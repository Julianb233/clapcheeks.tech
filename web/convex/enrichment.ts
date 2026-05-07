/**
 * AI-9449 — Convex-resident enrichment + auto-responder logic.
 *
 * Replaces the Mac-Mini-side convex_runner Python module for the LLM-driven
 * jobs that don't need filesystem / iMessage-send access:
 *
 *   - classifyConversationVibeForOne — dating | platonic | professional | unclear
 *   - enrichCourtshipForOne          — trust + courtship-stage + next_best_move
 *   - sweepCourtshipCandidates       — find CC TECH people due for analysis
 *   - sweepVibeCandidates            — find people with iMessage activity due for vibe re-score
 *
 * Mac Mini still owns: actually sending iMessage / Hinge messages (BB Server),
 * chat.db backfill, presence gating. Those run as Convex agent_jobs the local
 * daemon picks up.
 *
 * LLM provider cascade: GEMINI_API_KEY -> DEEPSEEK_API_KEY -> XAI_API_KEY
 * (set via `npx convex env set ...`). Anthropic dropped from cloud cascade
 * because the legacy keys ran out of credits.
 */

import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

// -------------------------------------------------------------------------
// LLM provider abstraction (Convex-Action side, pure fetch — no SDK)
// -------------------------------------------------------------------------
type LLMResult = Record<string, unknown> | null;

async function llmJson(systemPrompt: string, userPrompt: string, maxTokens = 180): Promise<LLMResult> {
  // Try Gemini first
  const gemKey = process.env.GEMINI_API_KEY;
  if (gemKey) {
    const r = await tryGemini(gemKey, systemPrompt, userPrompt, maxTokens);
    if (r) return r;
  }
  // Then DeepSeek
  const dsKey = process.env.DEEPSEEK_API_KEY;
  if (dsKey) {
    const r = await tryOpenAICompat(
      "https://api.deepseek.com/chat/completions", dsKey, "deepseek-chat",
      systemPrompt, userPrompt, maxTokens,
    );
    if (r) return r;
  }
  // Then Grok
  const grokKey = process.env.XAI_API_KEY;
  if (grokKey) {
    const r = await tryOpenAICompat(
      "https://api.x.ai/v1/chat/completions", grokKey, "grok-2-latest",
      systemPrompt, userPrompt, maxTokens,
    );
    if (r) return r;
  }
  return null;
}

async function tryGemini(key: string, system: string, user: string, maxTokens: number): Promise<LLMResult> {
  const model = process.env.CC_VIBE_MODEL_GEMINI ?? "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${system}\n\n${user}` }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1, maxOutputTokens: maxTokens },
      }),
    });
    if (!r.ok) {
      console.warn(`gemini http ${r.status}`);
      return null;
    }
    const j: any = await r.json();
    const text = j?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    return JSON.parse(text);
  } catch (e) {
    console.warn(`gemini err: ${String(e).slice(0, 200)}`);
    return null;
  }
}

async function tryOpenAICompat(
  url: string, key: string, model: string,
  system: string, user: string, maxTokens: number,
): Promise<LLMResult> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model, max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!r.ok) {
      console.warn(`${model} http ${r.status}`);
      return null;
    }
    const j: any = await r.json();
    const text = j?.choices?.[0]?.message?.content;
    if (!text) return null;
    return JSON.parse(text);
  } catch (e) {
    console.warn(`${model} err: ${String(e).slice(0, 200)}`);
    return null;
  }
}

// -------------------------------------------------------------------------
// Internal queries used by actions (actions can't query the DB directly)
// -------------------------------------------------------------------------
export const _getPersonForEnrichment = internalQuery({
  args: { person_id: v.id("people") },
  handler: async (ctx, args) => await ctx.db.get(args.person_id),
});

export const _recentMessagesForPerson = internalQuery({
  args: { person_id: v.id("people"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 100, 500);
    let rows = await ctx.db
      .query("messages")
      .withIndex("by_person_recent", (q) => q.eq("person_id", args.person_id))
      .order("desc")
      .take(limit);
    if (rows.length === 0) {
      const convs = await ctx.db
        .query("conversations")
        .withIndex("by_person", (q) => q.eq("person_id", args.person_id))
        .collect();
      const collected: typeof rows = [];
      for (const c of convs) {
        const msgs = await ctx.db
          .query("messages")
          .withIndex("by_conversation", (q) => q.eq("conversation_id", c._id))
          .order("desc")
          .take(limit);
        collected.push(...msgs);
      }
      collected.sort((a, b) => (b.sent_at || 0) - (a.sent_at || 0));
      rows = collected.slice(0, limit);
    }
    return rows;
  },
});

// -------------------------------------------------------------------------
// classifyConversationVibeForOne
// -------------------------------------------------------------------------
export const classifyConversationVibeForOne = internalAction({
  args: { person_id: v.id("people") },
  handler: async (ctx, args) => {
    const recent: any[] = await ctx.runQuery(internal.enrichment._recentMessagesForPerson, {
      person_id: args.person_id, limit: 50,
    });
    if (recent.length < 4) return { skipped: true, reason: "not_enough_messages" };

    const transcript = recent
      .reverse()
      .map((m) => `${m.direction === "outbound" ? "You" : "Them"}: ${(m.body || "").slice(0, 240)}`)
      .join("\n");
    const system =
      "Classify a 1:1 transcript into: dating | platonic | professional | unclear.\n" +
      'Output ONLY JSON: {"classification":"...","confidence":0..1,"evidence":"<one sentence>"}';
    const parsed = await llmJson(system, `Transcript:\n\n${transcript}`, 180);
    if (!parsed) return { skipped: true, reason: "no_llm_or_failed" };

    const valid = new Set(["dating", "platonic", "professional", "unclear"]);
    let cls = String(parsed.classification ?? "unclear").toLowerCase();
    if (!valid.has(cls)) cls = "unclear";
    const conf = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0)));
    const ev = String(parsed.evidence ?? "").slice(0, 300) || undefined;

    await ctx.runMutation(internal.people._updateVibeInternal, {
      person_id: args.person_id,
      vibe_classification: cls as any,
      vibe_confidence: conf,
      vibe_evidence: ev,
    });
    return { person_id: args.person_id, classification: cls, confidence: conf };
  },
});

