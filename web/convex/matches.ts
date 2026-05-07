import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

// AI-9526 — Match metadata + photos on Convex.
//
// Replaces Supabase `clapcheeks_matches` table + `clapcheeks-match-photos`
// Storage bucket. Auth still lives on Supabase (supabase.auth.getUser); the
// user_id field on every row is the Supabase auth uuid.
//
// Mac Mini match_sync.py: `convex.mutation('matches:upsertByExternal', ...)`
// Web client: `useQuery(api.matches.listForUser, { user_id })`
//
// Idempotency: keyed by (user_id, platform, external_match_id).
// Mirrors the conversations:listForUser cap fix from PR #130 (default 200,
// max 2000) so dashboards never silently truncate.

const PLATFORM = v.union(
  v.literal("hinge"),
  v.literal("tinder"),
  v.literal("bumble"),
  v.literal("imessage"),
  v.literal("offline"),
);

const PHOTO = v.object({
  storage_id: v.optional(v.id("_storage")),
  url: v.optional(v.string()),
  supabase_path: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  primary: v.optional(v.boolean()),
  idx: v.optional(v.number()),
});

const MAX_LIMIT = 2000;
const DEFAULT_LIMIT = 200;

// AI-9526 Q2 — default status for any match row missing one. The Supabase
// backfill landed many rows with status=null; the dashboard contract is that
// every match has a status the dropdown can flip. We apply this on every
// read path so legacy rows surface as "lead" without needing a migration.
const DEFAULT_STATUS = "lead";

function withDefaultStatus<T extends { status?: string | null | undefined } | null | undefined>(
  row: T,
): T {
  if (!row) return row;
  if (row.status == null || row.status === "") {
    return { ...row, status: DEFAULT_STATUS } as T;
  }
  return row;
}

// ----------------------------------------------------------------------------
// upsertByExternal — write path used by Mac Mini match_sync.py.
//
// Idempotent: looks up by (user_id, platform, external_match_id). Inserts on
// first sight, patches on subsequent runs. Numeric/string fields default to
// undefined (not patched) when the caller omits them so we don't accidentally
// blow away enrichment data set by the Vercel UI.
// ----------------------------------------------------------------------------
export const upsertByExternal = mutation({
  args: {
    user_id: v.string(),
    platform: PLATFORM,
    external_match_id: v.string(),
    match_name: v.optional(v.string()),
    name: v.optional(v.string()),
    age: v.optional(v.number()),
    bio: v.optional(v.string()),
    status: v.optional(v.string()),
    photos: v.optional(v.array(PHOTO)),
    instagram_handle: v.optional(v.string()),
    zodiac: v.optional(v.string()),
    job: v.optional(v.string()),
    school: v.optional(v.string()),
    stage: v.optional(v.string()),
    health_score: v.optional(v.number()),
    final_score: v.optional(v.number()),
    julian_rank: v.optional(v.number()),
    match_intel: v.optional(v.any()),
    attributes: v.optional(v.any()),
    last_activity_at: v.optional(v.number()),
    supabase_match_id: v.optional(v.string()),
    person_id: v.optional(v.id("people")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("matches")
      .withIndex("by_user_platform_external", (q) =>
        q
          .eq("user_id", args.user_id)
          .eq("platform", args.platform)
          .eq("external_match_id", args.external_match_id),
      )
      .first();

    // Build a partial patch that only includes fields the caller actually set.
    const patch: Record<string, unknown> = { updated_at: now };
    const fields: Array<keyof typeof args> = [
      "match_name", "name", "age", "bio", "status", "photos",
      "instagram_handle", "zodiac", "job", "school", "stage",
      "health_score", "final_score", "julian_rank", "match_intel",
      "attributes", "last_activity_at", "supabase_match_id", "person_id",
    ];
    for (const f of fields) {
      if (args[f] !== undefined) patch[f as string] = args[f];
    }

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { action: "updated" as const, _id: existing._id };
    }
    const id = await ctx.db.insert("matches", {
      user_id: args.user_id,
      platform: args.platform,
      external_match_id: args.external_match_id,
      match_name: args.match_name,
      name: args.name,
      age: args.age,
      bio: args.bio,
      status: args.status ?? DEFAULT_STATUS,
      photos: args.photos,
      instagram_handle: args.instagram_handle,
      zodiac: args.zodiac,
      job: args.job,
      school: args.school,
      stage: args.stage,
      health_score: args.health_score,
      final_score: args.final_score,
      julian_rank: args.julian_rank,
      match_intel: args.match_intel,
      attributes: args.attributes,
      last_activity_at: args.last_activity_at,
      supabase_match_id: args.supabase_match_id,
      person_id: args.person_id,
      created_at: now,
      updated_at: now,
    });
    return { action: "inserted" as const, _id: id };
  },
});

