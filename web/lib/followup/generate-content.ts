import Anthropic from '@anthropic-ai/sdk'

export type FollowupKind = 'follow_up' | 'app_to_text'

export type GenerateFollowupInput = {
  kind: FollowupKind
  matchName: string
  platform: string
  lastMessage?: string
  conversationSummary?: string
  sequenceStep?: number
  toneHint?: string
}

const FOLLOWUP_PROMPTS: Record<FollowupKind, (i: GenerateFollowupInput) => string> = {
  follow_up: (i) =>
    `Craft a low-pressure re-engagement text to ${i.matchName} on ${i.platform}.
This is follow-up #${(i.sequenceStep ?? 0) + 1}. The conversation has gone quiet.
Reference something specific from the conversation below, keep it warm, under 120 chars,
no desperation, no apologies for following up.

Recent conversation:
${i.conversationSummary ?? i.lastMessage ?? '(no context available — use a light check-in)'}

Return ONLY the message text, no quotes, no preamble.`,

  app_to_text: (i) =>
    `The conversation with ${i.matchName} on ${i.platform} is warm enough to move to text.
Write a single message that naturally transitions to text. Reference something specific
from the conversation. Keep it short (under 140 chars), confident, and give a clear reason
(e.g. "${i.platform} notifications are a mess").

Recent conversation:
${i.conversationSummary ?? i.lastMessage ?? '(no context — keep it casual and specific)'}

Return ONLY the message text, no quotes, no preamble.`,
}

const FALLBACKS: Record<FollowupKind, (name: string) => string> = {
  follow_up: (name) => `hey ${name} — how's your week going?`,
  app_to_text: (name) => `hey ${name}, these app notifications are a black hole. text me: `,
}

export async function generateFollowupMessage(
  input: GenerateFollowupInput,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return FALLBACKS[input.kind](input.matchName)
  }

  try {
    const anthropic = new Anthropic({ apiKey })
    const prompt = FOLLOWUP_PROMPTS[input.kind](input)
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 160,
      messages: [{ role: 'user', content: prompt }],
    })
    const block = res.content.find((b) => b.type === 'text')
    const text = block && block.type === 'text' ? block.text.trim() : ''
    if (!text) return FALLBACKS[input.kind](input.matchName)
    return text.replace(/^["']+|["']+$/g, '').slice(0, 280)
  } catch {
    return FALLBACKS[input.kind](input.matchName)
  }
}
