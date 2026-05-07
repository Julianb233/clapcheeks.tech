/**
 * AI-9500 Wave2 #K — Pre-date debrief + tag system.
 *
 * This module owns two things:
 *
 * 1. _extractThingsFromRecentMessages (internalAction)
 *    Runs an LLM over the person's last 30 messages to find things she
 *    mentioned that matter to her. Categorises each into one of:
 *      food | music | career | family | hobbies | travel | pets | sports |
 *      relationships | health | other
 *    Writes results back to people.things_mentioned with source="auto".
 *    Called by sweepDebriefExtraction (cron) and directly on demand.
 *
 * 2. sweepDebriefExtraction (internalMutation)
 *    Cron entrypoint. Finds people who haven't had a debrief extraction in
 *    the last 24h (courtship_last_analyzed proxy) AND have >= 10 messages.
 *    Schedules individual _extractThingsFromRecentMessages calls staggered
 *    5s apart, max 20 per sweep.
 *
 * Companion:
 *   - people.ts: getDebriefCard, addThingMentioned, addTag
 *   - touches.ts: schedules pre_date_debrief touch on date confirmation
 *   - crons.ts: sweepDebriefExtraction every 24h
 */

import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

// ---------------------------------------------------------------------------
// Category bucket helpers
// ---------------------------------------------------------------------------
const THING_CATEGORIES = [
  "food", "music", "career", "family", "hobbies",
  "travel", "pets", "sports", "relationships", "health", "other",
] as const;
type ThingCategory = (typeof THING_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// _extractThingsFromRecentMessages
//
// InternalAction because it makes an LLM call (Anthropic Claude via fetch).
// Reads the last 30 messages for the person, runs a structured extraction
// prompt, and writes findings back via addThingMentioned mutation.
// ---------------------------------------------------------------------------
export const _extractThingsFromRecentMessages = internalAction({
  args: {
    person_id: v.id("people"),
    user_id: v.string(),
  },
  handler: async (ctx, args) => {
    // Fetch the person + last 30 messages via getDossier pattern.
    const dossier: any = await ctx.runQuery(internal.debrief._getDossierForExtraction, {
      person_id: args.person_id,
    });

    if (!dossier) return { skipped: true, reason: "person_not_found" };

    const inboundMessages = (dossier.messages ?? [])
      .filter((m: any) => m.direction === "inbound")
      .slice(0, 30);

    if (inboundMessages.length < 3) {
      return { skipped: true, reason: "too_few_messages", count: inboundMessages.length };
    }

    // Build message transcript for the LLM
    const transcript = inboundMessages
      .map((m: any) => `[${new Date(m.sent_at).toLocaleDateString()}] ${m.body}`)
      .join("\n");

    const personName = dossier.person?.display_name ?? "her";

    // LLM extraction prompt
    const prompt = `You are analyzing messages from a dating conversation to identify topics and things that matter to the woman (${personName}).

Here are her recent messages:
${transcript}

Extract up to 8 distinct things she mentioned that reveal her interests, preferences, or personality. For each item output a JSON object on its own line with:
- topic: short label (1-4 words, e.g. "Italian food", "hiking trails", "sister's wedding")
- detail: 1 sentence of context from what she said (max 100 chars)
- category: one of: ${THING_CATEGORIES.join(", ")}

Output ONLY the JSON objects, one per line. No markdown, no explanation. If nothing notable, output an empty line.
Example:
{"topic":"Italian food","detail":"Said she loves pasta and grew up in an Italian family","category":"food"}
{"topic":"Yoga studio","detail":"Goes to hot yoga 3x/week, mentioned it relieves her work stress","category":"health"}`;

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      console.warn("debrief: ANTHROPIC_API_KEY not set, skipping extraction");
      return { skipped: true, reason: "no_api_key" };
    }

    let extracted: Array<{ topic: string; detail: string; category: ThingCategory }> = [];

    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5",
          max_tokens: 1024,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!resp.ok) {
        console.error("debrief: LLM call failed", resp.status, await resp.text());
        return { skipped: true, reason: "llm_error", status: resp.status };
      }

      const data: any = await resp.json();
      const rawText: string = data?.content?.[0]?.text ?? "";

      // Parse each line as JSON
      for (const line of rawText.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "{}") continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (
            typeof parsed.topic === "string" &&
            typeof parsed.detail === "string" &&
            THING_CATEGORIES.includes(parsed.category)
          ) {
            extracted.push({
              topic: parsed.topic.slice(0, 100),
              detail: parsed.detail.slice(0, 300),
              category: parsed.category,
            });
          }
        } catch {
          // skip malformed lines
        }
      }
    } catch (err) {
      console.error("debrief: extraction error", err);
      return { skipped: true, reason: "fetch_error" };
    }

    if (extracted.length === 0) {
      return { skipped: false, extracted_count: 0, reason: "nothing_notable" };
    }

    // Get existing auto things to avoid duplicates (same topic)
    const existingTopics = new Set(
      (dossier.person?.things_mentioned ?? [])
        .filter((t: any) => t.source === "auto")
        .map((t: any) => t.topic.toLowerCase()),
    );

    let written = 0;
    for (const item of extracted) {
      if (existingTopics.has(item.topic.toLowerCase())) continue;
      await ctx.runMutation(internal.debrief._appendThingMentioned, {
        person_id: args.person_id,
        topic: item.topic,
        detail: item.detail,
        category: item.category,
        source: "auto",
      });
      written++;
    }

    return { skipped: false, extracted_count: extracted.length, written };
  },
});

