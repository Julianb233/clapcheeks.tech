/**
 * AI-9500 #8 — Opener A/B Engine
 *
 * First-reply rate is the multiplier on everything downstream. This module
 * makes every opener smarter over time via archetype bucketing + epsilon-greedy
 * winner selection.
 *
 * Architecture:
 *   _archetypeForPersonId → "DI:high_emoji:24-29"  (coarse archetype string)
 *   _draftOpenerVariants  → [{variant_id, variant_kind, body}, ...]  (2 variants)
 *   pickOpenerVariant     → {experiment_id, body, variant_kind}    (public action)
 *   recordOpenerOutcome   → void                                    (public mutation)
 *   getArchetypeWinner    → winner row or null                      (public query)
 *   _markGhostedExperiments → void                       (internal mutation — daily cron)
 *   _recomputeArchetypeWinners → void                   (internal mutation — weekly cron)
 *
 * Conservative rollout: pickOpenerVariant is a SEPARATE function. The existing
 * opener path in convex_runner.py is untouched. Operators call pickOpenerVariant
 * explicitly; the old path stays as-is.
 */

import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

// ---------------------------------------------------------------------------
// LLM provider cascade (same pattern as enrichment.ts — Gemini -> DeepSeek -> Grok)
// ---------------------------------------------------------------------------

async function llmText(systemPrompt: string, userPrompt: string, maxTokens = 300): Promise<string | null> {
  const gemKey = process.env.GEMINI_API_KEY;
  if (gemKey) {
    const r = await tryGeminiText(gemKey, systemPrompt, userPrompt, maxTokens);
    if (r) return r;
  }
  const dsKey = process.env.DEEPSEEK_API_KEY;
  if (dsKey) {
    const r = await tryOpenAICompatText(
      "https://api.deepseek.com/chat/completions", dsKey, "deepseek-chat",
      systemPrompt, userPrompt, maxTokens,
    );
    if (r) return r;
  }
  const grokKey = process.env.XAI_API_KEY;
  if (grokKey) {
    const r = await tryOpenAICompatText(
      "https://api.x.ai/v1/chat/completions", grokKey, "grok-2-latest",
      systemPrompt, userPrompt, maxTokens,
    );
    if (r) return r;
  }
  return null;
}

async function tryGeminiText(
  key: string, system: string, user: string, maxTokens: number,
): Promise<string | null> {
  const model = process.env.CC_OPENER_MODEL_GEMINI ?? "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: user }] }],
        systemInstruction: { parts: [{ text: system }] },
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.9 },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;
    const candidates = (data.candidates as Array<Record<string, unknown>>) ?? [];
    const content = candidates[0]?.content as Record<string, unknown>;
    const parts = (content?.parts as Array<Record<string, unknown>>) ?? [];
    const text = (parts[0]?.text as string) ?? "";
    return text.trim() || null;
  } catch {
    return null;
  }
}

async function tryOpenAICompatText(
  url: string, key: string, model: string,
  system: string, user: string, maxTokens: number,
): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: maxTokens,
        temperature: 0.9,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;
    const choices = (data.choices as Array<Record<string, unknown>>) ?? [];
    const message = choices[0]?.message as Record<string, unknown>;
    const text = (message?.content as string) ?? "";
    return text.trim() || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// _archetypeForPersonId — coarse archetype string from person fields
//
// Format: "<DISC_primary>:<emoji_bucket>:<age_band>"
// Examples:
//   "D:low_emoji:30-39"
//   "I:high_emoji:24-29"
//   "unknown:med_emoji:18-23"
// ---------------------------------------------------------------------------

function bucketEmoji(freq: number | undefined): string {
  if (freq === undefined || freq === null) return "med_emoji";
  if (freq < 0.1) return "low_emoji";
  if (freq > 0.3) return "high_emoji";
  return "med_emoji";
}

