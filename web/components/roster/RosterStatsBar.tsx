'use client'

import { useMemo } from 'react'
import { ClapcheeksMatchRow, ROSTER_STAGES } from '@/lib/matches/types'

type Props = {
  matches: ClapcheeksMatchRow[]
}

function isWithinDays(iso: string | null | undefined, days: number): boolean {
  if (!iso) return false
  const t = new Date(iso).getTime()
  return Date.now() - t < days * 86400 * 1000
}

function isWithinMonth(iso: string | null | undefined): boolean {
  if (!iso) return false
  const d = new Date(iso)
  const now = new Date()
  return d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth()
}

export default function RosterStatsBar({ matches }: Props) {
  const stats = useMemo(() => {
    const active = matches.filter((m) => {
      const s = m.stage ?? m.status
      return s !== 'archived' && s !== 'ghosted' && s !== 'archived_cluster_dupe'
    })
    const newThisWeek = matches.filter((m) => isWithinDays(m.created_at, 7)).length
    const datesThisWeek = matches.filter(
      (m) =>
        (m.stage === 'date_booked' || m.stage === 'date_attended' || m.status === 'date_booked' || m.status === 'dated') &&
        isWithinDays(m.last_activity_at ?? m.updated_at, 7),
    ).length
    const closesThisMonth = matches.filter(
      (m) =>
        (m.stage === 'hooked_up' || m.stage === 'recurring') &&
        isWithinMonth(m.last_activity_at ?? m.updated_at),
    ).length

    // Funnel — same stage order but trimmed to the headline transitions.
    const funnel = [
      { label: 'New', count: matches.filter((m) => (m.stage ?? 'new_match') === 'new_match').length },
      { label: 'Chatting', count: matches.filter((m) => m.stage === 'chatting' || m.stage === 'chatting_phone').length },
      { label: 'Proposed', count: matches.filter((m) => m.stage === 'date_proposed').length },
      { label: 'Booked', count: matches.filter((m) => m.stage === 'date_booked').length },
      { label: 'Closed', count: matches.filter((m) => m.stage === 'hooked_up' || m.stage === 'recurring').length },
    ]

    return {
      active: active.length,
      newThisWeek,
      datesThisWeek,
      closesThisMonth,
      funnel,
    }
  }, [matches])

  const maxCount = Math.max(1, ...stats.funnel.map((f) => f.count))

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
      <StatCard label="Active" value={stats.active} accent="yellow" />
      <StatCard label="New this week" value={stats.newThisWeek} accent="blue" />
      <StatCard label="Dates this week" value={stats.datesThisWeek} accent="pink" />
      <StatCard label="Closes this month" value={stats.closesThisMonth} accent="emerald" />
      <div className="col-span-2 md:col-span-4 lg:col-span-1 bg-white/[0.03] border border-white/10 rounded-xl p-3">
        <div className="text-[10px] uppercase tracking-widest font-mono text-white/40 mb-1.5">
          Funnel
        </div>
        <div className="space-y-1">
          {stats.funnel.map((f) => (
            <div key={f.label} className="flex items-center gap-2">
              <span className="text-[10px] text-white/60 font-mono w-14 truncate">{f.label}</span>
              <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-yellow-400 to-red-500"
                  style={{ width: `${(f.count / maxCount) * 100}%` }}
                />
              </div>
              <span className="text-[10px] text-white/70 font-mono w-6 text-right">{f.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent: 'yellow' | 'blue' | 'pink' | 'emerald'
}) {
  const color =
    accent === 'yellow'  ? 'text-yellow-400' :
    accent === 'blue'    ? 'text-blue-300' :
    accent === 'pink'    ? 'text-pink-300' :
                           'text-emerald-300'
  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-xl p-3">
      <div className="text-[10px] uppercase tracking-widest font-mono text-white/40 mb-1">{label}</div>
      <div className={`font-mono text-2xl font-bold ${color}`}>{value}</div>
    </div>
  )
}