// -------------------------------------------------------------------------
// enrichCourtshipForOne
// -------------------------------------------------------------------------
export const enrichCourtshipForOne = internalAction({
  args: { person_id: v.id("people") },
  handler: async (ctx, args) => {
    const recent: any[] = await ctx.runQuery(internal.enrichment._recentMessagesForPerson, {
      person_id: args.person_id, limit: 100,
    });
    if (recent.length < 6) return { skipped: true, reason: "not_enough_messages" };

    const transcript = recent
      .reverse()
      .map((m) => `${m.direction === "outbound" ? "You" : "Her"}: ${(m.body || "").slice(0, 280)}`)
      .join("\n");
    const system =
      "You are a dating coach analyzing a 1:1 iMessage thread between Julian (You) and a woman (Her). " +
      "Extract STRUCTURED SIGNALS that help him build trust, court her, AND make her feel seen, heard, and understood. " +
      "Output ONLY JSON. Use [] when nothing applies; do NOT invent data not in the transcript.\n\n" +
      `{
  "trust_score": 0.0-1.0,
  "courtship_stage": "matched|early_chat|phone_swap|pre_date|first_date_done|ongoing|exclusive|ghosted|ended",
  "trust_signals_observed": [...],
  "trust_signals_missing": [...],
  "things_she_loves": [...],
  "things_she_dislikes": [...],
  "boundaries_stated": [...],
  "green_flags": [...],
  "red_flags": [...],
  "compliments_that_landed": [...],
  "references_to_callback": [...],
  "her_love_languages": ["words_of_affirmation|quality_time|receiving_gifts|acts_of_service|physical_touch", ...],
  "next_best_move": "<one concrete next message or move, <=140 chars>",
  "next_best_move_confidence": 0.0-1.0,
  "personal_details": [<short factual strings ONLY from transcript: "rescue puppy named Beans", "sister Maya getting married Sept", etc.>],
  "recent_life_events": [{"event":"<thing happening in her world>","iso_date_or_estimate":"YYYY-MM-DD","status":"future|past"}],
  "topics_that_lit_her_up": [<topics where her engagement spiked: longer messages, asking questions back, emoji uptick>],
  "curiosity_questions_to_ask": [<5-8 specific questions Julian could ask to deepen knowledge of her — must reference something specific to her, NOT generic "how was your day">],
  "current_emotional_state": "stressed|excited|playful|vulnerable|flirty|bored|tired|proud|anxious|neutral",
  "current_emotional_intensity": 0.0-1.0,
  "time_to_ask_score": 0.0-1.0,
  "ghosting_risk": 0.0-1.0,
  "engagement_score": 0.0-1.0,
  "flirtation_level": 0-10,
  "attachment_style": "anxious|avoidant|secure|fearful|unclear",
  "love_languages_top2": ["<primary: words_of_affirmation|acts_of_service|receiving_gifts|quality_time|physical_touch>","<secondary>"],
  "ask_yes_prob_now": 0.0-1.0
}` +
      "\n\nRules: be evidence-based, empty arrays are fine, JSON only no markdown. " +
      "personal_details + curiosity_questions_to_ask are how Julian shows he's been paying attention — every entry must be defensible from the transcript.\n" +
      "Tier 2: flirtation_level 0=platonic 10=overtly flirty. attachment_style inferred from patterns. love_languages_top2 exactly 2. ask_yes_prob_now probability she'd say yes right now.";

    const parsed = await llmJson(system, `Transcript:\n\n${transcript}`, 1400);
    if (!parsed) return { skipped: true, reason: "no_llm_or_failed" };

    const validStages = new Set([
      "matched", "early_chat", "phone_swap", "pre_date",
      "first_date_done", "ongoing", "exclusive", "ghosted", "ended",
    ]);
    let stage = String(parsed.courtship_stage ?? "").toLowerCase();
    if (!validStages.has(stage)) stage = "early_chat";

    const clamp01 = (x: any) => {
      const n = Number(x);
      return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : undefined;
    };
    const strs = (x: any): string[] | undefined =>
      Array.isArray(x) ? x.map((s) => String(s).slice(0, 200)).filter(Boolean).slice(0, 20) : undefined;

    // Feels-seen extras: append directly to person row.
    const personalDetails = strs(parsed.personal_details) ?? [];
    const curiosityQs = strs(parsed.curiosity_questions_to_ask) ?? [];
    const litTopics = strs(parsed.topics_that_lit_her_up) ?? [];
    const lifeEvents: any[] = Array.isArray(parsed.recent_life_events)
      ? parsed.recent_life_events.slice(0, 10) : [];
    const validStates = new Set([
      "stressed","excited","playful","vulnerable","flirty","bored","tired","proud","anxious","neutral",
    ]);
    const emotionalState = validStates.has(String(parsed.current_emotional_state ?? "").toLowerCase())
      ? String(parsed.current_emotional_state).toLowerCase() : undefined;

    await ctx.runMutation(internal.enrichment._appendCourtshipExtras, {
      person_id: args.person_id,
      personal_details: personalDetails,
      curiosity_questions: curiosityQs,
      lit_topics: litTopics,
      life_events: lifeEvents,
      emotional_state: emotionalState,
      emotional_intensity: clamp01(parsed.current_emotional_intensity),
      time_to_ask_score: clamp01(parsed.time_to_ask_score),
      engagement_score: clamp01(parsed.engagement_score),
    });

    await ctx.runMutation(internal.people._updateCourtshipInternal, {
      person_id: args.person_id,
      courtship_stage: stage as any,
      trust_score: clamp01(parsed.trust_score),
      trust_signals_observed: strs(parsed.trust_signals_observed),
      trust_signals_missing: strs(parsed.trust_signals_missing),
      things_she_loves: strs(parsed.things_she_loves),
      things_she_dislikes: strs(parsed.things_she_dislikes),
      boundaries_stated: strs(parsed.boundaries_stated),
      green_flags: strs(parsed.green_flags),
      red_flags: strs(parsed.red_flags),
      compliments_that_landed: strs(parsed.compliments_that_landed),
      references_to_callback: strs(parsed.references_to_callback),
      her_love_languages: strs(parsed.her_love_languages),
      next_best_move: parsed.next_best_move ? String(parsed.next_best_move).slice(0, 300) : undefined,
      next_best_move_confidence: clamp01(parsed.next_best_move_confidence),
    });

    // -----------------------------------------------------------------------
    // AI-9500 Wave2 #C — Tier 2 scoring (same LLM call, 4 extra dimensions)
    // -----------------------------------------------------------------------
    const validAttachmentStyles = new Set(["anxious", "avoidant", "secure", "fearful", "unclear"]);
    const validLoveLangs = new Set([
      "words_of_affirmation", "acts_of_service", "receiving_gifts", "quality_time", "physical_touch",
    ]);

    const rawFl = parsed.flirtation_level;
    const flirtationLevel: number | undefined = (rawFl !== undefined && rawFl !== null)
      ? Math.max(0, Math.min(10, Math.round(Number(rawFl)))) : undefined;

    const rawAs = String(parsed.attachment_style ?? "").toLowerCase().trim();
    const attachmentStyle = validAttachmentStyles.has(rawAs) ? (rawAs as any) : undefined;

    const rawLl: unknown = parsed.love_languages_top2;
    let loveLanguagesTop2: Array<any> | undefined;
    if (Array.isArray(rawLl)) {
      const filtered = rawLl
        .map((l) => String(l ?? "").toLowerCase().trim())
        .filter((l) => validLoveLangs.has(l))
        .slice(0, 2) as any[];
      if (filtered.length >= 1) loveLanguagesTop2 = filtered;
    }

    const askYesProbNow = clamp01(parsed.ask_yes_prob_now);

    await ctx.runMutation(internal.people._writeTier2Scores, {
      person_id: args.person_id,
      flirtation_level: flirtationLevel,
      attachment_style: attachmentStyle,
      love_languages_top2: loveLanguagesTop2,
      ask_yes_prob_now: askYesProbNow,
    });

    return {
      person_id: args.person_id,
      courtship_stage: stage,
      tier2: { flirtation_level: flirtationLevel, attachment_style: attachmentStyle, love_languages_top2: loveLanguagesTop2, ask_yes_prob_now: askYesProbNow },
    };
  },
});

// -------------------------------------------------------------------------
// _appendCourtshipExtras — append the feels-seen fields (personal_details,
// curiosity_ledger, lit_topics, recent_life_events, emotional_state).
// Called from enrichCourtshipForOne in addition to _updateCourtshipInternal.
// -------------------------------------------------------------------------
export const _appendCourtshipExtras = internalMutation({
  args: {
    person_id: v.id("people"),
    personal_details: v.array(v.string()),
    curiosity_questions: v.array(v.string()),
    lit_topics: v.array(v.string()),
    life_events: v.array(v.any()),
    emotional_state: v.optional(v.string()),
    emotional_intensity: v.optional(v.number()),
    time_to_ask_score: v.optional(v.number()),
    engagement_score: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.person_id);
    if (!p) return;
    const now = Date.now();

    // personal_details — dedup by case-insensitive fact string.
    const existingPD = p.personal_details ?? [];
    const seenPD = new Set(existingPD.map((d: any) => (d.fact ?? "").toLowerCase()));
    const newPD = args.personal_details
      .filter((f) => !seenPD.has(f.toLowerCase()))
      .map((f) => ({ fact: f, learned_at: now, validated_by_julian: false }));
    const personal_details = [...existingPD, ...newPD].slice(-100);

    // curiosity_ledger — append new pending questions. Cap at 30.
    const existingCL = p.curiosity_ledger ?? [];
    const seenCL = new Set(existingCL.map((q: any) => (q.question ?? "").toLowerCase()));
    const newCL = args.curiosity_questions
      .filter((q) => !seenCL.has(q.toLowerCase()))
      .map((q, i) => ({
        question: q, priority: 1 + i, status: "pending" as const, added_at_ms: now,
      }));
    const curiosity_ledger = [...existingCL, ...newCL].slice(-30);

    // lit_topics — increment count or insert.
    const litList = [...(p.topics_that_lit_her_up ?? [])];
    for (const topic of args.lit_topics) {
      const idx = litList.findIndex((t: any) => (t.topic ?? "").toLowerCase() === topic.toLowerCase());
      if (idx >= 0) {
        litList[idx] = { ...litList[idx], signal_count: (litList[idx].signal_count ?? 0) + 1, last_lit_at_ms: now };
      } else {
        litList.push({ topic, signal_count: 1, last_lit_at_ms: now, signal_strength: 0.6 });
      }
    }
    const topics_that_lit_her_up = litList.slice(-50);

    // life_events — dedup by event string.
    const evList = [...(p.recent_life_events ?? [])];
    const seenEv = new Set(evList.map((e: any) => (e.event ?? "").toLowerCase()));
    for (const e of args.life_events) {
      const ek = String(e.event ?? "").toLowerCase();
      if (!ek || seenEv.has(ek)) continue;
      const eDate = Date.parse(String(e.iso_date_or_estimate ?? ""));
      evList.push({
        event: String(e.event).slice(0, 200),
        date_mentioned_ms: now,
        event_date_estimated_ms: Number.isFinite(eDate) ? eDate : undefined,
        status: e.status === "past" ? "happened" as const : "pending" as const,
      });
      seenEv.add(ek);
    }
    const recent_life_events = evList.slice(-30);

    // emotional_state — append if provided.
    let emotional_state_recent = p.emotional_state_recent ?? [];
    if (args.emotional_state) {
      emotional_state_recent = [
        ...emotional_state_recent,
        {
          state: args.emotional_state as any,
          intensity: args.emotional_intensity ?? 0.5,
          observed_at_ms: now,
        },
      ].slice(-10);
    }

    const patch: Record<string, unknown> = {
      personal_details, curiosity_ledger, topics_that_lit_her_up,
      recent_life_events, emotional_state_recent, updated_at: now,
    };
    if (args.time_to_ask_score !== undefined) patch.time_to_ask_score = args.time_to_ask_score;
    if (args.engagement_score !== undefined) patch.engagement_score = args.engagement_score;
    await ctx.db.patch(args.person_id, patch);
  },
});

