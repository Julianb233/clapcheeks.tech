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
 * AI-9500 Wave 2.4D additions:
 *   - LAYER 1: Anti-loop collision detection via bodyShape (sha1-ish fingerprint
 *              of type + draft body prefix). Prevents the same message shape from
 *              firing to ANY person in the last 7 days.
 *   - LAYER 2: Boundary respect moved to convex_runner.py _draft_with_template,
 *              which runs BEFORE drafting and AFTER draft generation. The fireOne
 *              function delegates to the agent_jobs send_imessage job, which calls
 *              _draft_with_template — boundary checks happen there.
 *
 * AI-9500 #5 Anti-flake kit:
 *   When date_confirm_24h fires successfully, two follow-up touches are
 *   automatically scheduled:
 *   - date_dayof_transit  : (date_time - 90min) — "heading to <venue>, text
 *                           me when you're 5 out". Commitment device disguised
 *                           as logistics. Pre-commitment language drops flake
 *                           rate ~20% per randomized studies.
 *   - date_check_in       : (date_time - 30min) — low-pressure "you good?".
 *                           ONLY fires if last_inbound_at < (now - 60min).
 *                           If she's been actively chatting, skip with
 *                           skip_reason "she_is_active".
 *
 *   date metadata (venue + date_time_ms) is read from the touch's
 *   prompt_template field, stored as JSON: {"venue":"X","date_time_ms":N}.
 *   _extractDateMetaFromTouch() parses this safely with fallbacks.
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
  v.literal("date_dayof_transit"),     // AI-9500 #5 — 90min-before transit ping
  v.literal("date_check_in"),          // AI-9500 #5 — 30min-before silence check
  v.literal("date_postmortem"),
  v.literal("post_date_calibration"),  // AI-9500 #6
  v.literal("easy_question_revival"),  // AI-9500 #1
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
//
// Wave 2.4 Task G — when preview_only=true:
//   - touch is parked 1 year out so fireOne never auto-fires
//   - is_preview=true is written
//   - a draft_preview agent_job is enqueued for the Mac Mini convex_runner,
//     which calls _draft_with_template (boundaries-as-hard-rule + post-draft
//     validation regen pass) and writes the body back via touches:setPreviewDraft
//   - dashboard's reactive subscription renders the draft, operator edits +
//     calls touches:commitPreview to fire the standard send pipeline
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
    // Wave 2.4 Task G — operator-driven preview/compose flow.
    preview_only: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const isPreview = args.preview_only === true;
    const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
    const scheduledFor = isPreview ? now + ONE_YEAR_MS : args.scheduled_for;

    const touchId = await ctx.db.insert("scheduled_touches", {
      user_id: args.user_id,
      person_id: args.person_id,
      conversation_id: args.conversation_id,
      type: args.type,
      scheduled_for: scheduledFor,
      status: "scheduled",
      draft_body: args.draft_body,
      generate_at_fire_time: args.generate_at_fire_time,
      media_asset_id: args.media_asset_id,
      prompt_template: args.prompt_template,
      urgency: args.urgency,
      generated_by_run_id: args.generated_by_run_id,
      is_preview: isPreview ? true : undefined,
      created_at: now,
      updated_at: now,
    });

    if (isPreview) {
      // Mac Mini draft_preview job_handler picks this up via the agent_jobs queue.
      await ctx.db.insert("agent_jobs", {
        user_id: args.user_id,
        job_type: "draft_preview",
        payload: {
          touch_id: touchId,
          person_id: args.person_id,
          conversation_id: args.conversation_id,
          touch_type: args.type,
          prompt_template: args.prompt_template,
          media_asset_id: args.media_asset_id,
        },
        status: "queued",
        priority: 2,
        attempts: 0,
        max_attempts: 3,
        created_at: now,
        updated_at: now,
      } as any);
    } else {
      // Self-schedule: Convex fires at scheduled_for ± ~50ms (or immediately if past).
      const delayMs = Math.max(0, scheduledFor - now);
      await ctx.scheduler.runAfter(delayMs, internal.touches.fireOne, { touch_id: touchId });
    }
    return { touch_id: touchId, is_preview: isPreview };
  },
});

