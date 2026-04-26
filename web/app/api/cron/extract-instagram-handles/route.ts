import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { findHandleInMessages } from '@/lib/instagram-extractor'

// GET /api/cron/extract-instagram-handles?secret=...
// Hourly sweep: walk every active match's conversation, run the parser,
// fill in instagram_handle where missing or where we now have a higher-
// confidence find.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret')
  const vercelCron = req.headers.get('user-agent')?.includes('vercel-cron')
  if (!vercelCron && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  // Pull all active matches + their conversations together.
  const { data: matches } = await supabase
    .from('clapcheeks_matches')
    .select('id, user_id, match_id, instagram_handle, match_intel')
    .not('stage', 'in', '("archived","archived_cluster_dupe")')
    .returns<Array<{
      id: string; user_id: string; match_id: string;
      instagram_handle: string | null;
      match_intel: Record<string, unknown> | null;
    }>>()

  if (!matches || matches.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, updated: 0 })
  }

  // Fetch conversations in parallel, keyed by (user_id, match_id).
  const matchIds = matches.map(m => m.match_id).filter(Boolean)
  const { data: convs } = await supabase
    .from('clapcheeks_conversations')
    .select('user_id, match_id, messages')
    .in('match_id', matchIds)
    .returns<Array<{ user_id: string; match_id: string; messages: unknown }>>()

  const convByKey = new Map<string, unknown>()
  for (const c of convs ?? []) {
    convByKey.set(`${c.user_id}::${c.match_id}`, c.messages)
  }

  let updated = 0
  const found_log: Array<{ match_id: string; handle: string; confidence: number }> = []
  for (const m of matches) {
    const messages = convByKey.get(`${m.user_id}::${m.match_id}`)
    const found = findHandleInMessages(messages)
    if (!found) continue

    const intel = m.match_intel ?? {}
    const prevConfidence = (intel.instagram_handle_confidence as number) ?? 0
    const wasManual = intel.instagram_handle_source === 'manual'
    if (wasManual && m.instagram_handle) continue
    if (m.instagram_handle === found.handle) continue
    if (found.confidence < prevConfidence) continue

    const { error } = await supabase
      .from('clapcheeks_matches')
      .update({
        instagram_handle: found.handle,
        instagram_fetched_at: new Date().toISOString(),
        match_intel: {
          ...intel,
          instagram_handle_source: 'message_parser',
          instagram_handle_confidence: found.confidence,
          instagram_handle_matched_text: found.matched_text,
        },
      })
      .eq('id', m.id)

    if (!error) {
      updated++
      found_log.push({ match_id: m.match_id, handle: found.handle, confidence: found.confidence })
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: matches.length,
    updated,
    found: found_log,
  })
}