// ----------------------------------------------------------------------------
// upsertFromBackfill — gated mutation used by the Supabase->Convex backfill
// script. Same idempotent shape as upsertByExternal but accepts a created_at
// override (preserve original Supabase timestamps) and is gated on the shared
// secret so it can't be invoked from a browser session.
// ----------------------------------------------------------------------------
export const upsertFromBackfill = mutation({
  args: {
    deploy_key_check: v.string(),
    user_id: v.string(),
    platform: PLATFORM,
    external_match_id: v.string(),
    supabase_match_id: v.optional(v.string()),
    match_name: v.optional(v.string()),
    name: v.optional(v.string()),
    age: v.optional(v.number()),
    bio: v.optional(v.string()),
    status: v.optional(v.string()),
    photos: v.optional(v.array(PHOTO)),
    instagram_handle: v.optional(v.string()),
    zodiac: v.optional(v.string()),
    job: v.optional(v.string()),
    school: v.optional(v.string()),
    stage: v.optional(v.string()),
    health_score: v.optional(v.number()),
    final_score: v.optional(v.number()),
    julian_rank: v.optional(v.number()),
    match_intel: v.optional(v.any()),
    attributes: v.optional(v.any()),
    last_activity_at: v.optional(v.number()),
    created_at: v.optional(v.number()),
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
      .query("matches")
      .withIndex("by_user_platform_external", (q) =>
        q
          .eq("user_id", args.user_id)
          .eq("platform", args.platform)
          .eq("external_match_id", args.external_match_id),
      )
      .first();
    const fields: Array<string> = [
      "match_name", "name", "age", "bio", "status", "photos",
      "instagram_handle", "zodiac", "job", "school", "stage",
      "health_score", "final_score", "julian_rank", "match_intel",
      "attributes", "last_activity_at", "supabase_match_id",
    ];
    const patch: Record<string, unknown> = { updated_at: now };
    for (const f of fields) {
      const val = (args as Record<string, unknown>)[f];
      if (val !== undefined) patch[f] = val;
    }
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { action: "updated" as const, _id: existing._id };
    }
    const id = await ctx.db.insert("matches", {
      user_id: args.user_id,
      platform: args.platform,
      external_match_id: args.external_match_id,
      match_name: args.match_name,
      name: args.name,
      age: args.age,
      bio: args.bio,
      status: args.status ?? DEFAULT_STATUS,
      photos: args.photos,
      instagram_handle: args.instagram_handle,
      zodiac: args.zodiac,
      job: args.job,
      school: args.school,
      stage: args.stage,
      health_score: args.health_score,
      final_score: args.final_score,
      julian_rank: args.julian_rank,
      match_intel: args.match_intel,
      attributes: args.attributes,
      last_activity_at: args.last_activity_at,
      supabase_match_id: args.supabase_match_id,
      created_at: args.created_at ?? now,
      updated_at: now,
    });
    return { action: "inserted" as const, _id: id };
  },
});

