import { query } from "./_generated/server";
import { v } from "convex/values";

// AI-9500 #7 — Self-coaching dashboard.
//
// All queries are read-only aggregations over messages + people + scheduled_touches.
// Designed for /admin/clapcheeks-ops/coach which shows Julian his own patterns
// and one actionable sentence per card.
//
// Every query takes user_id and operates over the last 30 days unless noted.

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// getOverPursueList
//
// For each active person with messages in the last 30d, compute:
//   outbound_words / inbound_words ratio (proxy for "over-investment").
// Returns top 10 where ratio > 2.5, sorted descending.
//
// Logic: pull all messages by conversation → count words per direction.
// ---------------------------------------------------------------------------
export const getOverPursueList = query({
  args: { user_id: v.string() },
  handler: async (ctx, { user_id }) => {
    const cutoff = Date.now() - THIRTY_DAYS_MS;

    // Get all active/paused/dating people for this user
    const people = await ctx.db
      .query("people")
      .withIndex("by_user_status", (q) => q.eq("user_id", user_id).eq("status", "active"))
      .collect();

    const results: Array<{
      person_id: string;
      display_name: string;
      courtship_stage: string | undefined;
      outbound_words: number;
      inbound_words: number;
      ratio: number;
      last_inbound_at: number | undefined;
    }> = [];

    // AI-9526 — exclude people whose vibe was classified as professional or
    // platonic so the "you're over-investing" list doesn't suggest cooling
    // off on Anagha (Script.IQ co-founder) or Colin White (work contact).
    // We still include vibe=dating, vibe=unclear, or vibe=undefined (sweep
    // hasn't run yet) — operator judgment kicks in.
    const datingFilter = (p: any) =>
      p.vibe_classification !== "professional" &&
      p.vibe_classification !== "platonic";
    // Limit to first 100 active people to stay within Convex read limits.
    // (260 active people × N messages each can exceed 16MB; 100 is safe.)
    const peopleSample = people.filter(datingFilter).slice(0, 100);

    for (const person of peopleSample) {
      // Use by_person_recent index (person_id, sent_at) — properly indexed per person.
      const personMessages = await ctx.db
        .query("messages")
        .withIndex("by_person_recent", (q) =>
          q.eq("person_id", person._id).gt("sent_at", cutoff)
        )
        .take(200); // cap per person

      const outboundMessages = personMessages.filter((m) => m.direction === "outbound");
      const inboundMessages = personMessages.filter((m) => m.direction === "inbound");

      if (outboundMessages.length === 0 && inboundMessages.length === 0) continue;

      const outboundWords = outboundMessages.reduce(
        (acc, m) => acc + (m.body?.split(/\s+/).filter(Boolean).length ?? 0),
        0
      );
      const inboundWords = inboundMessages.reduce(
        (acc, m) => acc + (m.body?.split(/\s+/).filter(Boolean).length ?? 0),
        0
      );

      // Skip if no outbound activity
      if (outboundWords === 0) continue;

      // Avoid div/0: if she has sent nothing, ratio = outboundWords (effectively infinite)
      const ratio = inboundWords === 0 ? outboundWords : outboundWords / inboundWords;

      if (ratio > 2.5) {
        results.push({
          person_id: person._id,
          display_name: person.display_name,
          courtship_stage: person.courtship_stage,
          outbound_words: outboundWords,
          inbound_words: inboundWords,
          ratio: Math.round(ratio * 10) / 10,
          last_inbound_at: person.last_inbound_at,
        });
      }
    }

    return results
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 10);
  },
});

