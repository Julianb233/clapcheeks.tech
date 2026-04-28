'use client'

import { useState } from 'react'

export type Channel = 'email' | 'imessage' | 'push'

export type EventKey =
  | 'date_booked'
  | 'ban_detected'
  | 'new_match'
  | 'draft_queued'
  | 'token_expiring'

export interface NotificationPrefs {
  email: string
  phone_e164: string
  channels_per_event: Record<EventKey, Channel[]>
  quiet_hours_start: number
  quiet_hours_end: number
}

const EVENT_LABELS: { key: EventKey; label: string; help?: string }[] = [
  { key: 'date_booked', label: 'Date booked', help: 'A match booked into your calendar.' },
  {
    key: 'ban_detected',
    label: 'Ban detected',
    help: 'A platform paused your account; safety-critical, ignores quiet hours.',
  },
  { key: 'new_match', label: 'New match', help: 'A new match landed on a platform.' },
  {
    key: 'draft_queued',
    label: 'Draft queued',
    help: 'A low-confidence draft is waiting for your review.',
  },
  {
    key: 'token_expiring',
    label: 'Token expiring',
    help: 'A platform session is about to expire; reauth needed.',
  },
]

const CHANNEL_COLS: { key: Channel; label: string; disabled?: boolean }[] = [
  { key: 'email', label: 'Email' },
  { key: 'imessage', label: 'iMessage' },
  { key: 'push', label: 'Push' },
]

const HOURS = Array.from({ length: 24 }, (_, h) => h)

export default function NotificationPrefsForm({
  initial,
}: {
  initial: NotificationPrefs
}) {
  const [prefs, setPrefs] = useState<NotificationPrefs>(initial)
  const [saving, setSaving] = useState(false)
  const [savedMessage, setSavedMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  function toggleChannel(event: EventKey, channel: Channel) {
    setPrefs((prev) => {
      const current = prev.channels_per_event[event] || []
      const next = current.includes(channel)
        ? current.filter((c) => c !== channel)
        : [...current, channel]
      return {
        ...prev,
        channels_per_event: { ...prev.channels_per_event, [event]: next },
      }
    })
  }

  async function handleSave() {
    setSaving(true)
    setSavedMessage('')
    setErrorMessage('')
    try {
      const res = await fetch('/api/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs),
      })
      if (res.ok) {
        setSavedMessage('Saved')
        setTimeout(() => setSavedMessage(''), 2500)
      } else {
        const j = await res.json().catch(() => ({}))
        setErrorMessage(j.error || `Save failed (${res.status})`)
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Contact section */}
      <section className="bg-white/5 border border-white/10 rounded-xl p-5">
        <h2 className="text-white font-semibold text-sm mb-4 uppercase tracking-wider">
          Where to reach you
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-white/60 text-xs block mb-1">Email</span>
            <input
              type="email"
              value={prefs.email}
              onChange={(e) => setPrefs({ ...prefs, email: e.target.value })}
              placeholder="you@example.com"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-white/60 text-xs block mb-1">Phone (E.164)</span>
            <input
              type="tel"
              value={prefs.phone_e164}
              onChange={(e) => setPrefs({ ...prefs, phone_e164: e.target.value })}
              placeholder="+15555550123"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
            />
          </label>
        </div>
      </section>

      {/* Event matrix */}
      <section className="bg-white/5 border border-white/10 rounded-xl p-5">
        <h2 className="text-white font-semibold text-sm mb-4 uppercase tracking-wider">
          Event channels
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-white/40 text-xs uppercase tracking-wider">
                <th className="text-left py-2 pr-4 font-normal">Event</th>
                {CHANNEL_COLS.map((c) => (
                  <th key={c.key} className="text-center py-2 px-2 font-normal w-20">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {EVENT_LABELS.map((row) => (
                <tr key={row.key} className="border-t border-white/5">
                  <td className="py-3 pr-4">
                    <div className="text-white">{row.label}</div>
                    {row.help && (
                      <div className="text-white/40 text-xs mt-0.5">{row.help}</div>
                    )}
                  </td>
                  {CHANNEL_COLS.map((c) => {
                    const enabled =
                      prefs.channels_per_event[row.key]?.includes(c.key) || false
                    return (
                      <td key={c.key} className="text-center py-3 px-2">
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={() => toggleChannel(row.key, c.key)}
                          aria-label={`${row.label} via ${c.label}`}
                          className="w-4 h-4 accent-fuchsia-600"
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-white/40 text-xs mt-4">
          Push delivery is queued today and drained by the PWA service worker
          once installed. Email and iMessage deliver immediately.
        </p>
      </section>

      {/* Quiet hours */}
      <section className="bg-white/5 border border-white/10 rounded-xl p-5">
        <h2 className="text-white font-semibold text-sm mb-4 uppercase tracking-wider">
          Quiet hours
        </h2>
        <p className="text-white/40 text-xs mb-4">
          Non-urgent events are suppressed in this window. Ban detection and
          token expiry always page you.
        </p>
        <div className="flex items-center gap-3">
          <select
            value={prefs.quiet_hours_start}
            onChange={(e) =>
              setPrefs({ ...prefs, quiet_hours_start: Number(e.target.value) })
            }
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none appearance-none"
            aria-label="Quiet hours start"
          >
            {HOURS.map((h) => (
              <option key={h} value={h} className="bg-black">
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </select>
          <span className="text-white/60 text-sm">to</span>
          <select
            value={prefs.quiet_hours_end}
            onChange={(e) =>
              setPrefs({ ...prefs, quiet_hours_end: Number(e.target.value) })
            }
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none appearance-none"
            aria-label="Quiet hours end"
          >
            {HOURS.map((h) => (
              <option key={h} value={h} className="bg-black">
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Save row */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save preferences'}
        </button>
        {savedMessage && <span className="text-green-400 text-sm">{savedMessage}</span>}
        {errorMessage && <span className="text-red-400 text-sm">{errorMessage}</span>}
      </div>
    </div>
  )
}
