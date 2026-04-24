import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_AUDIO_BYTES = 25 * 1024 * 1024

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Transcription not configured' }, { status: 503 })
  }

  let incoming: FormData
  try {
    incoming = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart form with audio' }, { status: 400 })
  }

  const audio = incoming.get('audio') as File | null
  if (!audio || typeof audio === 'string') {
    return NextResponse.json({ error: 'Missing audio blob' }, { status: 400 })
  }
  if (audio.size === 0) {
    return NextResponse.json({ error: 'Empty audio' }, { status: 400 })
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'Audio too large (25MB max)' }, { status: 413 })
  }

  const language = (incoming.get('language') as string) || 'en'
  const prompt = (incoming.get('prompt') as string) || ''

  const filename = audio.name || 'audio.webm'
  const file = audio instanceof File
    ? audio
    : new File([audio as Blob], filename, { type: (audio as Blob).type || 'audio/webm' })

  const body = new FormData()
  body.append('file', file)
  body.append('model', 'whisper-1')
  body.append('response_format', 'json')
  if (language) body.append('language', language)
  if (prompt) body.append('prompt', prompt)

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
  })

  if (!res.ok) {
    const detail = await res.text()
    console.error('Whisper error:', res.status, detail)
    return NextResponse.json(
      { error: 'Transcription failed', status: res.status },
      { status: 502 }
    )
  }

  const data = (await res.json()) as { text?: string }
  return NextResponse.json({ text: data.text ?? '' })
}