// ---------------------------------------------------------------------------
// getLateNightConversion
//
// Your outbound sends bucketed by hour-of-day (0-23, local UTC-7 approximation).
// For each hour: total sends + how many got a reply within 24h.
// Returns array of { hour, sends, replies, conversion_rate }.
// Limited to 2000 outbound + 2000 inbound messages (30-day window, most recent first).
// ---------------------------------------------------------------------------
export const getLateNightConversion = query({
  args: { user_id: v.string() },
  handler: async (ctx, { user_id }) => {
    const cutoff = Date.now() - THIRTY_DAYS_MS;
    const MSG_LIMIT = 2000;

    const outboundMessages = await ctx.db
      .query("messages")
      .withIndex("by_user_recent", (q) =>
        q.eq("user_id", user_id).gt("sent_at", cutoff)
      )
      .filter((q) => q.eq(q.field("direction"), "outbound"))
      .order("desc")
      .take(MSG_LIMIT);

    // Build map of conversation_id -> sorted inbound sent_at timestamps
    const convInboundTimes: Record<string, number[]> = {};
    const inboundMessages = await ctx.db
      .query("messages")
      .withIndex("by_user_recent", (q) =>
        q.eq("user_id", user_id).gt("sent_at", cutoff)
      )
      .filter((q) => q.eq(q.field("direction"), "inbound"))
      .order("desc")
      .take(MSG_LIMIT);

    for (const msg of inboundMessages) {
      const cid = msg.conversation_id;
      if (!convInboundTimes[cid]) convInboundTimes[cid] = [];
      convInboundTimes[cid].push(msg.sent_at);
    }

    // Hour buckets (adjust for Pacific time UTC-7 heuristic)
    const UTC_OFFSET_HOURS = -7;
    const buckets = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      sends: 0,
      replies: 0,
    }));

    const TWENTY_FOUR_H_MS = 24 * 60 * 60 * 1000;

    for (const msg of outboundMessages) {
      // Convert UTC ms to local hour
      const localHour = ((new Date(msg.sent_at).getUTCHours() + UTC_OFFSET_HOURS + 24) % 24);
      buckets[localHour].sends++;

      // Check if any inbound came within 24h on the same conversation
      const inbounds = convInboundTimes[msg.conversation_id] ?? [];
      const gotReply = inbounds.some(
        (t) => t > msg.sent_at && t <= msg.sent_at + TWENTY_FOUR_H_MS
      );
      if (gotReply) buckets[localHour].replies++;
    }

    return buckets.map((b) => ({
      ...b,
      conversion_rate:
        b.sends === 0 ? 0 : Math.round((b.replies / b.sends) * 100) / 100,
    }));
  },
});

// ---------------------------------------------------------------------------
// getSameOpenerOveruse
//
// Group your outbound messages (first message in each conversation) by the
// first 50 chars. Return groups where count >= 3, with reply-rate per group.
//
// "First message" = lowest sent_at outbound per conversation.
// ---------------------------------------------------------------------------
export const getSameOpenerOveruse = query({
  args: { user_id: v.string() },
  handler: async (ctx, { user_id }) => {
    const cutoff = Date.now() - THIRTY_DAYS_MS;

    // Get all conversations for user
    // Cap at 300 most-recent conversations (by last_message_at desc) to stay within read limits.
    const allConversations = await ctx.db
      .query("conversations")
      .withIndex("by_last_message", (q) => q.eq("user_id", user_id).gt("last_message_at", cutoff))
      .order("desc")
      .take(300);
    const conversations = allConversations;

    // For each conversation, find the first outbound message
    const openerMap: Record<
      string,
      { preview: string; count: number; replied_count: number; conv_ids: string[] }
    > = {};

    for (const conv of conversations) {
      // Find earliest outbound
      const firstOutbound = await ctx.db
        .query("messages")
        .withIndex("by_conversation", (q) =>
          q.eq("conversation_id", conv._id).gt("sent_at", 0)
        )
        .filter((q) => q.eq(q.field("direction"), "outbound"))
        .first(); // index is ordered by sent_at ascending

      if (!firstOutbound) continue;
      if (firstOutbound.sent_at < cutoff) continue; // only openers from last 30d

      const preview = (firstOutbound.body ?? "").slice(0, 50).trim();
      if (!preview) continue;

      // Normalize: lowercase + strip punctuation for grouping
      const key = preview.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
      if (!openerMap[key]) {
        openerMap[key] = { preview, count: 0, replied_count: 0, conv_ids: [] };
      }
      openerMap[key].count++;
      openerMap[key].conv_ids.push(conv._id as string);

      // Did this conversation get a reply after the opener?
      const firstReply = await ctx.db
        .query("messages")
        .withIndex("by_conversation", (q) =>
          q.eq("conversation_id", conv._id).gt("sent_at", firstOutbound.sent_at)
        )
        .filter((q) => q.eq(q.field("direction"), "inbound"))
        .first();

      if (firstReply) openerMap[key].replied_count++;
    }

    return Object.values(openerMap)
      .filter((g) => g.count >= 3)
      .map((g) => ({
        preview: g.preview,
        count: g.count,
        reply_rate: Math.round((g.replied_count / g.count) * 100) / 100,
      }))
      .sort((a, b) => b.count - a.count);
  },
});

