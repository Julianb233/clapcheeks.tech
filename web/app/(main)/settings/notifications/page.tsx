import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import NotificationPrefsForm, {
  type NotificationPrefs,
} from './notification-prefs-form'

export const metadata: Metadata = {
  title: 'Notifications - Clapcheeks',
  description: 'Choose how the agent reaches you when something important happens.',
}

const DEFAULT_PREFS: NotificationPrefs = {
  email: '',
  phone_e164: '',
  channels_per_event: {
    date_booked: ['email', 'imessage'],
    ban_detected: ['email', 'imessage'],
    new_match: [],
    draft_queued: [],
    token_expiring: ['email'],
  },
  quiet_hours_start: 21,
  quiet_hours_end: 8,
}

export default async function NotificationsSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const { data: row } = await supabase
    .from('clapcheeks_notification_prefs')
    .select('email, phone_e164, channels_per_event, quiet_hours_start, quiet_hours_end')
    .eq('user_id', user.id)
    .maybeSingle()

  const initial: NotificationPrefs = {
    email: row?.email ?? user.email ?? '',
    phone_e164:
      row?.phone_e164 ??
      ((user.user_metadata as { phone?: string } | null)?.phone || ''),
    channels_per_event: {
      ...DEFAULT_PREFS.channels_per_event,
      ...((row?.channels_per_event as NotificationPrefs['channels_per_event']) || {}),
    },
    quiet_hours_start: row?.quiet_hours_start ?? DEFAULT_PREFS.quiet_hours_start,
    quiet_hours_end: row?.quiet_hours_end ?? DEFAULT_PREFS.quiet_hours_end,
  }

  return (
    <div className="min-h-screen bg-black text-white p-6 md:p-10">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-semibold mb-1">Notifications</h1>
        <p className="text-sm text-white/60 mb-8">
          Pick which channels reach you for each event. The agent fans events
          out to email, iMessage, and (soon) web push based on what you flip on
          here.
        </p>
        <NotificationPrefsForm initial={initial} />
      </div>
    </div>
  )
}
