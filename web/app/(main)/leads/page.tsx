import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import LeadsBoard, { type Lead } from './leads-board'

export const metadata: Metadata = {
  title: 'Leads — Clapcheeks',
  description: 'Kanban view of every match and where it sits in your funnel.',
}

const STAGES = [
  { key: 'matched',        label: 'Matched',        hint: 'Swiped right, no opener yet' },
  { key: 'opened',         label: 'Opened',         hint: 'Opener sent, no reply' },
  { key: 'replying',       label: 'Replying',       hint: 'Back and forth' },
  { key: 'date_proposed',  label: 'Date proposed',  hint: 'Asked — awaiting confirm' },
  { key: 'date_booked',    label: 'Date booked',    hint: 'On your calendar' },
  { key: 'date_happened',  label: 'Date done',      hint: 'Log the outcome' },
  { key: 'ongoing',        label: 'Ongoing',        hint: 'Seeing each other' },
  { key: 'dead',           label: 'Archived',       hint: 'Dormant or rejected' },
] as const

export default async function LeadsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const { data, error } = await supabase
    .from('clapcheeks_leads')
    .select(`
      id, platform, match_id, name, age, stage, stage_entered_at,
      last_message_at, last_message_by, message_count, date_asked_at,
      date_slot_iso, date_booked_at, calendar_event_link, zodiac,
      interests, prompt_themes, tag, notes, outcome, drip_fired,
      updated_at
    `)
    .eq('user_id', user.id)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(500)

  const leads: Lead[] = (data ?? []).map((row) => ({
    id: row.id,
    platform: row.platform,
    match_id: row.match_id,
    name: row.name,
    age: row.age,
    stage: row.stage,
    stageEnteredAt: row.stage_entered_at,
    lastMessageAt: row.last_message_at,
    lastMessageBy: row.last_message_by,
    messageCount: row.message_count ?? 0,
    dateAskedAt: row.date_asked_at,
    dateSlotIso: row.date_slot_iso,
    dateBookedAt: row.date_booked_at,
    calendarEventLink: row.calendar_event_link,
    zodiac: row.zodiac,
    interests: (row.interests as string[] | null) ?? [],
    promptThemes: (row.prompt_themes as string[] | null) ?? [],
    tag: row.tag,
    notes: row.notes,
    outcome: row.outcome,
    dripFired: (row.drip_fired as Record<string, number> | null) ?? {},
  }))

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <header className="max-w-[1600px] mx-auto mb-6">
        <h1 className="text-3xl font-semibold">Leads</h1>
        <p className="text-sm text-white/60 mt-1">
          Every match, every stage, every next action — one view.
        </p>
        {error && (
          <div className="mt-3 text-sm text-red-400">
            Could not load leads: {error.message}
          </div>
        )}
      </header>

      <LeadsBoard stages={STAGES as unknown as { key: string; label: string; hint: string }[]} initialLeads={leads} />
    </div>
  )
}
