import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// AI-9449 — Unified person record across iMessage / dating apps / email / Telegram.
//
// Obsidian is canonical for "who they are" (interests, goals, values,
// communication_style, cadence_profile, whitelist_for_autoreply).
// Convex is canonical for "live state" (last_inbound_at, last_outbound_at,
// next_followup_at, style_profile).
//
// Sync is one-way: clapcheeks-local/intel/obsidian_sync.py walks the vault
// and calls upsertFromObsidian on every changed file. The daemon never
// writes back to Obsidian (no merge conflicts).
//
// Companion modules: messages.ts (extracts handles for person_linker),
// conversations.ts (carries person_id once linked).

// ----------------------------------------------------------------------------
// Cadence profile -> minimum inter-message gap (ms). Used by dueForFollowup.
// Conservative defaults; override per-person via Obsidian if needed.
// ----------------------------------------------------------------------------
const CADENCE_GAP_MS: Record<string, number> = {
  hot: 5 * 60 * 1000,                  // 5 min
  warm: 60 * 60 * 1000,                // 1 hour
  slow_burn: 24 * 60 * 60 * 1000,      // 1 day
  nurture: 3 * 24 * 60 * 60 * 1000,    // 3 days
  dormant: 30 * 24 * 60 * 60 * 1000,   // 1 month
};

const HANDLE_CHANNEL = v.union(
  v.literal("imessage"), v.literal("sms"), v.literal("hinge"),
  v.literal("tinder"), v.literal("bumble"), v.literal("instagram"),
  v.literal("telegram"), v.literal("email"), v.literal("whatsapp"),
);

const CADENCE_PROFILE = v.union(
  v.literal("hot"), v.literal("warm"), v.literal("slow_burn"),
  v.literal("nurture"), v.literal("dormant"),
);

const PERSON_STATUS = v.union(
  v.literal("lead"), v.literal("active"), v.literal("paused"),
  v.literal("ghosted"), v.literal("dating"), v.literal("ended"),
);

// ----------------------------------------------------------------------------
// upsertFromObsidian
//
// Idempotent. Keyed by (user_id, obsidian_path). If the supplied md_hash
// matches the stored hash, returns early — no DB write. Otherwise patches
// every Obsidian-sourced field; preserves daemon-owned fields
// (last_inbound_at, last_outbound_at, next_followup_at, style_profile).
// ----------------------------------------------------------------------------
export const upsertFromObsidian = mutation({
  args: {
    user_id: v.string(),
    obsidian_path: v.string(),
    obsidian_md_hash: v.string(),
    display_name: v.string(),
    handles: v.array(v.object({
      channel: HANDLE_CHANNEL,
      value: v.string(),
      verified: v.optional(v.boolean()),
      primary: v.optional(v.boolean()),
    })),
    interests: v.optional(v.array(v.string())),
    goals: v.optional(v.array(v.string())),
    values: v.optional(v.array(v.string())),
    context_notes: v.optional(v.string()),
    disc_primary: v.optional(v.string()),
    vak_primary: v.optional(v.string()),
    communication_style: v.optional(v.string()),
    cadence_profile: v.optional(CADENCE_PROFILE),
    active_hours_local: v.optional(v.object({
      tz: v.string(),
      start_hour: v.number(),
      end_hour: v.number(),
    })),
    status: v.optional(PERSON_STATUS),
    whitelist_for_autoreply: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("people")
      .withIndex("by_obsidian_path", (q) => q.eq("obsidian_path", args.obsidian_path))
      .first();

    // Normalize handle defaults (verified=false, primary=false unless given).
    const handles = args.handles.map((h) => ({
      channel: h.channel,
      value: h.value,
      verified: h.verified ?? false,
      primary: h.primary ?? false,
    }));

    if (existing && existing.obsidian_md_hash === args.obsidian_md_hash) {
      return { person_id: existing._id, changed: false };
    }

    const patch = {
      user_id: args.user_id,
      display_name: args.display_name,
      obsidian_path: args.obsidian_path,
      obsidian_md_hash: args.obsidian_md_hash,
      handles,
      interests: args.interests ?? [],
      goals: args.goals ?? [],
      values: args.values ?? [],
      context_notes: args.context_notes,
      disc_primary: args.disc_primary,
      vak_primary: args.vak_primary,
      communication_style: args.communication_style,
      cadence_profile: args.cadence_profile ?? "warm",
      active_hours_local: args.active_hours_local,
      status: args.status ?? "lead",
      whitelist_for_autoreply: args.whitelist_for_autoreply ?? false,
      updated_at: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { person_id: existing._id, changed: true };
    }

    const id = await ctx.db.insert("people", {
      ...patch,
      created_at: now,
    });
    return { person_id: id, changed: true };
  },
});