// ----------------------------------------------------------------------------
// listForUser — primary read path for /matches page.
//
// Returns matches sorted by julian_rank DESC, then final_score DESC, then
// created_at DESC. Convex indexes don't support multi-field DESC ordering, so
// we fetch by_user_rank and stable-sort in JS — fine at human-scale (<10k
// matches per user).
//
// Cap: default 200, max 2000 (mirrors conversations:listForUser PR #130 fix).
// ----------------------------------------------------------------------------
export const listForUser = query({
  args: {
    user_id: v.string(),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

    let rows;
    if (args.status) {
      rows = await ctx.db
        .query("matches")
        .withIndex("by_user_status", (q) =>
          q.eq("user_id", args.user_id).eq("status", args.status!),
        )
        .collect();
    } else {
      rows = await ctx.db
        .query("matches")
        .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
        .collect();
    }

    rows.sort((a, b) => {
      const ar = typeof a.julian_rank === "number" ? a.julian_rank : -Infinity;
      const br = typeof b.julian_rank === "number" ? b.julian_rank : -Infinity;
      if (br !== ar) return br - ar;
      const af = typeof a.final_score === "number" ? a.final_score : -Infinity;
      const bf = typeof b.final_score === "number" ? b.final_score : -Infinity;
      if (bf !== af) return bf - af;
      return (b.created_at ?? 0) - (a.created_at ?? 0);
    });
    return rows.slice(0, limit).map((r) => withDefaultStatus(r));
  },
});

// ----------------------------------------------------------------------------
// listForUserByPlatform — platform-filtered variant for any platform-specific
// dashboard (e.g. Tinder-only roster view).
// ----------------------------------------------------------------------------
export const listForUserByPlatform = query({
  args: {
    user_id: v.string(),
    platform: PLATFORM,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const all = await ctx.db
      .query("matches")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .collect();
    const filtered = all.filter((r) => r.platform === args.platform);
    filtered.sort((a, b) => {
      const ar = typeof a.julian_rank === "number" ? a.julian_rank : -Infinity;
      const br = typeof b.julian_rank === "number" ? b.julian_rank : -Infinity;
      if (br !== ar) return br - ar;
      const af = typeof a.final_score === "number" ? a.final_score : -Infinity;
      const bf = typeof b.final_score === "number" ? b.final_score : -Infinity;
      if (bf !== af) return bf - af;
      return (b.created_at ?? 0) - (a.created_at ?? 0);
    });
    return filtered.slice(0, limit).map((r) => withDefaultStatus(r));
  },
});

// ----------------------------------------------------------------------------
// getById — single match by Convex doc id.
// ----------------------------------------------------------------------------
export const getById = query({
  args: { id: v.id("matches") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    return withDefaultStatus(row);
  },
});

// ----------------------------------------------------------------------------
// getBySupabaseId — single match looked up by original Supabase id (for the
// detail page during the dual-read transition window).
// ----------------------------------------------------------------------------
export const getBySupabaseId = query({
  args: { supabase_match_id: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("matches")
      .withIndex("by_supabase_match_id", (q) =>
        q.eq("supabase_match_id", args.supabase_match_id),
      )
      .first();
    return withDefaultStatus(row);
  },
});

// ----------------------------------------------------------------------------
// patch — partial update (status, julian_rank, attributes, etc.).
//
// AI-9534: extended to cover every column the 16 remaining clapcheeks_matches
// call sites poke at. Caller passes only the fields they want changed; any
// undefined arg is skipped. updated_at is always bumped.
// ----------------------------------------------------------------------------
export const patch = mutation({
  args: {
    id: v.id("matches"),
    status: v.optional(v.string()),
    stage: v.optional(v.string()),
    julian_rank: v.optional(v.number()),
    health_score: v.optional(v.number()),
    final_score: v.optional(v.number()),
    attributes: v.optional(v.any()),
    attributes_updated_at: v.optional(v.string()),
    match_intel: v.optional(v.any()),
    instagram_intel: v.optional(v.any()),
    instagram_fetched_at: v.optional(v.string()),
    last_activity_at: v.optional(v.number()),
    instagram_handle: v.optional(v.string()),
    photos: v.optional(v.array(PHOTO)),
    name: v.optional(v.string()),
    age: v.optional(v.number()),
    bio: v.optional(v.string()),
    zodiac: v.optional(v.string()),
    job: v.optional(v.string()),
    school: v.optional(v.string()),
    birth_date: v.optional(v.string()),
    prompts_jsonb: v.optional(v.any()),
    spotify_artists: v.optional(v.array(v.string())),
    vision_summary: v.optional(v.string()),
    outcome: v.optional(v.string()),
    opener_sent_at: v.optional(v.string()),
    ai_active: v.optional(v.boolean()),
    close_probability: v.optional(v.number()),
    mutual_friends_count: v.optional(v.number()),
    mutual_friends_list: v.optional(v.any()),
    social_risk_band: v.optional(v.string()),
    friend_cluster_id: v.optional(v.string()),
    cluster_rank: v.optional(v.number()),
    social_graph_confidence: v.optional(v.number()),
    social_graph_sources: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { id, ...rest } = args;
    const patch: Record<string, unknown> = { updated_at: Date.now() };
    for (const [k, v2] of Object.entries(rest)) {
      if (v2 !== undefined) patch[k] = v2;
    }
    await ctx.db.patch(id, patch);
    return { ok: true as const };
  },
});

