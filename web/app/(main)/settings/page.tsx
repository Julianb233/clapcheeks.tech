'use client'

import { useState, useEffect } from 'react'

const DAYS = [
  { value: 'monday', label: 'Monday' },
  { value: 'friday', label: 'Friday' },
  { value: 'sunday', label: 'Sunday' },
] as const

export default function SettingsPage() {
  const [emailEnabled, setEmailEnabled] = useState(true)
  const [sendDay, setSendDay] = useState('monday')
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [savedMessage, setSavedMessage] = useState('')

  useEffect(() => {
    async function loadPreferences() {
      try {
        const res = await fetch('/api/reports/preferences')
        if (res.ok) {
          const data = await res.json()
          if (data.email_enabled !== undefined) {
            setEmailEnabled(data.email_enabled)
          }
          if (data.send_day) {
            setSendDay(data.send_day)
          }
        }
      } catch {
        // Use defaults
      } finally {
        setLoaded(true)
      }
    }
    loadPreferences()
  }, [])

  async function handleSave() {
    setSaving(true)
    setSavedMessage('')
    try {
      const res = await fetch('/api/reports/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email_enabled: emailEnabled,
          send_day: sendDay,
        }),
      })
      if (res.ok) {
        setSavedMessage('Preferences saved')
        setTimeout(() => setSavedMessage(''), 3000)
      }
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) {
    return (
      <div className="min-h-screen bg-black text-white p-6 md:p-10">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-2xl font-bold mb-8">Settings</h1>
          <div className="bg-white/5 border border-white/10 rounded-xl p-5 animate-pulse h-48" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black text-white p-6 md:p-10">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-8">Settings</h1>

        {/* Weekly Reports Section */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-5 mb-8">
          <h2 className="text-white font-semibold text-sm mb-4">
            Weekly Reports
          </h2>
          <div className="space-y-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={emailEnabled}
                onChange={(e) => setEmailEnabled(e.target.checked)}
                className="rounded border-white/20 bg-white/5 w-4 h-4 accent-fuchsia-600"
              />
              <span className="text-white/60 text-sm">
                Email weekly reports
              </span>
            </label>

            <div>
              <label className="text-white/40 text-xs block mb-1">
                Report day
              </label>
              <select
                value={sendDay}
                onChange={(e) => setSendDay(e.target.value)}
                className="w-full max-w-xs bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none appearance-none"
              >
                {DAYS.map((d) => (
                  <option key={d.value} value={d.value} className="bg-black">
                    {d.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save preferences'}
              </button>
              {savedMessage && (
                <span className="text-green-400 text-sm">{savedMessage}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