// ---------------------------------------------------------------------------
// Wave 2.4 Task G — commitPreview
// Operator clicked "Send" on the dossier compose panel. Patches the touch
// with edited_body, clears is_preview, sets scheduled_for, triggers fireOne
// so the standard send pipeline runs (whitelist / active-hours / anti-loop
// / cadence-mirror / boundary-respect all still apply).
// ---------------------------------------------------------------------------
export const commitPreview = mutation({
  args: {
    touch_id: v.id("scheduled_touches"),
    edited_body: v.string(),
    scheduled_for_ms: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const touch = await ctx.db.get(args.touch_id);
    if (!touch) return { not_found: true };
    if (touch.status !== "scheduled") return { wrong_status: touch.status };
    if (!touch.is_preview) return { not_a_preview: true };

    const fireAt = args.scheduled_for_ms ?? Date.now() + 5 * 60 * 1000;
    await ctx.db.patch(args.touch_id, {
      draft_body: args.edited_body,
      scheduled_for: fireAt,
      is_preview: false,
      generate_at_fire_time: false,
      updated_at: Date.now(),
    });
    const delayMs = Math.max(0, fireAt - Date.now());
    await ctx.scheduler.runAfter(delayMs, internal.touches.fireOne, {
      touch_id: args.touch_id,
    });
    return { committed: true, scheduled_for: fireAt };
  },
});

