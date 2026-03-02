'use client'

import { useState } from 'react'

interface ReportPreferencesProps {
  emailEnabled: boolean
  sendDay: string
  sendHour: number
}

const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

export default function ReportPreferences({ emailEnabled, sendDay, sendHour }: ReportPreferencesProps) {
  const [enabled, setEnabled] = useState(emailEnabled)
  const [day, setDay] = useState(sendDay)
  const [hour, setHour] = useState(sendHour)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      await fetch('/api/reports/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email_enabled: enabled, send_day: day, send_hour: hour }),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-5 mb-8">
      <h2 className="text-white font-semibold text-sm mb-4">Report Preferences</h2>
      <div className="space-y-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="rounded border-white/20 bg-white/5"
          />
          <span className="text-white/60 text-sm">Email weekly reports</span>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-white/40 text-xs block mb-1">Send day</label>
            <select
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none appearance-none capitalize"
            >
              {days.map((d) => (
                <option key={d} value={d} className="bg-black capitalize">{d}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-white/40 text-xs block mb-1">Send hour</label>
            <select
              value={hour}
              onChange={(e) => setHour(Number(e.target.value))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none appearance-none"
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i} className="bg-black">
                  {i === 0 ? '12 AM' : i < 12 ? `${i} AM` : i === 12 ? '12 PM' : `${i - 12} PM`}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save preferences'}
        </button>
      </div>
    </div>
  )
}
