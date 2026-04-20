// Type definitions for Phase D match views.
// Aligns with the clapcheeks_matches schema that Phase A (AI-8315) will create.
// Columns marked "future" may not exist yet — read with try/catch or optional chaining.

export type MatchPlatform = 'tinder' | 'hinge' | 'bumble' | 'offline'

export type MatchStatus =
  | 'new'
  | 'opened'
  | 'conversing'
  | 'stalled'
  | 'date_proposed'
  | 'date_booked'
  | 'dated'
  | 'ghosted'

export type MatchPhoto = {
  url: string
  supabase_path?: string | null
  width?: number | null
  height?: number | null
}

export type MatchPrompt = {
  question: string
  answer: string
}

export type MatchIntel = {
  summary?: string | null
  red_flags?: string[]
  green_flags?: string[]
  vibe?: string | null
  compatibility?: number | null
  [k: string]: unknown
}

export type InstagramIntel = {
  summary?: string | null
  handle?: string | null
  follower_count?: number | null
  vibes?: string[]
  [k: string]: unknown
}

export type ClapcheeksMatchRow = {
  id: string
  user_id: string
  platform: MatchPlatform
  external_id: string | null
  name: string | null
  age: number | null
  bio: string | null
  photos_jsonb: MatchPhoto[] | null
  prompts_jsonb: MatchPrompt[] | null
  job: string | null
  school: string | null
  instagram_handle: string | null
  spotify_artists: string[] | null
  birth_date: string | null
  zodiac: string | null
  match_intel: MatchIntel | null
  vision_summary: string | null
  instagram_intel: InstagramIntel | null
  status: MatchStatus
  last_activity_at: string | null
  created_at: string
  updated_at: string
  // future scoring columns (may not exist yet)
  final_score: number | null
  location_score: number | null
  criteria_score: number | null
  scoring_reason: string | null
  // future agent override (may not exist yet)
  julian_rank: number | null
  // demo / dev flag for seeded data
  is_demo?: boolean | null
}

export type MatchListFilters = {
  platform: 'all' | MatchPlatform
  status: 'all' | 'new' | 'conversing' | 'date_proposed' | 'date_booked' | 'dated' | 'stalled' | 'ghosted'
  minScore: number
}

export type ConversationMessage = {
  id?: string
  direction: 'incoming' | 'outgoing'
  body: string
  sent_at: string
  platform?: string
}

export const PLATFORM_OPTIONS: Array<{ value: 'all' | MatchPlatform; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'tinder', label: 'Tinder' },
  { value: 'hinge', label: 'Hinge' },
  { value: 'bumble', label: 'Bumble' },
  { value: 'offline', label: 'Offline' },
]

export const STATUS_OPTIONS: Array<{ value: MatchListFilters['status']; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'conversing', label: 'Conversing' },
  { value: 'date_proposed', label: 'Date proposed' },
  { value: 'date_booked', label: 'Date booked' },
  { value: 'dated', label: 'Dated' },
  { value: 'stalled', label: 'Stalled' },
  { value: 'ghosted', label: 'Ghosted' },
]

export const STATUS_COLORS: Record<MatchStatus, string> = {
  new:            'bg-blue-500/15 text-blue-300 border-blue-500/30',
  opened:         'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  conversing:     'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  stalled:        'bg-amber-500/15 text-amber-300 border-amber-500/30',
  date_proposed:  'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30',
  date_booked:    'bg-pink-500/15 text-pink-300 border-pink-500/30',
  dated:          'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
  ghosted:        'bg-white/10 text-white/50 border-white/15',
}

export const PLATFORM_COLORS: Record<MatchPlatform, string> = {
  tinder:  'bg-rose-500/15 text-rose-300 border-rose-500/30',
  hinge:   'bg-violet-500/15 text-violet-300 border-violet-500/30',
  bumble:  'bg-amber-500/15 text-amber-300 border-amber-500/30',
  offline: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
}

export function formatTimeAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diff = Math.max(0, now - then)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}