// ---------------------------------------------------------------------------
// getCutListCandidates
//
// People where:
//   effort_rating >= 3 (medium-high effort) AND
//   hotness_rating <= 4 (low operator interest) AND
//   her_words / your_words < 0.3 in last 30d (she's barely engaging)
// Returns top 10, sorted by effort_rating desc.
// ---------------------------------------------------------------------------
export const getCutListCandidates = query({
  args: { user_id: v.string() },
  handler: async (ctx, { user_id }) => {
    const cutoff = Date.now() - THIRTY_DAYS_MS;

    const people = await ctx.db
      .query("people")
      .withIndex("by_user", (q) => q.eq("user_id", user_id))
      .filter((q) =>
        q.and(
          q.gte(q.field("effort_rating"), 3),
          q.lte(q.field("hotness_rating"), 4)
        )
      )
      .collect();

    const results: Array<{
      person_id: string;
      display_name: string;
      effort_rating: number;
      hotness_rating: number | undefined;
      courtship_stage: string | undefined;
      her_word_ratio: number;
      last_inbound_at: number | undefined;
    }> = [];

    for (const person of people) {
      // Use by_person_recent index — properly indexed per person
      const personMessages = await ctx.db
        .query("messages")
        .withIndex("by_person_recent", (q) =>
          q.eq("person_id", person._id).gt("sent_at", cutoff)
        )
        .take(200); // cap per person

      const outboundMessages = personMessages.filter((m) => m.direction === "outbound");
      const inboundMessages = personMessages.filter((m) => m.direction === "inbound");

      const outboundWords = outboundMessages.reduce(
        (acc, m) => acc + (m.body?.split(/\s+/).filter(Boolean).length ?? 0),
        0
      );
      const inboundWords = inboundMessages.reduce(
        (acc, m) => acc + (m.body?.split(/\s+/).filter(Boolean).length ?? 0),
        0
      );

      // Skip if no activity at all
      if (outboundWords === 0) continue;

      const ratio = outboundWords === 0 ? 0 : inboundWords / outboundWords;

      if (ratio < 0.3) {
        results.push({
          person_id: person._id,
          display_name: person.display_name,
          effort_rating: person.effort_rating ?? 0,
          hotness_rating: person.hotness_rating,
          courtship_stage: person.courtship_stage,
          her_word_ratio: Math.round(ratio * 100) / 100,
          last_inbound_at: person.last_inbound_at,
        });
      }
    }

    return results
      .sort((a, b) => b.effort_rating - a.effort_rating)
      .slice(0, 10);
  },
});

