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
