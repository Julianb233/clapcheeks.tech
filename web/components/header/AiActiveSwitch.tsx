'use client'
/**
 * AI-8809 — Global AI Active toggle.
 *
 * Renders a switch in the sidebar that toggles clapcheeks_user_settings.ai_active.
 * Snooze options: 1h, 4h, until midnight, until manual resume.
 * Optional reason chip: "On a date", "Manual mode", custom text.
 *
 * Wired into app-sidebar.tsx inside the user section at the bottom.
 */

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

type AiSettings = {
  ai_active: boolean
  ai_paused_until: string | null
  ai_paused_reason: string | null
}

const REASON_PRESETS = ['On a date', 'Manual mode', 'Focus time']
const SNOOZE_OPTIONS = [
  { label: '1 hour', hours: 1 },
  { label: '4 hours', hours: 4 },
  { label: 'Rest of today', hours: null }, // until midnight
  { label: 'Until I resume', hours: -1 }, // permanent
]

function hoursFromNow(h: number): string {
  const d = new Date()
  d.setHours(d.getHours() + h)
  return d.toISOString()
}

function untilMidnight(): string {
  const d = new Date()
  d.setHours(23, 59, 59, 0)
  return d.toISOString()
}

export default function AiActiveSwitch() {
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [showMenu, setShowMenu] = useState(false)
  const [saving, setSaving] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Load current settings
  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)

      const { data } = await supabase
        .from('clapcheeks_user_settings')
        .select('ai_active, ai_paused_until, ai_paused_reason')
        .eq('user_id', user.id)
        .single()
      if (data) setSettings(data as AiSettings)
    })()
  }, [])

  // Close menu on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  async function applySettings(patch: Partial<AiSettings>) {
    if (!userId) return
    setSaving(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('clapcheeks_user_settings')
      .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' })
      .select('ai_active, ai_paused_until, ai_paused_reason')
      .single()
    if (data) setSettings(data as AiSettings)
    setSaving(false)
    setShowMenu(false)
  }

  async function handleToggle() {
    if (!settings) return
    if (settings.ai_active) {
      // Turning off → show snooze menu
      setShowMenu((v) => !v)
    } else {
      // Turning back on → clear snooze
      await applySettings({ ai_active: true, ai_paused_until: null, ai_paused_reason: null })
    }
  }

  async function applySnooze(hours: number | null, reason?: string) {
    const paused_until = hours === -1 ? null : hours === null ? untilMidnight() : hoursFromNow(hours)
    await applySettings({
      ai_active: false,
      ai_paused_until: paused_until,
      ai_paused_reason: reason ?? 'Paused',
    })
  }

  const isActive = settings?.ai_active ?? true
  const reason = settings?.ai_paused_reason

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={handleToggle}
        disabled={saving || !settings}
        title={isActive ? 'AI Active — click to pause' : `AI Paused${reason ? `: ${reason}` : ''} — click to resume`}
        className={`
          w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium
          transition-all duration-200 border
          ${isActive
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
            : 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'}
          ${saving ? 'opacity-50 cursor-wait' : 'cursor-pointer'}
        `}
      >
        {/* Toggle pill */}
        <span
          className={`
            relative w-8 h-4 rounded-full transition-colors duration-200 flex-shrink-0
            ${isActive ? 'bg-emerald-500' : 'bg-red-500/60'}
          `}
        >
          <span
            className={`
              absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform duration-200
              ${isActive ? 'translate-x-4' : 'translate-x-0.5'}
            `}
          />
        </span>

        <span className="flex-1 text-left leading-none">
          {isActive ? 'AI Active' : 'AI Paused'}
        </span>

        {!isActive && reason && (
          <span className="text-[10px] text-red-300/70 truncate max-w-[72px]">{reason}</span>
        )}
      </button>

      {/* Snooze dropdown */}
      {showMenu && (
        <div className="absolute bottom-full left-0 mb-2 w-48 bg-[#0a0a12] border border-white/10 rounded-xl shadow-2xl p-2 z-50">
          <p className="text-[10px] text-white/40 uppercase tracking-widest px-2 pb-1">Pause for</p>

          {SNOOZE_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              onClick={() => applySnooze(opt.hours)}
              className="w-full text-left px-3 py-2 text-xs text-white/70 hover:bg-white/5 hover:text-white rounded-lg transition-colors"
            >
              {opt.label}
            </button>
          ))}

          <div className="border-t border-white/8 my-1" />
          <p className="text-[10px] text-white/40 uppercase tracking-widest px-2 pb-1">Reason</p>

          {REASON_PRESETS.map((r) => (
            <button
              key={r}
              onClick={() => applySnooze(null, r)}
              className="w-full text-left px-3 py-2 text-xs text-white/70 hover:bg-white/5 hover:text-white rounded-lg transition-colors"
            >
              {r}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