// -------------------------------------------------------------------------
// Sweeps — run by cron, schedule per-person enrichment with rate limiting
// -------------------------------------------------------------------------
const ENRICH_STALE_DAYS = 7;          // re-run courtship every 7 days
const VIBE_STALE_DAYS = 30;           // re-run vibe every 30 days
const MAX_PER_SWEEP = 10;             // throttle to avoid LLM rate limits + cost
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const DATING_CHANNELS = new Set(["imessage", "hinge", "tinder", "bumble", "instagram"]);

// AI-9500 audit: dating-relevance heuristic — must match the network page filter
// in app/admin/clapcheeks-ops/network/page.tsx::isDatingRelevant. Sweeps
// originally filtered by `google_contacts_labels.includes("CC TECH")` but
// labels were never populated in Convex, so 0 candidates ever surfaced
// despite ~71 active iMessage threads. This heuristic widens the net so
// enrichment + vibe + cadence actually run.
function isDatingRelevant(p: any, now: number): boolean {
  if (!["lead", "active", "dating", "paused"].includes(p.status)) return false;
  // Legacy CC TECH path stays valid in case labels start landing later.
  if ((p.google_contacts_labels ?? []).includes("CC TECH")) return true;
  const handles = p.handles ?? [];
  const hasDatingHandle = handles.some((h: any) => DATING_CHANNELS.has(h.channel));
  const hasRecentInbound = p.last_inbound_at && now - p.last_inbound_at < NINETY_DAYS_MS;
  const hasOperatorRating = p.hotness_rating !== undefined || p.effort_rating !== undefined;
  const isDatingVibe = p.vibe_classification === "dating";
  const isImported = p.imported_from_profile_screenshot === true;
  return Boolean(hasDatingHandle || hasRecentInbound || hasOperatorRating || isDatingVibe || isImported);
}

export const sweepCourtshipCandidates = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const staleBefore = now - ENRICH_STALE_DAYS * 24 * 60 * 60 * 1000;

    const all = await ctx.db.query("people").collect();
    const eligible = all.filter((p) => isDatingRelevant(p, now));
    const candidates = eligible
      .filter((p) => !p.courtship_last_analyzed || p.courtship_last_analyzed < staleBefore)
      .slice(0, MAX_PER_SWEEP);

    let scheduled = 0;
    for (let i = 0; i < candidates.length; i++) {
      const p = candidates[i];
      // Stagger the calls 6 seconds apart to spread LLM API load
      await ctx.scheduler.runAfter(i * 6000, internal.enrichment.enrichCourtshipForOne, {
        person_id: p._id,
      });
      scheduled++;
    }
    return {
      scheduled,
      eligible: eligible.length,
      total_people: all.length,
    };
  },
});

// -------------------------------------------------------------------------
// sweepAskCandidates — AI-9500 #2 Ask-Window Optimizer
//
// Two-tier scheduling strategy:
//
//   TIER A — Active-typing window (2x conversion lift)
//   For candidates whose last_inbound_at is within 10 minutes AND whose
//   most-recent emotional state is positive (happy/playful/flirty/curious/warm)
//   AND who have no boundary mention in their last 5 messages:
//     → Schedule the date_ask to fire in 60 seconds — lands while she's still
//       scrolling and receptive.
//
//   TIER B — Static stagger (legacy fallback)
//   All other candidates get the existing 30-90 min stagger so the ask
//   lands in a warm-but-not-cold window without stomping on an active burst.
// -------------------------------------------------------------------------
const ASK_THRESHOLD = 0.7;
const ASK_COOLDOWN_DAYS = 14;
const MAX_ASKS_PER_SWEEP = 5;

/** Positive emotional states where asking mid-flow converts ~2x. */
const ACTIVE_TYPING_POSITIVE_STATES = new Set([
  "happy", "playful", "flirty", "curious", "warm", "excited",
]);

/** Boundary-mention regex — same patterns used by the inbound interpreter. */
const BOUNDARY_REGEX = /\b(not\s+ready|not\s+interested|seeing\s+someone|in\s+a\s+relationship|boyfriend|girlfriend|partner|just\s+friends|don'?t\s+like|stop|no\s+thanks|leave\s+me|block)\b/i;

/**
 * Returns true when the candidate is in an active-typing window:
 *   1. Last inbound within 10 minutes.
 *   2. Most-recent emotional_state_recent entry is a positive state.
 *   3. None of the last 5 messages (passed in) contain a boundary mention.
 */
function _isActivelyTyping(
  person: any,
  now: number,
  last5Bodies: string[],
): boolean {
  // Gate 1: she replied within the last 10 minutes.
  const tenMinMs = 10 * 60 * 1000;
  if (!person.last_inbound_at || now - person.last_inbound_at > tenMinMs) return false;

  // Gate 2: most-recent emotional state is positive.
  const stateLog: any[] = person.emotional_state_recent ?? [];
  const latestState = stateLog[stateLog.length - 1]?.state as string | undefined;
  if (!latestState || !ACTIVE_TYPING_POSITIVE_STATES.has(latestState)) return false;

  // Gate 3: no boundary mention in last 5 messages.
  for (const body of last5Bodies) {
    if (BOUNDARY_REGEX.test(body)) return false;
  }
  return true;
}

import { api } from "./_generated/api";

// Internal query to fetch last N message bodies for boundary-check.
export const _lastNBodiesForPerson = internalQuery({
  args: {
    person_id: v.id("people"),
    n: v.number(),
  },
  handler: async (ctx, args) => {
    // Primary: messages table by person_id.
    let rows = await ctx.db
      .query("messages")
      .withIndex("by_person_recent", (q) => q.eq("person_id", args.person_id))
      .order("desc")
      .take(args.n);
    // Fallback: walk conversations.
    if (rows.length === 0) {
      const convs = await ctx.db
        .query("conversations")
        .withIndex("by_person", (q) => q.eq("person_id", args.person_id))
        .collect();
      const collected: typeof rows = [];
      for (const c of convs) {
        const msgs = await ctx.db
          .query("messages")
          .withIndex("by_conversation", (q) => q.eq("conversation_id", c._id))
          .order("desc")
          .take(args.n);
        collected.push(...msgs);
      }
      collected.sort((a, b) => (b.sent_at || 0) - (a.sent_at || 0));
      rows = collected.slice(0, args.n);
    }
    return rows.map((m) => (m.body || "").slice(0, 300));
  },
});

export const sweepAskCandidates = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cooldown = now - ASK_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

    const all = await ctx.db.query("people").collect();
    // AI-9500 audit: widened from CC-TECH-label gate to dating-relevance heuristic.
    // Whitelist + active-status + ttas-threshold gates remain — those are the
    // actual safety brakes; the label was just a coarse pre-filter.
    const candidates = all
      .filter((p) => isDatingRelevant(p, now))
      .filter((p) => p.whitelist_for_autoreply === true)
      .filter((p) => p.status === "active")
      .filter((p) => (p.time_to_ask_score ?? 0) >= ASK_THRESHOLD)
      .filter((p) => !p.last_ask_attempted_at || p.last_ask_attempted_at < cooldown)
      .filter((p) => p.courtship_stage !== "ended" && p.courtship_stage !== "ghosted")
      .sort((a, b) => (b.time_to_ask_score ?? 0) - (a.time_to_ask_score ?? 0))
      .slice(0, MAX_ASKS_PER_SWEEP);

    let scheduled = 0;
    let activeTypingCount = 0;
    for (let i = 0; i < candidates.length; i++) {
      const p = candidates[i];

      // AI-9500 #2: Detect active-typing window.
      // Fetch last 5 message bodies (inbound + outbound) to check for boundaries.
      const last5Bodies: string[] = await ctx.db
        .query("messages")
        .withIndex("by_person_recent", (q) => q.eq("person_id", p._id))
        .order("desc")
        .take(5)
        .then((rows) => rows.map((m: any) => (m.body || "").slice(0, 300)));

      const isActiveWindow = _isActivelyTyping(p, now, last5Bodies);

      let scheduledFor: number;
      if (isActiveWindow) {
        // TIER A: fire in 60 seconds — she's actively typing, max receptivity.
        scheduledFor = now + 60_000;
        activeTypingCount++;
      } else {
        // TIER B: legacy 30-90 min stagger.
        scheduledFor = now + (30 + i * 12) * 60 * 1000;
      }

      await ctx.scheduler.runAfter(0, internal.enrichment._scheduleAskFor, {
        person_id: p._id,
        user_id: p.user_id,
        scheduled_for: scheduledFor,
        active_typing_window: isActiveWindow,
      });
      // Throttle marker so re-sweeps don't double-schedule.
      await ctx.db.patch(p._id, {
        last_ask_attempted_at: now, updated_at: now,
      });
      scheduled++;
    }
    return { scheduled, eligible: candidates.length, active_typing_path: activeTypingCount };
  },
});