// ---------------------------------------------------------------------------
// getStuckInStage
//
// People in courtship_stage "matched" or "early_chat" for > 14 days.
// Days-in-stage approximated from (now - last_inbound_at) when courtship_stage
// was set. We use updated_at as a proxy if courtship_last_analyzed is absent.
// Returns list with days_in_stage, sorted descending.
// ---------------------------------------------------------------------------
export const getStuckInStage = query({
  args: { user_id: v.string() },
  handler: async (ctx, { user_id }) => {
    const now = Date.now();

    const people = await ctx.db
      .query("people")
      .withIndex("by_user", (q) => q.eq("user_id", user_id))
      .filter((q) =>
        q.or(
          q.eq(q.field("courtship_stage"), "matched"),
          q.eq(q.field("courtship_stage"), "early_chat")
        )
      )
      .collect();

    return people
      .map((p) => {
        // Use courtship_last_analyzed as "when we last confirmed stage" or created_at as fallback
        const stageSetAt = p.courtship_last_analyzed ?? p.created_at;
        const daysInStage = Math.floor((now - stageSetAt) / (24 * 60 * 60 * 1000));
        return {
          person_id: p._id,
          display_name: p.display_name,
          courtship_stage: p.courtship_stage,
          days_in_stage: daysInStage,
          last_inbound_at: p.last_inbound_at,
          hotness_rating: p.hotness_rating,
        };
      })
      .filter((p) => p.days_in_stage >= 14)
      .sort((a, b) => b.days_in_stage - a.days_in_stage);
  },
});

// ---------------------------------------------------------------------------
// getTimeOfDayHeatmap
//
// 7×24 grid: for each (day_of_week 0=Sun…6=Sat, hour 0-23 local):
//   sends: your outbound count
//   replies: inbound messages that arrived in same hour×day window
//   conversion_rate: replies / sends (0-1)
//
// Returns flat array of { dow, hour, sends, replies, conversion_rate }.
// Only includes cells with at least 1 send.
// ---------------------------------------------------------------------------
export const getTimeOfDayHeatmap = query({
  args: { user_id: v.string() },
  handler: async (ctx, { user_id }) => {
    const cutoff = Date.now() - THIRTY_DAYS_MS;
    const UTC_OFFSET_HOURS = -7; // Pacific heuristic
    const MSG_LIMIT = 2000;

    const outboundMessages = await ctx.db
      .query("messages")
      .withIndex("by_user_recent", (q) =>
        q.eq("user_id", user_id).gt("sent_at", cutoff)
      )
      .filter((q) => q.eq(q.field("direction"), "outbound"))
      .order("desc")
      .take(MSG_LIMIT);

    const inboundMessages = await ctx.db
      .query("messages")
      .withIndex("by_user_recent", (q) =>
        q.eq("user_id", user_id).gt("sent_at", cutoff)
      )
      .filter((q) => q.eq(q.field("direction"), "inbound"))
      .order("desc")
      .take(MSG_LIMIT);

    // Build inbound bucket: key = "dow:hour" -> count
    const inboundBuckets: Record<string, number> = {};
    for (const msg of inboundMessages) {
      const d = new Date(msg.sent_at);
      const localHour = ((d.getUTCHours() + UTC_OFFSET_HOURS + 24) % 24);
      const localDow = d.getUTCDay(); // good enough approximation
      const key = `${localDow}:${localHour}`;
      inboundBuckets[key] = (inboundBuckets[key] ?? 0) + 1;
    }

    // Build outbound bucket
    const outboundBuckets: Record<string, number> = {};
    for (const msg of outboundMessages) {
      const d = new Date(msg.sent_at);
      const localHour = ((d.getUTCHours() + UTC_OFFSET_HOURS + 24) % 24);
      const localDow = d.getUTCDay();
      const key = `${localDow}:${localHour}`;
      outboundBuckets[key] = (outboundBuckets[key] ?? 0) + 1;
    }

    const cells: Array<{
      dow: number;
      hour: number;
      sends: number;
      replies: number;
      conversion_rate: number;
    }> = [];

    for (let dow = 0; dow < 7; dow++) {
      for (let hour = 0; hour < 24; hour++) {
        const key = `${dow}:${hour}`;
        const sends = outboundBuckets[key] ?? 0;
        if (sends === 0) continue;
        const replies = inboundBuckets[key] ?? 0;
        cells.push({
          dow,
          hour,
          sends,
          replies,
          conversion_rate: Math.round((replies / sends) * 100) / 100,
        });
      }
    }

    return cells;
  },
});

