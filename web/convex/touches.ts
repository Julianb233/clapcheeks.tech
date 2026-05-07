/**
 * AI-9449 Phase A — scheduled_touches engine.
 *
 * Per-row scheduling instead of global polling. Every touch picks its own
 * runAt timestamp so Convex fires it within ~50ms of the target — no cron
 * scan, no rate-limit spikes, naturally spread load.
 *
 * Public API (called from Mac Mini daemon, dashboard, or other Convex fns):
 *   - scheduleOne     : insert + ctx.scheduler.runAt
 *   - cancelForPerson : when conversation state changes (e.g. she replied,
 *                       cancel pending nudge), cancel a person's pending touches
 *
 * Internal:
 *   - fireOne   : runs at scheduled_for; checks active hours / safety brake;
 *                 enqueues an agent_jobs.send_imessage row (or sends inline);
 *                 records as fired/skipped
 *   - drainDue  : safety net cron — finds any "scheduled" rows whose time has
 *                 passed and weren't fired (process crash, etc.)
 *
 * AI-9500-D: Anti-loop enforcement added to fireOne.
 *   Before enqueuing a send_imessage job, fireOne computes a pattern_hash =
 *   sha256(template_id + ":" + first_50_chars(draft_body)).  If any OTHER
 *   person for the same user received a fired touch with the same pattern_hash
 *   within the past 7 days, the touch is skipped with skip_reason
 *   "anti_loop_collision".  The hash is stored on the touch row when it fires.
 */