function bucketAge(age: number | undefined): string {
  if (age === undefined || age === null) return "unknown_age";
  if (age < 24) return "18-23";
  if (age < 30) return "24-29";
  if (age < 40) return "30-39";
  return "40+";
}

export const _archetypeForPersonId = internalQuery({
  args: { person_id: v.id("people") },
  handler: async (ctx, args): Promise<string> => {
    const person = await ctx.db.get(args.person_id);
    if (!person) return "unknown:med_emoji:unknown_age";
    const disc = person.disc_primary ?? person.disc_inference ?? "unknown";
    const emoji = bucketEmoji(person.emoji_frequency);
    const age = bucketAge(person.age);
    return `${disc}:${emoji}:${age}`;
  },
});

// internalQuery: fetch person by id (actions can't call db.get directly)
export const _getPersonById = internalQuery({
  args: { person_id: v.id("people") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.person_id);
  },
});

// ---------------------------------------------------------------------------
// _draftOpenerVariants — generate 2 distinct opener variants via LLM
//
// Seeds: humor / callback / warm / curious
// Seeds are chosen deterministically per person_id for spread across archetypes.
// ---------------------------------------------------------------------------

const VARIANT_SEEDS: Array<{ kind: string; prompt_hint: string }> = [
  { kind: "humor",    prompt_hint: "playful and witty — light tease or clever observation" },
  { kind: "callback", prompt_hint: "specific callback to something in her bio, prompts, or photos" },
  { kind: "warm",     prompt_hint: "warm genuine curiosity — make her feel seen and interesting" },
  { kind: "curious",  prompt_hint: "intriguing question about something she mentioned — open-ended" },
];

function pickTwoSeeds(personId: string): [typeof VARIANT_SEEDS[number], typeof VARIANT_SEEDS[number]] {
  let hash = 0;
  for (let i = 0; i < personId.length; i++) {
    hash = (hash * 31 + personId.charCodeAt(i)) >>> 0;
  }
  const idx1 = hash % VARIANT_SEEDS.length;
  const idx2 = (hash + 1) % VARIANT_SEEDS.length;
  return [VARIANT_SEEDS[idx1], VARIANT_SEEDS[idx2]];
}

type OpenerVariant = {
  variant_id: string;
  variant_kind: string;
  body: string;
};

