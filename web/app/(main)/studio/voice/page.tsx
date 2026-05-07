/**
 * /studio/voice — Voice Training UI (AI-8763).
 *
 * Server component: pulls the latest voice profile + digest for the
 * authed user, then hands off to the client component for interaction
 * (re-train trigger, tone calibration picks, stats display).
 */
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import VoiceStudioClient, { type VoiceProfile } from './voice-studio-client'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'

// AI-9537: voice_profiles on Convex.

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Voice Training',
}

export default async function VoiceStudioPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let profile: VoiceProfile | null = null
  try {
    const convex = getConvexServerClient()
    const data = await convex.query(api.voice.getProfile, { user_id: user.id })
    profile = (data as unknown as VoiceProfile | null) ?? null
  } catch {
    // empty-state path; client handles
    profile = null
  }

  return <VoiceStudioClient initialProfile={profile} />
}

