import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { image, filename } = await req.json()

    if (!image || typeof image !== 'string') {
      return NextResponse.json({ error: 'Missing image data' }, { status: 400 })
    }

    // Strip data URL prefix (e.g. "data:image/jpeg;base64,") to get raw base64
    const base64Data = image.includes(',') ? image.split(',')[1] : image

    const aiUrl = process.env.NEXT_PUBLIC_AI_URL || 'http://localhost:8000'
    const res = await fetch(`${aiUrl}/photos/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_base64: base64Data, filename }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error('AI service error:', res.status, text)
      return NextResponse.json(
        { error: 'AI scoring service unavailable' },
        { status: 502 }
      )
    }

    const scores = await res.json()
    return NextResponse.json(scores)
  } catch (error) {
    console.error('Photo scoring error:', error)
    return NextResponse.json(
      { error: 'Failed to score photo' },
      { status: 500 }
    )
  }
}