// ----------------------------------------------------------------------------
// findByHandle
//
// Look up people by exact (channel, value) match. Returns array — caller
// decides what to do with 0 / 1 / many results. Used by person_linker on
// every inbound message.
//
// O(N) over the user's people rows because Convex doesn't index inside
// arrays-of-objects. Fine at human scale (<10k people per user).
// ----------------------------------------------------------------------------
export const findByHandle = query({
  args: {
    user_id: v.string(),
    channel: HANDLE_CHANNEL,
    value: v.string(),
  },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("people")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .collect();
    const needle = args.value.trim().toLowerCase();
    return all.filter((p) =>
      p.handles.some(
        (h) => h.channel === args.channel && h.value.trim().toLowerCase() === needle,
      ),
    );
  },
});

// ----------------------------------------------------------------------------
// dueForFollowup
//
// Returns whitelisted, active people whose next_followup_at has passed
// AND whose minimum inter-message gap (per cadence_profile) has elapsed
// since last_outbound_at. The cadence_runner iterates this list every 30s.
//
// Active-hours filtering is done client-side (daemon) because Convex
// can't evaluate per-person tz windows efficiently in a query.
// ----------------------------------------------------------------------------
export const dueForFollowup = query({
  args: {
    user_id: v.string(),
    now_ms: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now_ms ?? Date.now();
    const limit = Math.min(args.limit ?? 50, 200);

    const candidates = await ctx.db
      .query("people")
      .withIndex("by_user_status", (q) =>
        q.eq("user_id", args.user_id).eq("status", "active"),
      )
      .collect();

    const ready = candidates.filter((p) => {
      if (!p.whitelist_for_autoreply) return false;
      if (p.next_followup_at && p.next_followup_at > now) return false;
      const gap = CADENCE_GAP_MS[p.cadence_profile] ?? CADENCE_GAP_MS.warm;
      if (p.last_outbound_at && now - p.last_outbound_at < gap) return false;
      return true;
    });

    // Oldest next_followup_at first (or oldest last_outbound_at if no followup).
    ready.sort((a, b) => {
      const ax = a.next_followup_at ?? a.last_outbound_at ?? 0;
      const bx = b.next_followup_at ?? b.last_outbound_at ?? 0;
      return ax - bx;
    });
    return ready.slice(0, limit);
  },
});

// ----------------------------------------------------------------------------
// linkConversation
//
// Atomically attach a conversation (and its messages, denormalized) to a
// person. Idempotent — calling twice is a no-op once linked. Called by
// person_linker.py on exact-match auto-link, or by the dashboard on manual
// resolution of a pending_links row.
// ----------------------------------------------------------------------------
export const linkConversation = mutation({
  args: {
    conversation_id: v.id("conversations"),
    person_id: v.id("people"),
    backfill_messages: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const conv = await ctx.db.get(args.conversation_id);
    if (!conv) throw new Error("conversation not found");
    if (conv.person_id === args.person_id) {
      return { conversation_id: conv._id, person_id: args.person_id, already_linked: true };
    }

    const now = Date.now();
    await ctx.db.patch(conv._id, { person_id: args.person_id, updated_at: now });

    if (args.backfill_messages !== false) {
      const msgs = await ctx.db
        .query("messages")
        .withIndex("by_conversation", (q) => q.eq("conversation_id", conv._id))
        .collect();
      for (const m of msgs) {
        if (m.person_id !== args.person_id) {
          await ctx.db.patch(m._id, { person_id: args.person_id });
        }
      }
    }

    // Pull last_inbound/outbound_at from conversation onto the person row
    // so cadence_runner has fresh state.
    const person = await ctx.db.get(args.person_id);
    if (person) {
      const patch: Record<string, unknown> = { updated_at: now };
      if (conv.last_inbound_at && (!person.last_inbound_at || conv.last_inbound_at > person.last_inbound_at)) {
        patch.last_inbound_at = conv.last_inbound_at;
      }
      if (conv.last_outbound_at && (!person.last_outbound_at || conv.last_outbound_at > person.last_outbound_at)) {
        patch.last_outbound_at = conv.last_outbound_at;
      }
      if (Object.keys(patch).length > 1) await ctx.db.patch(args.person_id, patch);
    }

    return { conversation_id: conv._id, person_id: args.person_id, already_linked: false };
  },
});

