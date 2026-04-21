import Anthropic from '@anthropic-ai/sdk'
import { SupabaseClient } from '@supabase/supabase-js'

interface ReplySuggestion {
  text: string
  tone: 'witty' | 'warm' | 'direct'
  reasoning: string
  confidence: number
}

// PHASE-E (AI-8319) — platform tones rewritten to avoid em-dashes (banned glyph).
const PLATFORM_TONE: Record<string, string> = {
  Tinder: 'Keep it playful and fun. Tinder conversations are lighter, humor works best.',
  Bumble: 'Be slightly more direct and confident. Bumble users appreciate straightforwardness.',
  Hinge: 'Keep it casual and warm. Hinge conversations tend to be more relaxed and genuine.',
  iMessage: 'Match their energy. iMessage is personal, mirror their texting style closely.',
}

// PHASE-E (AI-8319) — unicode -> ASCII sanitizer to mirror agent/clapcheeks/ai/sanitizer.py.
const BANNED_CHARS: Record<string, string> = {
  '\u2014': '-',      // em-dash
  '\u2013': '-',      // en-dash
  '\u2026': '...',    // ellipsis
  '\u201c': '"',      // left curly double quote
  '\u201d': '"',      // right curly double quote
  '\u2018': "'",      // left curly single quote
  '\u2019': "'",      // right curly single quote
  '\u00a0': ' ',      // non-breaking space
  '\u2022': '*',      // bullet
  '\u00b7': '*',      // middle dot
  '\u2192': '->',     // rightward arrow
}

const CORNY_CLOSERS = [
  'looking forward to hearing from you',
  'looking forward to hearing back',
  'hope to hear from you soon',
  'let me know your thoughts',
  'have a great day',
  'feel free to reach out',
  "don't hesitate to",
]

function sanitizeDraft(text: string): string {
  if (!text) return text
  let out = text
  for (const [bad, good] of Object.entries(BANNED_CHARS)) {
    out = out.split(bad).join(good)
  }
  // Collapse runs of 3+ dashes (from em-dash replacements).
  out = out.replace(/-{3,}/g, '-')
  return out.trim()
}

function validateDraft(
  text: string,
  bannedWords: string[] = [],
  hardMaxChars = 160
): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  if (!text || !text.trim()) {
    errors.push('empty draft')
    return { ok: false, errors }
  }
  for (const bad of Object.keys(BANNED_CHARS)) {
    if (text.includes(bad)) errors.push(`banned unicode punctuation: ${bad}`)
  }
  if (text.includes(';')) errors.push('semicolon (banned)')
  const low = text.toLowerCase()
  for (const w of bannedWords) {
    if (w && low.includes(w.toLowerCase())) errors.push(`banned_word: ${w}`)
  }
  for (const closer of CORNY_CLOSERS) {
    if (low.includes(closer)) errors.push(`corny closer: ${closer}`)
  }
  if (text.length > hardMaxChars) {
    errors.push(`over hard_max_chars (${text.length} > ${hardMaxChars})`)
  }
  return { ok: errors.length === 0, errors }
}

// Renders the persona into a literal block for Claude's system prompt.
function renderPersonaBlock(persona: Record<string, unknown> | null): string {
  if (!persona) return ''
  const voiceStyle = persona.voice_style as string | undefined
  const sig = (persona.signature_phrases as string[] | undefined) || []
  const banned = (persona.banned_words as string[] | undefined) || []
  const hooks = (persona.attraction_hooks as string[] | undefined) || []
  const rules = (persona.message_formatting_rules as Record<string, unknown>) || {}

  const lines: string[] = ['=== VOICE + DRAFTING RULES (follow exactly) ===']
  if (voiceStyle) lines.push(`Voice: ${voiceStyle}`)
  if (sig.length) {
    lines.push(
      `Signature phrases I actually say (rotate naturally): ${sig.slice(0, 10).map((s) => `"${s}"`).join(', ')}`
    )
  }
  if (banned.length) {
    lines.push(`NEVER use these words or phrases: ${banned.slice(0, 30).join(', ')}`)
  }
  if (hooks.length) {
    lines.push(
      `Attraction hooks (pick AT MOST ONE relevant, never list, surface warmest-first): ${hooks.slice(0, 8).join('; ')}`
    )
  }
  if (Object.keys(rules).length) {
    lines.push('Message formatting rules (READ LITERALLY):')
    lines.push(JSON.stringify(rules, null, 2))
  }
  lines.push('')
  lines.push('CRITICAL VOICE RULES (hard constraints):')
  lines.push('- Short, sweet, to the point. Lowercase-first is natural and good.')
  lines.push('- No em-dashes, en-dashes, semicolons, ellipsis, curly quotes ever.')
  lines.push('- If you have 2+ thoughts, write separate sentences so they can be split.')
  lines.push('- Zero to one emoji max. Zero in the first 1-2 messages.')
  lines.push('- Reference something specific from HER profile in every draft.')
  lines.push('- Never sound like an AI. No corny closers. No pickup lines. No walls of text.')
  return lines.join('\n')
}

