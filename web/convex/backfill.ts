/**
 * AI-9500 Wave 2.1A — One-shot backfill helpers.
 *
 * After person_linker shipped, conversations + messages from before the
 * linker had no person_id. backfillBatch walks orphan rows and patches in
 * person_id when an exact-match handle resolves.
 *
 * runChained calls _runChainedStep on a self-recursive scheduler so the
 * backfill spreads across many small batches instead of one giant mutation.
 *
 * Read-only orphanStatus exposes "how many rows still need backfilling" so
 * the dashboard can show progress.
 */
import { v } from "convex/values";
import { mutation, internalAction, query } from "./_generated/server";
import { internal } from "./_generated/api";

const BATCH_SIZE = 100;

// ---------------------------------------------------------------------------
// backfillBatch — walk one batch of orphan messages + conversations.
// ---------------------------------------------------------------------------
export const backfillBatch = mutation({
  args: {
    user_id: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const batch = Math.min(args.limit ?? BATCH_SIZE, 500);
    let patchedConvos = 0;
    let patchedMessages = 0;

    const convos = await ctx.db
      .query("conversations")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .collect();
    const orphanConvos = convos
      .filter((c) => !c.person_id && c.imessage_handle)
      .slice(0, batch);

    for (const c of orphanConvos) {
      // Find people whose handles include this E.164 phone.
      const candidates = await ctx.db
        .query("people")
        .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
        .collect();
      const matches = candidates.filter((p) =>
        p.handles.some(
          (h) => h.value.trim().toLowerCase() === c.imessage_handle!.trim().toLowerCase(),
        ),
      );
      if (matches.length === 1) {
        await ctx.db.patch(c._id, { person_id: matches[0]._id });
        patchedConvos++;
        // Also patch messages for this conversation.
        const msgs = await ctx.db
          .query("messages")
          .withIndex("by_conversation", (q) => q.eq("conversation_id", c._id))
          .collect();
        for (const m of msgs) {
          if (!m.person_id) {
            await ctx.db.patch(m._id, { person_id: matches[0]._id });
            patchedMessages++;
          }
        }
      }
    }

    return {
      scanned_conversations: orphanConvos.length,
      patched_conversations: patchedConvos,
      patched_messages: patchedMessages,
      done: orphanConvos.length < batch,
    };
  },
});

// ---------------------------------------------------------------------------
// runChained — kicks off self-scheduling backfill.
// ---------------------------------------------------------------------------
export const runChained = mutation({
  args: { user_id: v.string() },
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(0, internal.backfill._runChainedStep, {
      user_id: args.user_id,
      iter: 0,
    });
    return { kicked_off: true };
  },
});

export const _runChainedStep = internalAction({
  args: { user_id: v.string(), iter: v.number() },
  handler: async (ctx, args): Promise<any> => {
    if (args.iter > 200) return { stopped: "iteration_cap" };
    const result: any = await ctx.runMutation(internal.backfill._batchInternal, {
      user_id: args.user_id,
      limit: BATCH_SIZE,
    });
    if (!result.done) {
      await ctx.scheduler.runAfter(2000, internal.backfill._runChainedStep, {
        user_id: args.user_id,
        iter: args.iter + 1,
      });
    }
    return result;
  },
});

// Internal mutation copy of backfillBatch — same logic, internal-only access
// so the action can call it without going through the public API.
import { internalMutation } from "./_generated/server";
export const _batchInternal = internalMutation({
  args: { user_id: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const batch = Math.min(args.limit ?? BATCH_SIZE, 500);
    let patchedConvos = 0;
    let patchedMessages = 0;
    const convos = await ctx.db
      .query("conversations")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .collect();
    const orphanConvos = convos
      .filter((c) => !c.person_id && c.imessage_handle)
      .slice(0, batch);
    for (const c of orphanConvos) {
      const candidates = await ctx.db
        .query("people")
        .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
        .collect();
      const matches = candidates.filter((p) =>
        p.handles.some(
          (h) => h.value.trim().toLowerCase() === c.imessage_handle!.trim().toLowerCase(),
        ),
      );
      if (matches.length === 1) {
        await ctx.db.patch(c._id, { person_id: matches[0]._id });
        patchedConvos++;
        const msgs = await ctx.db
          .query("messages")
          .withIndex("by_conversation", (q) => q.eq("conversation_id", c._id))
          .collect();
        for (const m of msgs) {
          if (!m.person_id) {
            await ctx.db.patch(m._id, { person_id: matches[0]._id });
            patchedMessages++;
          }
        }
      }
    }
    return {
      scanned_conversations: orphanConvos.length,
      patched_conversations: patchedConvos,
      patched_messages: patchedMessages,
      done: orphanConvos.length < batch,
    };
  },
});

// ---------------------------------------------------------------------------
// orphanStatus — read-only progress query.
// ---------------------------------------------------------------------------
export const orphanStatus = query({
  args: { user_id: v.string() },
  handler: async (ctx, args) => {
    const convos = await ctx.db
      .query("conversations")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .collect();
    const orphans = convos.filter((c) => !c.person_id && c.imessage_handle).length;
    const linked = convos.filter((c) => c.person_id).length;
    return { orphans, linked, total: convos.length };
  },
});
