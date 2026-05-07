import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'

// AI-9537: migrated from Supabase clapcheeks_voice_profiles to Convex voice_profiles.

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const convex = getConvexServerClient()
  const data = await convex.query(api.voice.getProfile, { user_id: user.id })

  return NextResponse.json({ profile: data || null })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { sampleMessages } = body

  if (!sampleMessages || !Array.isArray(sampleMessages) || sampleMessages.length < 3) {
    return NextResponse.json(
      { error: 'Provide at least 3 sample messages to analyze your voice' },
      { status: 400 }
    )
  }

  // Analyze voice using Claude
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: `You analyze texting style from sample messages. Extract a voice profile.

Return ONLY a JSON object with these fields:
{
  "style_summary": "1-2 sentence description of their texting style",
  "tone": "casual|formal|playful",
  "sample_phrases": ["common phrases they use"],
  "profile_data": {
    "avg_message_length": number,
    "emoji_frequency": "none|rare|moderate|heavy",
    "formality": "formal|neutral|casual|very_casual",
    "humor_style": "dry|playful|sarcastic|none",
    "punctuation_style": "formal|standard|minimal|none",
    "capitalization": "proper|mixed|lowercase",
    "response_length_preference": "short|medium|long"
  }
}`,
    messages: [
      {
        role: 'user',
        content: `Analyze these sample messages and extract my texting style profile:\n\n${sampleMessages.map((m: string, i: number) => `${i + 1}. "${m}"`).join('\n')}`,
      },
    ],
  })

  const responseText = message.content[0].type === 'text' ? message.content[0].text : ''
  let profileData
  try {
    profileData = JSON.parse(responseText)
  } catch {
    const match = responseText.match(/\{[\s\S]*\}/)
    if (match) {
      profileData = JSON.parse(match[0])
    } else {
      return NextResponse.json(
        { error: 'Failed to analyze voice profile' },
        { status: 500 }
      )
    }
  }

  // Upsert voice profile
  try {
    const convex = getConvexServerClient()
    await convex.mutation(api.voice.upsertProfile, {
      user_id: user.id,
      style_summary: profileData.style_summary,
      sample_phrases: profileData.sample_phrases || [],
      tone: profileData.tone || 'casual',
      profile_data: profileData.profile_data || {},
      messages_analyzed: sampleMessages.length,
    })
    const data = await convex.query(api.voice.getProfile, { user_id: user.id })
    return NextResponse.json({ profile: data })
  } catch (err) {
    console.error('Voice profile error:', err)
    return NextResponse.json(
      { error: 'Failed to save voice profile' },
      { status: 500 }
    )
  }
}