// Internal helper — wraps the public api.touches.scheduleOne so we can call
// it from a scheduled context inside the sweep.
import { internalAction as ia2 } from "./_generated/server";
export const _scheduleAskFor = ia2({
  args: {
    person_id: v.id("people"),
    user_id: v.string(),
    scheduled_for: v.number(),
    // AI-9500 #2: tracks whether this was scheduled in the active-typing window
    // so downstream analytics can distinguish Tier A vs Tier B outcomes.
    active_typing_window: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(api.touches.scheduleOne, {
      user_id: args.user_id,
      person_id: args.person_id,
      type: "date_ask",
      scheduled_for: args.scheduled_for,
      generate_at_fire_time: true,
      urgency: args.active_typing_window ? "hot" : "warm",
      prompt_template: "date_ask_three_options",
      generated_by_run_id: `ask-sweep-${args.active_typing_window ? "active" : "static"}-${Date.now()}`,
    } as any);
  },
});

export const sweepVibeCandidates = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const staleBefore = now - VIBE_STALE_DAYS * 24 * 60 * 60 * 1000;

    // AI-9500 audit: build the conversations set via index lookup per-person
    // instead of a single full table-scan. The full-scan was racing against
    // BlueBubbles webhook writes and crashing the sweep with OptimisticConcurrency.
    // Per-person `by_person_recent` index reads are smaller, so the OCC
    // window per-row is tiny and the overall sweep tolerates concurrent inserts.
    const all = await ctx.db.query("people").collect();
    const eligibleStale = all
      .filter((p) => !p.vibe_classified_at || p.vibe_classified_at < staleBefore)
      .filter((p) => isDatingRelevant(p, now));

    let withConvCount = 0;
    const candidates: typeof eligibleStale = [];
    for (const p of eligibleStale) {
      if (candidates.length >= MAX_PER_SWEEP) break;
      const conv = await ctx.db
        .query("conversations")
        .withIndex("by_person", (q) => q.eq("person_id", p._id))
        .first();
      if (conv) {
        candidates.push(p);
        withConvCount++;
      }
    }

    let scheduled = 0;
    for (let i = 0; i < candidates.length; i++) {
      await ctx.scheduler.runAfter(i * 6000, internal.enrichment.classifyConversationVibeForOne, {
        person_id: candidates[i]._id,
      });
      scheduled++;
    }
    return { scheduled, with_convs: withConvCount, eligible: eligibleStale.length };
  },
});

// -------------------------------------------------------------------------
// AI-9500-E — Reply-velocity mirror + active-hours auto-tune
//
// recalibrateCadenceForOne: fits her median reply-gap from the last 30d of
// messages and updates cadence_overrides on the person row. Also computes
// her active-hours histogram (active_hours_computed) from observed message
// timestamps (inbound messages, bucketed by local hour).
//
// Algorithm:
//   1. Fetch last 30d of messages for the person (both directions).
//   2. Build reply-pair list: for each outbound message, find the next
//      inbound message. Record gap_ms = inbound.sent_at - outbound.sent_at.
//      Only pairs where gap < 24h (genuine replies, not "she came back 3 days
//      later") and gap > 30s (not automated instant-reply artifacts).
//   3. If < MIN_REPLY_PAIRS pairs, return {skipped: true, reason: "insufficient_data"}.
//   4. Sort gaps, pick median. Clamp min/max to [30s, 6h].
//      min_reply_gap_ms = clamp(median * 0.7, 30s, 6h)
//      max_reply_gap_ms = clamp(median * 1.4, 30s, 6h)
//   5. Active-hours: bucket inbound messages by local hour (using person.timezone
//      or UTC fallback). Mark hours where count > 1/3 of peak count.
//   6. Patch the person row with cadence_overrides + active_hours_computed.
// -------------------------------------------------------------------------

const MIN_REPLY_PAIRS = 10;             // require at least 10 pairs to fit
const MAX_PAIR_GAP_MS = 24 * 3600_000; // ignore gaps >24h (left conversation, not a reply)
const MIN_PAIR_GAP_MS = 30_000;        // ignore gaps <30s (bot, read-receipt, sync artifact)
const CLAMP_MIN_MS = 30_000;           // absolute floor: 30 seconds
const CLAMP_MAX_MS = 6 * 3600_000;     // absolute ceiling: 6 hours

// Internal query: fetch last 30d of messages for a person, newest first.
export const _recentMessagesForCadence = internalQuery({
  args: {
    person_id: v.id("people"),
    since_ms: v.number(),
  },
  handler: async (ctx, args) => {
    // Primary path: use the by_person_recent index if it exists on messages.
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_person_recent", (q) =>
        q.eq("person_id", args.person_id).gte("sent_at", args.since_ms),
      )
      .order("asc")
      .collect();

    if (rows.length > 0) return rows;

    // Fallback: iterate conversations linked to person and collect.
    const convs = await ctx.db
      .query("conversations")
      .withIndex("by_person", (q) => q.eq("person_id", args.person_id))
      .collect();
    const collected: typeof rows = [];
    for (const c of convs) {
      const msgs = await ctx.db
        .query("messages")
        .withIndex("by_conversation", (q) =>
          q.eq("conversation_id", c._id).gte("sent_at", args.since_ms),
        )
        .order("asc")
        .collect();
      collected.push(...msgs);
    }
    collected.sort((a, b) => (a.sent_at || 0) - (b.sent_at || 0));
    return collected;
  },
});

// Internal mutation: write computed cadence fields back to the person row.
export const _writeCadenceOverrides = internalMutation({
  args: {
    person_id: v.id("people"),
    cadence_overrides: v.object({
      min_reply_gap_ms: v.number(),
      max_reply_gap_ms: v.number(),
      computed_at: v.number(),
      sample_pairs: v.number(),
    }),
    active_hours_computed: v.array(v.float64()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.person_id, {
      cadence_overrides: args.cadence_overrides,
      active_hours_computed: args.active_hours_computed,
      updated_at: now,
    });
  },
});

// -------------------------------------------------------------------------
// AI-9500 #1 — Curiosity-question scheduler helpers
//
// _computeHerQuestionRatio: reads her inbound messages in the last 7d and
// returns { ratio, question_count, total_count } where ratio = ?-count / total.
// Uses the by_person_recent index for efficiency.
//
// _writeHerQuestionRatio: patches the person row with the computed ratio and
// timestamp. Also sets next_followup_kind = "easy_question_revival" when:
//   - ratio < 0.15 (she's stopped asking questions)
//   - last_inbound_at > 24h ago (conversation is quiet)
//
// These are called from recalibrateCadenceForOne so cadence + question-ratio
// compute in a single sweep pass.
// -------------------------------------------------------------------------