// ---------------------------------------------------------------------------
// getDashboardSummary
//
// Single-call rollup for the top KPI bar:
//   active_threads: count of people with status=active
//   dates_this_week: count of scheduled_touches type=date_confirm_24h fired this week
//   ghost_rate_this_month: (people who went ghosted in last 30d) / (all active+ghosted)
//   kissed_this_month: count of people whose operator_notes contains kiss/kissed/making out (regex)
//   slept_with_this_month: count of people whose operator_notes contains slept with/sex/hooked up (regex)
//   avg_reply_rate: mean of response_rate across active people (from enrichment)
// ---------------------------------------------------------------------------
export const getDashboardSummary = query({
  args: { user_id: v.string() },
  handler: async (ctx, { user_id }) => {
    const now = Date.now();
    const cutoff = now - THIRTY_DAYS_MS;
    const weekCutoff = now - 7 * 24 * 60 * 60 * 1000;

    // Active people count
    const activePeople = await ctx.db
      .query("people")
      .withIndex("by_user_status", (q) => q.eq("user_id", user_id).eq("status", "active"))
      .collect();

    // Ghosted in last 30 days (status=ghosted AND updated_at > cutoff)
    const recentlyGhosted = await ctx.db
      .query("people")
      .withIndex("by_user_status", (q) => q.eq("user_id", user_id).eq("status", "ghosted"))
      .filter((q) => q.gt(q.field("updated_at"), cutoff))
      .collect();

    const ghostRate =
      activePeople.length + recentlyGhosted.length === 0
        ? 0
        : Math.round(
            (recentlyGhosted.length / (activePeople.length + recentlyGhosted.length)) * 100
          ) / 100;

    // Dates this week: date_confirm_24h touches fired in last 7 days
    const datesThisWeek = await ctx.db
      .query("scheduled_touches")
      .withIndex("by_user_fired_at", (q) =>
        q.eq("user_id", user_id).gt("fired_at", weekCutoff)
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("type"), "date_confirm_24h"),
          q.eq(q.field("status"), "fired")
        )
      )
      .collect();

    // Kissed / slept-with: scan operator_notes for keywords (best-effort regex)
    const KISS_RE = /\b(kiss(ed|ing)?|making out|makeout|made out)\b/i;
    const SLEEP_RE = /\b(slept with|had sex|hooked up|sex with|sleeping with|fucked)\b/i;

    let kissedCount = 0;
    let sleptWithCount = 0;

    // Scan all people (not just active — notes persist across status changes)
    const allPeople = await ctx.db
      .query("people")
      .withIndex("by_user", (q) => q.eq("user_id", user_id))
      .collect();

    for (const person of allPeople) {
      if (!person.operator_notes) continue;
      if (KISS_RE.test(person.operator_notes)) kissedCount++;
      if (SLEEP_RE.test(person.operator_notes)) sleptWithCount++;
    }

    // Average reply rate from enrichment data
    const replyRates = activePeople
      .map((p) => p.response_rate)
      .filter((r): r is number => typeof r === "number");
    const avgReplyRate =
      replyRates.length === 0
        ? 0
        : Math.round(
            (replyRates.reduce((a, b) => a + b, 0) / replyRates.length) * 100
          ) / 100;

    // AI-9526 — also report dating-only count so the roster card doesn't
    // overstate by counting Sean Gelt (Hafnia, vibe=professional) and the
    // other 60+ professional/platonic active threads.
    const datingActive = activePeople.filter(
      (p: any) =>
        p.vibe_classification !== "professional" &&
        p.vibe_classification !== "platonic"
    );

    return {
      active_threads: activePeople.length,
      active_dating_threads: datingActive.length,
      dates_this_week: datesThisWeek.length,
      ghost_rate_this_month: ghostRate,
      kissed_this_month: kissedCount,
      slept_with_this_month: sleptWithCount,
      avg_reply_rate: avgReplyRate,
      total_people: allPeople.length,
    };
  },
});

