'use client'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

interface PlatformData {
  [platform: string]: {
    swipes_right: number
    matches: number
    messages_sent: number
    dates_booked: number
  }
}

interface PlatformBreakdownProps {
  data: PlatformData
}

export function PlatformBreakdown({ data }: PlatformBreakdownProps) {
  const chartData = Object.entries(data).map(([platform, stats]) => ({
    platform: platform.charAt(0).toUpperCase() + platform.slice(1),
    swipes: stats.swipes_right,
    matches: stats.matches,
  }))

  if (chartData.length === 0) return null

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-5">
      <h2 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-4">
        Platform Breakdown
      </h2>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
            <XAxis
              dataKey="platform"
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
              axisLine={false} tickLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(0,0,0,0.9)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8, color: '#fff', fontSize: 12,
              }}
            />
            <Legend
              wrapperStyle={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}
            />
            <Bar dataKey="swipes" name="Swipes" fill="#a855f7" radius={[4, 4, 0, 0]} />
            <Bar dataKey="matches" name="Matches" fill="#ec4899" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