/** Count question marks in a string (counts "?", "??", "???" as 1 each occurrence of "?"). */
function _countQuestionMarks(text: string): number {
  return (text.match(/\?/g) || []).length;
}

export const _computeHerQuestionRatio = internalQuery({
  args: { person_id: v.id("people") },
  handler: async (ctx, args) => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 3600_000;

    // Primary: by_person_recent index with since filter
    let inboundMsgs = await ctx.db
      .query("messages")
      .withIndex("by_person_recent", (q) =>
        q.eq("person_id", args.person_id).gte("sent_at", sevenDaysAgo),
      )
      .filter((q) => q.eq(q.field("direction"), "inbound"))
      .collect();

    // Fallback: walk conversations if index returned nothing
    if (inboundMsgs.length === 0) {
      const convs = await ctx.db
        .query("conversations")
        .withIndex("by_person", (q) => q.eq("person_id", args.person_id))
        .collect();
      for (const c of convs) {
        const msgs = await ctx.db
          .query("messages")
          .withIndex("by_conversation", (q) =>
            q.eq("conversation_id", c._id).gte("sent_at", sevenDaysAgo),
          )
          .filter((q) => q.eq(q.field("direction"), "inbound"))
          .collect();
        inboundMsgs.push(...msgs);
      }
    }

    const total = inboundMsgs.length;
    if (total === 0) return { ratio: null, question_count: 0, total_count: 0 };

    let questionCount = 0;
    for (const m of inboundMsgs) {
      if (_countQuestionMarks(m.body || "") > 0) questionCount++;
    }

    return {
      ratio: questionCount / total,
      question_count: questionCount,
      total_count: total,
    };
  },
});

export const _writeHerQuestionRatio = internalMutation({
  args: {
    person_id: v.id("people"),
    her_question_ratio_7d: v.number(),
    set_easy_question_revival: v.boolean(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const patch: Record<string, unknown> = {
      her_question_ratio_7d: args.her_question_ratio_7d,
      her_question_ratio_computed_at: now,
      updated_at: now,
    };
    if (args.set_easy_question_revival) {
      patch.next_followup_kind = "easy_question_revival";
    }
    await ctx.db.patch(args.person_id, patch);
  },
});

// Main action: compute and write cadence overrides for one person.
export const recalibrateCadenceForOne = internalAction({
  args: { person_id: v.id("people") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const since = now - 30 * 24 * 3600_000;  // last 30 days

    // Fetch person for timezone + validation.
    const person: any = await ctx.runQuery(internal.enrichment._getPersonForEnrichment, {
      person_id: args.person_id,
    });
    if (!person) return { skipped: true, reason: "person_not_found" };

    const msgs: any[] = await ctx.runQuery(internal.enrichment._recentMessagesForCadence, {
      person_id: args.person_id,
      since_ms: since,
    });

    if (msgs.length < 4) {
      return { skipped: true, reason: "insufficient_data", msg_count: msgs.length };
    }

    // -----------------------------------------------------------------------
    // Step 1: Build reply-pair gaps
    // A "reply pair" is: outbound[i] -> inbound[j] where j is the first
    // inbound message after outbound[i], and the gap is within bounds.
    // -----------------------------------------------------------------------
    const replyGaps: number[] = [];
    for (let i = 0; i < msgs.length - 1; i++) {
      if (msgs[i].direction !== "outbound") continue;
      const outboundAt = msgs[i].sent_at as number;
      // Find the next inbound after this outbound.
      for (let j = i + 1; j < msgs.length; j++) {
        if (msgs[j].direction === "inbound") {
          const inboundAt = msgs[j].sent_at as number;
          const gap = inboundAt - outboundAt;
          if (gap >= MIN_PAIR_GAP_MS && gap <= MAX_PAIR_GAP_MS) {
            replyGaps.push(gap);
          }
          // Whether or not gap was in bounds, stop looking for a reply to
          // this outbound (she replied; we already captured or discarded it).
          break;
        }
        // If another outbound comes before an inbound, this outbound never
        // got a direct reply — skip it.
        if (msgs[j].direction === "outbound") break;
      }
    }

    if (replyGaps.length < MIN_REPLY_PAIRS) {
      return {
        skipped: true,
        reason: "insufficient_data",
        reply_pairs: replyGaps.length,
        needed: MIN_REPLY_PAIRS,
      };
    }

    // -----------------------------------------------------------------------
    // Step 2: Median reply gap
    // -----------------------------------------------------------------------
    replyGaps.sort((a, b) => a - b);
    const mid = Math.floor(replyGaps.length / 2);
    const median = replyGaps.length % 2 === 0
      ? (replyGaps[mid - 1] + replyGaps[mid]) / 2
      : replyGaps[mid];

    const clamp = (v: number) => Math.max(CLAMP_MIN_MS, Math.min(CLAMP_MAX_MS, v));
    const minGap = clamp(median * 0.7);
    const maxGap = clamp(median * 1.4);

    // -----------------------------------------------------------------------
    // Step 3: Active-hours histogram (inbound messages by local hour)
    // -----------------------------------------------------------------------
    const tz = (person.active_hours_local?.tz) || "UTC";
    const hourCounts = new Array<number>(24).fill(0);
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    });

    for (const m of msgs) {
      if (m.direction !== "inbound") continue;
      try {
        const hourStr = fmt.format(new Date(m.sent_at as number));
        const h = parseInt(hourStr, 10);
        if (h >= 0 && h < 24) hourCounts[h]++;
      } catch {
        // non-critical; skip malformed timestamps
      }
    }

    const peakCount = Math.max(...hourCounts);
    const activeHours: number[] = [];
    if (peakCount > 0) {
      const threshold = peakCount / 3;
      for (let h = 0; h < 24; h++) {
        if (hourCounts[h] > threshold) activeHours.push(h);
      }
    }

    // -----------------------------------------------------------------------
    // Step 4: Write back cadence overrides
    // -----------------------------------------------------------------------
    const cadenceOverrides = {
      min_reply_gap_ms: minGap,
      max_reply_gap_ms: maxGap,
      computed_at: now,
      sample_pairs: replyGaps.length,
    };

    await ctx.runMutation(internal.enrichment._writeCadenceOverrides, {
      person_id: args.person_id,
      cadence_overrides: cadenceOverrides,
      active_hours_computed: activeHours,
    });

    // -----------------------------------------------------------------------
    // Step 5: AI-9500 #1 — Curiosity-question ratio
    //
    // Compute her ?-count / total-messages ratio for the last 7d inbound messages.
    // If ratio < 0.15 AND last_inbound_at > 24h ago → flag for easy_question_revival
    // so the fatigue sweep sends a yes/no question instead of a generic interrupt.
    // -----------------------------------------------------------------------
    const QUESTION_RATIO_THRESHOLD = 0.15;
    const TWENTY_FOUR_H_MS = 24 * 3600_000;
    const lastInboundAt: number = person.last_inbound_at ?? 0;
    const isSilent = lastInboundAt > 0 && (now - lastInboundAt) > TWENTY_FOUR_H_MS;

    const questionRatioResult: any = await ctx.runQuery(
      internal.enrichment._computeHerQuestionRatio,
      { person_id: args.person_id },
    );

    let questionRatioWritten: number | null = null;
    if (questionRatioResult.ratio !== null) {
      const ratio: number = questionRatioResult.ratio;
      const setRevival = ratio < QUESTION_RATIO_THRESHOLD && isSilent;
      await ctx.runMutation(internal.enrichment._writeHerQuestionRatio, {
        person_id: args.person_id,
        her_question_ratio_7d: ratio,
        set_easy_question_revival: setRevival,
      });
      questionRatioWritten = ratio;
    }

    return {
      person_id: args.person_id,
      reply_pairs: replyGaps.length,
      median_reply_gap_ms: median,
      min_reply_gap_ms: minGap,
      max_reply_gap_ms: maxGap,
      active_hours: activeHours,
      her_question_ratio_7d: questionRatioWritten,
      easy_question_revival_flagged: questionRatioWritten !== null
        && questionRatioWritten < QUESTION_RATIO_THRESHOLD && isSilent,
    };
  },
});