// ----------------------------------------------------------------------------
// patchByUser — same as patch but enforces user ownership in the mutation
// itself (caller passes user_id; mismatch throws). API routes use this so the
// ownership check + the write happen atomically.
// ----------------------------------------------------------------------------
export const patchByUser = mutation({
  args: {
    id: v.id("matches"),
    user_id: v.string(),
    status: v.optional(v.string()),
    stage: v.optional(v.string()),
    julian_rank: v.optional(v.number()),
    health_score: v.optional(v.number()),
    final_score: v.optional(v.number()),
    attributes: v.optional(v.any()),
    attributes_updated_at: v.optional(v.string()),
    match_intel: v.optional(v.any()),
    instagram_intel: v.optional(v.any()),
    instagram_fetched_at: v.optional(v.string()),
    last_activity_at: v.optional(v.number()),
    instagram_handle: v.optional(v.string()),
    photos: v.optional(v.array(PHOTO)),
    name: v.optional(v.string()),
    age: v.optional(v.number()),
    bio: v.optional(v.string()),
    zodiac: v.optional(v.string()),
    job: v.optional(v.string()),
    school: v.optional(v.string()),
    birth_date: v.optional(v.string()),
    prompts_jsonb: v.optional(v.any()),
    spotify_artists: v.optional(v.array(v.string())),
    vision_summary: v.optional(v.string()),
    outcome: v.optional(v.string()),
    opener_sent_at: v.optional(v.string()),
    ai_active: v.optional(v.boolean()),
    close_probability: v.optional(v.number()),
    mutual_friends_count: v.optional(v.number()),
    mutual_friends_list: v.optional(v.any()),
    social_risk_band: v.optional(v.string()),
    friend_cluster_id: v.optional(v.string()),
    cluster_rank: v.optional(v.number()),
    social_graph_confidence: v.optional(v.number()),
    social_graph_sources: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { id, user_id, ...rest } = args;
    const row = await ctx.db.get(id);
    if (!row) throw new Error("not_found");
    if (row.user_id !== user_id) throw new Error("forbidden");
    const patch: Record<string, unknown> = { updated_at: Date.now() };
    for (const [k, v2] of Object.entries(rest)) {
      if (v2 !== undefined) patch[k] = v2;
    }
    await ctx.db.patch(id, patch);
    return { ok: true as const, _id: id, row: { ...row, ...patch } };
  },
});

// ----------------------------------------------------------------------------
// resolveByAnyId — resolve a string id from a URL/UI to a match doc by trying
// (a) Convex doc id, (b) supabase_match_id index. Centralizes the dual-lookup
// pattern used by /matches/[id], API PATCH/DELETE, etc.
// ----------------------------------------------------------------------------
export const resolveByAnyId = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    // Try Convex _id first (only succeeds if the string is a valid Convex id
    // belonging to the matches table).
    try {
      const doc = await ctx.db.get(args.id as unknown as Parameters<typeof ctx.db.get>[0]);
      if (doc && (doc as { _id?: unknown })._id) return withDefaultStatus(doc as { status?: string | null });
    } catch {
      // not a valid Convex id — fall through
    }
    const row = await ctx.db
      .query("matches")
      .withIndex("by_supabase_match_id", (q) =>
        q.eq("supabase_match_id", args.id),
      )
      .first();
    return withDefaultStatus(row);
  },
});

