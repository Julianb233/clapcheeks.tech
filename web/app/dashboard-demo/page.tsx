import { notFound } from 'next/navigation'
import MatchGrid from '@/components/matches/MatchGrid'
import MatchDetail from '@/components/matches/MatchDetail'
import { ClapcheeksMatchRow, ConversationMessage } from '@/lib/matches/types'
import { createClient } from '@/lib/supabase/server'

/**
 * Admin-only demo preview for Phase D screenshots. Server-side role gate:
 * only users with profiles.role IN ('admin', 'super_admin') can view this
 * page. All other requests (including unauthenticated) get notFound().
 */
export const dynamic = 'force-dynamic'

const DEMO_USER = '00000000-0000-0000-0000-000000000000'
const NOW = new Date()

const DEMO_MATCHES: ClapcheeksMatchRow[] = [
  {
    id: 'demo-1',
    user_id: DEMO_USER,
    platform: 'hinge',
    external_id: 'demo-hinge-001',
    name: 'Sofia',
    age: 27,
    bio: 'Barre instructor by day. Matcha enthusiast. Ask me about my dog.',
    photos_jsonb: [
      { url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800' },
      { url: 'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=800' },
      { url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=800' },
    ],
    prompts_jsonb: [
      { question: 'My simple pleasures', answer: 'Espresso, vinyl, and winning arguments.' },
      { question: 'Two truths and a lie', answer: 'Ran a marathon; allergic to cilantro; played in a punk band.' },
    ],
    job: 'Pilates instructor',
    school: 'UCSD',
    instagram_handle: 'sofia.moves',
    spotify_artists: ['Faye Webster', 'Phoebe Bridgers', 'Mac Demarco'],
    birth_date: null,
    zodiac: 'Libra',
    match_intel: {
      summary: 'High-energy, creative.',
      green_flags: ['Replies within 2h consistently', 'Uses complete sentences'],
      red_flags: [],
    },
    vision_summary:
      'Balanced photo set: two portraits, one group shot, one activity. Warm outdoor lighting. Genuine smile in primary.',
    instagram_intel: {
      summary: 'Active (posts 3x/week). Fitness and cafe culture. Low red flags.',
      handle: 'sofia.moves',
    },
    status: 'conversing',
    last_activity_at: new Date(NOW.getTime() - 42 * 60 * 1000).toISOString(),
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    final_score: 87,
    location_score: 92,
    criteria_score: 83,
    scoring_reason: 'Lives within 5 miles. Hits 4 of 5 criteria: fitness, creative career, pets, non-smoker.',
    julian_rank: 8,
    is_demo: true,
  },
  {
    id: 'demo-2',
    user_id: DEMO_USER,
    platform: 'tinder',
    external_id: 'demo-tinder-002',
    name: 'Marisol',
    age: 24,
    bio: 'Architect. Travel junkie.',
    photos_jsonb: [
      { url: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=800' },
    ],
    prompts_jsonb: null,
    job: 'Architect',
    school: null,
    instagram_handle: null,
    spotify_artists: ['Caamp'],
    birth_date: null,
    zodiac: 'Gemini',
    match_intel: null,
    vision_summary: null,
    instagram_intel: null,
    status: 'new',
    last_activity_at: new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString(),
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    final_score: 72,
    location_score: 85,
    criteria_score: 60,
    scoring_reason: 'Good location, only hits 2 of 5 criteria.',
    julian_rank: null,
    is_demo: true,
  },
  {
    id: 'demo-3',
    user_id: DEMO_USER,
    platform: 'hinge',
    external_id: 'demo-hinge-003',
    name: 'Talia',
    age: 29,
    bio: 'PT. Runner. Reader of weird fiction.',
    photos_jsonb: [
      { url: 'https://images.unsplash.com/photo-1521146764736-56c929d59c83?w=800' },
      { url: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=800' },
    ],
    prompts_jsonb: [
      { question: "I'm weirdly attracted to", answer: 'People who over-explain the plot of a movie.' },
    ],
    job: 'Physical therapist',
    school: 'SDSU',
    instagram_handle: 'talia.runs',
    spotify_artists: ['Big Thief', 'Soccer Mommy'],
    birth_date: null,
    zodiac: 'Virgo',
    match_intel: {
      summary: 'Independent, witty.',
      green_flags: ['Outdoorsy', 'Shared music taste'],
      red_flags: [],
    },
    vision_summary: 'All daytime outdoor shots. Strong eye contact in primary.',
    instagram_intel: {
      summary: 'Moderate (posts weekly). Running, books, beach. Consistent aesthetic.',
      handle: 'talia.runs',
    },
    status: 'date_proposed',
    last_activity_at: new Date(NOW.getTime() - 18 * 60 * 60 * 1000).toISOString(),
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    final_score: 91,
    location_score: 95,
    criteria_score: 88,
    scoring_reason: 'Top match. Lives 2 miles away, hits 5 of 5 criteria.',
    julian_rank: 9,
    is_demo: true,
  },
  {
    id: 'demo-4',
    user_id: DEMO_USER,
    platform: 'bumble',
    external_id: 'demo-bumble-004',
    name: 'Priya',
    age: 26,
    bio: 'Grad student. Climbing. Slow mornings.',
    photos_jsonb: [
      { url: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=800' },
    ],
    prompts_jsonb: null,
    job: 'PhD student',
    school: 'UCSD',
    instagram_handle: null,
    spotify_artists: [],
    birth_date: null,
    zodiac: null,
    match_intel: null,
    vision_summary: null,
    instagram_intel: null,
    status: 'stalled',
    last_activity_at: new Date(NOW.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString(),
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    final_score: 54,
    location_score: 70,
    criteria_score: 45,
    scoring_reason: 'Minimal bio. Stalled after 3 exchanges.',
    julian_rank: null,
    is_demo: true,
  },
  {
    id: 'demo-5',
    user_id: DEMO_USER,
    platform: 'offline',
    external_id: 'demo-offline-005',
    name: 'Elena',
    age: 28,
    bio: 'Met at the Mission Beach Pilates studio.',
    photos_jsonb: [
      { url: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=800' },
      { url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800' },
    ],
    prompts_jsonb: null,
    job: 'Pilates instructor',
    school: null,
    instagram_handle: 'elena.flows',
    spotify_artists: [],
    birth_date: null,
    zodiac: 'Taurus',
    match_intel: {
      summary: 'In-person intro; highest trust signal.',
      green_flags: ['Met IRL', 'Gave number unprompted'],
      red_flags: [],
    },
    vision_summary: 'Two photos total, both candid. High authenticity signal.',
    instagram_intel: { summary: 'Private account.' },
    status: 'date_booked',
    last_activity_at: new Date(NOW.getTime() - 8 * 60 * 1000).toISOString(),
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    final_score: 95,
    location_score: 100,
    criteria_score: 93,
    scoring_reason: 'Met offline — highest-trust channel. Top criteria match. Booked for Thursday.',
    julian_rank: 10,
    is_demo: true,
  },
]

const DEMO_MESSAGES: ConversationMessage[] = [
  { id: 'm1', direction: 'outgoing', body: 'Espresso, vinyl, or winning arguments — which one do we start with?', sent_at: new Date(NOW.getTime() - 5 * 60 * 60 * 1000).toISOString() },
  { id: 'm2', direction: 'incoming', body: 'Haha okay I respect the callback. Espresso first, arguments after caffeine lands.', sent_at: new Date(NOW.getTime() - 4 * 60 * 60 * 1000).toISOString() },
  { id: 'm3', direction: 'outgoing', body: 'Deal. You have a favorite spot or should I pick?', sent_at: new Date(NOW.getTime() - 42 * 60 * 1000).toISOString() },
]

export default async function DashboardDemo({ searchParams }: { searchParams: Promise<{ view?: string; id?: string }> }) {
  // Server-side admin gate — only admin or super_admin roles can view the demo.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || (profile.role !== 'admin' && profile.role !== 'super_admin')) {
    notFound()
  }

  const sp = await searchParams
  const view = sp.view ?? 'grid'
  const id = sp.id ?? 'demo-1'

  if (view === 'detail') {
    const match = DEMO_MATCHES.find((m) => m.id === id) ?? DEMO_MATCHES[0]
    return <MatchDetail match={match} messages={DEMO_MESSAGES} clusterRisk={false} />
  }
  if (view === 'empty') {
    return (
      <div className="min-h-screen bg-black px-4 md:px-6 py-6 md:py-8">
        <div className="relative max-w-7xl mx-auto">
          <h1 className="font-display text-3xl md:text-4xl uppercase tracking-wide gold-text mb-2">
            Matches
          </h1>
          <p className="text-white/50 text-sm mb-6">Every match, ranked by score and recency.</p>
          <MatchGrid
            initialMatches={[]}
            initialHasMore={false}
            initialLastMessages={{}}
            pageSize={30}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black px-4 md:px-6 py-6 md:py-8">
      <div className="relative max-w-7xl mx-auto">
        <h1 className="font-display text-3xl md:text-4xl uppercase tracking-wide gold-text mb-2">
          Matches (demo)
        </h1>
        <p className="text-white/50 text-sm mb-6">
          Public preview for Phase D screenshots — real data lives at /dashboard/matches.
        </p>
        <MatchGrid
          initialMatches={DEMO_MATCHES}
          initialHasMore={false}
          initialLastMessages={{
            'demo-1': 'Haha okay I respect the callback. Espresso first, arguments after caffeine lands.',
            'demo-3': 'Thursday works. 7pm? The place on Adams?',
            'demo-5': 'See you Thursday!',
          }}
          pageSize={30}
        />
      </div>
    </div>
  )
}
