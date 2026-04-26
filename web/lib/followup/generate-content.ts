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
  sequenceStep?: number
  toneHint?: string
  /** Date plan context — used for pre/post-date kinds. */
  dateContext?: { what?: string; when?: string; where?: string }
}

const SYSTEM_PROMPT = `You are Julian's dating ghostwriter. Write in his voice:
casual, confident, low-effort polish, lowercase-friendly, occasional well-placed
emoji (never more than one). No exclamation marks unless he'd actually use one.
Never apologize for following up. Never use corporate words like "circle back"
or "touch base". Match her energy. Output ONLY the message text — no preamble,
no quotes, no signature.`

const PROMPTS: Record<FollowupKind, (i: GenerateFollowupInput) => string> = {
  follow_up: (i) =>
    `Re-engagement #${(i.sequenceStep ?? 0) + 1} to ${i.matchName} on ${i.platform}.
Conversation went quiet. Reference something specific from below. Under 120 chars.

Recent conversation:
${i.conversationSummary ?? i.lastMessage ?? '(no context — light check-in)'}`,

  app_to_text: (i) =>
    `Move ${i.matchName} from ${i.platform} to text. Reference something specific.
Under 140 chars. Give a clear reason ("${i.platform} notifs are a mess" or similar).

Recent conversation:
${i.conversationSummary ?? i.lastMessage ?? '(no context)'}`,

  pre_date_confirm: (i) => {
    const what = i.dateContext?.what ?? 'our plans'
    const when = i.dateContext?.when ?? 'tomorrow'
    return `Confirm ${what} with ${i.matchName} ${when}. Casual, warm, one short
line. Keep it light — no over-eager. Under 100 chars.`
  },

  post_date_thank: (i) =>
    `Post-date thank-you to ${i.matchName} after ${i.dateContext?.what ?? 'last night'}.
Specific callback to one moment from the date if you have context. Under 120 chars.
Light, not gushing.

Date context:
${i.conversationSummary ?? '(use a generic warm callback)'}`,

  ghost_reengage: (i) =>
    `Single revival attempt for ${i.matchName}. She faded ~${i.sequenceStep ?? 7} days
ago. ONE warm callback to a specific thing she mentioned. No "hey stranger".
No "long time no talk". Under 100 chars.

Last we talked:
${i.conversationSummary ?? i.lastMessage ?? '(generic — pick a fun open)'}`,

  nudge: (i) =>
    `Light "thinking of you" to ${i.matchName} between dates. Reference something
specific, no pressure to reply, no questions. Under 90 chars.

Recent:
${i.conversationSummary ?? i.lastMessage ?? '(generic warm reference)'}`,
}

const FALLBACKS: Record<FollowupKind, (name: string) => string> = {
  follow_up: (n) => `hey ${n} — how's your week going`,
  app_to_text: (n) => `hey ${n}, this app's notifications are a black hole. text me:`,
  pre_date_confirm: (n) => `still on for tomorrow ${n}?`,
  post_date_thank: (n) => `had fun ${n} 🤙`,
  ghost_reengage: (n) => `hey ${n}, this song reminded me of you`,
  nudge: (n) => `random thought — ${n}, you'd probably love this place i found`,
}

export async function generateFollowupMessage(
  input: GenerateFollowupInput,
): Promise<string> {
  try {
    const userPrompt = PROMPTS[input.kind](input)
    const res = await chatComplete({
      systemPrompt: SYSTEM_PROMPT,
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