import { mutation, internalAction, internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

const TOUCH_TYPE = v.union(
  v.literal("reply"),
  v.literal("nudge"),
  v.literal("callback_reference"),
  v.literal("date_ask"),
  v.literal("date_confirm_24h"),
  v.literal("date_dayof"),
  v.literal("date_postmortem"),
  v.literal("reengage_low_temp"),
  v.literal("birthday_wish"),
  v.literal("event_day_check"),
  v.literal("pattern_interrupt"),
  v.literal("phone_swap_followup"),
  v.literal("first_call_invite"),
  v.literal("morning_text"),
  v.literal("digest_inclusion"),
);

// ---------------------------------------------------------------------------
// scheduleOne — insert + runAt. Returns touch_id.
// ---------------------------------------------------------------------------
export const scheduleOne = mutation({
  args: {
    user_id: v.string(),
    person_id: v.id("people"),
    conversation_id: v.optional(v.id("conversations")),
    type: TOUCH_TYPE,
    scheduled_for: v.number(),
    draft_body: v.optional(v.string()),
    generate_at_fire_time: v.optional(v.boolean()),
    media_asset_id: v.optional(v.id("media_assets")),
    prompt_template: v.optional(v.string()),
    urgency: v.optional(v.union(v.literal("hot"), v.literal("warm"), v.literal("cool"))),
    generated_by_run_id: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const touchId = await ctx.db.insert("scheduled_touches", {
      user_id: args.user_id,
      person_id: args.person_id,
      conversation_id: args.conversation_id,
      type: args.type,
      scheduled_for: args.scheduled_for,
      status: "scheduled",
      draft_body: args.draft_body,
      generate_at_fire_time: args.generate_at_fire_time,
      media_asset_id: args.media_asset_id,
      prompt_template: args.prompt_template,
      urgency: args.urgency,
      generated_by_run_id: args.generated_by_run_id,
      created_at: now,
      updated_at: now,
    });
    // Self-schedule: Convex fires at scheduled_for ± ~50ms (or immediately if past).
    const delayMs = Math.max(0, args.scheduled_for - now);
    await ctx.scheduler.runAfter(delayMs, internal.touches.fireOne, { touch_id: touchId });
    return { touch_id: touchId };
  },
});

// ---------------------------------------------------------------------------
// cancelForPerson — when she replies / state shifts, cancel pending touches
// of certain types (we don't want to nudge her 5 minutes after she replied).
// ---------------------------------------------------------------------------
export const cancelForPerson = mutation({
  args: {
    person_id: v.id("people"),
    types_to_cancel: v.optional(v.array(TOUCH_TYPE)),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query("scheduled_touches")
      .withIndex("by_person_status", (q) =>
        q.eq("person_id", args.person_id).eq("status", "scheduled"),
      )
      .collect();
    let cancelled = 0;
    const filterTypes = args.types_to_cancel
      ? new Set(args.types_to_cancel)
      : null;
    for (const t of pending) {
      if (filterTypes && !filterTypes.has(t.type as any)) continue;
      await ctx.db.patch(t._id, {
        status: "cancelled",
        skip_reason: args.reason ?? "superseded",
        updated_at: Date.now(),
      });
      cancelled++;
    }
    return { cancelled };
  },
});

// ---------------------------------------------------------------------------
// _computePatternHash — deterministic 52-char hex string derived from
// template_id and the first 50 chars of draft_body.  Used for anti-loop
// collision detection across different people within 7 days.
//
// Pure JS implementation (no Node crypto) so it runs inside Convex V8.
// Uses FNV-1a 64-bit (two 32-bit words) — good enough for collision detection
// without a full sha256 (which requires subtle crypto or a dependency).
// ---------------------------------------------------------------------------
function _computePatternHash(templateId: string, draftBody: string): string {
  const key = templateId + ":" + (draftBody || "").slice(0, 50);
  // FNV-1a 32-bit — fast, no dependencies, sufficient for collision detection.
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // Mix again with a second pass seeded by the first result for extra spread.
  let h2 = h ^ 0xdeadbeef;
  for (let i = key.length - 1; i >= 0; i--) {
    h2 ^= key.charCodeAt(i);
    h2 = Math.imul(h2, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// fireOne — runs at scheduled_for. Decides: send via agent_jobs, or skip.
// Skip cases: status no longer scheduled, person paused, outside active hours,
// safety brake (whitelist_for_autoreply false), boundaries violated.
//
// AI-9500-D: Anti-loop check added before enqueue.
//   Computes pattern_hash = fnv1a(template_id + ":" + first_50_chars(draft_body)).
//   If ANY other person for the same user had a touch fired with the same
//   pattern_hash in the past 7 days, skip with "anti_loop_collision".
//   Stores pattern_hash on the touch row so future calls can match.
// ---------------------------------------------------------------------------
export const fireOne = internalAction({
  args: { touch_id: v.id("scheduled_touches") },
  handler: async (ctx, args) => {
    const touch = await ctx.runQuery(internal.touches._getTouch, { touch_id: args.touch_id });
    if (!touch) return { skipped: true, reason: "touch_not_found" };
    if (touch.status !== "scheduled") return { skipped: true, reason: `status_${touch.status}` };

    const person = await ctx.runQuery(internal.touches._getPerson, { person_id: touch.person_id });
    if (!person) {
      await ctx.runMutation(internal.touches._markFired, {
        touch_id: args.touch_id, status: "skipped", skip_reason: "person_not_found",
      });
      return { skipped: true, reason: "person_not_found" };
    }

    // Safety brake — whitelist required for autoreply.
    if (!person.whitelist_for_autoreply && touch.type !== "digest_inclusion") {
      await ctx.runMutation(internal.touches._markFired, {
        touch_id: args.touch_id, status: "skipped", skip_reason: "not_whitelisted",
      });
      return { skipped: true, reason: "not_whitelisted" };
    }
    if (person.status === "paused" || person.status === "ended") {
      await ctx.runMutation(internal.touches._markFired, {
        touch_id: args.touch_id, status: "skipped", skip_reason: `person_${person.status}`,
      });
      return { skipped: true, reason: `person_${person.status}` };
    }

    // Active-hours respect (per girl's tz).
    const ah = person.active_hours_local;
    if (ah?.tz && typeof ah.start_hour === "number" && typeof ah.end_hour === "number") {
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: ah.tz, hour: "numeric", hour12: false,
      });
      const hourStr = fmt.format(new Date());
      const hour = parseInt(hourStr, 10);
      if (Number.isFinite(hour) && (hour < ah.start_hour || hour >= ah.end_hour)) {
        // Re-schedule for next active-hour window start.
        const nextWindowMs = nextHourLocalToUnix(ah.tz, ah.start_hour);
        await ctx.runMutation(internal.touches._reschedule, {
          touch_id: args.touch_id, scheduled_for: nextWindowMs,
        });
        await ctx.scheduler.runAt(nextWindowMs, internal.touches.fireOne, {
          touch_id: args.touch_id,
        });
        return { skipped: true, reason: "outside_active_hours", rescheduled_for: nextWindowMs };
      }
    }

    // -----------------------------------------------------------------------
    // AI-9500-D: Anti-loop collision check.
    //
    // Compute the pattern_hash for this touch. Query the last 7 days of fired
    // touches for this user. If any row for a DIFFERENT person carries the same
    // pattern_hash, skip with anti_loop_collision so Sarah and Kate don't both
    // receive the identical "btw you mentioned…" line within a week.
    //
    // pattern_hash is computed from (prompt_template || touch.type) and the
    // first 50 chars of draft_body.  generate_at_fire_time touches don't have
    // a draft_body yet — hash on template alone, which is still a signal that
    // the SAME template fired for the SAME user within 7d.
    // -----------------------------------------------------------------------
    const templateKey = (touch.prompt_template || touch.type) as string;
    const draftSnippet = (touch.draft_body || "").slice(0, 50);
    const patternHash = _computePatternHash(templateKey, draftSnippet);

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentFired = await ctx.runQuery(internal.touches._getRecentFiredByUser, {
      user_id: touch.user_id,
      since_ms: sevenDaysAgo,
    });
    for (const ft of recentFired) {
      if (
        ft.pattern_hash === patternHash &&
        ft.person_id !== touch.person_id
      ) {
        // Same pattern was sent to a different person within 7 days — skip.
        await ctx.runMutation(internal.touches._markSkippedWithHash, {
          touch_id: args.touch_id,
          skip_reason: "anti_loop_collision",
          pattern_hash: patternHash,
        });
        return {
          skipped: true,
          reason: "anti_loop_collision",
          pattern_hash: patternHash,
          collided_with_person: ft.person_id,
        };
      }
    }

    // -----------------------------------------------------------------------
    // AI-9500-E: Reply-velocity cadence-gap enforcement.
    //
    // If the person has cadence_overrides (computed by recalibrateCadenceForOne),
    // compare "now" against her last_inbound_at. If we're firing too soon after
    // her last reply (< min_reply_gap_ms), push the touch to
    //   lastReceived + min_reply_gap_ms + jitter(0..30s)
    // so Julian's AI reply mirrors her natural response rhythm.
    //
    // Additive: if cadence_overrides is absent (new person, not enough data),
    // the existing send path continues unchanged.
    // -----------------------------------------------------------------------
    const cadOvr = (person as any).cadence_overrides;
    if (cadOvr?.min_reply_gap_ms && person.last_inbound_at) {
      const nowMs = Date.now();
      const elapsedSinceHerReply = nowMs - person.last_inbound_at;
      if (elapsedSinceHerReply < cadOvr.min_reply_gap_ms) {
        // Too soon — reschedule to lastReceived + min_reply_gap_ms + jitter.
        const jitterMs = Math.floor(Math.random() * 30_000); // 0..30s
        const newScheduledFor = person.last_inbound_at + cadOvr.min_reply_gap_ms + jitterMs;
        await ctx.runMutation(internal.touches._reschedule, {
          touch_id: args.touch_id,
          scheduled_for: newScheduledFor,
        });
        await ctx.scheduler.runAt(newScheduledFor, internal.touches.fireOne, {
          touch_id: args.touch_id,
        });
        return {
          rescheduled: true,
          reason: "cadence_gap_too_soon",
          new_scheduled_for: newScheduledFor,
          elapsed_ms: elapsedSinceHerReply,
          min_gap_ms: cadOvr.min_reply_gap_ms,
        };
      }
    }

    // Enqueue an agent_jobs row for the Mac Mini daemon to actually send.
    // (Actual send happens daemon-side because BlueBubbles HTTP is on Mac.)
    await ctx.runMutation(internal.touches._enqueueSendJob, {
      user_id: touch.user_id,
      person_id: touch.person_id,
      conversation_id: touch.conversation_id,
      type: touch.type,
      draft_body: touch.draft_body,
      generate_at_fire_time: touch.generate_at_fire_time,
      media_asset_id: touch.media_asset_id,
      prompt_template: touch.prompt_template,
    });
    // Mark fired AND store the pattern_hash for future anti-loop checks.
    await ctx.runMutation(internal.touches._markFired, {
      touch_id: args.touch_id, status: "fired", pattern_hash: patternHash,
    });
    return { fired: true, type: touch.type, pattern_hash: patternHash };
  },
});

// ---------------------------------------------------------------------------
// drainDue — safety-net cron. Catches any "scheduled" rows past their time
// that didn't fire (process crash before runAt resolved, etc.).
// ---------------------------------------------------------------------------
export const drainDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("scheduled_touches")
      .withIndex("by_due", (q) => q.eq("status", "scheduled").lte("scheduled_for", now))
      .take(50);
    let scheduled = 0;
    for (const t of due) {
      await ctx.scheduler.runAfter(0, internal.touches.fireOne, { touch_id: t._id });
      scheduled++;
    }
    return { scheduled, scanned: due.length };
  },
});

