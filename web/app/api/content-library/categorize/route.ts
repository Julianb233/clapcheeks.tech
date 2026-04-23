import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Phase L (AI-8340) - Auto-categorize an uploaded library item.
 *
 *   POST /api/content-library/categorize
 *   body: { media_path: string }
 *
 * Rudimentary filename/heuristic classifier. The real Claude Vision
 * call lives in the Python agent (clapcheeks.content.categorize) and
 * gets wired up when the uploader runs through a server action - this
 * fallback keeps the UX snappy and works without the agent online.
 */

const KEYWORDS: Array<[string, string]> = [
  ['surf', 'beach_active'],
  ['beach', 'beach_active'],
  ['run', 'beach_active'],
  ['yoga', 'beach_active'],
  ['pickle', 'beach_active'],
  ['dog', 'dog_faith'],
  ['church', 'dog_faith'],
  ['cross', 'dog_faith'],
  ['laptop', 'beach_house_work_from_home'],
  ['wfh', 'beach_house_work_from_home'],
  ['pool', 'beach_house_work_from_home'],
  ['stage', 'ted_talk_speaking'],
  ['ted', 'ted_talk_speaking'],
  ['speak', 'ted_talk_speaking'],
  ['mic', 'ted_talk_speaking'],
  ['office', 'entrepreneur_behind_scenes'],
  ['desk', 'entrepreneur_behind_scenes'],
  ['whiteboard', 'entrepreneur_behind_scenes'],
  ['wine', 'food_drinks_mission_beach'],
  ['sushi', 'food_drinks_mission_beach'],
  ['coffee', 'food_drinks_mission_beach'],
  ['taco', 'food_drinks_mission_beach'],
  ['mission', 'food_drinks_mission_beach'],
]

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { media_path?: string } = {}
  try {
    body = await req.json()
  } catch {
    // empty body
  }
  const mediaPath = (body.media_path || '').toLowerCase()

  // Keyword scan - matches most real upload names (phones add
  // descriptors, exports add slugs).
  let category = 'entrepreneur_behind_scenes'
  for (const [kw, cat] of KEYWORDS) {
    if (mediaPath.includes(kw)) {
      category = cat
      break
    }
  }

  // Time-of-day hint from filename.
  let targetTimeOfDay: string = 'anytime'
  if (mediaPath.includes('sunset') || mediaPath.includes('golden')) {
    targetTimeOfDay = 'golden_hour'
  } else if (mediaPath.includes('morning') || mediaPath.includes('coffee')) {
    targetTimeOfDay = 'workday'
  } else if (mediaPath.includes('evening') || mediaPath.includes('wine')) {
    targetTimeOfDay = 'evening'
  }

  return NextResponse.json({
    category,
    target_time_of_day: targetTimeOfDay,
    confidence: 0.4,
    source: 'filename_heuristic',
  })
}
