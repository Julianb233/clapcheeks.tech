import { chatComplete } from '@/lib/conversation-ai/llm-provider'

export type FollowupKind =
  | 'follow_up'
  | 'app_to_text'
  | 'pre_date_confirm'
  | 'post_date_thank'
  | 'ghost_reengage'
  | 'nudge'

export type GenerateFollowupInput = {
  kind: FollowupKind
  matchName: string
  platform: string
  lastMessage?: string
  conversationSummary?: string
  /** Last 10 messages [{from:'her'|'him', text}]. Beats summary for groundedness. */
  conversationHistory?: Array<{ from?: string; text?: string }>
  sequenceStep?: number
  toneHint?: string
  /** Date plan context — used for pre/post-date kinds. */
  dateContext?: { what?: string; when?: string; where?: string }
  /** Voice profile from clapcheeks_voice_profiles — drives the system prompt. */
  voiceProfile?: {
    style_summary?: string
    sample_phrases?: string[]
    tone?: string
  }
}

const FALLBACK_VOICE = `casual, lowercase-friendly, short messages, no emojis unless one fits, no exclamation marks, no apologies, never desperate.`

function buildSystemPrompt(voice?: GenerateFollowupInput['voiceProfile']): string {
  const style = voice?.style_summary?.trim() || FALLBACK_VOICE
  const samples = (voice?.sample_phrases ?? []).slice(0, 8)
  const sampleBlock = samples.length
    ? `\n\nExamples of his actual texting voice (use as tone reference, do NOT copy verbatim):\n${samples.map((s) => `  - "${s}"`).join('\n')}`
    : ''
  return `You are Julian's dating ghostwriter. Write in his voice.

Voice profile:
${style}${sampleBlock}

Hard rules:
- Output ONLY the message text — no preamble, no quotes, no signature
- Never invent shared memories. If you don't see it in conversation history, don't reference it
- Match her energy from the conversation
- No corporate/generic phrases ("circle back", "touch base", "hope you're well")
- No apologies for following up`
}

const PROMPTS: Record<FollowupKind, (i: GenerateFollowupInput, ctx: string) => string> = {
  follow_up: (i, ctx) =>
    `Re-engagement #${(i.sequenceStep ?? 0) + 1} to ${i.matchName} on ${i.platform}.
Conversation went quiet ${i.sequenceStep ? `(${(i.sequenceStep + 1) * 24}+ hours)` : ''}.
${ctx ? 'Reference something specific from the conversation below.' : 'No conversation context — use a light, generic check-in. DO NOT invent context.'}
Under 100 chars. Lowercase OK.

${ctx}`,

  app_to_text: (i, ctx) =>
    `Move ${i.matchName} from ${i.platform} to text/iMessage. Reference something specific
${ctx ? 'from the conversation below' : '(but don\'t invent shared memories — keep it about the platform)'}.
Under 140 chars. Give a clear reason ("${i.platform} notifs are a mess" or similar).

${ctx}`,

  pre_date_confirm: (i) => {
    const what = i.dateContext?.what ?? 'our plans'
    const when = i.dateContext?.when ?? 'tomorrow'
    return `Confirm ${what} with ${i.matchName} ${when}. Casual, warm, ONE short
line. No over-eager. Under 80 chars. Examples: "still on for tomorrow?" / "we still good for ${when}?"`
  },

  post_date_thank: (i, ctx) =>
    `Post-date message to ${i.matchName} after ${i.dateContext?.what ?? 'last night'}.
${ctx ? 'Specific callback to ONE thing from below if helpful.' : 'No specific date context — keep it warm but generic. DO NOT invent a moment.'}
Under 100 chars. Light, not gushing. No "thanks for".

${ctx}`,

  ghost_reengage: (i, ctx) =>
    `Single revival attempt for ${i.matchName}. She faded ~${i.sequenceStep ?? 7} days ago.
${ctx ? 'ONE warm callback to a specific thing she mentioned in the convo below.' : 'No conversation context. Use ONE light, neutral opener about something current (a song, a meme topic, weather). DO NOT invent shared memories.'}
No "hey stranger". No "long time no talk". Under 90 chars.

${ctx}`,

  nudge: (i, ctx) =>
    `Light "thinking of you" to ${i.matchName} between dates. ${ctx ? 'Reference something specific from below.' : 'Generic warm reference, no invented memories.'}
No pressure to reply. No questions. Under 80 chars.

${ctx}`,
}

const FALLBACKS: Record<FollowupKind, (name: string) => string> = {
  follow_up: (n) => `hey ${n} how's the week going`,
  app_to_text: (n) => `hey ${n}, this app's a black hole. text me:`,
  pre_date_confirm: (n) => `still on for tomorrow ${n}?`,
  post_date_thank: (n) => `had fun last night ${n}`,
  ghost_reengage: (n) => `${n} this song just made me think of you`,
  nudge: (n) => `${n} hope your week's going well`,
}

function buildContextBlock(input: GenerateFollowupInput): string {
  const history = input.conversationHistory ?? []
  if (history.length > 0) {
    const lines = history
      .slice(-10)
      .filter((m) => m && m.text)
      .map((m) => {
        const who = m.from === 'him' || m.from === 'me' ? 'You' : input.matchName
        return `${who}: ${(m.text ?? '').replace(/\n/g, ' ').slice(0, 200)}`
      })
    if (lines.length > 0) return `Recent conversation (real, do not invent beyond this):\n${lines.join('\n')}`
  }
  if (input.conversationSummary) {
    return `Conversation summary:\n${input.conversationSummary}`
  }
  if (input.lastMessage) {
    return `Last message from her:\n"${input.lastMessage}"`
  }
  return ''
}

export async function generateFollowupMessage(
  input: GenerateFollowupInput,
): Promise<string> {
  try {
    const systemPrompt = buildSystemPrompt(input.voiceProfile)
    const ctx = buildContextBlock(input)
    const userPrompt = PROMPTS[input.kind](input, ctx)
    const res = await chatComplete({
      systemPrompt,
      userPrompt,
      maxTokens: 160,
      temperature: 0.85,
      fast: true,
    })
    const text = (res.text || '').trim().replace(/^["']+|["']+$/g, '')
    if (!text) return FALLBACKS[input.kind](input.matchName)
    return text.slice(0, 280)
  } catch {
    return FALLBACKS[input.kind](input.matchName)
  }
}
