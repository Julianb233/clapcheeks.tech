import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

// Append a message to a conversation. Called by the local Mac agent when
// it imports a new inbound iMessage / dating-app message, or by the user
// approving an AI suggestion.
//
// AI-9409: extended with optional multi-line iMessage fields (line, transport,
// external_guid, attachments_summary, send_error). Backwards-compatible —
// existing call sites work unchanged. Dedup by external_guid at top of handler.
export const append = mutation({
  args: {
    conversation_id: v.id("conversations"),
    user_id: v.string(),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    body: v.string(),
    sent_at: v.number(),
    source: v.union(
      v.literal("user"),
      v.literal("ai_suggestion_approved"),
      v.literal("ai_auto_send"),
      v.literal("scheduled"),
      v.literal("import"),
      v.literal("bluebubbles_webhook"),
    ),
    ai_metadata: v.optional(v.any()),
    // AI-9409 optional multi-line fields
    line: v.optional(v.number()),
    transport: v.optional(v.union(
      v.literal("bluebubbles"),
      v.literal("pypush"),
      v.literal("applescript"),
      v.literal("sms"),
      v.literal("imessage_native"),
    )),
    external_guid: v.optional(v.string()),
    attachments_summary: v.optional(v.any()),
    send_error: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    // Dedup check by external_guid if provided (AI-9409)
    if (args.external_guid) {
      const existing = await ctx.db
        .query("messages")
        .withIndex("by_external_guid", (q) =>
          q.eq("external_guid", args.external_guid),
        )
        .first();
      if (existing) return existing._id; // already ingested
    }

    const messageId = await ctx.db.insert("messages", args);

    const conv = await ctx.db.get(args.conversation_id);
    if (conv) {
      const isInbound = args.direction === "inbound";
      const patches: Record<string, unknown> = {
        last_message_at: args.sent_at,
        last_inbound_at: isInbound ? args.sent_at : conv.last_inbound_at,
        last_outbound_at: !isInbound ? args.sent_at : conv.last_outbound_at,
        unread_count: isInbound ? conv.unread_count + 1 : conv.unread_count,
        updated_at: Date.now(),
      };
      // Sticky-line: stamp the line on the conversation if not yet set (AI-9409)
      if (args.line && !conv.line) patches.line = args.line;
      await ctx.db.patch(args.conversation_id, patches);
    }

    return messageId;
  },
});