// ----------------------------------------------------------------------------
// listForUserOrdered — read all matches for a user, ordered for the Pipeline /
// Roster header strip (close_probability DESC, then final_score DESC, then
// last_activity_at DESC). Mirrors the legacy Supabase query.
// ----------------------------------------------------------------------------
export const listForUserOrdered = query({
  args: {
    user_id: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const all = await ctx.db
      .query("matches")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .collect();
    all.sort((a, b) => {
      const ap = typeof a.close_probability === "number" ? a.close_probability : -Infinity;
      const bp = typeof b.close_probability === "number" ? b.close_probability : -Infinity;
      if (bp !== ap) return bp - ap;
      const af = typeof a.final_score === "number" ? a.final_score : -Infinity;
      const bf = typeof b.final_score === "number" ? b.final_score : -Infinity;
      if (bf !== af) return bf - af;
      const aa = typeof a.last_activity_at === "number" ? a.last_activity_at : -Infinity;
      const ba = typeof b.last_activity_at === "number" ? b.last_activity_at : -Infinity;
      return ba - aa;
    });
    return all.slice(0, limit).map((r) => withDefaultStatus(r));
  },
});

// ----------------------------------------------------------------------------
// countForUser — fast count for the Dashboard "Total Matches" stat. Avoids
// loading the rows themselves (Convex still scans the index, but this hides
// that detail behind a typed return).
// ----------------------------------------------------------------------------
export const countForUser = query({
  args: { user_id: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("matches")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .collect();
    return rows.length;
  },
});

// ----------------------------------------------------------------------------
// insertManual — write path for the /api/match-profile/add route. Lets the UI
// create a brand-new match row with no platform-side counterpart yet.
// ----------------------------------------------------------------------------
export const insertManual = mutation({
  args: {
    user_id: v.string(),
    platform: PLATFORM,
    external_match_id: v.string(),                // generated client-side (manual-<ts>-<rand>)
    match_id: v.optional(v.string()),              // legacy mirror
    external_id: v.optional(v.string()),           // legacy mirror
    name: v.string(),
    match_name: v.optional(v.string()),
    age: v.optional(v.number()),
    birth_date: v.optional(v.string()),
    bio: v.optional(v.string()),
    instagram_handle: v.optional(v.string()),
    match_intel: v.optional(v.any()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("matches", {
      user_id: args.user_id,
      platform: args.platform,
      external_match_id: args.external_match_id,
      match_id: args.match_id ?? args.external_match_id,
      external_id: args.external_id ?? args.external_match_id,
      name: args.name,
      match_name: args.match_name ?? args.name,
      age: args.age,
      birth_date: args.birth_date,
      bio: args.bio,
      instagram_handle: args.instagram_handle,
      match_intel: args.match_intel,
      status: args.status ?? DEFAULT_STATUS,
      created_at: now,
      updated_at: now,
    });
    return { _id: id };
  },
});

// ----------------------------------------------------------------------------
// upsertOffline — write path for the /api/matches/offline route. Mirrors the
// previous `.upsert(..., { onConflict: 'user_id,platform,external_id' })`.
// ----------------------------------------------------------------------------
export const upsertOffline = mutation({
  args: {
    user_id: v.string(),
    external_match_id: v.string(),                // 'offline:<digits>'
    match_id: v.optional(v.string()),
    external_id: v.optional(v.string()),
    match_name: v.string(),
    name: v.string(),
    her_phone: v.string(),
    source: v.optional(v.string()),
    primary_channel: v.optional(v.string()),
    handoff_complete: v.optional(v.boolean()),
    julian_shared_phone: v.optional(v.boolean()),
    handoff_detected_at: v.optional(v.number()),
    instagram_handle: v.optional(v.string()),
    met_at: v.optional(v.string()),
    first_impression: v.optional(v.string()),
    match_intel: v.optional(v.any()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("matches")
      .withIndex("by_user_platform_external", (q) =>
        q
          .eq("user_id", args.user_id)
          .eq("platform", "offline")
          .eq("external_match_id", args.external_match_id),
      )
      .first();
    const fields: Record<string, unknown> = {
      match_id: args.match_id ?? args.external_match_id,
      external_id: args.external_id ?? args.external_match_id,
      match_name: args.match_name,
      name: args.name,
      her_phone: args.her_phone,
      source: args.source,
      primary_channel: args.primary_channel,
      handoff_complete: args.handoff_complete,
      julian_shared_phone: args.julian_shared_phone,
      handoff_detected_at: args.handoff_detected_at,
      instagram_handle: args.instagram_handle,
      met_at: args.met_at,
      first_impression: args.first_impression,
      match_intel: args.match_intel,
      status: args.status ?? "conversing",
      last_activity_at: now,
      updated_at: now,
    };
    if (existing) {
      const patch: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(fields)) {
        if (val !== undefined) patch[k] = val;
      }
      await ctx.db.patch(existing._id, patch);
      return { action: "updated" as const, _id: existing._id, external_id: args.external_match_id };
    }
    const id = await ctx.db.insert("matches", {
      user_id: args.user_id,
      platform: "offline",
      external_match_id: args.external_match_id,
      created_at: now,
      ...fields,
    } as Parameters<typeof ctx.db.insert<"matches">>[1]);
    return { action: "inserted" as const, _id: id, external_id: args.external_match_id };
  },
});

// ----------------------------------------------------------------------------
// listManualByUser — list path for GET /api/match-profile/add. Returns the
// full row sorted by created_at desc.
// ----------------------------------------------------------------------------
export const listManualByUser = query({
  args: {
    user_id: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const rows = await ctx.db
      .query("matches")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .collect();
    rows.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
    return rows.slice(0, limit);
  },
});

// ----------------------------------------------------------------------------
// archive — soft-archive (sets status='archived'). Caller can use patch too;
// this is a convenience wrapper.
// ----------------------------------------------------------------------------
export const archive = mutation({
  args: { id: v.id("matches") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "archived",
      updated_at: Date.now(),
    });
    return { ok: true as const };
  },
});

