'use client'

import type { BudgetSummary, DateRecord, ExpenseCategory } from '@/lib/dates/types'

interface Props {
  budget: BudgetSummary
  dates: DateRecord[]
}

const CATEGORY_META: Record<ExpenseCategory, { label: string; color: string }> = {
  food: { label: 'Food', color: 'bg-orange-400' },
  drinks: { label: 'Drinks', color: 'bg-purple-400' },
  activity: { label: 'Activity', color: 'bg-blue-400' },
  transport: { label: 'Transport', color: 'bg-green-400' },
  gifts: { label: 'Gifts', color: 'bg-pink-400' },
  other: { label: 'Other', color: 'bg-gray-400' },
}

export default function BudgetTab({ budget, dates }: Props) {
  const completedDates = dates.filter(d => d.status === 'completed')
  const totalCategorySpend = Object.values(budget.byCategory).reduce((s, v) => s + v, 0)

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Spent" value={`$${budget.totalSpent.toFixed(0)}`} />
        <StatCard label="Dates Completed" value={String(budget.dateCount)} />
        <StatCard label="Avg per Date" value={`$${budget.averagePerDate.toFixed(0)}`} />
        <StatCard label="This Month" value={`$${(budget.monthlyTrend[budget.monthlyTrend.length - 1]?.amount ?? 0).toFixed(0)}`} />
      </div>

      {/* Category breakdown */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5">
        <h3 className="text-white font-medium text-sm mb-4">Spending by Category</h3>
        {totalCategorySpend > 0 ? (
          <div className="space-y-3">
            {(Object.entries(budget.byCategory) as [ExpenseCategory, number][])
              .filter(([, amount]) => amount > 0)
              .sort(([, a], [, b]) => b - a)
              .map(([category, amount]) => {
                const pct = (amount / totalCategorySpend) * 100
                const meta = CATEGORY_META[category]
                return (
                  <div key={category}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-white/70">{meta.label}</span>
                      <span className="text-white/50">${amount.toFixed(0)} ({pct.toFixed(0)}%)</span>
                    </div>
                    <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                      <div className={`h-full ${meta.color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
          </div>
        ) : (
          <p className="text-white/30 text-sm">No expenses tracked yet. Complete a date and add expenses to see breakdown.</p>
        )}
      </div>

      {/* Monthly trend */}
      {budget.monthlyTrend.length > 0 && (
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5">
          <h3 className="text-white font-medium text-sm mb-4">Monthly Trend</h3>
          <div className="flex items-end gap-2 h-32">
            {budget.monthlyTrend.map(({ month, amount }) => {
              const maxAmount = Math.max(...budget.monthlyTrend.map(m => m.amount))
              const height = maxAmount > 0 ? (amount / maxAmount) * 100 : 0
              return (
                <div key={month} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] text-white/40">${amount.toFixed(0)}</span>
                  <div className="w-full rounded-t-sm bg-gradient-to-t from-yellow-500/40 to-red-500/40" style={{ height: `${height}%`, minHeight: '4px' }} />
                  <span className="text-[10px] text-white/30">{month.slice(5)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Per-date breakdown */}
      {completedDates.length > 0 && (
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5">
          <h3 className="text-white font-medium text-sm mb-4">Per-Date Costs</h3>
          <div className="space-y-2">
            {completedDates
              .filter(d => d.actual_cost || d.estimated_cost)
              .slice(0, 10)
              .map(date => (
                <div key={date.id} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                  <div>
                    <p className="text-white/80 text-sm">{date.title}</p>
                    <p className="text-white/30 text-xs">{date.match_name || 'No name'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-white font-medium text-sm">${(date.actual_cost || 0).toFixed(0)}</p>
                    {date.estimated_cost && (
                      <p className="text-white/30 text-xs">est. ${date.estimated_cost.toFixed(0)}</p>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {budget.dateCount === 0 && (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">💰</div>
          <p className="text-white/50 text-sm">Complete some dates and track expenses to see your budget breakdown.</p>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-4 text-center">
      <p className="text-white/40 text-xs uppercase tracking-wider mb-1">{label}</p>
      <p className="text-white font-display text-xl">{value}</p>
    </div>
  )
}