// ---------------------------------------------------------------------------
// Internal queries / mutations used by the action above.
// ---------------------------------------------------------------------------
import { internalQuery } from "./_generated/server";

export const _getTouch = internalQuery({
  args: { touch_id: v.id("scheduled_touches") },
  handler: async (ctx, args) => await ctx.db.get(args.touch_id),
});

export const _getPerson = internalQuery({
  args: { person_id: v.id("people") },
  handler: async (ctx, args) => await ctx.db.get(args.person_id),
});

export const _markFired = internalMutation({
  args: {
    touch_id: v.id("scheduled_touches"),
    status: v.union(v.literal("fired"), v.literal("skipped"), v.literal("error")),
    skip_reason: v.optional(v.string()),
    // AI-9500-D: store pattern_hash on the row when firing so future
    // fireOne calls can detect anti-loop collisions across people.
    pattern_hash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.touch_id, {
      status: args.status,
      skip_reason: args.skip_reason,
      fired_at: Date.now(),
      updated_at: Date.now(),
      ...(args.pattern_hash !== undefined ? { pattern_hash: args.pattern_hash } : {}),
    });
  },
});

// AI-9500-D: Skip with hash — marks the touch skipped AND stores the
// pattern_hash so the collision is auditable in the dashboard.
export const _markSkippedWithHash = internalMutation({
  args: {
    touch_id: v.id("scheduled_touches"),
    skip_reason: v.string(),
    pattern_hash: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.touch_id, {
      status: "skipped",
      skip_reason: args.skip_reason,
      pattern_hash: args.pattern_hash,
      fired_at: Date.now(),
      updated_at: Date.now(),
    });
  },
});