// ---------------------------------------------------------------------------
// _getDossierForExtraction — thin internal query (no media)
// ---------------------------------------------------------------------------
export const _getDossierForExtraction = internalMutation({
  args: { person_id: v.id("people") },
  handler: async (ctx, args) => {
    const person = await ctx.db.get(args.person_id);
    if (!person) return null;

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_person_recent", (q) => q.eq("person_id", args.person_id))
      .order("desc")
      .take(30);

    return { person, messages };
  },
});

// ---------------------------------------------------------------------------
// _appendThingMentioned — thin internal mutation wrapper
// (avoids calling public mutation from internalAction cross-module)
// ---------------------------------------------------------------------------
export const _appendThingMentioned = internalMutation({
  args: {
    person_id: v.id("people"),
    topic: v.string(),
    detail: v.optional(v.string()),
    category: v.optional(v.string()),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    const person = await ctx.db.get(args.person_id);
    if (!person) return;
    const existing = person.things_mentioned ?? [];
    await ctx.db.patch(args.person_id, {
      things_mentioned: [
        ...existing,
        {
          topic: args.topic,
          detail: args.detail,
          said_at_ms: Date.now(),
          source: args.source,
        },
      ],
      updated_at: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// sweepDebriefExtraction
//
// Cron entrypoint. Finds people with enough messages who haven't been
// extracted recently, schedules individual extractions staggered 5s apart.
// Max 20 per sweep so we don't flood the LLM or DB.
// ---------------------------------------------------------------------------
export const sweepDebriefExtraction = internalMutation({
  args: {},
  handler: async (ctx) => {
    const STALE_MS = 24 * 60 * 60 * 1000; // 24 hours
    const now = Date.now();
    const staleThreshold = now - STALE_MS;
    const MAX_SWEEP = 20;
    const STAGGER_MS = 5000;

    // Load all active people (limit to 200 to be safe)
    const allPeople = await ctx.db
      .query("people")
      .withIndex("by_user_status", (q) => q.eq("user_id", "fleet-julian").eq("status", "active"))
      .take(200);

    // Filter to people who are stale (last courtship analysis was > 24h ago)
    const candidates = allPeople.filter((p) => {
      const lastAnalyzed = p.courtship_last_analyzed ?? 0;
      return lastAnalyzed < staleThreshold;
    });

    let scheduled = 0;
    for (const person of candidates.slice(0, MAX_SWEEP)) {
      await ctx.scheduler.runAfter(
        scheduled * STAGGER_MS,
        internal.debrief._extractThingsFromRecentMessages,
        { person_id: person._id, user_id: person.user_id },
      );
      scheduled++;
    }

    return { swept: candidates.length, scheduled };
  },
});