export const _draftOpenerVariants = internalAction({
  args: {
    person_id: v.id("people"),
    conversation_id: v.optional(v.id("conversations")),
    user_id: v.string(),
  },
  handler: async (ctx, args): Promise<OpenerVariant[]> => {
    const person = await ctx.runQuery(internal.opener._getPersonById, { person_id: args.person_id });
    if (!person) {
      return [
        { variant_id: "fallback-warm",    variant_kind: "warm",    body: "Hey! Your profile caught my eye — how's your week going?" },
        { variant_id: "fallback-curious", variant_kind: "curious", body: "I have to ask — what drew you to that?" },
      ];
    }

    const bioContext = [
      person.bio_text ? `Bio: ${person.bio_text}` : "",
      (person.profile_prompts_observed ?? []).map((p: { prompt: string; answer: string }) =>
        `Prompt: "${p.prompt}" -> "${p.answer}"`
      ).join("\n"),
      (person.interests ?? []).length > 0 ? `Interests: ${person.interests.join(", ")}` : "",
      (person.passions ?? []).length > 0 ? `Passions: ${person.passions?.join(", ")}` : "",
      person.occupation_observed ? `Occupation: ${person.occupation_observed}` : "",
      person.location_observed ? `Location: ${person.location_observed}` : "",
      person.zodiac_sign ? `Zodiac: ${person.zodiac_sign}` : "",
      person.disc_primary ? `DISC: ${person.disc_primary}` : "",
    ].filter(Boolean).join("\n");

    const openerSuggestions = (person.opener_suggestions ?? []).join(" | ");
    const [seed1, seed2] = pickTwoSeeds(args.person_id as string);

    async function draftOne(seed: typeof VARIANT_SEEDS[number]): Promise<OpenerVariant> {
      const variantId = `${args.person_id}-${seed.kind}-${Date.now()}`;

      const systemPrompt = `You are writing a dating app opener for Julian, a confident and charismatic man.

HARD RULES (non-negotiable):
1. No more than 240 characters total.
2. Reference at least ONE specific thing from her profile (bio, prompt, interest, photo, occupation).
3. Match her communication energy.
4. No "hey", "hi there", no emojis unless she uses a lot, no pickup lines, no compliments on looks.
5. End with either a natural question or an intriguing observation. NOT a generic "how's your day?".
6. Do NOT start with "I" — start with an observation, question, or her name.
7. No semicolons.

APPROACH: ${seed.prompt_hint}`;

      const userPrompt = `Her profile:\n${bioContext}\n\n${openerSuggestions ? `Prior suggestions (don't copy):\n${openerSuggestions}\n\n` : ""}Write ONE opener using the "${seed.kind}" approach. Return ONLY the message text, nothing else.`;

      const text = await llmText(systemPrompt, userPrompt, 120);
      const body = text
        ? text.replace(/^["']|["']$/g, "").trim().slice(0, 240)
        : `[${seed.kind} opener placeholder]`;

      return { variant_id: variantId, variant_kind: seed.kind, body };
    }

    const [v1, v2] = await Promise.all([draftOne(seed1), draftOne(seed2)]);
    return [v1, v2];
  },
});

// ---------------------------------------------------------------------------
// Internal DB helpers (mutations/queries called from the action)
// ---------------------------------------------------------------------------

export const _insertExperiment = internalMutation({
  args: {
    user_id: v.string(),
    person_id: v.id("people"),
    conversation_id: v.optional(v.id("conversations")),
    archetype: v.string(),
    variant_id: v.string(),
    variant_kind: v.string(),
    body_preview: v.string(),
    sent_at: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"opener_experiments">> => {
    return await ctx.db.insert("opener_experiments", {
      user_id: args.user_id,
      person_id: args.person_id,
      conversation_id: args.conversation_id,
      archetype: args.archetype,
      variant_id: args.variant_id,
      variant_kind: args.variant_kind,
      body_preview: args.body_preview,
      sent_at: args.sent_at,
    });
  },
});

export const _getArchetypeWinnerInternal = internalQuery({
  args: { user_id: v.string(), archetype: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("opener_winners")
      .withIndex("by_user_archetype", (q) =>
        q.eq("user_id", args.user_id).eq("archetype", args.archetype),
      )
      .first();
  },
});

// ---------------------------------------------------------------------------
// pickOpenerVariant — public ACTION
//
// Orchestrates: archetype -> 2 variants -> epsilon-greedy pick -> DB insert.
// Conservative rollout: SEPARATE from the existing convex_runner.py path.
// ---------------------------------------------------------------------------

export const pickOpenerVariant = action({
  args: {
    person_id: v.id("people"),
    conversation_id: v.optional(v.id("conversations")),
    user_id: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    experiment_id: Id<"opener_experiments">;
    body: string;
    variant_kind: string;
    archetype: string;
  }> => {
    const userId = args.user_id ?? "fleet-julian";

    const archetype = await ctx.runQuery(internal.opener._archetypeForPersonId, {
      person_id: args.person_id,
    });

    const variants: OpenerVariant[] = await ctx.runAction(internal.opener._draftOpenerVariants, {
      person_id: args.person_id,
      conversation_id: args.conversation_id,
      user_id: userId,
    });

    const winner = await ctx.runQuery(internal.opener._getArchetypeWinnerInternal, {
      user_id: userId,
      archetype,
    });

    let chosen: OpenerVariant;

    if (winner && winner.samples >= 30) {
      // Epsilon-greedy: 10% explore (random), 90% exploit (winner kind)
      const explore = Math.random() < 0.1;
      if (explore) {
        chosen = variants[Math.floor(Math.random() * variants.length)];
      } else {
        const winnerVariant = variants.find(
          (vnt) => vnt.variant_kind === winner.winning_variant_id,
        );
        chosen = winnerVariant ?? variants[0];
      }
    } else {
      // Cold start: uniform random
      chosen = variants[Math.floor(Math.random() * variants.length)];
    }

    const now = Date.now();
    const experimentId: Id<"opener_experiments"> = await ctx.runMutation(
      internal.opener._insertExperiment,
      {
        user_id: userId,
        person_id: args.person_id,
        conversation_id: args.conversation_id,
        archetype,
        variant_id: chosen.variant_id,
        variant_kind: chosen.variant_kind,
        body_preview: chosen.body.slice(0, 80),
        sent_at: now,
      },
    );

    return {
      experiment_id: experimentId,
      body: chosen.body,
      variant_kind: chosen.variant_kind,
      archetype,
    };
  },
});

// ---------------------------------------------------------------------------
// recordOpenerOutcome — public mutation
// ---------------------------------------------------------------------------

export const recordOpenerOutcome = mutation({
  args: {
    experiment_id: v.id("opener_experiments"),
    outcome: v.union(
      v.literal("replied_in_4h"),
      v.literal("replied_in_24h"),
      v.literal("replied_later"),
      v.literal("ghosted"),
      v.literal("unknown"),
    ),
    her_first_reply_minutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.experiment_id, {
      outcome: args.outcome,
      outcome_at: Date.now(),
      her_first_reply_minutes: args.her_first_reply_minutes,
    });
  },
});

// ---------------------------------------------------------------------------
// recordOpenerOutcomeByMessageId — alternate entry point used by upsertFromWebhook
// ---------------------------------------------------------------------------

export const recordOpenerOutcomeByMessageId = mutation({
  args: {
    message_id: v.id("messages"),
    outcome: v.union(
      v.literal("replied_in_4h"),
      v.literal("replied_in_24h"),
      v.literal("replied_later"),
      v.literal("ghosted"),
      v.literal("unknown"),
    ),
    her_first_reply_minutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const experiment = await ctx.db
      .query("opener_experiments")
      .filter((q) => q.eq(q.field("message_id"), args.message_id))
      .first();

    if (!experiment || experiment.outcome) return null;

    await ctx.db.patch(experiment._id, {
      outcome: args.outcome,
      outcome_at: Date.now(),
      her_first_reply_minutes: args.her_first_reply_minutes,
    });

    return experiment._id;
  },
});

// ---------------------------------------------------------------------------
// linkExperimentToMessage — backfill message_id after send
// ---------------------------------------------------------------------------

export const linkExperimentToMessage = mutation({
  args: {
    experiment_id: v.id("opener_experiments"),
    message_id: v.id("messages"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.experiment_id, { message_id: args.message_id });
  },
});

// ---------------------------------------------------------------------------
// getArchetypeWinner — public query
// ---------------------------------------------------------------------------

export const getArchetypeWinner = query({
  args: {
    archetype: v.string(),
    user_id: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = args.user_id ?? "fleet-julian";
    const winner = await ctx.db
      .query("opener_winners")
      .withIndex("by_user_archetype", (q) =>
        q.eq("user_id", userId).eq("archetype", args.archetype),
      )
      .first();

    if (!winner || winner.samples < 30) return null;
    return winner;
  },
});

// ---------------------------------------------------------------------------
// listRecentExperiments — public query for the dashboard
// ---------------------------------------------------------------------------

export const listRecentExperiments = query({
  args: {
    user_id: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = args.user_id ?? "fleet-julian";
    const limit = Math.min(args.limit ?? 50, 200);
    return await ctx.db
      .query("opener_experiments")
      .withIndex("by_user", (q) => q.eq("user_id", userId))
      .order("desc")
      .take(limit);
  },
});

// ---------------------------------------------------------------------------
// _markGhostedExperiments — internal mutation (daily cron 04:00 UTC)
//
// Scans opener_experiments rows older than 7 days with no outcome set and
// marks them "ghosted". Keeps the table clean for the weekly winner computation.
// ---------------------------------------------------------------------------

export const _markGhostedExperiments = internalMutation({
  args: {},
  handler: async (ctx) => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const stale = await ctx.db
      .query("opener_experiments")
      .filter((q) =>
        q.and(
          q.lt(q.field("sent_at"), sevenDaysAgo),
          q.eq(q.field("outcome"), undefined),
        ),
      )
      .take(200);

    let count = 0;
    for (const row of stale) {
      await ctx.db.patch(row._id, {
        outcome: "ghosted",
        outcome_at: Date.now(),
      });
      count++;
    }
    return { marked_ghosted: count };
  },
});

// ---------------------------------------------------------------------------
// _recomputeArchetypeWinners — internal mutation (weekly cron Sun 05:00 UTC)
//
// For each archetype with >= 30 resolved samples, computes per-variant_kind
// reply-in-24h rate. Writes opener_winners if margin >= 0.05 AND winner >= 15.
// ---------------------------------------------------------------------------

export const _recomputeArchetypeWinners = internalMutation({
  args: { user_id: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = args.user_id ?? "fleet-julian";

    const resolved = await ctx.db
      .query("opener_experiments")
      .withIndex("by_user_outcome", (q) => q.eq("user_id", userId))
      .filter((q) => q.neq(q.field("outcome"), undefined))
      .take(2000);

    const withKind = resolved.filter((r) => r.variant_kind && r.archetype);

    const byArchetype = new Map<string, typeof withKind>();
    for (const row of withKind) {
      const key = row.archetype;
      const bucket = byArchetype.get(key) ?? [];
      bucket.push(row);
      byArchetype.set(key, bucket);
    }

    let upserted = 0;
    for (const [archetype, rows] of byArchetype.entries()) {
      if (rows.length < 30) continue;

      const kindStats = new Map<string, { wins: number; total: number }>();
      for (const row of rows) {
        const kind = row.variant_kind!;
        const entry = kindStats.get(kind) ?? { wins: 0, total: 0 };
        entry.total++;
        if (row.outcome === "replied_in_4h" || row.outcome === "replied_in_24h") {
          entry.wins++;
        }
        kindStats.set(kind, entry);
      }

      const ranked = Array.from(kindStats.entries())
        .map(([kind, stats]) => ({
          kind,
          win_rate: stats.total > 0 ? stats.wins / stats.total : 0,
          total: stats.total,
        }))
        .sort((a, b) => b.win_rate - a.win_rate);

      if (ranked.length < 1) continue;
      const best = ranked[0];
      const runnerUp = ranked[1];

      if (best.total < 15) continue;
      const margin = best.win_rate - (runnerUp?.win_rate ?? 0);
      if (margin < 0.05) continue;

      const confidence = Math.min(1.0, margin * Math.sqrt(best.total) / 2);
      const now = Date.now();

      const existingWinner = await ctx.db
        .query("opener_winners")
        .withIndex("by_user_archetype", (q) =>
          q.eq("user_id", userId).eq("archetype", archetype),
        )
        .first();

      if (existingWinner) {
        await ctx.db.patch(existingWinner._id, {
          winning_variant_id: best.kind,
          samples: rows.length,
          win_rate: best.win_rate,
          runner_up_variant_id: runnerUp?.kind,
          confidence,
          computed_at: now,
        });
      } else {
        await ctx.db.insert("opener_winners", {
          user_id: userId,
          archetype,
          winning_variant_id: best.kind,
          samples: rows.length,
          win_rate: best.win_rate,
          runner_up_variant_id: runnerUp?.kind,
          confidence,
          computed_at: now,
        });
      }
      upserted++;
    }

    return { archetypes_processed: byArchetype.size, winners_upserted: upserted };
  },
});