// Single entry point for the VPS BlueBubbles receiver (AI-9409).
// Resolves or creates the conversation by imessage_handle, then appends
// the message. Safe to call concurrently — dedup in append() handles races.
export const upsertFromWebhook = mutation({
  args: {
    user_id: v.string(),         // for now: hardcoded "fleet-julian"; multi-tenant later
    line: v.number(),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    handle: v.string(),          // E.164 phone or email (the OTHER party)
    body: v.string(),
    sent_at: v.number(),
    external_guid: v.string(),
    transport: v.union(
      v.literal("bluebubbles"),
      v.literal("pypush"),
      v.literal("applescript"),
      v.literal("sms"),
      v.literal("imessage_native"),
    ),
    attachments_summary: v.optional(v.any()),
    send_error: v.optional(v.any()),
    ai_metadata: v.optional(v.any()),
    delivered_at: v.optional(v.number()),
    read_at: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // AI-9449 — Inline person linking. Resolve the handle to a people row
    // (created by obsidian_sync / google_contacts_sync / supabase_migration)
    // so messages + conversations carry person_id from the moment they land.
    // Without this, every backfilled iMessage is orphaned and the courtship
    // / vibe enrichment skips them with "not_enough_messages".
    //
    // Channel resolution: '@' in handle -> email. Otherwise we accept either
    // imessage or sms-tagged person handles (chat.db doesn't distinguish).
    const handleNorm = args.handle.trim().toLowerCase();
    const isEmail = handleNorm.includes("@");
    const allPeople = await ctx.db
      .query("people")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .collect();
    const matches = allPeople.filter((p) =>
      p.handles.some((h) => {
        const v = h.value.trim().toLowerCase();
        if (isEmail) return h.channel === "email" && v === handleNorm;
        return (h.channel === "imessage" || h.channel === "sms") && v === handleNorm;
      }),
    );
    let resolvedPersonId: Id<"people"> | undefined;
    const ambiguousMatches = matches.length > 1 ? matches.map((p) => p._id) : [];
    if (matches.length === 1) {
      resolvedPersonId = matches[0]._id;
    }
    // Multi-match pending_links row is written after convId is known (below).

    // 1. Find or create conversation for this handle
    let convId: Id<"conversations">;
    const existingConv = await ctx.db
      .query("conversations")
      .withIndex("by_imessage_handle", (q) =>
        q.eq("imessage_handle", args.handle),
      )
      .filter((q) => q.eq(q.field("user_id"), args.user_id))
      .first();

    if (!existingConv) {
      const now = Date.now();
      convId = await ctx.db.insert("conversations", {
        user_id: args.user_id,
        platform: "imessage",
        external_match_id: args.handle,
        status: "active",
        last_message_at: args.sent_at,
        last_inbound_at:
          args.direction === "inbound" ? args.sent_at : undefined,
        last_outbound_at:
          args.direction === "outbound" ? args.sent_at : undefined,
        unread_count: args.direction === "inbound" ? 1 : 0,
        line: args.line,
        imessage_handle: args.handle,
        person_id: resolvedPersonId,
        created_at: now,
        updated_at: now,
      });
    } else {
      convId = existingConv._id;
      // Backfill person_id on conversation if previously orphaned + we now resolve.
      if (resolvedPersonId && !existingConv.person_id) {
        await ctx.db.patch(convId, { person_id: resolvedPersonId });
      }
    }

    // 1b. Multi-match -> record once for human disambiguation. Schema requires
    // conversation_id so this can only run after convId is known.
    if (ambiguousMatches.length > 0) {
      const existingPending = await ctx.db
        .query("pending_links")
        .withIndex("by_conversation", (q) => q.eq("conversation_id", convId))
        .filter((q) =>
          q.and(
            q.eq(q.field("handle_value"), handleNorm),
            q.eq(q.field("status"), "open"),
          ),
        )
        .first();
      if (!existingPending) {
        const now = Date.now();
        await ctx.db.insert("pending_links", {
          user_id: args.user_id,
          conversation_id: convId,
          handle_channel: isEmail ? "email" : "imessage",
          handle_value: handleNorm,
          candidate_person_ids: ambiguousMatches,
          raw_context: args.body.slice(0, 200),
          status: "open",
          created_at: now,
          updated_at: now,
        });
      }
    }

    // 2. Dedup check by external_guid
    const existingMsg = await ctx.db
      .query("messages")
      .withIndex("by_external_guid", (q) =>
        q.eq("external_guid", args.external_guid),
      )
      .first();
    if (existingMsg) {
      return { conversation_id: convId, message_id: existingMsg._id };
    }

    // 2b. Backfill: REST proxy outbound sends insert "pending-<ts>" rows
    // because mac CLI doesn't always return the BB guid synchronously. When
    // the eventual updated-message webhook arrives with the real guid, find
    // the pending row by (conversation, body, direction=outbound, last 10 min)
    // and patch the external_guid + delivery fields rather than insert dupe.
    if (args.direction === "outbound") {
      const tenMinAgo = args.sent_at - 10 * 60 * 1000;
      const pendingMatch = await ctx.db
        .query("messages")
        .withIndex("by_conversation", (q) =>
          q.eq("conversation_id", convId).gte("sent_at", tenMinAgo),
        )
        .filter((q) =>
          q.and(
            q.eq(q.field("direction"), "outbound"),
            q.eq(q.field("body"), args.body),
          ),
        )
        .first();
      if (
        pendingMatch &&
        typeof pendingMatch.external_guid === "string" &&
        pendingMatch.external_guid.startsWith("pending-")
      ) {
        const patches: Record<string, unknown> = {
          external_guid: args.external_guid,
          attachments_summary: args.attachments_summary ?? pendingMatch.attachments_summary,
          send_error: args.send_error ?? pendingMatch.send_error,
        };
        if (args.delivered_at !== undefined) patches.delivered_at = args.delivered_at;
        if (args.read_at !== undefined) patches.read_at = args.read_at;
        await ctx.db.patch(pendingMatch._id, patches);
        return { conversation_id: convId, message_id: pendingMatch._id };
      }

      // 2c. If row already exists (already patched by earlier event), and
      // this event carries newer delivered/read timestamps, patch them too.
      const existingByGuid = await ctx.db
        .query("messages")
        .withIndex("by_external_guid", (q) =>
          q.eq("external_guid", args.external_guid),
        )
        .first();
      if (existingByGuid && (args.delivered_at || args.read_at)) {
        const patches: Record<string, unknown> = {};
        if (args.delivered_at !== undefined && !existingByGuid.delivered_at) {
          patches.delivered_at = args.delivered_at;
        }
        if (args.read_at !== undefined && !existingByGuid.read_at) {
          patches.read_at = args.read_at;
        }
        if (Object.keys(patches).length > 0) {
          await ctx.db.patch(existingByGuid._id, patches);
        }
        return { conversation_id: convId, message_id: existingByGuid._id };
      }
    }

    // 3. Insert message
    const messageId = await ctx.db.insert("messages", {
      conversation_id: convId,
      user_id: args.user_id,
      direction: args.direction,
      body: args.body,
      sent_at: args.sent_at,
      source: "bluebubbles_webhook",
      line: args.line,
      transport: args.transport,
      external_guid: args.external_guid,
      attachments_summary: args.attachments_summary,
      send_error: args.send_error,
      ai_metadata: args.ai_metadata,
      person_id: resolvedPersonId,
    });

    // 3b. Update people.last_inbound_at / last_outbound_at when linked.
    if (resolvedPersonId) {
      const person = await ctx.db.get(resolvedPersonId);
      if (person) {
        const isInbound = args.direction === "inbound";
        const patch: Record<string, unknown> = { updated_at: Date.now() };
        if (isInbound) {
          if (!person.last_inbound_at || person.last_inbound_at < args.sent_at) {
            patch.last_inbound_at = args.sent_at;
          }
        } else {
          if (!person.last_outbound_at || person.last_outbound_at < args.sent_at) {
            patch.last_outbound_at = args.sent_at;
          }
        }
        if (Object.keys(patch).length > 1) {
          await ctx.db.patch(resolvedPersonId, patch);
        }
      }
    }

    // 4. Update conversation stats + sticky-line
    const conv = await ctx.db
      .query("conversations")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .filter((q) => q.eq(q.field("_id"), convId))
      .first();
    if (conv) {
      const isInbound = args.direction === "inbound";
      const patches: Record<string, unknown> = {
        last_message_at: args.sent_at,
        last_inbound_at: isInbound ? args.sent_at : conv.last_inbound_at,
        last_outbound_at: !isInbound ? args.sent_at : conv.last_outbound_at,
        unread_count: isInbound ? conv.unread_count + 1 : conv.unread_count,
        updated_at: Date.now(),
      };
      if (args.line && !conv.line) patches.line = args.line;
      await ctx.db.patch(convId, patches);
    }

    // 5. AI-9449 Phase B — Fire the inbound interpreter on every new inbound
    // message to a linked person. This is the brain: extracts intent, urgency,
    // emotional state, ask-readiness; appends personal_details / lit_topics /
    // recent_life_events to the person row; schedules touches.
    //
    // Only fires for genuinely-new inbound messages with a linked person, on a
    // best-effort basis (skips backfill rows older than 7 days to avoid burning
    // LLM credits interpreting ancient transcripts during chat.db backfill).
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const isFreshInbound =
      args.direction === "inbound"
      && resolvedPersonId
      && args.sent_at > Date.now() - SEVEN_DAYS_MS;
    if (isFreshInbound) {
      await ctx.scheduler.runAfter(0, internal.inbound.interpretInboundForOne, {
        person_id: resolvedPersonId,
        inbound_external_guid: args.external_guid,
      });
    }

    // 6. AI-9500 #2 — Ask-outcome classifier.
    //
    // When an inbound message lands for a linked person, check whether there is
    // a date_ask touch fired in the last 7 days with ask_outcome still undefined.
    // If so, classify this message as her reply and patch the touch row.
    //
    // Regex-first classifier (cheap, no LLM):
    //   "yes"/"sure"/"sounds good"/etc.            → yes
    //   "can't"/"busy"/"not"/"ugh"/etc.             → soft_no
    //   "no"/"won't"/"don't want to"/etc.           → hard_no
    //
    // Only runs on fresh inbound messages (not backfill, has resolvedPersonId).
    if (isFreshInbound && resolvedPersonId) {
      const sevenDaysAgo = Date.now() - SEVEN_DAYS_MS;
      // Find the most recent date_ask touch fired for this person without an outcome.
      const recentAsk = await ctx.db
        .query("scheduled_touches")
        .withIndex("by_person_status", (q) =>
          q.eq("person_id", resolvedPersonId!),
        )
        .filter((q) =>
          q.and(
            q.eq(q.field("type"), "date_ask"),
            q.eq(q.field("status"), "fired"),
            q.gte(q.field("fired_at"), sevenDaysAgo),
          ),
        )
        .order("desc")
        .first();

      if (recentAsk && (recentAsk as any).ask_outcome === undefined) {
        const body = (args.body || "").toLowerCase();
        let outcome: "yes" | "soft_no" | "hard_no" | undefined;

        // Yes patterns.
        if (/\b(yes|yeah|yep|yup|sure|sounds\s+good|i'?d?\s*love|absolutely|definitely|of\s+course|let'?s\s+do|i'?m\s+down|down\s+for|count\s+me\s+in|works\s+for\s+me|can'?t\s+wait|that\s+sounds)\b/.test(body)) {
          outcome = "yes";
        }
        // Hard no patterns (check before soft_no to avoid overlap).
        else if (/\b(no\b|nope|nah\b|won'?t|don'?t\s+want|not\s+going|not\s+happening|never|hard\s+pass|hard\s+no|absolutely\s+not)\b/.test(body)) {
          outcome = "hard_no";
        }
        // Soft no patterns.
        else if (/\b(can'?t|cannot|busy|not\s+sure|maybe|ugh|idk|i\s+don'?t\s+know|let\s+me\s+check|not\s+right\s+now|not\s+this\s+week|not\s+today|too\s+much|overwhelmed|raincheck|rain\s+check)\b/.test(body)) {
          outcome = "soft_no";
        }

        if (outcome !== undefined) {
          await ctx.db.patch(recentAsk._id, {
            ask_outcome: outcome,
            updated_at: Date.now(),
          } as any);

          // AI-9500 W2 #B — Soft-no recovery: schedule a +14d re-ask touch
          // immediately when we classify ask_outcome=soft_no. Smaller ask, lower
          // pressure, references something specific she said.
          // recovery_scheduled_at guard (inside _scheduleSoftNoRecovery) ensures
          // we don't double-schedule if this branch runs twice.
          if (outcome === "soft_no") {
            await ctx.scheduler.runAfter(0, internal.touches._scheduleSoftNoRecovery, {
              source_touch_id: recentAsk._id,
              user_id: recentAsk.user_id,
              person_id: recentAsk.person_id,
              conversation_id: recentAsk.conversation_id,
            });
          }
        }
      }
    }

    return { conversation_id: convId, message_id: messageId };
  },
});