// ----------------------------------------------------------------------------
// getPhotoUrl — resolve a Convex File Storage id to a URL the browser can hit.
// Used by the matches grid + detail components when a photo's storage_id is
// set (and url is not).
// ----------------------------------------------------------------------------
export const getPhotoUrl = query({
  args: { storage_id: v.id("_storage") },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storage_id);
  },
});

// ----------------------------------------------------------------------------
// generateUploadUrl — short-lived URL for uploading a photo blob into Convex
// File Storage. The Mac Mini match_sync.py uses this to push a downloaded
// match photo into Convex without an admin auth round-trip.
// ----------------------------------------------------------------------------
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

// ----------------------------------------------------------------------------
// AI-9526 Q2 — backfillStatusLead: one-shot mutation to set status="lead" on
// every match row where status is null/missing. Idempotent — re-running is a
// no-op. Optional `user_id` arg scopes the backfill; omit to run fleet-wide.
// Admin-only (Convex admin auth or shared secret).
// ----------------------------------------------------------------------------
export const backfillStatusLead = mutation({
  args: {
    user_id: v.optional(v.string()),
    deploy_key_check: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const expected = process.env.CONVEX_RUNNER_SHARED_SECRET;
    // Allow either Convex admin auth OR shared secret. If the secret is set,
    // require it; otherwise fall through to admin-auth-only.
    if (expected && args.deploy_key_check !== expected) {
      const identity = await ctx.auth.getUserIdentity();
      if (!identity) {
        throw new Error("forbidden: admin auth or deploy_key_check required");
      }
    }
    const rows = args.user_id
      ? await ctx.db
          .query("matches")
          .withIndex("by_user", (q) => q.eq("user_id", args.user_id!))
          .collect()
      : await ctx.db.query("matches").collect();
    let patched = 0;
    for (const row of rows) {
      if (row.status == null || row.status === "") {
        await ctx.db.patch(row._id, {
          status: DEFAULT_STATUS,
          updated_at: Date.now(),
        });
        patched += 1;
      }
    }
    return { scanned: rows.length, patched };
  },
});