// -------------------------------------------------------------------------
// recalibrateCadenceSweep — weekly cron target. Lists all people whose
// total_messages_30d > 30 and queues recalibrateCadenceForOne for each.
// Staggered 5s apart to spread load.
// -------------------------------------------------------------------------
const CADENCE_SWEEP_MIN_MSGS = 30;
const CADENCE_STAGGER_MS = 5_000;

export const recalibrateCadenceSweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("people").collect();
    const candidates = all.filter(
      (p) => (p.total_messages_30d ?? 0) > CADENCE_SWEEP_MIN_MSGS,
    );

    let scheduled = 0;
    for (let i = 0; i < candidates.length; i++) {
      await ctx.scheduler.runAfter(
        i * CADENCE_STAGGER_MS,
        internal.enrichment.recalibrateCadenceForOne,
        { person_id: candidates[i]._id },
      );
      scheduled++;
    }
    return {
      scheduled,
      total_people: all.length,
      eligible: candidates.length,
    };
  },
});

// -------------------------------------------------------------------------
// sweepFatigueDetection — AI-9500-F
//
// Identifies people whose engagement is declining and schedules a
// pattern_interrupt touch to re-spark the conversation.
//
// Selection criteria (ALL must be true):
//   - status in ["lead", "active", "dating"]
//   - whitelist_for_autoreply === true
//   - last 5 messages have a negative engagement slope (< -0.2)
//   - last inbound message > 3 days ago
//   - no pattern_interrupt touch scheduled in the last 14 days
//
// Engagement score per message: uses the stored engagement_score if the
// message has it; otherwise applies a quick heuristic:
//   score = clamp01(length/200 * 0.5 + questions/3 * 0.3 + emojis/3 * 0.2)
//
// Slope: simple linear regression slope = (y[n-1] - y[0]) / (n - 1)
// over the sorted 5-point series. Negative = engagement trending down.
//
// Scheduled touch fires within the person's active_hours_local window,
// jittered 0-6h from now.
// -------------------------------------------------------------------------

const FATIGUE_STATUSES = new Set(["lead", "active", "dating"]);
const FATIGUE_SLOPE_THRESHOLD = -0.2;
const FATIGUE_SILENCE_DAYS = 3;
const FATIGUE_INTERRUPT_COOLDOWN_DAYS = 14;
const FATIGUE_ENGAGE_WINDOW = 5;     // last N messages for slope
const MAX_FATIGUE_SWEEP = 20;
const FATIGUE_JITTER_MS = 6 * 60 * 60 * 1000; // max 6h jitter

/** Heuristic engagement score when no stored score available. */
function _msgEngagementScore(body: string): number {
  const len = Math.min(body.length, 300);
  const questions = (body.match(/\?/g) || []).length;
  // Count basic emoji ranges (BMP + supplementary)
  const emojis = (body.match(/[\u{1F300}-\u{1FAFF}]|\p{Emoji_Presentation}/gu) || []).length;
  const s = (len / 200) * 0.5 + Math.min(questions, 3) / 3 * 0.3 + Math.min(emojis, 3) / 3 * 0.2;
  return Math.max(0, Math.min(1, s));
}

/** Simple slope: (last - first) / (n-1). Returns 0 for single-point series. */
function _engagementSlope(scores: number[]): number {
  if (scores.length < 2) return 0;
  return (scores[scores.length - 1] - scores[0]) / (scores.length - 1);
}

// =========================================================================
// AI-9500-F — DISC → sub-style mapping for pattern_interrupt
// =========================================================================
//
// Sub-styles:
//   callback          — references something she said earlier; universal safe choice
//   meme_reference    — playful, culture-hook; re-establishes fun vibe
//   low_pressure_check_in — super-soft, easy on-ramp back
//   bold_direct       — direct, confident re-opener; slight challenge energy
//   seasonal_hook     — ties into current season/event/holiday; feels timely
//
// Resolution order: courtship_stage override → disc_primary → disc_inference → "callback"

const SUBSTYLE_BY_DISC: Record<string, string> = {
  D: "bold_direct",
  I: "meme_reference",
  S: "low_pressure_check_in",
  C: "seasonal_hook",
};

const SUBSTYLE_BY_STAGE: Record<string, string> = {
  ghosted: "low_pressure_check_in",
  ended:   "low_pressure_check_in",
  matched: "meme_reference",
};

/**
 * Determine the best pattern-interrupt sub-style for a person.
 *
 * Resolution order:
 *   1. courtship_stage override (ghosted/ended/matched → fixed style)
 *   2. disc_primary → DISC map
 *   3. disc_inference field (optional, string like "D/I" or "I")
 *   4. default → "callback"
 */
function _pickSubstyle(person: Record<string, unknown>): string {
  const stage = (person.courtship_stage as string | undefined) ?? "";
  if (stage in SUBSTYLE_BY_STAGE) {
    return SUBSTYLE_BY_STAGE[stage]!;
  }
  const disc =
    (person.disc_primary as string | undefined) ||
    (person.disc_inference as string | undefined) || "";
  const primary = disc.toUpperCase().trim().length > 0 ? disc.toUpperCase().trim()[0]! : "";
  if (primary in SUBSTYLE_BY_DISC) {
    return SUBSTYLE_BY_DISC[primary]!;
  }
  return "callback";
}

/**
 * Fit a simple least-squares linear slope on `y` values (one per index 0..N-1).
 * Returns slope (dy/d_position). Negative = declining engagement.
 * Supersedes the simple first/last delta in prior helper above.
 */
function _lsSlope(y: number[]): number {
  const n = y.length;
  if (n < 2) return 0;
  let xMean = 0; let yMean = 0;
  for (let i = 0; i < n; i++) { xMean += i; yMean += y[i]!; }
  xMean /= n; yMean /= n;
  let num = 0; let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (y[i]! - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/**
 * AI-9500-F — Conversation-fatigue detection sweep.
 *
 * Scans CC TECH people whose engagement is declining AND who have been silent
 * for >3 days, then enqueues a pattern_interrupt agent_job with the DISC-based
 * sub-style. Idempotent: skips people that already have a pending touch queued.
 *
 * Runs every 12h via crons.ts ("fatigue-detection-sweep").
 */
export const sweepFatigueDetection = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    scanned: number;
    qualified: number;
    scheduled: number;
    skipped_pending: number;
  }> => {
    const now = Date.now();
    const silenceCutoff = now - FATIGUE_SILENCE_DAYS * 24 * 60 * 60 * 1000;

    // 1. Load candidate people (active / paused / lead with recent last_inbound_at).
    const all: any[] = await ctx.runQuery(internal.enrichment._fatigueListPeople, {});
    const eligible = all
      .filter((p) => FATIGUE_STATUSES.has(p.status ?? ""))
      .slice(0, MAX_FATIGUE_SWEEP);

    let scanned = 0;
    let qualified = 0;
    let scheduled = 0;
    let skippedPending = 0;

    for (const person of eligible) {
      scanned++;

      // 2. Must be CC TECH member (array filter — can't index on array fields).
      const labels: string[] = (person.google_contacts_labels as string[] | undefined) ?? [];
      if (!labels.includes("CC TECH")) continue;

      // 3. Must be silent >3d (inbound older than cutoff).
      const lastInbound = (person.last_inbound_at as number | undefined) ?? 0;
      if (lastInbound > silenceCutoff) continue;

      // 4. Compute engagement slope over last 5 messages.
      const msgs: any[] = await ctx.runQuery(
        internal.enrichment._recentMessagesForPerson,
        { person_id: person._id, limit: FATIGUE_ENGAGE_WINDOW },
      );
      if (msgs.length >= 2) {
        const sorted = [...msgs].sort((a, b) => (a.sent_at || 0) - (b.sent_at || 0));
        const ySeries = sorted.map((m) =>
          typeof m.engagement_score === "number"
            ? m.engagement_score
            : _msgEngagementScore(m.body || ""),
        );
        // Normalise if scores look like raw word-counts (>1)
        const maxY = Math.max(...ySeries);
        const yNorm = maxY > 1 ? ySeries.map((v) => v / maxY) : ySeries;
        const slope = _lsSlope(yNorm);
        if (slope >= FATIGUE_SLOPE_THRESHOLD) continue; // healthy trend
      }
      // (if < 2 messages, allow through — pure silence trigger)

      // 5. Skip if pending pattern_interrupt touch already queued.
      const hasPending: boolean = await ctx.runQuery(
        internal.enrichment._hasRecentPatternInterrupt,
        { person_id: person._id, since: now - FATIGUE_INTERRUPT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000 },
      );
      if (hasPending) {
        skippedPending++;
        continue;
      }

      // 6. Pick sub-style and enqueue agent_job.
      qualified++;
      const substyle = _pickSubstyle(person as Record<string, unknown>);
      const jitterMs = Math.floor(Math.random() * FATIGUE_JITTER_MS);

      await ctx.runMutation(api.agent_jobs.enqueue, {
        user_id: person.user_id as string,
        job_type: "send_imessage",
        payload: {
          person_id: person._id,
          prompt_template: "pattern_interrupt",
          template_id: substyle,
          touch_type: "pattern_interrupt",
          sub_style: substyle,
          generate_at_fire_time: true,
          fatigue_sweep: true,
          scheduled_for: now + jitterMs,
        },
        priority: 1,
        max_attempts: 2,
      });
      scheduled++;
    }

    return { scanned, qualified, scheduled, skipped_pending: skippedPending };
  },
});

