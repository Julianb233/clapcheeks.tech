import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// AI-9537 — Google Calendar OAuth tokens on Convex.
//
// SENSITIVE: refresh_token + access_token are AES-256-GCM encrypted by the
// caller (web/lib/crypto/token-vault.ts → encryptToken) before being passed
// in. They are NEVER stored as plaintext at rest.

// ---------------------------------------------------------------------------
// upsertEncrypted — write path. Caller (Next.js route or Python backfill)
// pre-encrypts both tokens with the user's vault key and passes ciphertext.
// ---------------------------------------------------------------------------
export const upsertEncrypted = mutation({
  args: {
    user_id: v.string(),
    google_email: v.string(),
    google_sub: v.optional(v.string()),
    access_token_encrypted: v.bytes(),
    refresh_token_encrypted: v.bytes(),
    enc_version: v.number(),
    expires_at: v.number(),                  // unix ms
    scopes: v.array(v.string()),
    calendar_id: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("google_calendar_tokens")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .first();
    const calendar_id = args.calendar_id ?? "primary";
    if (existing) {
      await ctx.db.patch(existing._id, {
        google_email: args.google_email,
        google_sub: args.google_sub,
        access_token_encrypted: args.access_token_encrypted,
        refresh_token_encrypted: args.refresh_token_encrypted,
        enc_version: args.enc_version,
        expires_at: args.expires_at,
        scopes: args.scopes,
        calendar_id,
        updated_at: now,
      });
      return { ok: true as const, id: existing._id, action: "updated" as const };
    }
    const id = await ctx.db.insert("google_calendar_tokens", {
      user_id: args.user_id,
      google_email: args.google_email,
      google_sub: args.google_sub,
      access_token_encrypted: args.access_token_encrypted,
      refresh_token_encrypted: args.refresh_token_encrypted,
      enc_version: args.enc_version,
      expires_at: args.expires_at,
      scopes: args.scopes,
      calendar_id,
      created_at: now,
      updated_at: now,
    });
    return { ok: true as const, id, action: "inserted" as const };
  },
});

// ---------------------------------------------------------------------------
// updateAccessTokenEncrypted — token-refresh narrow patch. Only the
// short-lived access_token rotates; refresh_token stays put.
// ---------------------------------------------------------------------------
export const updateAccessTokenEncrypted = mutation({
  args: {
    user_id: v.string(),
    access_token_encrypted: v.bytes(),
    expires_at: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("google_calendar_tokens")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .first();
    if (!row) return { ok: false as const, reason: "not_connected" as const };
    await ctx.db.patch(row._id, {
      access_token_encrypted: args.access_token_encrypted,
      expires_at: args.expires_at,
      updated_at: Date.now(),
    });
    return { ok: true as const };
  },
});

// ---------------------------------------------------------------------------
// getEncryptedForUser — read path. Caller decrypts with token-vault.
// ---------------------------------------------------------------------------
export const getEncryptedForUser = query({
  args: { user_id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("google_calendar_tokens")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .first();
  },
});

// ---------------------------------------------------------------------------
// getMetaForUser — non-sensitive metadata (no ciphertext) for the "is the
// calendar connected?" UI hint.
// ---------------------------------------------------------------------------
export const getMetaForUser = query({
  args: { user_id: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("google_calendar_tokens")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .first();
    if (!row) return null;
    return {
      google_email: row.google_email,
      calendar_id: row.calendar_id,
      scopes: row.scopes,
      created_at: row.created_at,
      updated_at: row.updated_at,
      expires_at: row.expires_at,
    };
  },
});

// ---------------------------------------------------------------------------
// deleteForUser — disconnect path.
// ---------------------------------------------------------------------------
export const deleteForUser = mutation({
  args: { user_id: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("google_calendar_tokens")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .first();
    if (!row) return { ok: true as const, action: "noop" as const };
    await ctx.db.delete(row._id);
    return { ok: true as const, action: "deleted" as const };
  },
});
