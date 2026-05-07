import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

// AI-9524 — Device tokens for the Chrome extension + mitmproxy ingest path.
// Replaces Supabase clapcheeks_agent_tokens. Each token is an opaque random
// string bound to a single user_id; the token grants write access to that
// user's platform_tokens rows.
//
// Provisioning is admin-side: mint a token via the dashboard or one-shot
// admin script (mintForUser internal mutation), then paste it into the
// Chrome extension or mitmproxy config on the Mac.

// ----------------------------------------------------------------------------
// validate — quick existence check used during ingest. Returns user_id +
// device_name on success, null otherwise.
// ----------------------------------------------------------------------------
export const validate = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("agent_device_tokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!row || row.revoked) return null;
    return {
      user_id: row.user_id,
      device_name: row.device_name ?? null,
      last_seen_at: row.last_seen_at ?? null,
    };
  },
});

// ----------------------------------------------------------------------------
// mintForUser — internal mutation: provisioning a new device token.
// Called from a one-time admin script. Caller passes a pre-generated random
// token (so caller controls entropy source).
// ----------------------------------------------------------------------------
export const mintForUser = internalMutation({
  args: {
    token: v.string(),
    user_id: v.string(),
    device_name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agent_device_tokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (existing) {
      throw new Error("token_already_exists");
    }
    const now = Date.now();
    return await ctx.db.insert("agent_device_tokens", {
      token: args.token,
      user_id: args.user_id,
      device_name: args.device_name,
      created_at: now,
      revoked: false,
    });
  },
});

// ----------------------------------------------------------------------------
// mintForUserGated — public mutation gated by CONVEX_RUNNER_SHARED_SECRET so
// a one-shot backfill / admin CLI can mint without internal-mutation access.
// ----------------------------------------------------------------------------
export const mintForUserGated = mutation({
  args: {
    deploy_key_check: v.string(),
    token: v.string(),
    user_id: v.string(),
    device_name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const expected = process.env.CONVEX_RUNNER_SHARED_SECRET;
    if (!expected) {
      throw new Error("server_unconfigured: CONVEX_RUNNER_SHARED_SECRET unset");
    }
    if (args.deploy_key_check !== expected) {
      throw new Error("forbidden: bad deploy_key_check");
    }
    const existing = await ctx.db
      .query("agent_device_tokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (existing) {
      return { action: "already_exists" as const, _id: existing._id };
    }
    const now = Date.now();
    const id = await ctx.db.insert("agent_device_tokens", {
      token: args.token,
      user_id: args.user_id,
      device_name: args.device_name,
      created_at: now,
      revoked: false,
    });
    return { action: "inserted" as const, _id: id };
  },
});

// ----------------------------------------------------------------------------
// revoke — flip revoked=true. Stops accepting writes from a compromised device.
// ----------------------------------------------------------------------------
export const revoke = mutation({
  args: {
    deploy_key_check: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const expected = process.env.CONVEX_RUNNER_SHARED_SECRET;
    if (!expected) {
      throw new Error("server_unconfigured: CONVEX_RUNNER_SHARED_SECRET unset");
    }
    if (args.deploy_key_check !== expected) {
      throw new Error("forbidden: bad deploy_key_check");
    }
    const row = await ctx.db
      .query("agent_device_tokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!row) {
      return { ok: false as const, reason: "not_found" };
    }
    await ctx.db.patch(row._id, { revoked: true });
    return { ok: true as const };
  },
});
