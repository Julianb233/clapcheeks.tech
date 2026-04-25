import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AISettingsForm, { type Persona, type UserSettings } from './settings-form'

export const metadata: Metadata = {
  title: 'AI Settings — Clapcheeks',
  description: 'Tune the AI voice, drip rules, calendar, and approval gates.',
}

const DEFAULT_DRIP = `# Clapcheeks drip rules — each rule fires at most once per match.
#
# Triggers may reference:
#   stage, message_count, days_in_stage, hours_since_theirs,
#   hours_since_last_ours, hours_since_last_ts, date_asked, platform
#
# Actions: send_ai_reply, send_reengagement, send_date_ask,
#          send_template (args.name), advance_stage, mark_dead

templates:
  soft_bump: "hey, how's your week going?"
  confirm_date: "still good for our plan? :)"
  final_attempt: "I know it's been a minute — was hoping to catch up, still around?"

rules:
  - id: followup_2d_silent
    when: stage == "replying" and hours_since_theirs > 48 and hours_since_theirs <= 120
    do: send_reengagement

  - id: opener_ghosted_3d
    when: stage == "opened" and hours_since_last_ours > 72 and hours_since_last_ours <= 168
    do: send_template
    args: { name: soft_bump }

  - id: confirm_proposed_date_24h
    when: stage == "date_proposed" and hours_since_theirs > 24
    do: send_template
    args: { name: confirm_date }

  - id: archive_10d_dead
    when: stage in ("replying", "opened", "date_proposed") and hours_since_last_ts > 240
    do: mark_dead
`

export default async function AISettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: rows } = await supabase
    .from('clapcheeks_user_settings')
    .select('*')
    .eq('user_id', user.id)
    .limit(1)

  const row = rows?.[0]
  const persona: Persona = (row?.persona as Persona) ?? {
    first_name: '',
    age: 0,
    location: '',
    occupation: '',
    height_in: 0,
    voice_style: 'confident, playful, direct — witty without trying too hard',
    humor_flavor: 'dry, observational, a bit mischievous',
    signature_phrases: [],
    banned_words: [],
    confidence_anchors: [],
    attraction_hooks: [],
    best_stories: [],
    values: [],
    date_proposal_style: 'direct and plan-oriented — suggest a specific place + time',
    avoid_topics: [],
  }

  const settings: UserSettings = {
    persona,
    dripRulesYaml: row?.drip_rules_yaml ?? DEFAULT_DRIP,
    styleText: row?.style_text ?? '',
    dateCalendarEmail: row?.date_calendar_email ?? 'julian@aiacrobatics.com',
    dateSlots: ((row?.date_slots as string[] | null) ?? ['18:00', '20:00', '21:30']),
    dateSlotDaysAhead: row?.date_slot_days_ahead ?? 14,
    dateSlotDurationHours: Number(row?.date_slot_duration_hours ?? 2),
    dateTimezone: row?.date_timezone ?? 'America/Los_Angeles',
    approveOpeners: row?.approve_openers ?? false,
    approveReplies: row?.approve_replies ?? false,
    approveDateAsks: row?.approve_date_asks ?? true,
    approveBookings: row?.approve_bookings ?? true,
  }

  return (
    <div className="min-h-screen bg-black text-white p-6 md:p-10">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-semibold mb-1">AI Settings</h1>
        <p className="text-sm text-white/60 mb-8">
          This is where the AI learns your voice, your rizz, and when to follow up.
        </p>
        <AISettingsForm initial={settings} userId={user.id} />
      </div>
    </div>
  )
}
