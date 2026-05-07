import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

// AI-9524 — Platform auth-token vault on Convex.
//
// Replaces Supabase clapcheeks_user_settings.{tinder,hinge,instagram}_auth_token_enc
// + bumble_session_enc storage. The ciphertext is produced by
// web/lib/crypto/token-vault.ts (Node) or clapcheeks/auth/token_vault.py
// (Python — wire-compatible). Decryption happens CLIENT-SIDE on the VPS
// daemon, which already has CLAPCHEEKS_TOKEN_MASTER_KEY.
//
// Auth model:
//   - upsertEncrypted: Chrome extension ingest path. Caller passes opaque
//     device token; we validate against agent_device_tokens.
//   - listAllForRunner / getForUser: VPS daemon read path. Gated on
//     CONVEX_RUNNER_SHARED_SECRET so service-role-equivalent access doesn't
//     leak to the operator's logged-in browser session.

const PLATFORM = v.union(
  v.literal("tinder"),
  v.literal("hinge"),
  v.literal("instagram"),
  v.literal("bumble"),
);

// ----------------------------------------------------------------------------
// upsertEncrypted — write path for the Chrome extension + mitmproxy.
//
// Validates the device token, finds-or-creates the platform_tokens row keyed
// on (user_id, platform), and bumps last_seen_at on the device token.
// ----------------------------------------------------------------------------
export const upsertEncrypted = mutation({
  args: {
    token: v.string(),                   // device token (auth)
    platform: PLATFORM,
    ciphertext: v.bytes(),
    enc_version: v.number(),
    source: v.string(),
    device_name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Validate device token
    const device = await ctx.db
      .query("agent_device_tokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!device || device.revoked) {
      throw new Error("invalid_device_token");
    }

    const now = Date.now();

    // Bump last_seen_at + optionally update device_name
    await ctx.db.patch(device._id, {
      last_seen_at: now,
      ...(args.device_name ? { device_name: args.device_name } : {}),
    });

    // Find existing row for (user_id, platform)
    const existing = await ctx.db
      .query("platform_tokens")
      .withIndex("by_user_platform", (q) =>
        q.eq("user_id", device.user_id).eq("platform", args.platform),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ciphertext: args.ciphertext,
        enc_version: args.enc_version,
        source: args.source,
        updated_at: now,
        ...(args.device_name ? { device_name: args.device_name } : {}),
      });
      return {
        ok: true as const,
        user_id: device.user_id,
        platform: args.platform,
        action: "updated" as const,
        updated_at: now,
      };
    }

    await ctx.db.insert("platform_tokens", {
      user_id: device.user_id,
      platform: args.platform,
      ciphertext: args.ciphertext,
      enc_version: args.enc_version,
      source: args.source,
      updated_at: now,
      device_name: args.device_name,
    });
    return {
      ok: true as const,
      user_id: device.user_id,
      platform: args.platform,
      action: "inserted" as const,
      updated_at: now,
    };
  },
});

// ----------------------------------------------------------------------------
// listAllForRunner — VPS daemon read path. Gated on a shared secret so this
// doesn't leak to operator browser sessions. The Python ConvexClient passes
// the secret in args; we compare to CONVEX_RUNNER_SHARED_SECRET env.
//
// Returns ALL token rows across all users so the runner can sweep them in
// one fetch (matches existing _load_users_with_tokens behavior).
// ----------------------------------------------------------------------------
export const listAllForRunner = query({
  args: {
    deploy_key_check: v.string(),
  },
  handler: async (ctx, args) => {
    const expected = process.env.CONVEX_RUNNER_SHARED_SECRET;
    if (!expected) {
      throw new Error("server_unconfigured: CONVEX_RUNNER_SHARED_SECRET unset");
    }
    if (args.deploy_key_check !== expected) {
      throw new Error("forbidden: bad deploy_key_check");
    }
    const rows = await ctx.db.query("platform_tokens").collect();
    return rows.map((r) => ({
      user_id: r.user_id,
      platform: r.platform,
      ciphertext: r.ciphertext,
      enc_version: r.enc_version,
      updated_at: r.updated_at,
      source: r.source,
    }));
  },
});

// ----------------------------------------------------------------------------
// getForUser — single-user, single-platform read. Used for future
// user-scoped reads (e.g. dashboard "is my Hinge token still fresh?").
// ----------------------------------------------------------------------------
export const getForUser = query({
  args: {
    user_id: v.string(),
    platform: PLATFORM,
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("platform_tokens")
      .withIndex("by_user_platform", (q) =>
        q.eq("user_id", args.user_id).eq("platform", args.platform),
      )
      .first();
    if (!row) return null;
    return {
      user_id: row.user_id,
      platform: row.platform,
      ciphertext: row.ciphertext,
      enc_version: row.enc_version,
      updated_at: row.updated_at,
      source: row.source,
    };
  },
});

// ----------------------------------------------------------------------------
// upsertEncryptedDirect — internal mutation used by the backfill script.
// Bypasses device-token check because the backfill runs from the operator's
// trusted environment with the master key. Caller must already know
// (user_id, platform).
// ----------------------------------------------------------------------------
export const upsertEncryptedDirect = internalMutation({
  args: {
    user_id: v.string(),
    platform: PLATFORM,
    ciphertext: v.bytes(),
    enc_version: v.number(),
    source: v.string(),
    device_name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("platform_tokens")
      .withIndex("by_user_platform", (q) =>
        q.eq("user_id", args.user_id).eq("platform", args.platform),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        ciphertext: args.ciphertext,
        enc_version: args.enc_version,
        source: args.source,
        updated_at: now,
        ...(args.device_name ? { device_name: args.device_name } : {}),
      });
      return { action: "updated" as const, _id: existing._id };
    }
    const id = await ctx.db.insert("platform_tokens", {
      user_id: args.user_id,
      platform: args.platform,
      ciphertext: args.ciphertext,
      enc_version: args.enc_version,
      source: args.source,
      updated_at: now,
      device_name: args.device_name,
    });
    return { action: "inserted" as const, _id: id };
  },
});

// ----------------------------------------------------------------------------
// upsertEncryptedFromBackfill — public mutation gated by shared secret, used
// by the one-shot backfill script (which runs from Mac Mini and can't easily
// invoke an internal mutation).
// ----------------------------------------------------------------------------
export const upsertEncryptedFromBackfill = mutation({
  args: {
    deploy_key_check: v.string(),
    user_id: v.string(),
    platform: PLATFORM,
    ciphertext: v.bytes(),
    enc_version: v.number(),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    const expected = process.env.CONVEX_RUNNER_SHARED_SECRET;
    if (!expected) {
      throw new Error("server_unconfigured: CONVEX_RUNNER_SHARED_SECRET unset");
    }
    if (args.deploy_key_check !== expected) {
      throw new Error("forbidden: bad deploy_key_check");
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("platform_tokens")
      .withIndex("by_user_platform", (q) =>
        q.eq("user_id", args.user_id).eq("platform", args.platform),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        ciphertext: args.ciphertext,
        enc_version: args.enc_version,
        source: args.source,
        updated_at: now,
      });
      return { action: "updated" as const };
    }
    await ctx.db.insert("platform_tokens", {
      user_id: args.user_id,
      platform: args.platform,
      ciphertext: args.ciphertext,
      enc_version: args.enc_version,
      source: args.source,
      updated_at: now,
    });
    return { action: "inserted" as const };
  },
});
