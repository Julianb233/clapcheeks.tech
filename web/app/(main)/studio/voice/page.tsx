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

  const { data, error } = await supabase
    .from('clapcheeks_voice_profiles')
    .select(
      'user_id, style_summary, tone, sample_phrases, profile_data, ' +
        'messages_analyzed, digest, boosted_samples, last_scan_at, updated_at'
    )
    .eq('user_id', user.id)
    .maybeSingle()

  // maybeSingle() returns the row or null. Treat any read error as "no
  // profile yet" rather than crashing — the client component handles the
  // empty state with onboarding instructions.
  const profile = error ? null : (data as unknown as VoiceProfile | null)

  return <VoiceStudioClient initialProfile={profile} />
}