// ----------------------------------------------------------------------------
// recordPendingLink
//
// Called by person_linker.py when an inbound message can't be auto-linked
// (no handle match OR multiple matches). Inserts a pending_links row the
// dashboard can surface for manual resolution.
// ----------------------------------------------------------------------------
export const recordPendingLink = mutation({
  args: {
    user_id: v.string(),
    conversation_id: v.id("conversations"),
    handle_channel: v.string(),
    handle_value: v.string(),
    candidate_person_ids: v.array(v.id("people")),
    raw_context: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    // Dedup: if an open pending_link already exists for this conversation,
    // append the new context but don't create a duplicate row.
    const existing = await ctx.db
      .query("pending_links")
      .withIndex("by_conversation", (q) => q.eq("conversation_id", args.conversation_id))
      .filter((q) => q.eq(q.field("status"), "open"))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        candidate_person_ids: args.candidate_person_ids,
        raw_context: args.raw_context ?? existing.raw_context,
        updated_at: now,
      });
      return { pending_link_id: existing._id, deduped: true };
    }
    const id = await ctx.db.insert("pending_links", {
      user_id: args.user_id,
      conversation_id: args.conversation_id,
      handle_channel: args.handle_channel,
      handle_value: args.handle_value,
      candidate_person_ids: args.candidate_person_ids,
      raw_context: args.raw_context,
      status: "open",
      created_at: now,
      updated_at: now,
    });
    return { pending_link_id: id, deduped: false };
  },
});

// ----------------------------------------------------------------------------
// listForUser
//
// Dashboard reader — sorted by next_followup_at (soonest first). Powers
// the "who's coming up" panel in the Vercel UI.
// ----------------------------------------------------------------------------
export const listForUser = query({
  args: {
    user_id: v.string(),
    status: v.optional(PERSON_STATUS),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 100, 500);
    if (args.status) {
      return await ctx.db
        .query("people")
        .withIndex("by_user_status", (q) => q.eq("user_id", args.user_id).eq("status", args.status!))
        .take(limit);
    }
    return await ctx.db
      .query("people")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .take(limit);
  },
});

// ----------------------------------------------------------------------------
// updateLiveState
//
// Daemon-only writer. Called whenever inbound/outbound activity occurs on
// any of this person's channels. Bumps last_inbound_at/last_outbound_at
// and (optionally) re-schedules next_followup_at based on cadence_profile.
// ----------------------------------------------------------------------------
export const updateLiveState = mutation({
  args: {
    person_id: v.id("people"),
    last_inbound_at: v.optional(v.number()),
    last_outbound_at: v.optional(v.number()),
    next_followup_at: v.optional(v.number()),
    style_profile: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const patch: Record<string, unknown> = { updated_at: now };
    if (args.last_inbound_at !== undefined) patch.last_inbound_at = args.last_inbound_at;
    if (args.last_outbound_at !== undefined) patch.last_outbound_at = args.last_outbound_at;
    if (args.next_followup_at !== undefined) patch.next_followup_at = args.next_followup_at;
    if (args.style_profile !== undefined) patch.style_profile = args.style_profile;
    await ctx.db.patch(args.person_id, patch);
  },
});
