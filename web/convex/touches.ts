/**
 * AI-9449 Phase A — scheduled_touches engine.
 *
 * AI-9500 W2 #G additions (voice-memo trigger):
 *   - sweepVoiceMemoCandidates  : internalMutation cron (every 6h).
 *                                 Detects three high-leverage moments and schedules a
 *                                 voice_memo touch for each qualifying person:
 *                                   1. Phone-swap +24h  — courtship_stage="phone_swap",
 *                                      no voice_memo sent yet.
 *                                   2. 3rd inbound reply — exactly 3 total inbound messages
 *                                      across all their conversations, no voice_memo yet.
 *                                   3. Post-second-date  — 2 post_date_calibration touches
 *                                      both fired, no voice_memo in last 7d.
 *                                 Each touch carries a short script in draft_body so the
 *                                 operator knows what to say before recording on their phone.
 *   - markVoiceMemoSent          : mutation. Operator calls after physically sending the
 *                                 voice memo. Patches the touch to status="fired" and
 *                                 records sent_at so the sweep won't re-schedule.
 *
 * Per-row scheduling instead of global polling. Every touch picks its own
 * runAt timestamp so Convex fires it within ~50ms of the target — no cron
 * scan, no rate-limit spikes, naturally spread load.
 *
 * Public API (called from Mac Mini daemon, dashboard, or other Convex fns):
 *   - scheduleOne     : insert + ctx.scheduler.runAt
 *   - cancelForPerson : when conversation state changes (e.g. she replied,
 *                       cancel pending nudge), cancel a person's pending touches
 *   - markDateDone    : AI-9500 #6 — operator calls after a date completes.
 *                       Schedules a post_date_calibration touch +18h out.
 *   - commitPostDateChoice : AI-9500 #6 — operator picks one of 3 candidates.
 *                            Copies body to draft_body and fires the standard pipeline.
 *
 * Internal:
 *   - fireOne   : runs at scheduled_for; checks active hours / safety brake;
 *                 enqueues an agent_jobs.send_imessage row (or sends inline);
 *                 records as fired/skipped.
 *                 AI-9500 #6: when type=post_date_calibration, calls
 *                 _draft3PostDateCandidates and parks row for operator choice.
 *   - drainDue  : safety net cron — finds any "scheduled" rows whose time has
 *                 passed and weren't fired (process crash, etc.)
 *   - autoPick6hCron : AI-9500 #6 — 1h interval cron. If a post_date_calibration
 *                      touch has candidate_drafts but operator hasn't chosen within 6h,
 *                      auto-picks "callback" and fires.
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
  v.literal("pre_date_debrief"),       // AI-9500 W2 #K — debrief Julian 2h before a date
  v.literal("soft_no_recovery"),       // AI-9500 W2 #B — +14d re-ask after soft_no
  v.literal("voice_memo"),             // AI-9500 W2 #G — voice memo at high-leverage moment
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
// AI-9500 #6 — markDateDone
//
// Operator calls this from the dossier page once a date has completed.
// Patches the originating touch (if given) with date_done_at / date_notes_text,
// then schedules a post_date_calibration touch +18h out.
//
// The post_date_calibration touch starts in status="scheduled" and will NOT
// auto-send: fireOne detects the type, calls _draft3PostDateCandidates, writes
// candidate_drafts, and leaves the touch in scheduled status for the operator
// to choose via commitPostDateChoice (or autoPick6hCron fires after 6h).
// ---------------------------------------------------------------------------
export const markDateDone = mutation({
  args: {
    user_id: v.string(),
    person_id: v.id("people"),
    conversation_id: v.optional(v.id("conversations")),
    // Optionally patch the originating date_ask/date_dayof touch with notes.
    source_touch_id: v.optional(v.id("scheduled_touches")),
    date_done_at: v.number(),                  // unix ms — when the date ended
    date_notes_text: v.optional(v.string()),   // operator notes about the date
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Patch the source touch if given.
    if (args.source_touch_id) {
      const src = await ctx.db.get(args.source_touch_id);
      if (src && src.person_id === args.person_id) {
        await ctx.db.patch(args.source_touch_id, {
          date_done_at: args.date_done_at,
          date_notes_text: args.date_notes_text,
          updated_at: now,
        });
      }
    }

    // Schedule the calibration touch +18h from date_done_at (or from now if date_done_at is in the past).
    const fireAt = Math.max(args.date_done_at + 18 * 60 * 60 * 1000, now + 60 * 1000);
    const calibrationTouchId = await ctx.db.insert("scheduled_touches", {
      user_id: args.user_id,
      person_id: args.person_id,
      conversation_id: args.conversation_id,
      type: "post_date_calibration",
      scheduled_for: fireAt,
      status: "scheduled",
      generate_at_fire_time: true,              // fireOne generates candidates
      date_done_at: args.date_done_at,
      date_notes_text: args.date_notes_text,
      created_at: now,
      updated_at: now,
    });

    const delayMs = Math.max(0, fireAt - now);
    await ctx.scheduler.runAfter(delayMs, internal.touches.fireOne, {
      touch_id: calibrationTouchId,
    });

    return { scheduled: true, touch_id: calibrationTouchId, fire_at: fireAt };
  },
});

// ---------------------------------------------------------------------------
// AI-9500 #6 — commitPostDateChoice
//
// Operator has reviewed the 3 candidate drafts and picked one.
// Copies the chosen body to draft_body and runs the standard send pipeline.
// ---------------------------------------------------------------------------
export const commitPostDateChoice = mutation({
  args: {
    touch_id: v.id("scheduled_touches"),
    chosen_kind: v.union(
      v.literal("callback"),
      v.literal("photo"),
      v.literal("generic"),
    ),
  },
  handler: async (ctx, args) => {
    const touch = await ctx.db.get(args.touch_id);
    if (!touch) return { not_found: true };
    if (touch.type !== "post_date_calibration") return { wrong_type: touch.type };
    if (touch.status !== "scheduled") return { wrong_status: touch.status };
    if (!touch.candidate_drafts?.length) return { no_candidates: true };

    const chosen = touch.candidate_drafts.find((c) => c.kind === args.chosen_kind);
    if (!chosen) {
      // Fall back to first candidate if kind not found.
      const first = touch.candidate_drafts[0];
      await ctx.db.patch(args.touch_id, {
        draft_body: first.body,
        generate_at_fire_time: false,
        updated_at: Date.now(),
      });
    } else {
      await ctx.db.patch(args.touch_id, {
        draft_body: chosen.body,
        generate_at_fire_time: false,
        updated_at: Date.now(),
      });
    }

    // Schedule immediate fire through the standard pipeline.
    const fireAt = Date.now() + 5 * 60 * 1000; // 5 min buffer for active-hours check
    await ctx.db.patch(args.touch_id, { scheduled_for: fireAt, updated_at: Date.now() });
    await ctx.scheduler.runAfter(5 * 60 * 1000, internal.touches.fireOne, {
      touch_id: args.touch_id,
    });
    return { committed: true, chosen_kind: args.chosen_kind };
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
    // date_check_in fires only if she's been silent >= 60min. If she's been
    // actively texting, skip — the check-in would feel needy, not caring.
    // Threshold: last_inbound_at < (now - 60min). Unset = treat as silent.
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

    // -----------------------------------------------------------------------
    // AI-9500 #6 — post_date_calibration special handling.
    //
    // Instead of immediately enqueueing a send job, we generate 3 candidate
    // drafts and park the touch for operator review. The touch STAYS in
    // "scheduled" status — it is NOT marked fired yet. The autoPick6hCron
    // will auto-fire after 6h if the operator hasn't chosen.
    // -----------------------------------------------------------------------
    if (touch.type === "post_date_calibration") {
      const candidates = await ctx.runAction(internal.touches._draft3PostDateCandidates, {
        user_id: touch.user_id,
        person_id: touch.person_id,
        date_notes_text: touch.date_notes_text,
      });
      await ctx.runMutation(internal.touches._setPostDateCandidates, {
        touch_id: args.touch_id,
        candidates,
      });
      // Do NOT mark as fired — leave in "scheduled" so operator can pick.
      return { parked_for_choice: true, type: touch.type, candidates };
    }


    // -----------------------------------------------------------------------
    // AI-9500 Wave2 #K — pre_date_debrief special handling.
    //
    // Generate a debrief card from getDebriefCard and write it as draft_body
    // (Markdown summary) on the touch row. This is NOT sent to her — it is
    // surfaced in the dashboard for Julian to read 2h before the date.
    // The touch is marked fired immediately; the card lives in draft_body.
    // -----------------------------------------------------------------------
    if (touch.type === "pre_date_debrief") {
      const debriefCard: any = await ctx.runQuery(internal.touches._getDebriefCard, {
        person_id: touch.person_id,
        user_id: touch.user_id,
      });
      const cardMarkdown = _renderDebriefMarkdown(debriefCard);
      await ctx.runMutation(internal.touches._setDebriefDraft, {
        touch_id: args.touch_id,
        draft_body: cardMarkdown,
      });
      await ctx.runMutation(internal.touches._markFired, {
        touch_id: args.touch_id, status: "fired",
      });
      return { fired: true, type: touch.type, debrief_generated: true };
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
    // On successful fire of date_confirm_24h, schedule:
    //   - date_dayof_transit at (date_time - 90min)
    //   - date_check_in      at (date_time - 30min, silence-conditional)
    //
    // date_time is read from prompt_template JSON. Fallback: scheduled_for.
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

// ---------------------------------------------------------------------------
// AI-9500 Wave2 #K — internal helpers for pre_date_debrief
// ---------------------------------------------------------------------------

// _getDebriefCard — thin query wrapper so internalAction can call it
export const _getDebriefCard = internalMutation({
  args: {
    person_id: v.id("people"),
    user_id: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const person = await ctx.db.get(args.person_id);
    if (!person) return null;

    const thingsMentioned = (person.things_mentioned ?? [])
      .slice()
      .sort((a: any, b: any) => b.said_at_ms - a.said_at_ms)
      .slice(0, 5);

    const tags = person.tags ?? [];

    const emotionalStateHistory = person.emotional_state_recent ?? [];
    const latestEmotionalState = emotionalStateHistory.length
      ? emotionalStateHistory[emotionalStateHistory.length - 1]
      : null;

    const topicsLitUp = (person.topics_that_lit_her_up ?? [])
      .slice()
      .sort((a: any, b: any) => (b.signal_count ?? 0) - (a.signal_count ?? 0))
      .slice(0, 3);

    const curiosityQuestions = (person.curiosity_ledger ?? [])
      .filter((q: any) => q.status === "pending")
      .slice()
      .sort((a: any, b: any) => (b.priority ?? 0) - (a.priority ?? 0))
      .slice(0, 3);

    // Last known venue
    const checklists = await ctx.db
      .query("date_logistics_checklists")
      .withIndex("by_person", (q: any) => q.eq("person_id", args.person_id))
      .order("desc")
      .take(5);

    let lastKnownVenue: string | null = null;
    for (const c of checklists) {
      if (c.venue) { lastKnownVenue = c.venue; break; }
    }

    return {
      display_name: person.display_name,
      courtship_stage: person.courtship_stage,
      tags,
      things_mentioned: thingsMentioned,
      latest_emotional_state: latestEmotionalState,
      topics_that_lit_her_up: topicsLitUp,
      curiosity_questions: curiosityQuestions,
      last_known_venue: lastKnownVenue,
      boundaries_stated: person.boundaries_stated ?? [],
      things_she_loves: (person.things_she_loves ?? []).slice(0, 5),
      next_best_move: person.next_best_move,
      green_flags: (person.green_flags ?? []).slice(0, 3),
      red_flags: (person.red_flags ?? []).slice(0, 3),
    };
  },
});

// _setDebriefDraft — write the generated markdown card back to the touch row
export const _setDebriefDraft = internalMutation({
  args: {
    touch_id: v.id("scheduled_touches"),
    draft_body: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.touch_id, {
      draft_body: args.draft_body,
      updated_at: Date.now(),
    });
  },
});

// _renderDebriefMarkdown — pure function, renders the debrief card as Markdown
function _renderDebriefMarkdown(card: any): string {
  if (!card) return "# Pre-Date Debrief\n\n_No data available._";

  const lines: string[] = [
    `# Pre-Date Debrief — ${card.display_name ?? "?"}`,
    `**Stage:** ${card.courtship_stage ?? "unknown"}`,
    "",
  ];

  if (card.tags?.length) {
    lines.push(`**Tags:** ${card.tags.map((t: string) => `#${t}`).join(" ")}`);
    lines.push("");
  }

  if (card.latest_emotional_state) {
    const es = card.latest_emotional_state;
    lines.push(`**Recent vibe:** ${es.state} (intensity ${es.intensity?.toFixed(1) ?? "?"}) — ${new Date(es.observed_at_ms).toLocaleDateString()}`);
    lines.push("");
  }

  if (card.things_mentioned?.length) {
    lines.push("## Things She Mentioned");
    for (const t of card.things_mentioned) {
      const detail = t.detail ? ` — ${t.detail}` : "";
      lines.push(`- **${t.topic}**${detail}`);
    }
    lines.push("");
  }

  if (card.topics_that_lit_her_up?.length) {
    lines.push("## Topics That Lit Her Up");
    for (const t of card.topics_that_lit_her_up) {
      lines.push(`- ${t.topic} (×${t.signal_count ?? 1} signals)`);
    }
    lines.push("");
  }

  if (card.curiosity_questions?.length) {
    lines.push("## Questions to Bring Up");
    for (const q of card.curiosity_questions) {
      const topic = q.topic ? ` [${q.topic}]` : "";
      lines.push(`- ${q.question}${topic}`);
    }
    lines.push("");
  }

  if (card.things_she_loves?.length) {
    lines.push(`**She loves:** ${card.things_she_loves.join(", ")}`);
  }

  if (card.boundaries_stated?.length) {
    lines.push(`**Boundaries (respect these):** ${card.boundaries_stated.join(", ")}`);
  }

  if (card.last_known_venue) {
    lines.push(`**Last known venue:** ${card.last_known_venue}`);
  }

  if (card.next_best_move) {
    lines.push(`\n**Next best move:** ${card.next_best_move}`);
  }

  if (card.green_flags?.length) {
    lines.push(`\n**Green flags:** ${card.green_flags.join(", ")}`);
  }

  if (card.red_flags?.length) {
    lines.push(`**Watch out for:** ${card.red_flags.join(", ")}`);
  }

  return lines.join("\n");
}

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
// AI-9500 #6 — _draft3PostDateCandidates (internalAction)
//
// Given person context and operator date notes, call the LLM to produce 3
// candidate follow-up messages:
//   "callback" — references a specific moment from date_notes_text (3x conversion)
//   "photo"    — frame around sharing a photo from the date or the day
//   "generic"  — warm, non-pressuring thanks / light callback
//
// Returns the 3 candidates as an array. fireOne writes them to candidate_drafts.
// ---------------------------------------------------------------------------
export const _draft3PostDateCandidates = internalAction({
  args: {
    user_id: v.string(),
    person_id: v.id("people"),
    date_notes_text: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Array<{ kind: string; body: string; reasoning: string }>> => {
    // Fetch person context for personalization.
    const person = await ctx.runQuery(internal.touches._getPerson, { person_id: args.person_id });
    const name = person?.display_name ?? "her";
    const references = person?.references_to_callback ?? [];
    const thingsSheLoves = person?.things_she_loves ?? [];
    const notes = args.date_notes_text ?? "";

    const systemPrompt = `You are a dating-coach AI helping a man craft the perfect post-date follow-up text.
Your job is to generate 3 distinct candidate messages for after a first date.
You MUST return ONLY valid JSON with no other text: an array of 3 objects each with keys "kind", "body", and "reasoning".

Rules:
- "body" is the actual text message to send (short, casual, no emojis overload, sounds like a real human)
- Messages should be warm but not needy, specific but not overwhelming
- The "callback" kind MUST reference a specific moment or detail from the date notes if available
- The "photo" kind should naturally invite sharing a photo moment from the date/day
- The "generic" kind is a warm, low-pressure message that works even with minimal notes
- Keep all bodies under 120 characters — these are texts, not essays`;

    const userPrompt = `Her name: ${name}
Date notes from operator: ${notes || "No specific notes provided."}
Known things she loves: ${thingsSheLoves.slice(0, 5).join(", ") || "unknown"}
Past callback references we've used: ${references.slice(0, 3).join(", ") || "none"}

Generate the 3 candidate follow-up texts now. Return JSON array only.
Example format:
[
  {"kind":"callback","body":"Had to laugh thinking about the thing with the [specific moment]...","reasoning":"References the specific moment she animated about — 3x conversion vs generic"},
  {"kind":"photo","body":"Still thinking about [location] — you should send me that photo you took","reasoning":"Creates a natural excuse for continued interaction via photo sharing"},
  {"kind":"generic","body":"[Name] — tonight was actually really fun. Let's do it again soon","reasoning":"Safe fallback — warm without pressure, leaves ball in her court"}
]`;

    // Call the LLM via the same cascade used elsewhere in enrichment.ts
    const gemKey = process.env.GEMINI_API_KEY;
    const dsKey = process.env.DEEPSEEK_API_KEY;
    const grokKey = process.env.XAI_API_KEY;

    let result: any = null;

    async function tryGeminiLocal(key: string): Promise<any> {
      const model = process.env.CC_VIBE_MODEL_GEMINI ?? "gemini-2.0-flash";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
            generationConfig: { responseMimeType: "application/json", temperature: 0.7, maxOutputTokens: 400 },
          }),
        });
        if (!r.ok) return null;
        const j: any = await r.json();
        const text = j?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) return null;
        return JSON.parse(text);
      } catch { return null; }
    }

    async function tryOpenAICompatLocal(url: string, key: string, model: string): Promise<any> {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            temperature: 0.7,
            max_tokens: 400,
          }),
        });
        if (!r.ok) return null;
        const j: any = await r.json();
        const text = j?.choices?.[0]?.message?.content;
        if (!text) return null;
        // Strip markdown code fences if present
        const clean = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
        return JSON.parse(clean);
      } catch { return null; }
    }

    if (gemKey) result = await tryGeminiLocal(gemKey);
    if (!result && dsKey) result = await tryOpenAICompatLocal("https://api.deepseek.com/chat/completions", dsKey, "deepseek-chat");
    if (!result && grokKey) result = await tryOpenAICompatLocal("https://api.x.ai/v1/chat/completions", grokKey, "grok-2-latest");

    // Validate: must be array of 3 objects with kind + body.
    if (Array.isArray(result) && result.length >= 1 && result[0]?.kind && result[0]?.body) {
      return result.slice(0, 3).map((c: any) => ({
        kind: String(c.kind),
        body: String(c.body).slice(0, 200),
        reasoning: String(c.reasoning ?? "").slice(0, 300),
      }));
    }

    // LLM failed — return safe fallbacks so the feature still works.
    console.warn(`_draft3PostDateCandidates: LLM failed for person ${args.person_id}, using fallbacks`);
    const fallbackName = name.split(" ")[0];
    return [
      {
        kind: "callback",
        body: notes
          ? `Was just thinking about ${notes.slice(0, 40).split(".")[0].toLowerCase()}... good times`
          : `${fallbackName} — I keep thinking about tonight. Really good time.`,
        reasoning: "Fallback callback — references notes if available",
      },
      {
        kind: "photo",
        body: `Still smiling from tonight. You should send me that pic if you grabbed one`,
        reasoning: "Fallback photo invite — natural excuse for continued contact",
      },
      {
        kind: "generic",
        body: `${fallbackName} — tonight was genuinely fun. Let's do this again`,
        reasoning: "Fallback generic — warm, no pressure, open door",
      },
    ];
  },
});

// ---------------------------------------------------------------------------
// AI-9500 #6 — _setPostDateCandidates (internalMutation)
// Writes the 3 candidate drafts to the touch row.
// ---------------------------------------------------------------------------
export const _setPostDateCandidates = internalMutation({
  args: {
    touch_id: v.id("scheduled_touches"),
    candidates: v.array(v.object({
      kind: v.string(),
      body: v.string(),
      reasoning: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.touch_id, {
      candidate_drafts: args.candidates,
      updated_at: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// AI-9500 #6 — autoPick6hCron (internalMutation)
//
// Called by a 1h-interval cron. Scans for post_date_calibration touches with
// candidate_drafts set but no choice committed after 6h. Auto-picks "callback"
// (the highest-converting kind) and fires via the standard pipeline.
// ---------------------------------------------------------------------------
export const autoPick6hCron = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const sixHoursAgo = now - 6 * 60 * 60 * 1000;

    // Find post_date_calibration touches still in "scheduled" with candidates
    // but updated (candidates generated) more than 6h ago.
    const candidates = await ctx.db
      .query("scheduled_touches")
      .withIndex("by_due", (q) => q.eq("status", "scheduled").lte("scheduled_for", now + 18 * 60 * 60 * 1000))
      .filter((q) => q.eq(q.field("type"), "post_date_calibration"))
      .collect();

    let autoPicked = 0;
    for (const touch of candidates) {
      if (!touch.candidate_drafts?.length) continue;
      // Only auto-pick if touch was scheduled and candidates have been set for 6+ hours.
      // We use updated_at as the proxy for when candidates were written.
      if (touch.updated_at > sixHoursAgo) continue;
      // Already has a draft_body = operator chose. Skip.
      if (touch.draft_body) continue;

      // Auto-pick "callback" — the highest-converting kind.
      const callbackCandidate = touch.candidate_drafts.find((c) => c.kind === "callback");
      const chosen = callbackCandidate ?? touch.candidate_drafts[0];

      const fireAt = now + 5 * 60 * 1000;
      await ctx.db.patch(touch._id, {
        draft_body: chosen.body,
        generate_at_fire_time: false,
        scheduled_for: fireAt,
        updated_at: now,
      });
      await ctx.scheduler.runAfter(5 * 60 * 1000, internal.touches.fireOne, {
        touch_id: touch._id,
      });
      autoPicked++;
    }

    return { scanned: candidates.length, auto_picked: autoPicked };
  },
});

// ---------------------------------------------------------------------------
// AI-9500 W2 #B — _scheduleSoftNoRecovery (internalMutation)
//
// Called immediately after ask_outcome is patched to "soft_no" on a date_ask
// touch (by upsertFromWebhook in messages.ts, or by the 6h sweep cron).
//
// Schedules a soft_no_recovery touch +14 days from now. The draft is a
// lower-pressure, smaller-ask message that references a specific moment from
// her recent messages (NOT another "want to grab dinner" — the ask that already
// got a soft_no). Her topics_that_lit_her_up / things_she_loves fields from
// the people row are used to personalise the callback reference.
//
// Idempotent: if a soft_no_recovery touch is already scheduled for this person
// (status=scheduled), skips and returns {skipped: true, reason: "already_scheduled"}.
// Records recovery_scheduled_at on the source date_ask touch so the sweep cron
// can skip already-processed rows.
// ---------------------------------------------------------------------------
export const _scheduleSoftNoRecovery = internalMutation({
  args: {
    source_touch_id: v.id("scheduled_touches"),  // the date_ask touch whose outcome=soft_no
    user_id: v.string(),
    person_id: v.id("people"),
    conversation_id: v.optional(v.id("conversations")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

    // Idempotency: check for an existing pending soft_no_recovery for this person.
    const existing = await ctx.db
      .query("scheduled_touches")
      .withIndex("by_person_status", (q) =>
        q.eq("person_id", args.person_id).eq("status", "scheduled"),
      )
      .filter((q) => q.eq(q.field("type"), "soft_no_recovery"))
      .first();

    if (existing) {
      // Already have a pending recovery — mark source and return.
      await ctx.db.patch(args.source_touch_id, {
        recovery_scheduled_at: existing.scheduled_for,
        updated_at: now,
      } as any);
      return { skipped: true, reason: "already_scheduled", existing_touch_id: existing._id };
    }

    // Fetch person context to personalise the draft.
    const person = await ctx.db.get(args.person_id);
    const firstName = (person?.display_name ?? "").split(" ")[0] || "hey";

    // Build a contextual lower-pressure draft:
    //   - Use her topics_that_lit_her_up[0] or things_she_loves[0] as callback anchor.
    //   - Smaller ask: coffee / walk / 30 min (NOT another dinner ask).
    //   - generate_at_fire_time=true so the Mac Mini convex_runner drafts it fresh
    //     with full conversation context at fire time — the prompt_template carries
    //     the coaching instructions.
    const litTopics = (person as any)?.topics_that_lit_her_up ?? [];
    const thingsSheLoves = (person as any)?.things_she_loves ?? [];
    const callbackHint =
      litTopics[0]?.topic ||
      thingsSheLoves[0] ||
      null;

    // Prompt template encoding (JSON) — convex_runner._draft_with_template reads this
    // when job_type=send_imessage + touch_type=soft_no_recovery.
    const promptTemplate = JSON.stringify({
      template: "soft_no_recovery",
      first_name: firstName,
      callback_hint: callbackHint,
      small_ask_only: true,          // convex_runner: propose coffee/walk/30min only
      avoid_repeat_venue: true,      // convex_runner: do NOT repeat the original ask venue
    });

    const fireAt = now + FOURTEEN_DAYS_MS;
    const recoveryTouchId = await ctx.db.insert("scheduled_touches", {
      user_id: args.user_id,
      person_id: args.person_id,
      conversation_id: args.conversation_id,
      type: "soft_no_recovery",
      scheduled_for: fireAt,
      status: "scheduled",
      generate_at_fire_time: true,
      prompt_template: promptTemplate,
      urgency: "cool",              // lower urgency than a fresh date_ask
      created_at: now,
      updated_at: now,
    });

    // Self-schedule: Convex fires at scheduled_for ± ~50ms.
    await ctx.scheduler.runAt(fireAt, internal.touches.fireOne, {
      touch_id: recoveryTouchId,
    });

    // Stamp recovery_scheduled_at on the source touch to prevent double-scheduling.
    await ctx.db.patch(args.source_touch_id, {
      recovery_scheduled_at: fireAt,
      updated_at: now,
    } as any);

    return { scheduled: true, touch_id: recoveryTouchId, fire_at: fireAt };
  },
});

// ---------------------------------------------------------------------------
// AI-9500 W2 #B — softNoRecoveryDetectorCron (internalMutation)
//
// Safety-net cron (every 6h) that scans date_ask touches whose ask_outcome
// is "soft_no" but recovery_scheduled_at is still null (i.e. the real-time
// path in upsertFromWebhook missed them — process restart, backfill, etc.).
//
// For each unprocessed soft_no touch found, calls _scheduleSoftNoRecovery.
// Processes at most 20 per sweep to avoid timeout; next sweep picks up the rest.
// ---------------------------------------------------------------------------
export const softNoRecoveryDetectorCron = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Scan recent date_ask fired touches with ask_outcome=soft_no and no recovery yet.
    // We query by status=fired, then JS-filter for ask_outcome and missing recovery_scheduled_at.
    // No dedicated index for ask_outcome — the set of fired date_ask touches is small (<500).
    const candidatesRaw = await ctx.db
      .query("scheduled_touches")
      .withIndex("by_due", (q) => q.eq("status", "fired").lte("scheduled_for", now))
      .filter((q) => q.eq(q.field("type"), "date_ask"))
      .take(200);

    const unprocessed = candidatesRaw.filter(
      (t) =>
        (t as any).ask_outcome === "soft_no" &&
        (t as any).recovery_scheduled_at === undefined,
    );

    let scheduled = 0;
    for (const touch of unprocessed.slice(0, 20)) {
      // Use scheduler.runAfter(0) so each recovery scheduling runs in its own
      // mutation (avoids doc-write limits and gives idempotent retry semantics).
      await ctx.scheduler.runAfter(0, internal.touches._scheduleSoftNoRecovery, {
        source_touch_id: touch._id,
        user_id: touch.user_id,
        person_id: touch.person_id,
        conversation_id: touch.conversation_id,
      });
      scheduled++;
    }

    return { scanned: candidatesRaw.length, unprocessed: unprocessed.length, scheduled };
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

// ===========================================================================
// AI-9500 W2 #G — Voice-memo trigger sweep
//
// sweepVoiceMemoCandidates — internalMutation called every 6h via cron.
//

const VOICE_MEMO_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;          // 7d
const VOICE_MEMO_PHONE_SWAP_WINDOW_MS = 4 * 24 * 60 * 60 * 1000;  // 4d active window
const VOICE_MEMO_MAX_SWEEP = 30;

/** Build the 1-2 sentence voice-memo script for a given trigger. */
=======
// Three high-leverage triggers:
//   1. Phone-swap +24h  — courtship_stage="phone_swap", active last 4d,
//      last_outbound_at at least 24h ago, no voice_memo yet.
//   2. 3rd inbound reply — exactly 3 inbound messages across all conversations.
//   3. Post-second-date  — 2+ fired post_date_calibration touches, no voice_memo in 7d.
//
// Each touch: draft_body = short operator script, generate_at_fire_time=false,
// urgency="warm". Does NOT auto-fire — operator records voice memo manually.
// ===========================================================================

