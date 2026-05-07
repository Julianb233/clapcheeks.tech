/**
 * AI-9500 Wave 2 #M — Cohort retro analysis.
 *
 * One-time script (also runnable on demand) that walks all conversations for a
 * user over a period, classifies each into the highest funnel stage reached, and
 * uses an LLM to surface 3-5 surprising conversion insights.
 *
 * Public action:  runCohortRetro(user_id, period_start_ms, period_end_ms)
 * Public query:   listRecent(user_id)
 *
 * Funnel stages (ordered from lowest to highest):
 *   matched → first_message_sent → reply_received → ongoing_chat →
 *   phone_swap → first_date_done → second_date_done → ongoing_dating →
 *   exclusive → ended_or_ghosted (parallel track)
 */

import { action, query, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

// ---------------------------------------------------------------------------
// LLM helper (duplicated from enrichment.ts to keep this module self-contained)
// ---------------------------------------------------------------------------
type LLMResult = Record<string, unknown> | null;

async function llmJson(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 500,
): Promise<LLMResult> {
  const gemKey = process.env.GEMINI_API_KEY;
  if (gemKey) {
    const r = await tryGemini(gemKey, systemPrompt, userPrompt, maxTokens);
    if (r) return r;
  }
  const dsKey = process.env.DEEPSEEK_API_KEY;
  if (dsKey) {
    const r = await tryOpenAICompat(
      "https://api.deepseek.com/chat/completions",
      dsKey,
      "deepseek-chat",
      systemPrompt,
      userPrompt,
      maxTokens,
    );
    if (r) return r;
  }
  const grokKey = process.env.XAI_API_KEY;
  if (grokKey) {
    const r = await tryOpenAICompat(
      "https://api.x.ai/v1/chat/completions",
      grokKey,
      "grok-2-latest",
      systemPrompt,
      userPrompt,
      maxTokens,
    );
    if (r) return r;
  }
  return null;
}

async function tryGemini(
  key: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<LLMResult> {
  const model = process.env.CC_VIBE_MODEL_GEMINI ?? "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${system}\n\n${user}` }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
          maxOutputTokens: maxTokens,
        },
      }),
    });
    if (!r.ok) {
      console.warn(`cohort_retro gemini http ${r.status}`);
      return null;
    }
    const j: any = await r.json();
    const text = j?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    return JSON.parse(text);
  } catch (e) {
    console.warn(`cohort_retro gemini err: ${String(e).slice(0, 200)}`);
    return null;
  }
}

