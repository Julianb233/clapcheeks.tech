'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { DateRecord } from '@/lib/dates/types'
import { format, parseISO, isAfter, isBefore, addDays } from 'date-fns'

interface Props {
  dates: DateRecord[]
  onUpdateDate: (date: DateRecord) => void
  onCancelDate: (id: string) => void
}

export default function CalendarTab({ dates, onUpdateDate, onCancelDate }: Props) {
  const [showNewForm, setShowNewForm] = useState(false)
  const [newDate, setNewDate] = useState({ title: '', match_name: '', venue_name: '', venue_address: '', scheduled_at: '', estimated_cost: '' })
  const [creating, setCreating] = useState(false)
  const [calendarConnected] = useState(false) // TODO: check actual Google Calendar connection

  const sortedDates = [...dates].sort((a, b) => {
    if (!a.scheduled_at) return 1
    if (!b.scheduled_at) return -1
    return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
  })

  const now = new Date()
  const thisWeek = sortedDates.filter(d => d.scheduled_at && isAfter(parseISO(d.scheduled_at), now) && isBefore(parseISO(d.scheduled_at), addDays(now, 7)))
  const later = sortedDates.filter(d => d.scheduled_at && isAfter(parseISO(d.scheduled_at), addDays(now, 7)))
  const unscheduled = sortedDates.filter(d => !d.scheduled_at)

  const handleCreate = async () => {
    setCreating(true)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('clapcheeks_dates')
      .insert({
        title: newDate.title,
        match_name: newDate.match_name || undefined,
        venue_name: newDate.venue_name || undefined,
        venue_address: newDate.venue_address || undefined,
        scheduled_at: newDate.scheduled_at || undefined,
        estimated_cost: newDate.estimated_cost ? Number(newDate.estimated_cost) : undefined,
        status: newDate.scheduled_at ? 'planned' : 'idea',
      })
      .select()
      .single()

    if (!error && data) {
      onUpdateDate(data as DateRecord)
      setNewDate({ title: '', match_name: '', venue_name: '', venue_address: '', scheduled_at: '', estimated_cost: '' })
      setShowNewForm(false)
    }
    setCreating(false)
  }

  const handleConfirm = async (id: string) => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('clapcheeks_dates')
      .update({ status: 'confirmed' })
      .eq('id', id)
      .select()
      .single()

    if (!error && data) onUpdateDate(data as DateRecord)
  }

  const handleCancel = async (id: string) => {
    const supabase = createClient()
    await supabase.from('clapcheeks_dates').update({ status: 'cancelled' }).eq('id', id)
    onCancelDate(id)
  }

  return (
    <div className="space-y-6">
      {/* Google Calendar connection banner */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${calendarConnected ? 'bg-green-400' : 'bg-white/20'}`} />
          <div>
            <p className="text-white text-sm font-medium">Google Calendar</p>
            <p className="text-white/40 text-xs">
              {calendarConnected ? 'Connected — dates sync automatically' : 'Connect to sync dates to your calendar'}
            </p>
          </div>
        </div>
        <button
          className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
            calendarConnected
              ? 'bg-green-500/10 text-green-400 border border-green-500/20'
              : 'bg-white/5 text-white/60 border border-white/10 hover:bg-white/10'
          }`}
          disabled={calendarConnected}
        >
          {calendarConnected ? 'Connected' : 'Connect Calendar'}
        </button>
      </div>

      {/* New date button/form */}
      {!showNewForm ? (
        <button
          onClick={() => setShowNewForm(true)}
          className="w-full py-3 rounded-xl border border-dashed border-white/20 text-white/50 text-sm hover:border-yellow-500/40 hover:text-yellow-300 transition-all"
        >
          + Plan a New Date
        </button>
      ) : (
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5 space-y-3">
          <h3 className="text-white font-medium text-sm">New Date</h3>
          <input
            type="text"
            placeholder="Date title (e.g. 'Coffee with Sarah')"
            value={newDate.title}
            onChange={e => setNewDate(p => ({ ...p, title: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg bg-black/50 border border-white/10 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-yellow-500/50"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Their name"
              value={newDate.match_name}
              onChange={e => setNewDate(p => ({ ...p, match_name: e.target.value }))}
              className="px-3 py-2 rounded-lg bg-black/50 border border-white/10 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-yellow-500/50"
            />
            <input
              type="text"
              placeholder="Venue"
              value={newDate.venue_name}
              onChange={e => setNewDate(p => ({ ...p, venue_name: e.target.value }))}
              className="px-3 py-2 rounded-lg bg-black/50 border border-white/10 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-yellow-500/50"
            />
            <input
              type="datetime-local"
              value={newDate.scheduled_at}
              onChange={e => setNewDate(p => ({ ...p, scheduled_at: e.target.value }))}
              className="px-3 py-2 rounded-lg bg-black/50 border border-white/10 text-white text-sm focus:outline-none focus:border-yellow-500/50"
            />
            <input
              type="number"
              placeholder="Estimated cost ($)"
              value={newDate.estimated_cost}
              onChange={e => setNewDate(p => ({ ...p, estimated_cost: e.target.value }))}
              className="px-3 py-2 rounded-lg bg-black/50 border border-white/10 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-yellow-500/50"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!newDate.title || creating}
              className="px-5 py-2 rounded-lg bg-gradient-to-r from-yellow-500 to-red-600 text-black font-semibold text-xs disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
            <button
              onClick={() => setShowNewForm(false)}
              className="px-4 py-2 rounded-lg bg-white/5 text-white/50 text-xs border border-white/10"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* This week */}
      {thisWeek.length > 0 && (
        <DateSection title="This Week" dates={thisWeek} onConfirm={handleConfirm} onCancel={handleCancel} />
      )}

      {/* Later */}
      {later.length > 0 && (
        <DateSection title="Coming Up" dates={later} onConfirm={handleConfirm} onCancel={handleCancel} />
      )}

      {/* Unscheduled */}
      {unscheduled.length > 0 && (
        <DateSection title="Unscheduled" dates={unscheduled} onConfirm={handleConfirm} onCancel={handleCancel} />
      )}

      {/* Empty state */}
      {dates.length === 0 && !showNewForm && (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">📅</div>
          <p className="text-white/50 text-sm">No upcoming dates. Plan one above or generate ideas from the Ideas tab.</p>
        </div>
      )}
    </div>
  )
}

function DateSection({ title, dates, onConfirm, onCancel }: { title: string; dates: DateRecord[]; onConfirm: (id: string) => void; onCancel: (id: string) => void }) {
  return (
    <div>
      <h3 className="text-white/60 text-xs uppercase tracking-wider mb-3">{title}</h3>
      <div className="space-y-2">
        {dates.map(date => (
          <div key={date.id} className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-2 h-2 rounded-full shrink-0 ${date.status === 'confirmed' ? 'bg-green-400' : 'bg-yellow-400'}`} />
              <div className="min-w-0">
                <p className="text-white font-medium text-sm truncate">{date.title}</p>
                <div className="flex items-center gap-2 text-white/40 text-xs mt-0.5">
                  {date.match_name && <span>{date.match_name}</span>}
                  {date.venue_name && <span>@ {date.venue_name}</span>}
                  {date.scheduled_at && <span>{format(parseISO(date.scheduled_at), 'EEE, MMM d · h:mm a')}</span>}
                </div>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              {date.status === 'planned' && (
                <button onClick={() => onConfirm(date.id)} className="px-3 py-1 rounded-lg bg-green-500/10 text-green-400 text-xs border border-green-500/20 hover:bg-green-500/20 transition-all">
                  Confirm
                </button>
              )}
              <button onClick={() => onCancel(date.id)} className="px-3 py-1 rounded-lg bg-white/5 text-white/40 text-xs border border-white/10 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 transition-all">
                Cancel
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
