/**
 * AI-9449 — Media library.
 *
 * Photos / videos / voice memos / memes Julian has approved for AI to send
 * in context (puppy, beach, gym selfie, memes that match her humor, etc.).
 * AI selects from this library based on conversation signals + a context-hook
 * match.
 *
 * Upload pathway:
 *   1. iPhone Shortcut hits /clapcheeks/media-upload (httpAction in http.ts)
 *      OR Mac Mini media_drive_watcher polls Google Drive folder
 *   2. media:upload mutation creates the row + fires autoTagMedia
 *   3. autoTagMedia (Gemini Vision) populates tags, vibe, smile_detected, etc.
 *   4. Operator approves in /admin/clapcheeks-ops/media
 *   5. AI sends pull from listApproved + findByContext
 */
import { v } from "convex/values";
import { mutation, query, internalMutation, internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

const KIND = v.union(
  v.literal("image"), v.literal("video"),
  v.literal("voice_memo"), v.literal("meme"), v.literal("gif"),
);

// ---------------------------------------------------------------------------
// upload — create a new media_assets row. Fires autoTagMedia for Vision-based
// auto-tagging unless explicit tags are provided.
// ---------------------------------------------------------------------------
export const upload = mutation({
  args: {
    user_id: v.string(),
    asset_id: v.string(),
    kind: KIND,
    storage_url: v.string(),
    thumbnail_url: v.optional(v.string()),
    file_size_bytes: v.optional(v.number()),
    mime_type: v.optional(v.string()),
    caption: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    context_hooks: v.optional(v.array(v.string())),
    upload_source: v.optional(v.union(
      v.literal("iphone"), v.literal("google_drive"),
      v.literal("manual"), v.literal("vps_cli"),
    )),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    // Dedup on (user_id, asset_id).
    const existing = await ctx.db
      .query("media_assets")
      .withIndex("by_asset_id", (q) => q.eq("asset_id", args.asset_id))
      .first();
    if (existing) return { asset_id: existing.asset_id, _id: existing._id, deduped: true };

    const tags = args.tags ?? [];
    const _id = await ctx.db.insert("media_assets", {
      user_id: args.user_id,
      asset_id: args.asset_id,
      kind: args.kind,
      storage_url: args.storage_url,
      thumbnail_url: args.thumbnail_url,
      file_size_bytes: args.file_size_bytes,
      mime_type: args.mime_type,
      caption: args.caption,
      tags,
      context_hooks: args.context_hooks ?? [],
      upload_source: args.upload_source,
      approval_status: "pending",
      created_at: now,
      updated_at: now,
    });
    // Fire Vision auto-tag if no manual tags provided.
    if (tags.length === 0 && args.kind === "image") {
      await ctx.scheduler.runAfter(0, internal.media.autoTagMedia, { _id });
    }
    return { asset_id: args.asset_id, _id };
  },
});

// ---------------------------------------------------------------------------
// findByContext — Mac Mini draft engine asks for media matching a hook.
// Filters by approved + matches at least one context_hook substring.
// ---------------------------------------------------------------------------
export const findByContext = query({
  args: {
    user_id: v.string(),
    hooks: v.array(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("media_assets")
      .withIndex("by_user_status", (q) =>
        q.eq("user_id", args.user_id).eq("approval_status", "approved"),
      )
      .collect();
    const needles = args.hooks.map((h) => h.toLowerCase());
    const scored = all
      .map((a) => {
        const haystack = [...(a.context_hooks || []), ...(a.tags || [])].map((s) => s.toLowerCase());
        const matches = needles.filter((n) => haystack.some((h) => h.includes(n) || n.includes(h)));
        return { asset: a, score: matches.length };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.min(args.limit ?? 5, 20)).map((x) => x.asset);
  },
});

// ---------------------------------------------------------------------------
// recordUse — Mac Mini records every send.
// ---------------------------------------------------------------------------
export const recordUse = mutation({
  args: {
    user_id: v.string(),
    asset_id: v.id("media_assets"),
    person_id: v.id("people"),
    conversation_id: v.optional(v.id("conversations")),
    sent_at: v.number(),
    message_external_guid: v.optional(v.string()),
    fire_context: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.asset_id);
    if (!asset) return { not_found: true };
    await ctx.db.insert("media_uses", {
      user_id: args.user_id,
      asset_id: args.asset_id,
      person_id: args.person_id,
      conversation_id: args.conversation_id,
      sent_at: args.sent_at,
      message_external_guid: args.message_external_guid,
      fire_context: args.fire_context,
    });
    await ctx.db.patch(args.asset_id, {
      used_count: ((asset as any).used_count ?? 0) + 1,
      last_used_at_ms: args.sent_at,
      last_used_with_person_id: args.person_id,
      updated_at: Date.now(),
    });
    return { ok: true };
  },
});

export const approve = mutation({
  args: { _id: v.id("media_assets") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args._id, { approval_status: "approved", updated_at: Date.now() });
  },
});

export const deprecate = mutation({
  args: { _id: v.id("media_assets") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args._id, { approval_status: "deprecated", updated_at: Date.now() });
  },
});