export async function generateReplies(
  supabase: SupabaseClient,
  userId: string,
  conversationContext: string,
  matchName: string,
  platform: string,
  profileContext?: string
): Promise<ReplySuggestion[]> {
  // Fetch voice profile
  const { data: voiceProfile } = await supabase
    .from('clapcheeks_voice_profiles')
    .select('style_summary, sample_phrases, tone, profile_data')
    .eq('user_id', userId)
    .single()

  // PHASE-E (AI-8319) — also load persona from clapcheeks_user_settings so the
  // persona.message_formatting_rules / banned_words / signature_phrases get
  // injected verbatim into the system prompt.
  const { data: settingsRow } = await supabase
    .from('clapcheeks_user_settings')
    .select('persona')
    .eq('user_id', userId)
    .single()
  const persona: Record<string, unknown> =
    (settingsRow?.persona as Record<string, unknown>) || {}
  const bannedWords = (persona.banned_words as string[] | undefined) || []

  const voiceContext = voiceProfile
    ? `User's texting style: ${voiceProfile.style_summary || 'casual'}
Tone preference: ${voiceProfile.tone || 'casual'}
Sample phrases they use: ${JSON.stringify(voiceProfile.sample_phrases || [])}
Style details: ${JSON.stringify(voiceProfile.profile_data || {})}`
    : 'No voice profile available. Use a casual, friendly tone.'

  const platformTone = PLATFORM_TONE[platform] || ''
  const personaBlock = renderPersonaBlock(persona) // PHASE-E

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const profileSection = profileContext
    ? `\nProfile context about the user: ${profileContext}`
    : ''

  // PHASE-E — persona block leads, so voice + formatting rules set the floor
  // before any other instruction.
  const systemPrompt = [
    personaBlock,
    '',
    'You are a dating conversation assistant for Clapcheeks.',
    "Generate reply suggestions that match the user's natural voice.",
    '',
    voiceContext,
    '',
    'Research-backed dating strategy:',
    '- Ask for a date after ~7 messages. Skip asking for phone number first (60% chance date never happens if you ask for number before date).',
    "- Reference something specific from their messages. Shows you're paying attention.",
    '- Keep messages short. Dating app messages under 160 chars get 2x more responses.',
    '- Never be creepy, desperate, or aggressive.',
    '',
    `Platform tone for ${platform}: ${platformTone}`,
    '',
    'Rules:',
    "- Match the user's texting style exactly (length, emoji, capitalization, formality)",
    '- Generate 3 replies with different styles:',
    '  1. witty. clever, humorous, shows personality',
    '  2. warm. genuine, caring, emotionally engaged',
    '  3. direct. confident, straightforward, no fluff',
    '- Each reply includes a "reasoning" field explaining why that reply works',
    '- Keep replies natural. They should sound like the user, not an AI',
    '- Consider conversation context and momentum',
    '- If the other person asked a question, answer it',
    '- Each reply max 160 characters',
    '- ABSOLUTELY no em-dashes, en-dashes, semicolons, ellipsis, curly quotes',
    '',
    'Return ONLY a JSON array of 3 suggestions, no other text.',
  ]
    .filter(Boolean)
    .join('\n')

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 768,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Conversation on ${platform} with ${matchName}:

${conversationContext}${profileSection}

Generate 3 reply options.
Return JSON: [{ "text": "reply", "tone": "witty|warm|direct", "reasoning": "why this works", "confidence": 0.0-1.0 }]`,
      },
    ],
  })

  const responseText = message.content[0].type === 'text' ? message.content[0].text : ''
  let suggestions: ReplySuggestion[]
  try {
    suggestions = JSON.parse(responseText)
  } catch {
    const match = responseText.match(/\[[\s\S]*\]/)
    if (match) {
      suggestions = JSON.parse(match[0])
    } else {
      throw new Error('Failed to parse reply suggestions from Claude response')
    }
  }

  // PHASE-E — sanitize + validate. Drop suggestions that fail hard constraints.
  const cleaned: ReplySuggestion[] = []
  for (const s of suggestions) {
    const sanitized = sanitizeDraft(s.text).slice(0, 160)
    const { ok } = validateDraft(sanitized, bannedWords, 160)
    if (ok) {
      cleaned.push({ ...s, text: sanitized })
    }
    // Bad drafts are dropped silently here; agent/drafter.py logs discards to Supabase.
  }

  // If everything got dropped, keep the originals with sanitize applied as a
  // least-bad fallback so the UI still shows something.
  const finalList = cleaned.length > 0
    ? cleaned
    : suggestions.map((s) => ({ ...s, text: sanitizeDraft(s.text).slice(0, 160) }))

  // Store suggestions
  await supabase.from('clapcheeks_reply_suggestions').insert({
    user_id: userId,
    conversation_context: conversationContext,
    suggestions: finalList,
  })

  return finalList
}