async function tryOpenAICompat(
  url: string,
  key: string,
  model: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<LLMResult> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!r.ok) {
      console.warn(`cohort_retro ${model} http ${r.status}`);
      return null;
    }
    const j: any = await r.json();
    const text = j?.choices?.[0]?.message?.content;
    if (!text) return null;
    return JSON.parse(text);
  } catch (e) {
    console.warn(`cohort_retro ${model} err: ${String(e).slice(0, 200)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal queries — actions can't read DB directly in Convex
// ---------------------------------------------------------------------------

export const _getConversationsForPeriod = internalQuery({
  args: {
    user_id: v.string(),
    period_start_ms: v.number(),
    period_end_ms: v.number(),
  },
  handler: async (ctx, args) => {
    // All conversations that had any activity (match or message) in the window.
    // We use created_at for new matches and last_message_at for activity.
    const allConvs = await ctx.db
      .query("conversations")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .collect();

    return allConvs.filter((c) => {
      const ts = c.last_message_at ?? c.created_at;
      return ts >= args.period_start_ms && ts <= args.period_end_ms;
    });
  },
});

export const _getMessagesForConversation = internalQuery({
  args: { conversation_id: v.id("conversations") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversation_id", args.conversation_id),
      )
      .collect();
  },
});

export const _getPostDateTouchesForConversation = internalQuery({
  args: { conversation_id: v.id("conversations") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("scheduled_touches")
      .withIndex("by_conversation", (q) =>
        q.eq("conversation_id", args.conversation_id),
      )
      .filter((q) => q.eq(q.field("type"), "post_date_calibration"))
      .collect();
  },
});

// ---------------------------------------------------------------------------
// Stage classification helpers
// ---------------------------------------------------------------------------

type FunnelStage =
  | "matched"
  | "first_message_sent"
  | "reply_received"
  | "ongoing_chat"
  | "phone_swap"
  | "first_date_done"
  | "second_date_done"
  | "ongoing_dating"
  | "exclusive"
  | "ended_or_ghosted";

const STAGE_RANK: Record<FunnelStage, number> = {
  matched: 0,
  first_message_sent: 1,
  reply_received: 2,
  ongoing_chat: 3,
  phone_swap: 4,
  first_date_done: 5,
  second_date_done: 6,
  ongoing_dating: 7,
  exclusive: 8,
  ended_or_ghosted: -1, // parallel track — classified separately
};

function classifyConversation(
  conv: any,
  messages: any[],
  postDateTouches: any[],
): { stage: FunnelStage; openerLen?: number; matchDayOfWeek?: number } {
  // Check terminal states
  if (conv.status === "ghosted") return { stage: "ended_or_ghosted" };
  if (conv.status === "ended") return { stage: "ended_or_ghosted" };

  // Check exclusive/ongoing_dating from conversation status
  if (conv.status === "dating") {
    const dateCount = postDateTouches.filter((t) => t.status === "fired").length;
    if (dateCount >= 2) return { stage: "ongoing_dating" };
    if (dateCount >= 1) return { stage: "first_date_done" };
    return { stage: "phone_swap" };
  }

  const outbound = messages.filter((m) => m.direction === "outbound");
  const inbound = messages.filter((m) => m.direction === "inbound");

  // Phone swap — has an imessage handle set
  if (conv.imessage_handle) {
    const dateCount = postDateTouches.filter((t) => t.status === "fired").length;
    if (dateCount >= 2) return { stage: "second_date_done" };
    if (dateCount >= 1) return { stage: "first_date_done" };
    return { stage: "phone_swap" };
  }

  // Ongoing chat — 5+ messages each side
  if (outbound.length >= 5 && inbound.length >= 5) {
    return { stage: "ongoing_chat" };
  }

  // Reply received — at least one inbound
  if (inbound.length >= 1) {
    // Capture opener length for insights
    const firstOut = outbound.sort((a, b) => a.sent_at - b.sent_at)[0];
    const openerLen = firstOut?.body?.length ?? 0;
    const matchDate = new Date(conv.created_at);
    const matchDayOfWeek = matchDate.getDay(); // 0=Sun, 6=Sat
    return { stage: "reply_received", openerLen, matchDayOfWeek };
  }

  // First message sent
  if (outbound.length >= 1) {
    const firstOut = outbound.sort((a, b) => a.sent_at - b.sent_at)[0];
    const openerLen = firstOut?.body?.length ?? 0;
    const matchDate = new Date(conv.created_at);
    const matchDayOfWeek = matchDate.getDay();
    return { stage: "first_message_sent", openerLen, matchDayOfWeek };
  }

  // Just matched
  return { stage: "matched" };
}

// ---------------------------------------------------------------------------
// Public action — the main entry point
// ---------------------------------------------------------------------------

export const runCohortRetro = action({
  args: {
    user_id: v.string(),
    period_start_ms: v.number(),
    period_end_ms: v.number(),
  },
  handler: async (ctx, args) => {
    console.log(
      `[cohort_retro] Starting retro for ${args.user_id} ` +
        `${new Date(args.period_start_ms).toISOString()} → ` +
        `${new Date(args.period_end_ms).toISOString()}`,
    );

    // Step 1: Fetch all conversations in the period
    const conversations: any[] = await ctx.runQuery(
      internal.cohort_retro._getConversationsForPeriod,
      {
        user_id: args.user_id,
        period_start_ms: args.period_start_ms,
        period_end_ms: args.period_end_ms,
      },
    );

    console.log(`[cohort_retro] Found ${conversations.length} conversations in period`);

    if (conversations.length === 0) {
      return {
        ok: false,
        reason: "no_conversations_in_period",
        period_start_ms: args.period_start_ms,
        period_end_ms: args.period_end_ms,
      };
    }

    // Step 2: Classify each conversation
    type ConvAnalysis = {
      conv: any;
      stage: FunnelStage;
      openerLen?: number;
      matchDayOfWeek?: number;
      messageCount: number;
      inboundCount: number;
      outboundCount: number;
    };

    const analyses: ConvAnalysis[] = [];

    for (const conv of conversations) {
      const [messages, postDateTouches] = await Promise.all([
        ctx.runQuery(internal.cohort_retro._getMessagesForConversation, {
          conversation_id: conv._id,
        }),
        ctx.runQuery(internal.cohort_retro._getPostDateTouchesForConversation, {
          conversation_id: conv._id,
        }),
      ]);

      const { stage, openerLen, matchDayOfWeek } = classifyConversation(
        conv,
        messages,
        postDateTouches,
      );

      analyses.push({
        conv,
        stage,
        openerLen,
        matchDayOfWeek,
        messageCount: messages.length,
        inboundCount: messages.filter((m) => m.direction === "inbound").length,
        outboundCount: messages.filter((m) => m.direction === "outbound").length,
      });
    }

    // Step 3: Aggregate funnel counts
    const funnel = {
      matched: 0,
      first_message: 0,
      reply: 0,
      ongoing_chat: 0,
      phone_swap: 0,
      first_date_done: 0,
      second_date_done: 0,
      ongoing: 0,
      ended: 0,
      ghosted: 0,
    };

    for (const a of analyses) {
      switch (a.stage) {
        case "matched":
          funnel.matched++;
          break;
        case "first_message_sent":
          funnel.first_message++;
          break;
        case "reply_received":
          funnel.reply++;
          break;
        case "ongoing_chat":
          funnel.ongoing_chat++;
          break;
        case "phone_swap":
          funnel.phone_swap++;
          break;
        case "first_date_done":
          funnel.first_date_done++;
          break;
        case "second_date_done":
          funnel.second_date_done++;
          break;
        case "ongoing_dating":
          funnel.ongoing++;
          break;
        case "exclusive":
          funnel.ongoing++;
          break;
        case "ended_or_ghosted":
          // Split based on conversation status
          if (a.conv.status === "ghosted") funnel.ghosted++;
          else funnel.ended++;
          break;
      }
    }

    const totalConversations = conversations.length;

    // Step 4: Build data summaries for LLM insights
    const openerLens = analyses
      .filter((a) => a.openerLen != null && a.openerLen > 0)
      .map((a) => ({ len: a.openerLen!, gotReply: a.stage !== "first_message_sent" && a.stage !== "matched" }));

    const dayOfWeekCounts: Record<number, { total: number; converted: number }> = {};
    const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    for (const a of analyses) {
      if (a.matchDayOfWeek == null) continue;
      const d = a.matchDayOfWeek;
      if (!dayOfWeekCounts[d]) dayOfWeekCounts[d] = { total: 0, converted: 0 };
      dayOfWeekCounts[d].total++;
      if (STAGE_RANK[a.stage] >= STAGE_RANK.reply_received) {
        dayOfWeekCounts[d].converted++;
      }
    }

    // Opener length buckets: short (<80), medium (80-200), long (>200)
    const openerBuckets = {
      short: { total: 0, converted: 0 },
      medium: { total: 0, converted: 0 },
      long: { total: 0, converted: 0 },
    };
    for (const o of openerLens) {
      const bucket = o.len < 80 ? "short" : o.len <= 200 ? "medium" : "long";
      openerBuckets[bucket].total++;
      if (o.gotReply) openerBuckets[bucket].converted++;
    }

    // Platform breakdown
    const platformCounts: Record<string, { total: number; converted: number }> = {};
    for (const a of analyses) {
      const p = a.conv.platform ?? "unknown";
      if (!platformCounts[p]) platformCounts[p] = { total: 0, converted: 0 };
      platformCounts[p].total++;
      if (STAGE_RANK[a.stage] >= STAGE_RANK.reply_received) {
        platformCounts[p].converted++;
      }
    }

    // Average messages before ghosting vs advancing
    const ghosted = analyses.filter((a) => a.stage === "ended_or_ghosted");
    const advanced = analyses.filter(
      (a) => STAGE_RANK[a.stage] >= STAGE_RANK.reply_received,
    );
    const avgMsgGhosted =
      ghosted.length > 0
        ? ghosted.reduce((s, a) => s + a.messageCount, 0) / ghosted.length
        : 0;
    const avgMsgAdvanced =
      advanced.length > 0
        ? advanced.reduce((s, a) => s + a.messageCount, 0) / advanced.length
        : 0;

    // Step 5: Generate LLM insights
    const systemPrompt = `You are a dating coach analyst. Given funnel data about a man's dating app performance over a time period, produce 3-5 surprising, specific, actionable insights. Focus on what's non-obvious and counter-intuitive.

Return a JSON object with one key "insights" — an array of strings. Each insight should be a single sentence starting with an observation (e.g. "Short openers under 80 chars converted at 2.3x the rate of long openers"). Be specific with numbers when available.`;

    const userPrompt = `FUNNEL (${totalConversations} total conversations):
matched: ${funnel.matched}
first_message_sent: ${funnel.first_message}
reply_received: ${funnel.reply}
ongoing_chat: ${funnel.ongoing_chat}
phone_swap: ${funnel.phone_swap}
first_date_done: ${funnel.first_date_done}
second_date_done: ${funnel.second_date_done}
ongoing_dating: ${funnel.ongoing}
ended_or_ghosted: ${funnel.ended + funnel.ghosted}

OPENER LENGTH vs REPLY RATE:
short (<80 chars): ${openerBuckets.short.converted}/${openerBuckets.short.total} replied
medium (80-200 chars): ${openerBuckets.medium.converted}/${openerBuckets.medium.total} replied
long (>200 chars): ${openerBuckets.long.converted}/${openerBuckets.long.total} replied

MATCH DAY OF WEEK vs REPLY RATE:
${Object.entries(dayOfWeekCounts)
  .map(([d, v]) => `${DAY_NAMES[parseInt(d)]}: ${v.converted}/${v.total} replied (${v.total > 0 ? Math.round((v.converted / v.total) * 100) : 0}%)`)
  .join("\n")}

PLATFORM BREAKDOWN:
${Object.entries(platformCounts)
  .map(([p, v]) => `${p}: ${v.converted}/${v.total} got reply (${v.total > 0 ? Math.round((v.converted / v.total) * 100) : 0}%)`)
  .join("\n")}

AVG MESSAGES:
conversations that advanced: ${avgMsgAdvanced.toFixed(1)} messages avg
conversations that ghosted/ended: ${avgMsgGhosted.toFixed(1)} messages avg

Key funnel conversion rates:
match→first_message: ${funnel.first_message + funnel.reply + funnel.ongoing_chat + funnel.phone_swap + funnel.first_date_done + funnel.second_date_done + funnel.ongoing}/${totalConversations}
first_message→reply: ${funnel.reply + funnel.ongoing_chat + funnel.phone_swap + funnel.first_date_done + funnel.second_date_done + funnel.ongoing}/${Math.max(1, funnel.first_message + funnel.reply + funnel.ongoing_chat + funnel.phone_swap + funnel.first_date_done + funnel.second_date_done + funnel.ongoing)}
reply→phone_swap: ${funnel.phone_swap + funnel.first_date_done + funnel.second_date_done + funnel.ongoing}/${Math.max(1, funnel.reply + funnel.ongoing_chat + funnel.phone_swap + funnel.first_date_done + funnel.second_date_done + funnel.ongoing)}
phone_swap→date: ${funnel.first_date_done + funnel.second_date_done + funnel.ongoing}/${Math.max(1, funnel.phone_swap + funnel.first_date_done + funnel.second_date_done + funnel.ongoing)}`;

    console.log(`[cohort_retro] Calling LLM for insights...`);
    const llmResult = await llmJson(systemPrompt, userPrompt, 600);
    const insights: string[] =
      Array.isArray((llmResult as any)?.insights) ? (llmResult as any).insights : [];

    if (insights.length === 0) {
      // Fallback: compute basic insights without LLM
      const totalMessaged = totalConversations - funnel.matched;
      const totalReplied = funnel.reply + funnel.ongoing_chat + funnel.phone_swap +
        funnel.first_date_done + funnel.second_date_done + funnel.ongoing;

      if (totalMessaged > 0) {
        insights.push(
          `Overall reply rate: ${Math.round((totalReplied / totalMessaged) * 100)}% of first messages get a reply.`,
        );
      }
      const totalDates = funnel.first_date_done + funnel.second_date_done + funnel.ongoing;
      if (funnel.phone_swap > 0) {
        insights.push(
          `Phone-swap to date conversion: ${Math.round((totalDates / (funnel.phone_swap + totalDates)) * 100)}% of phone swaps result in a date.`,
        );
      }
    }

    // Step 6: Build summary object
    const summary = {
      total_conversations: totalConversations,
      period_days: Math.round((args.period_end_ms - args.period_start_ms) / 86400000),
      overall_reply_rate:
        totalConversations > 0
          ? +(
              (funnel.reply +
                funnel.ongoing_chat +
                funnel.phone_swap +
                funnel.first_date_done +
                funnel.second_date_done +
                funnel.ongoing) /
              Math.max(1, funnel.first_message + funnel.reply + funnel.ongoing_chat + funnel.phone_swap + funnel.first_date_done + funnel.second_date_done + funnel.ongoing)
            ).toFixed(3)
          : 0,
      opener_buckets: openerBuckets,
      day_of_week: Object.fromEntries(
        Object.entries(dayOfWeekCounts).map(([d, v]) => [
          DAY_NAMES[parseInt(d)],
          { ...v, rate: v.total > 0 ? +(v.converted / v.total).toFixed(3) : 0 },
        ]),
      ),
      platform_breakdown: Object.fromEntries(
        Object.entries(platformCounts).map(([p, v]) => [
          p,
          { ...v, rate: v.total > 0 ? +(v.converted / v.total).toFixed(3) : 0 },
        ]),
      ),
      avg_messages_advanced: +avgMsgAdvanced.toFixed(1),
      avg_messages_ghosted: +avgMsgGhosted.toFixed(1),
    };

    // Step 7: Insert into cohort_retros
    const retroId = await ctx.runMutation(internal.cohort_retro._insertRetroRow, {
      user_id: args.user_id,
      period_start_ms: args.period_start_ms,
      period_end_ms: args.period_end_ms,
      summary,
      funnel,
      insights,
      computed_at: Date.now(),
    });

    console.log(`[cohort_retro] Inserted retro row ${retroId}`);

    return {
      ok: true,
      retro_id: retroId,
      total_conversations: totalConversations,
      funnel,
      insights,
    };
  },
});

// Internal mutation to insert (actions need a mutation, not query, to write)
export const _insertRetroRow = internalMutation({
  args: {
    user_id: v.string(),
    period_start_ms: v.number(),
    period_end_ms: v.number(),
    summary: v.any(),
    funnel: v.object({
      matched: v.number(),
      first_message: v.number(),
      reply: v.number(),
      ongoing_chat: v.number(),
      phone_swap: v.number(),
      first_date_done: v.number(),
      second_date_done: v.number(),
      ongoing: v.number(),
      ended: v.number(),
      ghosted: v.number(),
    }),
    insights: v.array(v.string()),
    computed_at: v.number(),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("cohort_retros", {
      user_id: args.user_id,
      period_start_ms: args.period_start_ms,
      period_end_ms: args.period_end_ms,
      summary: args.summary,
      funnel: args.funnel,
      insights: args.insights,
      computed_at: args.computed_at,
    });
  },
});

// ---------------------------------------------------------------------------
// Public query — dashboard fetches recent retros
// ---------------------------------------------------------------------------

export const listRecent = query({
  args: {
    user_id: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    const rows = await ctx.db
      .query("cohort_retros")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .order("desc")
      .take(limit);
    return rows;
  },
});