export const get = query({
  args: { _id: v.id("media_assets") },
  handler: async (ctx, args) => await ctx.db.get(args._id),
});

export const listForApproval = query({
  args: { user_id: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("media_assets")
      .withIndex("by_user_status", (q) =>
        q.eq("user_id", args.user_id).eq("approval_status", "pending"),
      )
      .order("desc")
      .take(Math.min(args.limit ?? 50, 200));
    return rows;
  },
});

export const listApproved = query({
  args: { user_id: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("media_assets")
      .withIndex("by_user_status", (q) =>
        q.eq("user_id", args.user_id).eq("approval_status", "approved"),
      )
      .order("desc")
      .take(Math.min(args.limit ?? 50, 200));
    return rows;
  },
});

// ---------------------------------------------------------------------------
// Convex storage upload helpers.
// ---------------------------------------------------------------------------
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

export const storageUrl = query({
  args: { storage_id: v.string() },
  handler: async (ctx, args) => await ctx.storage.getUrl(args.storage_id),
});

export const markAsProfileScreenshot = mutation({
  args: {
    asset_id: v.string(),
    platform: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const asset = await ctx.db
      .query("media_assets")
      .withIndex("by_asset_id", (q) => q.eq("asset_id", args.asset_id))
      .first();
    if (!asset) return { not_found: true };
    await ctx.db.patch(asset._id, {
      analysis_kind: "profile_screenshot",
      ...(args.platform ? { caption: `Profile screenshot (${args.platform})` } : {}),
      updated_at: Date.now(),
    });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// autoTagMedia — Vision-based tagging. The actual Gemini Vision call is
// proxied through the Mac Mini convex_runner via an agent_job because Convex
// V8 doesn't have the SDK. This action enqueues the job and returns; the job
// handler calls back into _patchTags with the result.
// ---------------------------------------------------------------------------
export const autoTagMedia = internalAction({
  args: { _id: v.id("media_assets") },
  handler: async (ctx, args) => {
    const asset = await ctx.runQuery(internal.media._getMedia, { _id: args._id });
    if (!asset) return { skipped: true, reason: "not_found" };
    if ((asset as any).analysis_kind === "profile_screenshot") {
      // Profile screenshots are analyzed differently (profile_import.analyzeAsProfile).
      return { skipped: true, reason: "is_profile_screenshot" };
    }
    const now = Date.now();
    await ctx.runMutation(internal.media._enqueueAutoTagJob, {
      _id: args._id,
      user_id: asset.user_id,
      storage_url: asset.storage_url,
      mime_type: asset.mime_type,
    });
    return { enqueued: true, queued_at: now };
  },
});

export const _getMedia = internalQuery({
  args: { _id: v.id("media_assets") },
  handler: async (ctx, args) => await ctx.db.get(args._id),
});

export const _patchTags = internalMutation({
  args: {
    _id: v.id("media_assets"),
    tags: v.array(v.string()),
    context_hooks: v.array(v.string()),
    vibe: v.optional(v.string()),
    flex_level: v.optional(v.number()),
    smile_detected: v.optional(v.boolean()),
    with_friends: v.optional(v.boolean()),
    with_pet: v.optional(v.boolean()),
    auto_tag_run_id: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: any = {
      tags: args.tags,
      context_hooks: args.context_hooks,
      updated_at: Date.now(),
    };
    if (args.vibe) patch.vibe = args.vibe;
    if (args.flex_level !== undefined) patch.flex_level = args.flex_level;
    if (args.smile_detected !== undefined) patch.smile_detected = args.smile_detected;
    if (args.with_friends !== undefined) patch.with_friends = args.with_friends;
    if (args.with_pet !== undefined) patch.with_pet = args.with_pet;
    if (args.auto_tag_run_id) patch.auto_tag_run_id = args.auto_tag_run_id;
    await ctx.db.patch(args._id, patch);
  },
});

export const _enqueueAutoTagJob = internalMutation({
  args: {
    _id: v.id("media_assets"),
    user_id: v.string(),
    storage_url: v.string(),
    mime_type: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("agent_jobs", {
      user_id: args.user_id,
      job_type: "auto_tag_media",
      payload: {
        media_id: args._id,
        storage_url: args.storage_url,
        mime_type: args.mime_type,
      },
      status: "queued",
      priority: 6,
      attempts: 0,
      max_attempts: 3,
      created_at: now,
      updated_at: now,
    } as any);
  },
});
