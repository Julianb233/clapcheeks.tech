import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * GET /api/cron/refresh-voice-profile
 *
 * Iterates every active conversation in clapcheeks_conversations.messages,
 * harvests the user's outbound texts (`from === 'him'`), and re-derives the
 * voice fingerprint into clapcheeks_voice_profiles. Designed to run nightly
 * after the chat.db sync so the AI's "draft reply in your voice" stays fresh
 * as Julian texts more.
 *
 * Auth: same Bearer CRON_SECRET pattern as /api/cron/restage.
 */
export async function GET(req: Request) {
  const auth = req.headers.get('authorization') || ''
  const expected = process.env.CRON_SECRET
  if (expected && auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return NextResponse.json(
      { error: 'Supabase env not configured' },
      { status: 500 },
    )
  }

  const sb = createClient(url, key, { auth: { persistSession: false } })

  // Group conversations by user.
  const { data: convos, error: cErr } = await (sb as any)
    .from('clapcheeks_conversations')
    .select('user_id, messages')
  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 500 })
  }

  const byUser = new Map<string, string[]>()
  for (const c of (convos as Array<{ user_id: string; messages: unknown }>) ?? []) {
    if (!Array.isArray(c.messages)) continue
    const arr = byUser.get(c.user_id) ?? []
    for (const m of c.messages as Array<{ from?: string; text?: string }>) {
      if (m && m.from === 'him' && typeof m.text === 'string' && m.text.trim()) {
        arr.push(m.text)
      }
    }
    byUser.set(c.user_id, arr)
  }

  const REACTION_PREFIXES = [
    'Loved “',
    'Liked “',
    'Disliked “',
    'Laughed at “',
    'Emphasized “',
    'Questioned “',
    'Reacted ',
  ]
  const NO_APO = /\b(Im|Ill|whats|dont|cant|wont|youre|its|hes|shes|theyre|im|ill)\b/
  const DOUBLE = /([a-z])\1{2,}/
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F900}-\u{1F9FF}\u{1F600}-\u{1F64F}]/gu
  const GREETINGS = ['heyyy', 'heyy', 'hey', 'hi', 'hola', 'yo', 'good morning', 'whats up']

  const results: Record<string, unknown>[] = []

  for (const [userId, raw] of byUser) {
    const out = raw.filter(
      (s) => !REACTION_PREFIXES.some((p) => s.startsWith(p)),
    )
    const n = out.length
    if (n === 0) continue

    let totalWords = 0
    let lower = 0
    let endsQ = 0
    let ellipsis = 0
    let exclam = 0
    let noApo = 0
    let doubled = 0
    const emojiCount = new Map<string, number>()
    const greetCount = new Map<string, number>()
    const phraseCount = new Map<string, number>()

    for (const msg of out) {
      const s = msg.trim()
      if (!s) continue
      const words = s.split(/\s+/)
      totalWords += words.length
      if (s.toLowerCase() === s && /[a-z]/.test(s)) lower++
      if (s.endsWith('?')) endsQ++
      if (s.includes('...')) ellipsis++
      if (s.includes('!')) exclam++
      if (NO_APO.test(s)) noApo++
      if (DOUBLE.test(s.toLowerCase())) doubled++
      const ems = s.match(EMOJI) || []
      for (const e of ems) emojiCount.set(e, (emojiCount.get(e) || 0) + 1)
      const sl = s.toLowerCase()
      for (const g of GREETINGS) {
        if (sl.startsWith(g)) {
          greetCount.set(g, (greetCount.get(g) || 0) + 1)
          break
        }
      }
      for (const k of [2, 3]) {
        for (let i = 0; i + k <= words.length; i++) {
          const ph = words.slice(i, i + k).join(' ').toLowerCase()
          if (ph.length > 3 && ph.length < 30) {
            phraseCount.set(ph, (phraseCount.get(ph) || 0) + 1)
          }
        }
      }
    }

    const sortedEmojis = [...emojiCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([k]) => k)
    const sortedGreetings = [...greetCount.entries()].sort((a, b) => b[1] - a[1])
    const topPhrases = [...phraseCount.entries()]
      .filter(([, c]) => c >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([k]) => k)
    const samplePool = [...new Set(out)]
      .filter((s) => s.length > 4 && s.length < 90)
      .slice(0, 30)

    const avg = totalWords / n
    const styleSummary =
      `Casual, often lowercase (${Math.round((100 * lower) / n)}% all-lowercase). ` +
      `Avg ${avg.toFixed(1)} words. ` +
      `Drops apostrophes ${Math.round((100 * noApo) / n)}%. ` +
      `Doubles letters for warmth ${Math.round((100 * doubled) / n)}%. ` +
      `Top emojis: ${sortedEmojis.slice(0, 8).join(' ') || '(rare)'}. ` +
      `Top greetings: ${sortedGreetings
        .slice(0, 5)
        .map(([g, c]) => `${g} (${c})`)
        .join(', ')}. ` +
      `Bursts: 2-4 short messages in quick succession.`

    const profile = {
      user_id: userId,
      tone: 'casual',
      style_summary: styleSummary,
      sample_phrases: samplePool,
      profile_data: {
        avg_words: Math.round(avg * 100) / 100,
        total_messages_analyzed: n,
        uses_lowercase_only_pct: Math.round((1000 * lower) / n) / 10,
        drops_apostrophes_pct: Math.round((1000 * noApo) / n) / 10,
        doubles_letters_for_warmth_pct: Math.round((1000 * doubled) / n) / 10,
        uses_ellipsis_pct: Math.round((1000 * ellipsis) / n) / 10,
        uses_exclamation_pct: Math.round((1000 * exclam) / n) / 10,
        ends_with_question_pct: Math.round((1000 * endsQ) / n) / 10,
        common_emojis: sortedEmojis,
        top_phrases: topPhrases,
        casual_greetings: sortedGreetings.map(([g]) => g),
      },
      messages_analyzed: n,
      updated_at: new Date().toISOString(),
    }

    const { error } = await (sb as any)
      .from('clapcheeks_voice_profiles')
      .upsert(profile, { onConflict: 'user_id' })

    results.push({ user_id: userId, n, error: error?.message ?? null })
  }

  return NextResponse.json({ ok: true, refreshed: results.length, results })
}
