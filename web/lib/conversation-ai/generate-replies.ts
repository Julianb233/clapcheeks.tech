import Anthropic from '@anthropic-ai/sdk'
import { SupabaseClient } from '@supabase/supabase-js'

interface ReplySuggestion {
  text: string
  tone: 'witty' | 'warm' | 'direct'
  reasoning: string
  confidence: number
}

const PLATFORM_TONE: Record<string, string> = {
  Tinder: 'Keep it playful and fun — Tinder conversations are lighter, humor works best.',
  Bumble: 'Be slightly more direct and confident — Bumble users appreciate straightforwardness.',
  Hinge: 'Keep it casual and warm — Hinge conversations tend to be more relaxed and genuine.',
  iMessage: 'Match their energy — iMessage is personal, mirror their texting style closely.',
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

  const voiceContext = voiceProfile
    ? `User's texting style: ${voiceProfile.style_summary || 'casual'}
Tone preference: ${voiceProfile.tone || 'casual'}
Sample phrases they use: ${JSON.stringify(voiceProfile.sample_phrases || [])}
Style details: ${JSON.stringify(voiceProfile.profile_data || {})}`
    : 'No voice profile available. Use a casual, friendly tone.'

  const platformTone = PLATFORM_TONE[platform] || ''

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const profileSection = profileContext
    ? `\nProfile context about the user: ${profileContext}`
    : ''

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 768,
    system: `You are a dating conversation assistant for Outward.
Generate reply suggestions that match the user's natural voice.

${voiceContext}

Research-backed dating strategy:
- Ask for a date after ~7 messages. Skip asking for phone number first (60% chance date never happens if you ask for number before date).
- Reference something specific from their messages — shows you're paying attention.
- Keep messages short — dating app messages under 160 chars get 2x more responses.
- Never be creepy, desperate, or aggressive.

Platform tone for ${platform}: ${platformTone}

Rules:
- Match the user's texting style exactly (length, emoji, capitalization, formality)
- Generate 3 replies with different styles:
  1. witty — clever, humorous, shows personality
  2. warm — genuine, caring, emotionally engaged
  3. direct — confident, straightforward, no fluff
- Each reply includes a "reasoning" field explaining why that reply works for this conversation
- Keep replies natural — they should sound like the user, not an AI
- Consider conversation context and momentum
- If the other person asked a question, answer it
- Each reply max 160 characters

Return ONLY a JSON array of 3 suggestions, no other text.`,
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

  // Enforce 160 char limit
  suggestions = suggestions.map((s) => ({
    ...s,
    text: s.text.slice(0, 160),
  }))

  // Store suggestions
  await supabase.from('clapcheeks_reply_suggestions').insert({
    user_id: userId,
    conversation_context: conversationContext,
    suggestions,
  })

  return suggestions
}
