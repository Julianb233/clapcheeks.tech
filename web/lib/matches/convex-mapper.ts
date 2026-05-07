// AI-9534 — shared adapter that turns Convex match rows into the legacy
// ClapcheeksMatchRow shape that the existing UI components consume. Pulls the
// common-case fields and falls back to nulls everywhere else so we don't have
// to retype every component.
//
// `id` policy:
//   - prefer the original Supabase id (`supabase_match_id`) for back-compat
//     during the migration window so /matches/[id] URLs from old tabs still
//     resolve via getBySupabaseId.
//   - fall back to the Convex `_id` when there is no Supabase counterpart
//     (manually-added matches and offline matches created post-cutover).
//
// Numeric ms timestamps -> ISO strings so the components don't need to know
// the storage shape changed.

import type {
  ClapcheeksMatchRow,
  MatchPlatform,
  MatchPhoto,
  MatchPrompt,
  MatchStatus,
  MatchIntel,
  InstagramIntel,
  RosterStage,
} from './types'

type ConvexMatchRow = Record<string, unknown> & { _id?: unknown }

function n2iso(n: unknown): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  return new Date(n).toISOString()
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function asArray<T = unknown>(v: unknown): T[] | null {
  return Array.isArray(v) ? (v as T[]) : null
}

export function mapConvexMatchRowToLegacy(
  r: ConvexMatchRow,
): ClapcheeksMatchRow {
  const platform = (asString(r.platform) ?? 'tinder') as MatchPlatform
  const photosRaw = asArray<Record<string, unknown>>(r.photos)
  const photos: MatchPhoto[] | null = photosRaw
    ? photosRaw.map((p) => ({
        url: typeof p.url === 'string' ? p.url : '',
        supabase_path:
          typeof p.supabase_path === 'string' ? p.supabase_path : null,
        width: typeof p.width === 'number' ? p.width : null,
        height: typeof p.height === 'number' ? p.height : null,
      }))
    : null

  const promptsRaw = asArray<Record<string, unknown>>(r.prompts_jsonb)
  const prompts: MatchPrompt[] | null = promptsRaw
    ? promptsRaw
        .map((p) => ({
          question: typeof p.question === 'string' ? p.question : '',
          answer: typeof p.answer === 'string' ? p.answer : '',
        }))
        .filter((p) => p.question)
    : null

  const id =
    (asString(r.supabase_match_id) ?? (r._id as string | undefined)) ?? ''

  return {
    id,
    user_id: asString(r.user_id) ?? '',
    platform,
    external_id: asString(r.external_match_id) ?? asString(r.external_id),
    name: asString(r.name),
    age: asNumber(r.age),
    bio: asString(r.bio),
    photos_jsonb: photos,
    prompts_jsonb: prompts,
    job: asString(r.job),
    school: asString(r.school),
    instagram_handle: asString(r.instagram_handle),
    spotify_artists: asArray<string>(r.spotify_artists),
    birth_date: asString(r.birth_date),
    zodiac: asString(r.zodiac),
    match_intel: (r.match_intel as MatchIntel | null) ?? null,
    vision_summary: asString(r.vision_summary),
    instagram_intel: (r.instagram_intel as InstagramIntel | null) ?? null,
    status: (asString(r.status) ?? 'new') as MatchStatus,
    last_activity_at: n2iso(r.last_activity_at),
    created_at: n2iso(r.created_at) ?? new Date().toISOString(),
    updated_at: n2iso(r.updated_at) ?? new Date().toISOString(),
    final_score: asNumber(r.final_score),
    location_score: null,
    criteria_score: null,
    scoring_reason: null,
    julian_rank: asNumber(r.julian_rank),
    stage: (asString(r.stage) as RosterStage | null) ?? null,
    health_score: asNumber(r.health_score),
    close_probability: asNumber(r.close_probability),
    mutual_friends_count: asNumber(r.mutual_friends_count),
    mutual_friends_list:
      (r.mutual_friends_list as ClapcheeksMatchRow['mutual_friends_list']) ??
      null,
    social_risk_band:
      (asString(r.social_risk_band) as ClapcheeksMatchRow['social_risk_band']) ??
      null,
    friend_cluster_id: asString(r.friend_cluster_id),
    cluster_rank: asNumber(r.cluster_rank),
    social_graph_confidence: asNumber(r.social_graph_confidence),
    social_graph_sources: asArray<string>(r.social_graph_sources),
    // AI-9526 F6 — surface her_phone for tel:/imessage: links.
    her_phone: asString(r.her_phone),
  }
}

export function mapConvexMatchRowsToLegacy(
  rows: unknown,
): ClapcheeksMatchRow[] {
  if (!Array.isArray(rows)) return []
  return (rows as ConvexMatchRow[]).map(mapConvexMatchRowToLegacy)
}