// ---------------------------------------------------------------------------
// AI-9500 W2 #F follow-up — Roster KPI panel for /coach.
// Reads operator_profile.target_concurrent_active and computes capacity vs
// active dating-relevant threads. Surfaces the top 5 to move forward + the
// top 5 cooling threats to roster.
// ---------------------------------------------------------------------------
const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
const DATING_CHANNELS = new Set(["imessage", "hinge", "tinder", "bumble", "instagram"]);
function isDatingRelevant(p: any, now: number): boolean {
  if (!["lead", "active", "dating", "paused"].includes(p.status)) return false;
  if (p.archived_at) return false;
  const handles = p.handles ?? [];
  const hasDatingHandle = handles.some((h: any) => DATING_CHANNELS.has(h.channel));
  const hasRecentInbound = p.last_inbound_at && now - p.last_inbound_at < NINETY_DAYS;
  const hasOperatorRating = p.hotness_rating !== undefined || p.effort_rating !== undefined;
  const isDatingVibe = p.vibe_classification === "dating";
  return Boolean(hasDatingHandle || hasRecentInbound || hasOperatorRating || isDatingVibe);
}

export const getRosterKPIs = query({
  args: { user_id: v.string() },
  handler: async (ctx, { user_id }) => {
    const now = Date.now();
    const profile = await ctx.db
      .query("operator_profile")
      .withIndex("by_user", (q) => q.eq("user_id", user_id))
      .first();
    const target = profile?.target_concurrent_active ?? 10;

    const all = await ctx.db
      .query("people")
      .withIndex("by_user", (q) => q.eq("user_id", user_id))
      .collect();

    const active = all.filter((p) =>
      isDatingRelevant(p, now) &&
      (p.status === "active" || p.status === "dating") &&
      // AI-9526 — exclude vibe=professional/platonic from roster KPIs so the
      // capacity reading + cooling threats reflect actual dating threads, not
      // Sean Gelt (Hafnia client, vibe=professional) or Anagha (Script.IQ
      // co-founder, vibe=professional). Vibe=undefined still counts so
      // unenriched people surface for operator review.
      p.vibe_classification !== "professional" &&
      p.vibe_classification !== "platonic"
    );
    const capacity = target - active.length;

    function score(p: any): number {
      let s = 0;
      if (p.hotness_rating) s += p.hotness_rating * 10;
      if (p.last_inbound_at) {
        const h = (now - p.last_inbound_at) / 3_600_000;
        s += Math.max(0, 50 - h);
      }
      if (p.time_to_ask_score) s += p.time_to_ask_score * 30;
      return s;
    }

    const topToMoveForward = [...active]
      .sort((a, b) => score(b) - score(a))
      .slice(0, 5)
      .map((p) => ({
        _id: p._id,
        display_name: p.display_name,
        hotness_rating: p.hotness_rating ?? null,
        last_inbound_at: p.last_inbound_at ?? null,
        next_best_move: p.next_best_move ?? null,
        score: score(p),
      }));

    const THREE_D = 3 * 24 * 3_600_000;
    const cooling = active
      .filter((p) => p.last_inbound_at && now - p.last_inbound_at > THREE_D)
      .filter((p) => {
        const emo = (p.emotional_state_recent ?? []).slice(-1)[0]?.state;
        const wasWarm =
          emo === "happy" || emo === "playful" || emo === "flirty" ||
          emo === "warm" || p.conversation_temperature === "warm" ||
          p.conversation_temperature === "hot";
        return wasWarm;
      })
      .sort((a, b) => (a.last_inbound_at ?? 0) - (b.last_inbound_at ?? 0))
      .slice(0, 5)
      .map((p) => ({
        _id: p._id,
        display_name: p.display_name,
        last_inbound_at: p.last_inbound_at ?? null,
        days_silent: Math.round((now - (p.last_inbound_at ?? now)) / (24 * 3_600_000)),
      }));

    return {
      target,
      active_count: active.length,
      capacity,
      capacity_state: capacity < 0 ? "over" : capacity >= 2 ? "healthy" : "tight",
      top_to_move_forward: topToMoveForward,
      cooling_threats: cooling,
      operator_profile: profile ?? null,
    };
  },
});