const VOICE_MEMO_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const VOICE_MEMO_PHONE_SWAP_WINDOW_MS = 4 * 24 * 60 * 60 * 1000;
const VOICE_MEMO_MAX_SWEEP = 30;

function _voiceMemoScript(
  trigger: "phone_swap" | "third_reply" | "post_second_date",
  name: string,
): string {
  const firstName = name.split(" ")[0];
  switch (trigger) {
    case "phone_swap":
      return `Hey ${firstName} — just wanted to say hey properly. Hope you're having a great day`;
    case "third_reply":
      return `Hey ${firstName} — you seem really cool, figured a voice note beats another text`;
    case "post_second_date":
      return `${firstName} — that was honestly so fun. Thinking about you`;
  }
}

export const sweepVoiceMemoCandidates = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const sevenDaysAgo = now - VOICE_MEMO_COOLDOWN_MS;

    const allPeople = await ctx.db
      .query("people")
      .withIndex("by_user", (q) => q.eq("user_id", "fleet-julian"))
      .collect();

    const candidates = allPeople.filter(
      (p) => p.status !== "ended" && p.status !== "ghosted" && p.whitelist_for_autoreply,
    );

    let scheduled = 0;
    let scanned = 0;

    for (const person of candidates.slice(0, VOICE_MEMO_MAX_SWEEP)) {
      scanned++;

      const existingTouches = await ctx.db
        .query("scheduled_touches")
        .withIndex("by_person_status", (q) => q.eq("person_id", person._id))
        .collect();

      const hasScheduled = existingTouches.some(
        (t) => t.type === "voice_memo" && t.status === "scheduled",
      );
      const hasRecentFired = existingTouches.some(
        (t) =>
          t.type === "voice_memo" &&
          t.status === "fired" &&
          t.fired_at !== undefined &&
          t.fired_at >= sevenDaysAgo,
      );
      if (hasScheduled || hasRecentFired) continue;

      let triggerKind: "phone_swap" | "third_reply" | "post_second_date" | null = null;

      // Trigger 1: Phone-swap +24h
      if (person.courtship_stage === "phone_swap") {
        const lastOut = person.last_outbound_at ?? 0;
        const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
        if (lastOut >= (now - VOICE_MEMO_PHONE_SWAP_WINDOW_MS) && lastOut <= twentyFourHoursAgo) {
          triggerKind = "phone_swap";
        }
      }

      // Trigger 2: 3rd inbound reply
      if (!triggerKind) {
        const inboundMsgs = await ctx.db
          .query("messages")
          .withIndex("by_person_recent", (q) => q.eq("person_id", person._id))
          .filter((q) => q.eq(q.field("direction"), "inbound"))
          .collect();
        if (inboundMsgs.length === 3) {
          triggerKind = "third_reply";
        }
      }

      // Trigger 3: Post-second-date
      if (!triggerKind) {
        const firedCalibrations = existingTouches.filter(
          (t) => t.type === "post_date_calibration" && t.status === "fired",
        );
        if (firedCalibrations.length >= 2) {
          triggerKind = "post_second_date";
        }
      }

      if (!triggerKind) continue;

      const script = _voiceMemoScript(triggerKind, person.display_name);
      const fireAt = now + 30 * 60 * 1000;

      await ctx.db.insert("scheduled_touches", {
        user_id: "fleet-julian",
        person_id: person._id,
        type: "voice_memo",
        scheduled_for: fireAt,
        status: "scheduled",
        draft_body: script,
        generate_at_fire_time: false,
        urgency: "warm",
        prompt_template: `voice_memo_trigger_${triggerKind}`,
        created_at: now,
        updated_at: now,
      });
      // Does NOT call fireOne — operator records manually on phone.
      scheduled++;
    }

    return { scanned, scheduled };
  },
});

// ---------------------------------------------------------------------------
// markVoiceMemoSent — operator calls from dossier after recording & sending
// the voice memo on their phone. Patches status to "fired".
// ---------------------------------------------------------------------------
export const markVoiceMemoSent = mutation({
  args: {
    touch_id: v.id("scheduled_touches"),
  },
  handler: async (ctx, args) => {
    const touch = await ctx.db.get(args.touch_id);
    if (!touch) return { not_found: true };
    if (touch.type !== "voice_memo") return { wrong_type: touch.type };
    if (touch.status === "fired") return { already_fired: true };
    await ctx.db.patch(args.touch_id, {
      status: "fired",
      fired_at: Date.now(),
      updated_at: Date.now(),
    });
    return { marked_sent: true };
  },
});