// Mark all messages in a conversation as read.
export const markRead = mutation({
  args: { conversation_id: v.id("conversations") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const unread = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversation_id", args.conversation_id),
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("direction"), "inbound"),
          q.eq(q.field("read_at"), undefined),
        ),
      )
      .take(500);

    for (const m of unread) {
      await ctx.db.patch(m._id, { read_at: now });
    }

    await ctx.db.patch(args.conversation_id, {
      unread_count: 0,
      updated_at: now,
    });
    return { marked: unread.length };
  },
});

// AI-9449 — Cross-channel message feed for a single person. Pulls all
// messages for a given person_id (across iMessage / Hinge / Bumble / etc.)
// in chronological order. Used by:
//   - convex_runner classify_conversation_vibe (last 50 -> Claude)
//   - convex_runner enrich_person (style profiler input)
//   - dashboard person panel ("recent activity")
//
// Falls back to a conversation-walk if no messages have a person_id set
// yet (older rows from before the person_linker existed).
export const listForPerson = query({
  args: {
    person_id: v.id("people"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 500);

    // Primary path: messages with person_id set.
    let rows = await ctx.db
      .query("messages")
      .withIndex("by_person_recent", (q) => q.eq("person_id", args.person_id))
      .order("desc")
      .take(limit);

    // Fallback: collect via every conversation linked to this person.
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

// Recent messages for a user across all conversations — powers the
// global activity feed in the dashboard.
export const recentForUser = query({
  args: {
    user_id: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_user_recent", (q) => q.eq("user_id", args.user_id))
      .order("desc")
      .take(args.limit ?? 50);
  },
});

// AI-9412 — REST proxy read endpoint. Lists recent messages for a given line
// with optional handle/direction/since filter. Used by GET /api/v1/messages.
export const listForProxy = query({
  args: {
    line: v.optional(v.number()),
    user_id: v.optional(v.string()),
    handle: v.optional(v.string()),
    direction: v.optional(v.union(v.literal("inbound"), v.literal("outbound"))),
    since: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 200);
    const since = args.since ?? 0;

    // Choose the most selective index
    let q;
    if (args.line !== undefined) {
      q = ctx.db
        .query("messages")
        .withIndex("by_line_recent", (idx) =>
          idx.eq("line", args.line).gte("sent_at", since),
        );
    } else if (args.user_id) {
      q = ctx.db
        .query("messages")
        .withIndex("by_user_recent", (idx) =>
          idx.eq("user_id", args.user_id!).gte("sent_at", since),
        );
    } else {
      q = ctx.db.query("messages");
    }

    let rows = await q.order("desc").take(limit * 2);
    if (args.direction) rows = rows.filter((r) => r.direction === args.direction);
    if (args.handle) {
      const convs = await ctx.db
        .query("conversations")
        .withIndex("by_imessage_handle", (idx) => idx.eq("imessage_handle", args.handle))
        .collect();
      const convIds = new Set(convs.map((c) => c._id));
      rows = rows.filter((r) => convIds.has(r.conversation_id));
    }
    return rows.slice(0, limit);
  },
});

// AI-9500 W2 #D — Unified cross-platform thread for the dossier Timeline tab.
//
// Interleaves messages from ALL conversations linked to a person (iMessage,
// Hinge, Bumble, IG, Telegram, email…) into a single chronological feed.
// Each message is annotated with a `_platform` tag derived from its source
// conversation's `platform` field so the UI can render per-platform pills.
//
// Also returns `_handles_summary` — the distinct platforms present — so the
// caller can hide the toggle when only one platform exists.
//
// Cap: 200 most-recent messages (configurable via `limit`, max 200).
export const unifiedThreadForPerson = query({
  args: {
    person_id: v.id("people"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 200, 200);

    // Step 1: find all conversations for this person.
    const convs = await ctx.db
      .query("conversations")
      .withIndex("by_person", (q) => q.eq("person_id", args.person_id))
      .collect();

    // Build a lookup: conversation_id → platform.
    const platformByConvId: Record<string, string> = {};
    for (const c of convs) {
      platformByConvId[c._id] = c.platform;
    }

    // Step 2: collect messages from each conversation.
    // We over-fetch per conv so we don't miss messages after the final merge-sort.
    const collected: Array<Record<string, unknown>> = [];

    if (convs.length > 0) {
      for (const c of convs) {
        const msgs = await ctx.db
          .query("messages")
          .withIndex("by_conversation", (q) => q.eq("conversation_id", c._id))
          .order("desc")
          .take(limit);
        for (const m of msgs) {
          collected.push({ ...m, _platform: c.platform });
        }
      }
    }

    // Step 3: fallback — if no conv-linked messages, try messages by person_id directly.
    // This covers older rows that have person_id but whose conversation lacks by_person index entry.
    if (collected.length === 0) {
      const directMsgs = await ctx.db
        .query("messages")
        .withIndex("by_person_recent", (q) => q.eq("person_id", args.person_id))
        .order("desc")
        .take(limit);
      for (const m of directMsgs) {
        const platform = platformByConvId[m.conversation_id as string] ?? "imessage";
        collected.push({ ...m, _platform: platform });
      }
    }

    // Step 4: sort by sent_at ascending (oldest first — UI can reverse if needed)
    // and keep the 200 most-recent.
    collected.sort((a, b) => ((a.sent_at as number) || 0) - ((b.sent_at as number) || 0));
    const sliced = collected.slice(-limit);

    // Step 5: derive handles_summary — distinct platforms present.
    const platformsSet = new Set<string>();
    for (const m of sliced) {
      if (m._platform) platformsSet.add(m._platform as string);
    }
    const _handles_summary = Array.from(platformsSet);

    return { messages: sliced, _handles_summary };
  },
});