// AI-9500-D: Return all fired touches for a user since since_ms, including
// their pattern_hash and person_id, for the anti-loop check.
// Uses the by_user_fired_at index defined in schema.ts.
// Cap at 500 rows (realistic — 7d × ~10 fires/day = 70 rows for most users).
export const _getRecentFiredByUser = internalQuery({
  args: {
    user_id: v.string(),
    since_ms: v.number(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("scheduled_touches")
      .withIndex("by_user_fired", (q) =>
        q.eq("user_id", args.user_id).gte("fired_at", args.since_ms),
      )
      .filter((q) => q.eq(q.field("status"), "fired"))
      .take(500);
    return rows.map((r) => ({
      _id: r._id,
      person_id: r.person_id,
      pattern_hash: r.pattern_hash,
      fired_at: r.fired_at,
    }));
  },
});

export const _reschedule = internalMutation({
  args: { touch_id: v.id("scheduled_touches"), scheduled_for: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.touch_id, {
      scheduled_for: args.scheduled_for, updated_at: Date.now(),
    });
  },
});

export const _enqueueSendJob = internalMutation({
  args: {
    user_id: v.string(),
    person_id: v.id("people"),
    conversation_id: v.optional(v.id("conversations")),
    type: v.string(),
    draft_body: v.optional(v.string()),
    generate_at_fire_time: v.optional(v.boolean()),
    media_asset_id: v.optional(v.id("media_assets")),
    prompt_template: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("agent_jobs", {
      user_id: args.user_id,
      job_type: "send_imessage",
      payload: {
        person_id: args.person_id,
        conversation_id: args.conversation_id,
        touch_type: args.type,
        draft_body: args.draft_body,
        generate_at_fire_time: args.generate_at_fire_time,
        media_asset_id: args.media_asset_id,
        prompt_template: args.prompt_template,
      },
      status: "queued",
      priority: args.type.startsWith("date_") ? 1 : 5,
      attempts: 0,
      max_attempts: 3,
      created_at: now,
      updated_at: now,
    } as any);
  },
});

