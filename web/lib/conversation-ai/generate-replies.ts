import Anthropic from '@anthropic-ai/sdk'
import { SupabaseClient } from '@supabase/supabase-js'

interface ReplySuggestion {
  text: string
  tone: 'playful' | 'direct' | 'flirty'
  confidence: number
}

export async function generateReplies(
  supabase: SupabaseClient,
  userId: string,
  conversationContext: string,
  matchName: string,
  platform: string
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

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: `You are a dating conversation assistant for Outward.
Generate reply suggestions that match the user's natural voice.

${voiceContext}

Rules:
- Match the user's texting style exactly (length, emoji, capitalization, formality)
- Generate 3 replies with different tones: playful, direct, flirty
- Keep replies natural -- they should sound like the user, not an AI
- Consider conversation context and momentum
- If the other person asked a question, answer it
- Never be creepy, desperate, or aggressive
- Keep it concise -- each reply max 160 characters
- Dating app messages should be short

Return ONLY a JSON array of 3 suggestions, no other text.`,
    messages: [
      {
        role: 'user',
        content: `Conversation on ${platform} with ${matchName}:

${conversationContext}

Generate 3 reply options.
Return JSON: [{ "text": "reply", "tone": "playful|direct|flirty", "confidence": 0.0-1.0 }]`,
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