// ---------------------------------------------------------------------------
// Wave 2.4 Task G — setPreviewDraft (Mac Mini calls this after drafting)
// ---------------------------------------------------------------------------
export const setPreviewDraft = mutation({
  args: {
    touch_id: v.id("scheduled_touches"),
    draft_body: v.string(),
    template_used: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const touch = await ctx.db.get(args.touch_id);
    if (!touch) return { not_found: true };
    if (!touch.is_preview) return { not_a_preview: true };
    await ctx.db.patch(args.touch_id, {
      draft_body: args.draft_body,
      ...(args.template_used !== undefined ? { prompt_template: args.template_used } : {}),
      updated_at: Date.now(),
    });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Wave 2.4 Task G — listPreviewsForPerson
// Reactive read for ComposePanel to surface drafting/ready state.
// ---------------------------------------------------------------------------
export const listPreviewsForPerson = query({
  args: { person_id: v.id("people"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("scheduled_touches")
      .withIndex("by_person_status", (q) =>
        q.eq("person_id", args.person_id).eq("status", "scheduled"),
      )
      .order("desc")
      .take(Math.min(args.limit ?? 20, 50));
    return rows.filter((r) => r.is_preview === true);
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
// AI-9500 #5 — _extractDateMetaFromTouch
//
// Reads venue + date_time_ms from a touch row's prompt_template field.
// Metadata encoding: prompt_template carries JSON like
//   {"venue":"Bottega Louie","date_time_ms":1746000000000}
// when the touch was created via the date-ask flow.
//
// Falls back to safe defaults if the field is absent or non-JSON.
// ---------------------------------------------------------------------------
type DateMeta = { venue: string; date_time_ms: number };

function _extractDateMetaFromTouch(touch: {
  prompt_template?: string;
  scheduled_for: number;
}): DateMeta {
  let venue = "the spot";      // safe fallback
  let date_time_ms = touch.scheduled_for; // fallback: the touch's own fire time

  if (touch.prompt_template) {
    try {
      const parsed = JSON.parse(touch.prompt_template);
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.venue === "string" && parsed.venue.trim()) {
          venue = parsed.venue.trim();
        }
        if (typeof parsed.date_time_ms === "number" && parsed.date_time_ms > 0) {
          date_time_ms = parsed.date_time_ms;
        }
      }
    } catch {
      // Non-JSON prompt_template (plain template name). Keep defaults.
    }
  }
  return { venue, date_time_ms };
}

// ---------------------------------------------------------------------------
// AI-9500 #5 — _scheduleAntiFlakeTouches (internalMutation)
//
// Called by fireOne immediately after a date_confirm_24h touch fires.
// Schedules:
//   1. date_dayof_transit at (date_time_ms - 90min)
//      Draft: "heading to <venue> — text me when you're 5 min out"
//      (commitment device disguised as logistics)
//   2. date_check_in     at (date_time_ms - 30min)
//      Draft: "you good?" — silence-conditional at fire time
//      (fireOne enforces: skips if last_inbound_at >= now - 60min)
//
// Idempotent: if a scheduled touch of the same type already exists for this
// person, does not schedule another.
// ---------------------------------------------------------------------------
export const _scheduleAntiFlakeTouches = internalMutation({
  args: {
    user_id: v.string(),
    person_id: v.id("people"),
    conversation_id: v.optional(v.id("conversations")),
    venue: v.string(),
    date_time_ms: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const NINETY_MIN = 90 * 60 * 1000;
    const THIRTY_MIN = 30 * 60 * 1000;

    const transitAt = args.date_time_ms - NINETY_MIN;
    const checkInAt = args.date_time_ms - THIRTY_MIN;

    // Load pending touches to de-duplicate.
    const existingPending = await ctx.db
      .query("scheduled_touches")
      .withIndex("by_person_status", (q) =>
        q.eq("person_id", args.person_id).eq("status", "scheduled"),
      )
      .collect();

    const hasTransit = existingPending.some((t) => t.type === "date_dayof_transit");
    const hasCheckIn = existingPending.some((t) => t.type === "date_check_in");

    const scheduled: Array<{ type: string; at: number }> = [];
    const metaJson = JSON.stringify({ venue: args.venue, date_time_ms: args.date_time_ms });

    // 1. date_dayof_transit — 90 min before
    if (!hasTransit && transitAt > now) {
      const venuePart = args.venue !== "the spot" ? ` to ${args.venue}` : "";
      const transitDraft = `heading${venuePart} - text me when you're 5 min out`;
      const transitId = await ctx.db.insert("scheduled_touches", {
        user_id: args.user_id,
        person_id: args.person_id,
        conversation_id: args.conversation_id,
        type: "date_dayof_transit",
        scheduled_for: transitAt,
        status: "scheduled",
        draft_body: transitDraft,
        generate_at_fire_time: false,
        urgency: "hot",
        prompt_template: metaJson,
        created_at: now,
        updated_at: now,
      });
      await ctx.scheduler.runAt(transitAt, internal.touches.fireOne, { touch_id: transitId });
      scheduled.push({ type: "date_dayof_transit", at: transitAt });
    }

    // 2. date_check_in — 30 min before, silence-conditional at fire time
    if (!hasCheckIn && checkInAt > now) {
      const checkInId = await ctx.db.insert("scheduled_touches", {
        user_id: args.user_id,
        person_id: args.person_id,
        conversation_id: args.conversation_id,
        type: "date_check_in",
        scheduled_for: checkInAt,
        status: "scheduled",
        draft_body: "you good?",
        generate_at_fire_time: false,
        urgency: "hot",
        prompt_template: metaJson,
        created_at: now,
        updated_at: now,
      });
      await ctx.scheduler.runAt(checkInAt, internal.touches.fireOne, { touch_id: checkInId });
      scheduled.push({ type: "date_check_in", at: checkInAt });
    }

    return {
      scheduled,
      skipped_transit: hasTransit,
      skipped_check_in: hasCheckIn,
    };
  },
});

// ---------------------------------------------------------------------------
// _computeBodyShape — deterministic fingerprint for anti-loop detection.
//
// Convex Actions can use the Web Crypto API (globalThis.crypto). We compute
// sha1( type + ":" + draftBody.slice(0,50) ) as a hex string.
//
// Falls back to a pure-string hash if crypto.subtle is unavailable (unit tests,
// old runtimes). The fallback is "good enough" for dedup — not cryptographically
// secure, but that's not required here.
// ---------------------------------------------------------------------------
async function _computeBodyShape(type: string, draftBody: string): Promise<string> {
  const input = `${type}:${draftBody.slice(0, 50)}`;
  if (typeof crypto !== "undefined" && crypto.subtle) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(input);
      const hashBuffer = await crypto.subtle.digest("SHA-1", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
      // fall through to string hash
    }
  }
  // Deterministic djb2-style string hash (no crypto needed).
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return `noncrypto_${h.toString(16)}`;
}

// ---------------------------------------------------------------------------
// fireOne — runs at scheduled_for. Decides: send via agent_jobs, or skip.
// Skip cases: status no longer scheduled, person paused, outside active hours,
// safety brake (whitelist_for_autoreply false), boundaries violated.
//
// AI-9500 Wave 2.4D — LAYER 1: Anti-loop collision detection.
// Before enqueueing, compute bodyShape and check the last 7d of fired touches
// across ALL of this user's people. If any match, skip with anti_loop_collision.
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
    // AI-9500 Wave 2.4D — LAYER 1: Anti-loop collision detection.
    //
    // We compute a bodyShape fingerprint from the touch type + draft body
    // prefix (first 50 chars). If the same fingerprint fired in the last 7d
    // for ANY person under this user_id, we skip with anti_loop_collision.
    //
    // This prevents the cadence runner from repeatedly sending the same
    // "template + intro" combination across all conversations (e.g., firing
    // the same morning_text opener to 12 different girls in the same week).
    //
    // Note: digest_inclusion touches are exempt — they are not message sends
    // and have no body to deduplicate.
    // -----------------------------------------------------------------------
    if (touch.type !== "digest_inclusion") {
      const draftBody = touch.draft_body ?? "";
      const bodyShape = await _computeBodyShape(touch.type, draftBody);

      // Collect fired touches in the last 7 days for this user.
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const recentFired = await ctx.runQuery(internal.touches._getRecentFiredByUser, {
        user_id: touch.user_id,
        since_ms: sevenDaysAgo,
      });

      // Check for shape collision (skip the touch itself — it's still "scheduled").
      for (const fired of recentFired) {
        if (fired._id === args.touch_id) continue;
        if (fired.fired_body_shape === bodyShape) {
          await ctx.runMutation(internal.touches._markFired, {
            touch_id: args.touch_id,
            status: "skipped",
            skip_reason: "anti_loop_collision",
          });
          return {
            skipped: true,
            reason: "anti_loop_collision",
            skip_reason: "anti_loop_collision",
            colliding_touch_id: fired._id,
            body_shape: bodyShape,
          };
        }
      }

      // Store the bodyShape on the row so future fires can detect us.
      await ctx.runMutation(internal.touches._setBodyShape, {
        touch_id: args.touch_id,
        body_shape: bodyShape,
      });
    }

    // -----------------------------------------------------------------------
    // AI-9500 #5 — Silence check for date_check_in.
    //
    // date_check_in is conditional: only fire if she has been silent for
    // >= 60 min before this touch fires. If she's been actively texting,
    // skip — she's engaged and a check-in would be needy.
    //
    // Threshold: last_inbound_at < (now - 60min).
    // If last_inbound_at is unset, treat as silent (conservative: fire).
    // -----------------------------------------------------------------------
    if (touch.type === "date_check_in") {
      const SIXTY_MIN = 60 * 60 * 1000;
      const lastInbound = (person as any).last_inbound_at as number | undefined;
      if (lastInbound !== undefined && lastInbound >= Date.now() - SIXTY_MIN) {
        await ctx.runMutation(internal.touches._markFired, {
          touch_id: args.touch_id,
          status: "skipped",
          skip_reason: "she_is_active",
        });
        return { skipped: true, reason: "she_is_active", last_inbound_at: lastInbound };
      }
    }

    // Enqueue an agent_jobs row for the Mac Mini daemon to actually send.
    // (Actual send happens daemon-side because BlueBubbles HTTP is on Mac.)
    // Boundary-checking (Layer 2) runs inside convex_runner._draft_with_template.
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
    await ctx.runMutation(internal.touches._markFired, {
      touch_id: args.touch_id, status: "fired",
    });

    // -----------------------------------------------------------------------
    // AI-9500 #5 — Auto-schedule anti-flake touches after date_confirm_24h.
    //
    // When a date_confirm_24h fires successfully, schedule:
    //   - date_dayof_transit at (date_time - 90min)
    //   - date_check_in      at (date_time - 30min, silence-conditional)
    //
    // date_time is extracted from touch.prompt_template (JSON string).
    // Falls back to touch.scheduled_for as a best-effort proxy.
    // Non-fatal if scheduling fails — the confirm already went out.
    // -----------------------------------------------------------------------
    if (touch.type === "date_confirm_24h") {
      const dateMeta = _extractDateMetaFromTouch(touch as any);
      await ctx.runMutation(internal.touches._scheduleAntiFlakeTouches, {
        user_id: touch.user_id,
        person_id: touch.person_id,
        conversation_id: touch.conversation_id,
        venue: dateMeta.venue,
        date_time_ms: dateMeta.date_time_ms,
      });
    }

    return { fired: true, type: touch.type };
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

// AI-9500D: Query recent fired touches for a user (anti-loop).
// Uses the by_user_fired_at index to efficiently scan within the 7d window.
export const _getRecentFiredByUser = internalQuery({
  args: {
    user_id: v.string(),
    since_ms: v.number(),
  },
  handler: async (ctx, args) => {
    // Collect fired touches since since_ms across all people for this user.
    // We use by_user_status index to narrow to "fired" status, then filter by fired_at.
    // The by_user_fired_at index allows us to range-scan on fired_at.
    const rows = await ctx.db
      .query("scheduled_touches")
      .withIndex("by_user_fired_at", (q) =>
        q.eq("user_id", args.user_id).gte("fired_at", args.since_ms),
      )
      .filter((q) => q.eq(q.field("status"), "fired"))
      .collect();
    return rows;
  },
});

export const _markFired = internalMutation({
  args: {
    touch_id: v.id("scheduled_touches"),
    status: v.union(v.literal("fired"), v.literal("skipped"), v.literal("error")),
    skip_reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.touch_id, {
      status: args.status,
      skip_reason: args.skip_reason,
      fired_at: Date.now(),
      updated_at: Date.now(),
    });
  },
});

// AI-9500D: Store the bodyShape fingerprint before firing (for anti-loop).
export const _setBodyShape = internalMutation({
  args: {
    touch_id: v.id("scheduled_touches"),
    body_shape: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.touch_id, {
      fired_body_shape: args.body_shape,
      updated_at: Date.now(),
    });
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
