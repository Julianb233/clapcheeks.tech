// Phase 40 Pipeline — types & stage mapping.
//
// The clapcheeks_matches table has 12 detailed roster stages (Phase J),
// but Julian wants a 6-column visual pipeline he can drive from his phone.
// We bucket detail-stages into 6 broad lanes here.

import type { ClapcheeksMatchRow, RosterStage } from '@/lib/matches/types'

export type PipelineColumn =
  | 'new'
  | 'chatting'
  | 'proposed'
  | 'booked'
  | 'dated'
  | 'recurring'

export type PipelineColumnDef = {
  key: PipelineColumn
  label: string
  hint: string
  tone: string
  // The single canonical RosterStage value we write back when a match is
  // dragged into this column.
  canonicalStage: RosterStage
}

export const PIPELINE_COLUMNS: PipelineColumnDef[] = [
  {
    key: 'new',
    label: 'New',
    hint: 'Match — no opener yet',
    tone: 'border-blue-500/40 text-blue-300',
    canonicalStage: 'new_match',
  },
  {
    key: 'chatting',
    label: 'Chatting',
    hint: 'Back and forth',
    tone: 'border-emerald-500/40 text-emerald-300',
    canonicalStage: 'chatting',
  },
  {
    key: 'proposed',
    label: 'Proposed',
    hint: 'Date asked, awaiting confirm',
    tone: 'border-fuchsia-500/40 text-fuchsia-300',
    canonicalStage: 'date_proposed',
  },
  {
    key: 'booked',
    label: 'Booked',
    hint: 'On the calendar',
    tone: 'border-pink-500/40 text-pink-300',
    canonicalStage: 'date_booked',
  },
  {
    key: 'dated',
    label: 'Dated',
    hint: 'Date happened',
    tone: 'border-yellow-500/40 text-yellow-300',
    canonicalStage: 'date_attended',
  },
  {
    key: 'recurring',
    label: 'Recurring',
    hint: 'Seeing each other',
    tone: 'border-violet-500/40 text-violet-300',
    canonicalStage: 'recurring',
  },
]

const STAGE_TO_COLUMN: Record<RosterStage, PipelineColumn | null> = {
  new_match: 'new',
  chatting: 'chatting',
  chatting_phone: 'chatting',
  date_proposed: 'proposed',
  date_booked: 'booked',
  date_attended: 'dated',
  hooked_up: 'dated',
  recurring: 'recurring',
  // Cold lanes — hidden by default, surfaced via filter.
  faded: null,
  ghosted: null,
  archived: null,
  archived_cluster_dupe: null,
}

export function bucketStage(stage: RosterStage | null | undefined): PipelineColumn | null {
  if (!stage) return 'new'
  return STAGE_TO_COLUMN[stage] ?? null
}

// ─── Multi-dimension ranking ──────────────────────────────────────────

export const RANK_DIMENSIONS = [
  { key: 'vibe', label: 'Vibe' },
  { key: 'looks', label: 'Looks' },
  { key: 'effort', label: 'Effort' },
  { key: 'intelligence', label: 'Intelligence' },
  { key: 'chemistry', label: 'Chemistry' },
] as const

export type RankDimension = (typeof RANK_DIMENSIONS)[number]['key']

export type Rankings = Partial<Record<RankDimension, number>>

export function readRankings(intel: unknown): Rankings {
  if (!intel || typeof intel !== 'object') return {}
  const r = (intel as Record<string, unknown>).rankings
  if (!r || typeof r !== 'object') return {}
  const out: Rankings = {}
  for (const dim of RANK_DIMENSIONS) {
    const v = (r as Record<string, unknown>)[dim.key]
    if (typeof v === 'number' && v >= 0 && v <= 10) {
      out[dim.key] = Math.round(v)
    }
  }
  return out
}

export function computeOverallRank(rankings: Rankings): number | null {
  const vals = RANK_DIMENSIONS.map((d) => rankings[d.key]).filter(
    (v): v is number => typeof v === 'number',
  )
  if (vals.length === 0) return null
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
}

// ─── Filters & sort ───────────────────────────────────────────────────

export type SortKey = 'close_probability' | 'julian_rank' | 'health' | 'recent'
export type PlatformFilter = 'all' | 'tinder' | 'hinge' | 'bumble' | 'offline'

export type Filters = {
  platform: PlatformFilter
  hasPhotos: boolean
  hasInstagram: boolean
  showCold: boolean
  search: string
}

export const DEFAULT_FILTERS: Filters = {
  platform: 'all',
  hasPhotos: false,
  hasInstagram: false,
  showCold: false,
  search: '',
}

export function applyFilters(matches: ClapcheeksMatchRow[], f: Filters): ClapcheeksMatchRow[] {
  const q = f.search.trim().toLowerCase()
  return matches.filter((m) => {
    if (f.platform !== 'all' && m.platform !== f.platform) return false
    if (f.hasPhotos && (!m.photos_jsonb || m.photos_jsonb.length === 0)) return false
    if (f.hasInstagram && !m.instagram_handle) return false
    if (q) {
      const hay = [m.name, m.bio, m.job, m.school, m.zodiac, m.instagram_handle]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export function sortMatches(
  matches: ClapcheeksMatchRow[],
  key: SortKey,
): ClapcheeksMatchRow[] {
  const arr = [...matches]
  switch (key) {
    case 'close_probability':
      arr.sort((a, b) => (b.close_probability ?? 0) - (a.close_probability ?? 0))
      break
    case 'julian_rank':
      arr.sort((a, b) => (b.julian_rank ?? -1) - (a.julian_rank ?? -1))
      break
    case 'health':
      arr.sort((a, b) => (b.health_score ?? 0) - (a.health_score ?? 0))
      break
    case 'recent':
      arr.sort((a, b) => {
        const at = new Date(a.last_activity_at ?? a.updated_at ?? 0).getTime()
        const bt = new Date(b.last_activity_at ?? b.updated_at ?? 0).getTime()
        return bt - at
      })
      break
  }
  return arr
}
