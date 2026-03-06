'use client'

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'

interface SpendingChartProps {
  totalSpent: number
  costPerMatch: number
  costPerDate: number
  cpn?: number
  cpnGrade?: string
  cpnVerdict?: string
  cpnNuts?: number
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

const GRADE_COLORS: Record<string, string> = {
  'S': 'text-yellow-400',
  'A': 'text-green-400',
  'B': 'text-emerald-400',
  'C': 'text-white',
  'D': 'text-orange-400',
  'F': 'text-red-400',
  '--': 'text-white/30',
}

export function SpendingChart({ totalSpent, costPerMatch, costPerDate, cpn, cpnGrade, cpnVerdict, cpnNuts, byCategory }: SpendingChartProps) {
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-4">
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
        <div className="text-center">
          <div className="text-lg font-bold text-yellow-400">
            {cpn !== undefined && cpnNuts !== undefined && cpnNuts > 0 ? `$${cpn.toFixed(2)}` : '--'}
          </div>
          <div className="text-white/40 text-xs">Per Nut (CPN)</div>
        </div>
      </div>

      {/* CPN Grade Bar */}
      {cpnGrade && cpnGrade !== '--' && (
        <div className="flex items-center gap-3 mb-4 px-3 py-2.5 rounded-lg" style={{ background: 'rgba(201,164,39,0.06)', border: '1px solid rgba(201,164,39,0.15)' }}>
          <span className={`text-2xl font-bold ${GRADE_COLORS[cpnGrade] || 'text-white'}`}>
            {cpnGrade}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-white/60 text-xs font-semibold uppercase tracking-wider">CPN Grade</div>
            <div className="text-white/40 text-xs truncate">{cpnVerdict}</div>
          </div>
        </div>
      )}
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