// Dashboard reader: upcoming scheduled touches across all people.
export const listUpcoming = query({
  args: {
    user_id: v.string(),
    horizon_hours: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const horizon = (args.horizon_hours ?? 72) * 60 * 60 * 1000;
    const rows = await ctx.db
      .query("scheduled_touches")
      .withIndex("by_user_status", (q) => q.eq("user_id", args.user_id).eq("status", "scheduled"))
      .collect();
    const upcoming = rows
      .filter((r) => r.scheduled_for >= now && r.scheduled_for <= now + horizon)
      .sort((a, b) => a.scheduled_for - b.scheduled_for)
      .slice(0, Math.min(args.limit ?? 100, 500));
    return upcoming;
  },
});

// Manual cancel button on dashboard.
export const cancelOne = mutation({
  args: { touch_id: v.id("scheduled_touches"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const t = await ctx.db.get(args.touch_id);
    if (!t) return { not_found: true };
    if (t.status !== "scheduled") return { skipped: true, status: t.status };
    await ctx.db.patch(args.touch_id, {
      status: "cancelled",
      skip_reason: args.reason ?? "manual",
      updated_at: Date.now(),
    });
    return { cancelled: true };
  },
});

// Public reader for dashboard.
export const listForPerson = query({
  args: { person_id: v.id("people"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("scheduled_touches")
      .withIndex("by_person_status", (q) => q.eq("person_id", args.person_id))
      .order("desc")
      .take(Math.min(args.limit ?? 50, 200));
    return rows;
  },
});

// ---------------------------------------------------------------------------
// nextHourLocalToUnix — given a tz and an hour 0..23, return the next unix ms
// when that hour starts in that tz. Used for active-hours rescheduling.
// ---------------------------------------------------------------------------
function nextHourLocalToUnix(tz: string, hour: number): number {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "numeric", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const yyyy = parseInt(get("year"), 10);
  const mm = parseInt(get("month"), 10);
  const dd = parseInt(get("day"), 10);
  const currentHour = parseInt(get("hour"), 10);
  // Build target as tz-local YYYY-MM-DDTHH:00:00 then re-parse in that tz.
  const targetDay = currentHour < hour ? dd : dd + 1;  // tomorrow if past today's window
  const iso = `${yyyy}-${String(mm).padStart(2,"0")}-${String(targetDay).padStart(2,"0")}T${String(hour).padStart(2,"0")}:00:00`;
  // Approximate: assume tz offset stable. Use Date constructor + tz fmt diff.
  const utcGuess = Date.parse(iso + "Z");
  const tzOffsetMs = now.getTime() - Date.parse(
    new Intl.DateTimeFormat("sv-SE", { timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).format(now).replace(" ", "T") + "Z",
  );
  return utcGuess - tzOffsetMs;
}
