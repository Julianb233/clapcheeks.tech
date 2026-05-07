/**
 * AI-9500 Wave 2.4A — Profile screenshot importer.
 *
 * Julian screenshots a Tinder/Bumble/Hinge/IG profile, drops it via the iPhone
 * Shortcut with `x-cc-kind: profile` header. http.ts marks the asset
 * analysis_kind=profile_screenshot and fires analyzeAsProfile.
 *
 * analyzeAsProfile uses Gemini Vision to extract: name, age, occupation,
 * location, bio, prompts, photos described, zodiac inference, DISC inference,
 * 3 calibrated openers, green/red flags, compatibility-with-julian read.
 *
 * Operator reviews on /admin/clapcheeks-ops/profile-imports and clicks
 * "Create person row" → createPersonFromProfile creates a people row with
 * status=lead and whitelist_for_autoreply=false (safety default).
 *
 * Note: the Gemini Vision call runs through the Mac Mini convex_runner
 * because Convex V8 lacks the SDK. analyzeAsProfile here enqueues the
 * agent_job; runner calls back into _writeProfileData.
 */
import { v } from "convex/values";
import { internalAction, mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

// ---------------------------------------------------------------------------
// analyzeAsProfile — fires Mac Mini Gemini Vision via agent_job.
// ---------------------------------------------------------------------------
export const analyzeAsProfile = internalAction({
  args: { media_id: v.string() },
  handler: async (ctx, args) => {
    const asset = await ctx.runQuery(internal.profile_import._getMedia, {
      asset_id: args.media_id,
    });
    if (!asset) return { skipped: true, reason: "not_found" };
    await ctx.runMutation(internal.profile_import._enqueueAnalyzeJob, {
      _id: asset._id,
      user_id: asset.user_id,
      storage_url: asset.storage_url,
      mime_type: asset.mime_type,
    });
    return { enqueued: true };
  },
});

// ---------------------------------------------------------------------------
// listForReview — dashboard query.
// ---------------------------------------------------------------------------
export const listForReview = query({
  args: { user_id: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("media_assets")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .collect();
    return all
      .filter((a) =>
        (a as any).analysis_kind === "profile_screenshot" &&
        !(a as any).profile_imported_to_person_id,
      )
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, Math.min(args.limit ?? 50, 200));
  },
});

// ---------------------------------------------------------------------------
// reanalyze — operator clicked "retry analyze".
// ---------------------------------------------------------------------------
export const reanalyze = mutation({
  args: { media_id: v.id("media_assets") },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.media_id);
    if (!asset) return { not_found: true };
    await ctx.scheduler.runAfter(0, internal.profile_import.analyzeAsProfile, {
      media_id: (asset as any).asset_id,
    });
    return { enqueued: true };
  },
});

// ---------------------------------------------------------------------------
// dismissProfileScreenshot — operator clicked Skip; deprecate the asset.
// ---------------------------------------------------------------------------
export const dismissProfileScreenshot = mutation({
  args: { media_id: v.id("media_assets") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.media_id, {
      approval_status: "deprecated",
      updated_at: Date.now(),
    });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// createPersonFromProfile — operator clicked "Create person row".
// Creates a people row with status="lead" and whitelist_for_autoreply=false
// (safety default — operator has to flip whitelist before AI sends).
// ---------------------------------------------------------------------------
export const createPersonFromProfile = mutation({
  args: {
    media_id: v.id("media_assets"),
    user_id: v.string(),
    overrides: v.optional(v.object({
      display_name: v.optional(v.string()),
      platform: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.media_id);
    if (!asset) return { not_found: true };
    const data = (asset as any).profile_screenshot_data as any;
    if (!data) return { not_analyzed: true };

    const now = Date.now();
    const display = args.overrides?.display_name || data.name || "(unnamed)";
    const platform = (args.overrides?.platform || data.platform || "other") as
      "tinder" | "bumble" | "hinge" | "instagram" | "other";

    const handles: any[] = [];
    if (data.platform_user_id) {
      handles.push({
        channel: ["tinder","bumble","hinge","instagram"].includes(platform) ? platform : "other",
        value: String(data.platform_user_id),
        verified: false,
        primary: true,
      });
    }

    const personId = await ctx.db.insert("people", {
      user_id: args.user_id,
      display_name: display,
      handles,
      interests: data.interests || [],
      goals: [],
      values: [],
      cadence_profile: "warm",
      status: "lead",
      whitelist_for_autoreply: false,
      // Wave 2.4A profile-screenshot enrichment
      age: data.age,
      bio_text: data.bio_text,
      location_observed: data.location,
      occupation_observed: data.occupation,
      zodiac_sign: data.likely_zodiac_sign,
      zodiac_analysis: data.zodiac_block,
      disc_inference: data.disc,
      disc_inference_reasoning: data.disc_reasoning,
      opener_suggestions: data.opener_suggestions || [],
      profile_prompts_observed: data.prompts || [],
      photos_observed: data.photos_described || [],
      green_flags: data.green_flags || [],
      red_flags: data.red_flags || [],
      imported_from_profile_screenshot: true,
      imported_from_platform: platform,
      created_at: now,
      updated_at: now,
    } as any);

    await ctx.db.patch(args.media_id, {
      profile_imported_to_person_id: personId,
      approval_status: "approved",
      updated_at: now,
    });
    return { person_id: personId };
  },
});

// ---------------------------------------------------------------------------
// _writeProfileData — Mac Mini calls back here after Gemini Vision returns.
// ---------------------------------------------------------------------------
export const _writeProfileData = internalMutation({
  args: {
    _id: v.id("media_assets"),
    profile_screenshot_data: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args._id, {
      profile_screenshot_data: args.profile_screenshot_data,
      updated_at: Date.now(),
    });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------
export const _getMedia = internalQuery({
  args: { asset_id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("media_assets")
      .withIndex("by_asset_id", (q) => q.eq("asset_id", args.asset_id))
      .first();
  },
});

export const _enqueueAnalyzeJob = internalMutation({
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
      job_type: "analyze_profile_screenshot",
      payload: {
        media_id: args._id,
        storage_url: args.storage_url,
        mime_type: args.mime_type,
      },
      status: "queued",
      priority: 4,
      attempts: 0,
      max_attempts: 3,
      created_at: now,
      updated_at: now,
    } as any);
  },
});
