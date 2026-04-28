import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Shape consumed by web/app/(main)/intelligence/page.tsx (interface ABResult).
type ABStyle = { style: string; sent: number; reply_rate: number }
type ABResponse = {
  styles: ABStyle[]
  winner: string | null
  not_yet_available?: boolean
  missing_tables?: string[]
}

const isMissingTableError = (err: unknown): boolean => {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: string; message?: string }
  if (e.code === 'PGRST205' || e.code === 'PGRST116' || e.code === '42P01') return true
  if (typeof e.message === 'string') {
    const m = e.message.toLowerCase()
    return m.includes('does not exist') || m.includes('not found in the schema cache')
  }
  return false
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const since = new Date()
  since.setDate(since.getDate() - 30)

  const { data, error } = await supabase
    .from('clapcheeks_opener_log')
    .select('opener_style, got_reply')
    .eq('user_id', user.id)
    .gte('created_at', since.toISOString())
    .not('opener_style', 'is', null)

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json<ABResponse>({
        styles: [],
        winner: null,
        not_yet_available: true,
        missing_tables: ['clapcheeks_opener_log'],
      })
    }
    return NextResponse.json(
      { error: error.message ?? 'Failed to load opener log' },
      { status: 500 },
    )
  }

  const styles: Record<string, { style: string; total: number; replied: number }> = {}
  for (const row of data ?? []) {
    const style = (row.opener_style ?? 'default').toString()
    if (!styles[style]) styles[style] = { style, total: 0, replied: 0 }
    styles[style].total++
    if (row.got_reply) styles[style].replied++
  }

  const results: ABStyle[] = Object.values(styles)
    .map((s) => ({
      style: s.style,
      sent: s.total,
      reply_rate: s.total > 0 ? Math.round((s.replied / s.total) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.reply_rate - a.reply_rate)

  // Statistical significance: declare a winner only when we have at least 2
  // styles, the leader has >= 10 sends, and the lead is at least 5 percentage
  // points. Otherwise return winner=null so the UI shows "still gathering".
  let winner: string | null = null
  if (results.length >= 2) {
    const [first, second] = results
    if (first.sent >= 10 && first.reply_rate - second.reply_rate >= 0.05) {
      winner = first.style
    }
  } else if (results.length === 1 && results[0].sent >= 10) {
    winner = results[0].style
  }

  return NextResponse.json<ABResponse>({ styles: results, winner })
}
