#!/usr/bin/env tsx
/**
 * Seed 5 demo matches into clapcheeks_matches for local/dev usage.
 *
 * Usage:
 *   cd web && npx tsx scripts/seed-demo-matches.ts <user_id>
 *
 * Requires env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * All rows are inserted with is_demo=true so they can be nuked later via:
 *   DELETE FROM clapcheeks_matches WHERE is_demo = true;
 *
 * Phase A (AI-8315) owns the schema. If this script fails with
 * "relation clapcheeks_matches does not exist", wait for Phase A to land.
 */

import { createClient } from '@supabase/supabase-js'

const DEMO_MATCHES = [
  {
    external_id: 'demo-hinge-001',
    platform: 'hinge',
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
    zodiac: 'Libra',
    match_intel: {
      summary: 'High-energy, creative. Asks thoughtful questions.',
      green_flags: ['Replies within 2h consistently', 'Uses complete sentences'],
      red_flags: [],
    },
    vision_summary:
      'Balanced photo set: two portraits, one group shot, one activity. Warm outdoor lighting in 3 of 5. Genuine smile in primary.',
    instagram_intel: {
      summary: 'Active (posts 3x/week). Fitness and cafe culture. Low red flags.',
      handle: 'sofia.moves',
    },
    status: 'conversing',
    final_score: 87,
    location_score: 92,
    criteria_score: 83,
    scoring_reason: 'Lives within 5 miles. Hits 4 of 5 criteria: fitness, creative career, pets, non-smoker.',
    last_activity_at: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
  },
  {
    external_id: 'demo-tinder-002',
    platform: 'tinder',
    name: 'Marisol',
    age: 24,
    bio: 'Architect. Travel junkie. Sunday pancakes.',
    photos_jsonb: [
      { url: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=800' },
      { url: 'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=800' },
    ],
    prompts_jsonb: [],
    job: 'Architect',
    school: null,
    instagram_handle: null,
    spotify_artists: ['Caamp', 'Noah Kahan'],
    zodiac: 'Gemini',
    match_intel: {
      summary: 'Jet-setter lifestyle. Likely busy.',
      green_flags: ['Career-driven'],
      red_flags: ['Traveling next 2 weeks per bio'],
    },
    vision_summary: null,
    instagram_intel: null,
    status: 'new',
    final_score: 72,
    location_score: 85,
    criteria_score: 60,
    scoring_reason: 'Good location match but only hits 2 of 5 criteria. Travel schedule may slow down replies.',
    last_activity_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
  },
  {
    external_id: 'demo-hinge-003',
    platform: 'hinge',
    name: 'Talia',
    age: 29,
    bio: 'PT. Runner. Reader of weird fiction.',
    photos_jsonb: [
      { url: 'https://images.unsplash.com/photo-1521146764736-56c929d59c83?w=800' },
      { url: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=800' },
      { url: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=800' },
      { url: 'https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?w=800' },
    ],
    prompts_jsonb: [
      { question: "I'm weirdly attracted to", answer: 'People who over-explain the plot of a movie.' },
    ],
    job: 'Physical therapist',
    school: 'SDSU',
    instagram_handle: 'talia.runs',
    spotify_artists: ['Big Thief', 'Soccer Mommy'],
    zodiac: 'Virgo',
    match_intel: {
      summary: 'Independent, witty. Low overlap with prior stalls.',
      green_flags: ['Outdoorsy', 'Shares music taste overlap'],
      red_flags: [],
    },
    vision_summary:
      'All daytime outdoor shots. Strong eye contact in primary. No red flags on photo composition.',
    instagram_intel: {
      summary: 'Moderate (posts weekly). Running, books, beach. Consistent aesthetic.',
      handle: 'talia.runs',
    },
    status: 'date_proposed',
    final_score: 91,
    location_score: 95,
    criteria_score: 88,
    scoring_reason:
      'Top match. Lives 2 miles away, hits 5 of 5 criteria, shared taste in music and outdoor activity.',
    last_activity_at: new Date(Date.now() - 1000 * 60 * 60 * 18).toISOString(),
  },
  {
    external_id: 'demo-bumble-004',
    platform: 'bumble',
    name: 'Priya',
    age: 26,
    bio: 'Grad student. Climbing. Slow mornings.',
    photos_jsonb: [
      { url: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=800' },
    ],
    prompts_jsonb: [],
    job: 'PhD student',
    school: 'UCSD',
    instagram_handle: null,
    spotify_artists: [],
    zodiac: null,
    match_intel: null,
    vision_summary: null,
    instagram_intel: null,
    status: 'stalled',
    final_score: 54,
    location_score: 70,
    criteria_score: 45,
    scoring_reason: 'Minimal bio data. Stalled after 3 exchanges.',
    last_activity_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 6).toISOString(),
  },
  {
    external_id: 'demo-offline-005',
    platform: 'offline',
    name: 'Elena',
    age: 28,
    bio: 'Met at the Mission Beach Pilates studio. Gave me her number after 4 visits.',
    photos_jsonb: [
      { url: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=800' },
      { url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800' },
    ],
    prompts_jsonb: [],
    job: 'Pilates instructor',
    school: null,
    instagram_handle: 'elena.flows',
    spotify_artists: [],
    zodiac: 'Taurus',
    match_intel: {
      summary: 'In-person intro; highest trust signal of the cohort.',
      green_flags: ['Met IRL', 'Gave number unprompted'],
      red_flags: [],
      cluster_risk: false,
    },
    vision_summary:
      'Two photos total, both candid. High authenticity signal — no filter abuse.',
    instagram_intel: {
      summary: 'Private account. Limited intel until follow request accepted.',
    },
    status: 'date_booked',
    final_score: 95,
    location_score: 100,
    criteria_score: 93,
    scoring_reason:
      'Met offline — highest-trust channel. Top criteria match. Already booked for Thursday.',
    last_activity_at: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
  },
] as const

async function main() {
  const userId = process.argv[2]
  if (!userId) {
    console.error('Usage: npx tsx scripts/seed-demo-matches.ts <user_id>')
    process.exit(1)
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var.')
    process.exit(1)
  }
  const supabase = createClient(url, key)

  const rows = DEMO_MATCHES.map((m) => ({
    user_id: userId,
    ...m,
    is_demo: true,
    julian_rank: null,
    birth_date: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }))

  const { data, error } = await supabase
    .from('clapcheeks_matches')
    .upsert(rows, { onConflict: 'user_id,external_id', ignoreDuplicates: false })
    .select('id, name')
  if (error) {
    console.error('Seed failed:', error.message)
    process.exit(1)
  }
  console.log('Seeded matches:')
  for (const r of data ?? []) console.log(`  - ${r.name ?? '(unknown)'} [${r.id}]`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
