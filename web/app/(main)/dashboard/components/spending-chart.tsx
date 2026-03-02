'use client'

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'

interface SpendingChartProps {
  totalSpent: number
  costPerMatch: number
  costPerDate: number
  byCategory: Record<string, number>
}

const CATEGORY_COLORS: Record<string, string> = {
  drinks: '#a855f7',
  dinner: '#ec4899',
  activities: '#f472b6',
  subscriptions: '#c084fc',
  boost: '#818cf8',
  gift: '#fb923c',
  other: '#94a3b8',
}

export function SpendingChart({ totalSpent, costPerMatch, costPerDate, byCategory }: SpendingChartProps) {
  const chartData = Object.entries(byCategory).map(([category, amount]) => ({
    category: category.charAt(0).toUpperCase() + category.slice(1),
    amount: Number(amount.toFixed(2)),
    color: CATEGORY_COLORS[category] || '#94a3b8',
  }))

  if (chartData.length === 0 && totalSpent === 0) return null

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-5">
      <h2 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-4">
        Spend Tracker
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 mb-4">
        <div className="text-center">
          <div className="text-lg font-bold text-white">${totalSpent.toFixed(2)}</div>
          <div className="text-white/40 text-xs">Total This Month</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-white">${costPerMatch.toFixed(2)}</div>
          <div className="text-white/40 text-xs">Per Match</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-white">${costPerDate.toFixed(2)}</div>
          <div className="text-white/40 text-xs">Per Date</div>
        </div>
      </div>
      {chartData.length > 0 && (
        <div className="h-36 sm:h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
              <XAxis
                dataKey="category"
                tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
                axisLine={false} tickLine={false}
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
                formatter={(value: number) => [`$${value.toFixed(2)}`, 'Spent']}
              />
              <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