// Query: list all people for fatigue sweep (internalQuery so action can call it).
export const _fatigueListPeople = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("people").collect(),
});

// Query: check if a pattern_interrupt agent_job was queued within the last N ms.
// Replaces the scheduled_touches query — uses agent_jobs table instead.
export const _hasRecentPatternInterrupt = internalQuery({
  args: {
    person_id: v.id("people"),
    since: v.number(),
  },
  handler: async (ctx, args) => {
    // Scan queued + running + completed agent_jobs for this person.
    const statuses = ["queued", "running", "done"] as const;
    for (const status of statuses) {
      const rows = await ctx.db
        .query("agent_jobs")
        .withIndex("by_status_priority", (q) => q.eq("status", status))
        .order("desc")
        .take(200);
      const found = rows.some((job) => {
        if (job.job_type !== "send_imessage") return false;
        const p = job.payload as Record<string, unknown> | undefined;
        if (p?.person_id !== args.person_id) return false;
        if (p?.touch_type !== "pattern_interrupt") return false;
        // Check creation time — use _creationTime (Convex system field)
        return (job._creationTime ?? 0) >= args.since;
      });
      if (found) return true;
    }
    return false;
  },
});

// Pick a pattern_interrupt sub_style from DISC + stage.
// Exported so convex_runner.py can mirror the same logic client-side.
export function pickPatternInterruptSubStyle(
  discPrimary: string | null | undefined,
  courtshipStage?: string | null,
): string {
  return _pickSubstyle({
    disc_primary: discPrimary,
    courtship_stage: courtshipStage,
  });
}

// -------------------------------------------------------------------------
// AI-9500 #2 — 7-day ghost-out sweep for date_ask touches.
//
// Any scheduled_touches row of type "date_ask" that:
//   - fired more than 7 days ago (fired_at < now - 7d)
//   - has ask_outcome === undefined (no reply was classified)
// gets patched with ask_outcome = "no_reply" so the A/B analytics don't
// count it as "pending" indefinitely.
//
// Run every 6 hours via crons.ts. Processes at most 200 rows per run to
// bound the mutation duration.
// -------------------------------------------------------------------------
const GHOST_OUT_DAYS = 7;
const GHOST_OUT_BATCH = 200;

export const sweepDateAskGhostOuts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cutoff = now - GHOST_OUT_DAYS * 24 * 60 * 60 * 1000;

    // Scan the by_user_fired index for recently fired touches.
    // We don't have a direct "fired date_ask without outcome" index,
    // so we use the status=fired path and filter client-side.
    // The batch cap (200) keeps this well within Convex mutation limits.
    const firedRows = await ctx.db
      .query("scheduled_touches")
      .withIndex("by_due", (q) => q.eq("status", "fired").lte("scheduled_for", cutoff))
      .take(GHOST_OUT_BATCH);

    let patched = 0;
    for (const row of firedRows) {
      if (row.type !== "date_ask") continue;
      // Only ghost-out rows where ask_outcome is not yet set.
      if ((row as any).ask_outcome !== undefined) continue;
      await ctx.db.patch(row._id, {
        ask_outcome: "no_reply" as const,
        updated_at: now,
      } as any);
      patched++;
    }
    return { patched, scanned: firedRows.length };
  },
});

// =========================================================================
// AI-9500 W1 — Competition Signal Model
//
// Measures how much she's juggling other men using 4 complementary signals:
//
//   1. REPLY-TIME VARIANCE (weight 0.30)
//      Std-dev of her inter-reply-gaps over the last 30 days.
//      Low variance = she's consistent and attending to you;
//      high variance = her attention is scattered (other men, busy life).
//      Normalised against a 0-4h std-dev range.
//
//   2. COMPETING-DEMANDS FREQUENCY (weight 0.35)
//      Count of inbound messages mentioning keywords like "out with friends",
//      "back from trip", "busy", "another date", "talking to", "guy", "guys",
//      "seeing someone", "been dating", "dating app", etc. — divided by total
//      inbound message count to produce a rate.
//
//   3. GHOST-RECOVERY COUNT (weight 0.20)
//      How many times has she gone silent >48h and then come back on her own?
//      Each recovery is evidence she's juggling: she surfaces when she has a
//      free slot. Capped at 5 (1 recovery per month in a 5-month window).
//
//   4. LATE-EVENING ACTIVE-HOURS OVERLAP (weight 0.15)
//      During 8–11pm local time, what fraction of her replies arrive within
//      30 minutes of YOU sending? Low fraction = she's occupied those hours
//      (other men, dates). Inverted: low overlap → high competition signal.
//
// FINAL FORMULA:
//   raw = 0.30 * variance_score
//       + 0.35 * competing_demands_rate
//       + 0.20 * ghost_recovery_score
//       + 0.15 * (1 - evening_overlap_rate)
//   score = clamp(raw, 0, 1)
//
//   0.00–0.25  → 🎯 #1  (she's focused on you)
//   0.25–0.55  → ⚖️ middle (some competing demands, normal)
//   0.55–1.00  → 🚨 juggling (5+ men energy)
// =========================================================================

const COMP_LOOKBACK_MS = 30 * 24 * 3600_000;  // 30-day window
const COMP_STALE_DAYS = 14;                     // recompute every 14 days

/** Keywords that hint at competing demands / other men. */
const COMPETITION_KEYWORDS_RE = /\b(out\s+with\s+(?:friends|girls|the\s+girls)|back\s+from\s+(?:a?\s*trip|vacation|travelling)|(?:been\s+)?(?:so\s+)?busy|another\s+date|going\s+on\s+a\s+date|(?:talking\s+to|dating|seeing)\s+(?:a?\s*guy|some(?:one|body)|another|a\s+few)|(?:this\s+)?guy\s+i|met\s+(?:a|this)\s+guy|multiple\s+guys|dating\s+app|hinge|bumble|tinder|match\.com|apps again|in\s+a\s+talking\s+stage)\b/gi;

/** Evening window: 20:00–23:00 local (hours in 24h format). */
const EVENING_START_H = 20;
const EVENING_END_H = 23;
const QUICK_REPLY_MS = 30 * 60 * 1000;   // 30 min
const GHOST_GAP_MS = 48 * 3600_000;       // 48h silence = ghost
const MAX_GHOST_RECOVERIES = 5;           // cap ghost-recovery score at 5

// ---------------------------------------------------------------------------
// Internal query: fetch raw messages for competition analysis
// ---------------------------------------------------------------------------
export const _recentMessagesForCompetition = internalQuery({
  args: {
    person_id: v.id("people"),
    since_ms: v.number(),
  },
  handler: async (ctx, args) => {
    // Primary path via by_person_recent index.
    let rows = await ctx.db
      .query("messages")
      .withIndex("by_person_recent", (q) =>
        q.eq("person_id", args.person_id).gte("sent_at", args.since_ms),
      )
      .order("asc")
      .collect();

    if (rows.length > 0) return rows;

    // Fallback: iterate conversations.
    const convs = await ctx.db
      .query("conversations")
      .withIndex("by_person", (q) => q.eq("person_id", args.person_id))
      .collect();
    const collected: typeof rows = [];
    for (const c of convs) {
      const msgs = await ctx.db
        .query("messages")
        .withIndex("by_conversation", (q) =>
          q.eq("conversation_id", c._id).gte("sent_at", args.since_ms),
        )
        .order("asc")
        .collect();
      collected.push(...msgs);
    }
    collected.sort((a, b) => (a.sent_at || 0) - (b.sent_at || 0));
    return collected;
  },
});

// ---------------------------------------------------------------------------
// Internal mutation: write competition signal fields to person row
// ---------------------------------------------------------------------------
export const _writeCompetitionSignal = internalMutation({
  args: {
    person_id: v.id("people"),
    score: v.number(),
    evidence: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.person_id, {
      competition_signal_score: args.score,
      competition_signal_evidence: args.evidence,
      competition_signal_computed_at: now,
      updated_at: now,
    });
  },
});

// ---------------------------------------------------------------------------
// Core action: compute competition signal for one person
// ---------------------------------------------------------------------------
export const _computeCompetitionSignal = internalAction({
  args: { person_id: v.id("people") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const since = now - COMP_LOOKBACK_MS;

    const person: any = await ctx.runQuery(internal.enrichment._getPersonForEnrichment, {
      person_id: args.person_id,
    });
    if (!person) return { skipped: true, reason: "person_not_found" };

    const msgs: any[] = await ctx.runQuery(internal.enrichment._recentMessagesForCompetition, {
      person_id: args.person_id,
      since_ms: since,
    });

    if (msgs.length < 6) {
      return { skipped: true, reason: "insufficient_data", msg_count: msgs.length };
    }

    const inbound = msgs.filter((m) => m.direction === "inbound");
    const outbound = msgs.filter((m) => m.direction === "outbound");

    // -------------------------------------------------------------------
    // SIGNAL 1: Reply-time variance
    // Compute std-dev of her inter-reply-gap times.
    // Build the same outbound→inbound reply pairs used in cadence analysis.
    // -------------------------------------------------------------------
    const replyGaps: number[] = [];
    for (let i = 0; i < msgs.length - 1; i++) {
      if (msgs[i].direction !== "outbound") continue;
      const outAt = msgs[i].sent_at as number;
      for (let j = i + 1; j < msgs.length; j++) {
        if (msgs[j].direction === "inbound") {
          const gap = (msgs[j].sent_at as number) - outAt;
          // Filter to genuine reply pairs: >60s and <24h
          if (gap > 60_000 && gap < 24 * 3600_000) {
            replyGaps.push(gap);
          }
          break;
        }
        if (msgs[j].direction === "outbound") break;
      }
    }

    let varianceScore = 0;
    if (replyGaps.length >= 3) {
      const mean = replyGaps.reduce((s, g) => s + g, 0) / replyGaps.length;
      const variance = replyGaps.reduce((s, g) => s + (g - mean) ** 2, 0) / replyGaps.length;
      const stdDev = Math.sqrt(variance);
      // Normalise: a std-dev of 0 = totally predictable (score 0);
      // 4 hours std-dev = highly erratic (score 1).
      varianceScore = Math.min(1, stdDev / (4 * 3600_000));
    }

    // -------------------------------------------------------------------
    // SIGNAL 2: Competing-demands keyword frequency
    // Count inbound messages with competition keywords / total inbound.
    // -------------------------------------------------------------------
    let competingMentionCount = 0;
    const competingSnippets: string[] = [];
    for (const m of inbound) {
      const body = (m.body || "") as string;
      const matches = body.match(COMPETITION_KEYWORDS_RE);
      if (matches && matches.length > 0) {
        competingMentionCount++;
        competingSnippets.push(`"${body.slice(0, 60)}"`);
      }
    }
    const competingDemandsRate = inbound.length > 0
      ? Math.min(1, competingMentionCount / inbound.length)
      : 0;

    // -------------------------------------------------------------------
    // SIGNAL 3: Ghost-recovery count
    // Scan inbound messages for gaps >48h followed by a re-engagement.
    // Each such gap counts as one ghost-then-recovery event.
    // -------------------------------------------------------------------
    let ghostRecoveries = 0;
    let lastInboundAt: number | null = null;
    for (const m of inbound) {
      const at = m.sent_at as number;
      if (lastInboundAt !== null && at - lastInboundAt > GHOST_GAP_MS) {
        ghostRecoveries++;
      }
      lastInboundAt = at;
    }
    // Normalise: cap at MAX_GHOST_RECOVERIES recoveries = score 1
    const ghostRecoveryScore = Math.min(1, ghostRecoveries / MAX_GHOST_RECOVERIES);

    // -------------------------------------------------------------------
    // SIGNAL 4: Late-evening active-hours overlap (8–11pm local)
    // For each outbound sent in 8-11pm window, check if she replied within 30 min.
    // Low overlap = she's busy those hours.
    // -------------------------------------------------------------------
    const tz = (person.active_hours_local?.tz) || "UTC";
    const hrFmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour: "numeric", hour12: false,
    });

    let eveningOutboundCount = 0;
    let eveningQuickReplyCount = 0;

    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (m.direction !== "outbound") continue;
      const sendAt = m.sent_at as number;
      // Check if this outbound falls in the 8-11pm local window.
      let localHour = -1;
      try {
        const h = hrFmt.format(new Date(sendAt));
        localHour = parseInt(h, 10);
      } catch { /* skip */ }
      if (localHour < EVENING_START_H || localHour >= EVENING_END_H) continue;

      eveningOutboundCount++;
      // Did she reply within 30 min?
      for (let j = i + 1; j < msgs.length; j++) {
        if (msgs[j].direction === "inbound") {
          const replyAt = msgs[j].sent_at as number;
          if (replyAt - sendAt <= QUICK_REPLY_MS) {
            eveningQuickReplyCount++;
          }
          break;
        }
        if (msgs[j].direction === "outbound") break;
      }
    }

    const eveningOverlapRate = eveningOutboundCount > 0
      ? eveningQuickReplyCount / eveningOutboundCount
      : 0.5; // neutral when no evening data

    // -------------------------------------------------------------------
    // COMBINE: weighted sum
    //   0.30 * variance_score
    //   0.35 * competing_demands_rate
    //   0.20 * ghost_recovery_score
    //   0.15 * (1 - evening_overlap_rate)
    // -------------------------------------------------------------------
    const raw =
      0.30 * varianceScore +
      0.35 * competingDemandsRate +
      0.20 * ghostRecoveryScore +
      0.15 * (1 - eveningOverlapRate);
    const score = Math.max(0, Math.min(1, raw));

    // Build human-readable evidence string.
    const evidenceParts: string[] = [
      `reply-time std-dev score=${varianceScore.toFixed(2)} (${replyGaps.length} pairs)`,
      `competing-mentions=${competingMentionCount}/${inbound.length} msgs (rate=${competingDemandsRate.toFixed(2)})`,
      `ghost-recoveries=${ghostRecoveries} (score=${ghostRecoveryScore.toFixed(2)})`,
      `evening-overlap=${eveningQuickReplyCount}/${eveningOutboundCount} (rate=${eveningOverlapRate.toFixed(2)})`,
    ];
    if (competingSnippets.length > 0) {
      evidenceParts.push(`samples: ${competingSnippets.slice(0, 3).join("; ")}`);
    }
    const evidence = evidenceParts.join(" | ");

    // Write back to Convex.
    await ctx.runMutation(internal.enrichment._writeCompetitionSignal, {
      person_id: args.person_id,
      score,
      evidence,
    });

    return {
      person_id: args.person_id,
      score,
      variance_score: varianceScore,
      competing_demands_rate: competingDemandsRate,
      ghost_recovery_score: ghostRecoveryScore,
      evening_overlap_rate: eveningOverlapRate,
      evidence,
    };
  },
});

// ---------------------------------------------------------------------------
// Sweep: find dating-relevant people whose competition_signal_computed_at is
// null or >14 days stale, schedule _computeCompetitionSignal per person.
// Staggered 6s apart to spread LLM/DB load.
// ---------------------------------------------------------------------------
export const sweepCompetitionSignalCandidates = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const staleBefore = now - COMP_STALE_DAYS * 24 * 3600_000;

    const all = await ctx.db.query("people").collect();
    const eligible = all.filter((p) => isDatingRelevant(p, now));
    const candidates = eligible
      .filter((p) =>
        !p.competition_signal_computed_at || p.competition_signal_computed_at < staleBefore,
      )
      .slice(0, MAX_PER_SWEEP);

    let scheduled = 0;
    for (let i = 0; i < candidates.length; i++) {
      await ctx.scheduler.runAfter(
        i * 6_000,
        internal.enrichment._computeCompetitionSignal,
        { person_id: candidates[i]._id },
      );
      scheduled++;
    }

    return { scheduled, eligible: eligible.length, total_people: all.length };
  },
});
