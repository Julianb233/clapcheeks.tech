'use client'

import { useState } from 'react'
import type { DateRecord, DateIdea, BudgetSummary } from '@/lib/dates/types'
import DateIdeasTab from './date-ideas-tab'
import CalendarTab from './calendar-tab'
import BudgetTab from './budget-tab'
import HistoryTab from './history-tab'

const TABS = [
  { id: 'ideas', label: 'Ideas', icon: '💡' },
  { id: 'upcoming', label: 'Upcoming', icon: '📅' },
  { id: 'budget', label: 'Budget', icon: '💰' },
  { id: 'history', label: 'History', icon: '📖' },
] as const

type TabId = (typeof TABS)[number]['id']

interface Props {
  initialDates: DateRecord[]
  initialSavedIdeas: DateIdea[]
  initialBudget: BudgetSummary
}

export default function DatePlannerClient({ initialDates, initialSavedIdeas, initialBudget }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('ideas')
  const [dates, setDates] = useState(initialDates)
  const [savedIdeas, setSavedIdeas] = useState(initialSavedIdeas)
  const [budget] = useState(initialBudget)

  const upcomingDates = dates.filter(d => d.status === 'planned' || d.status === 'confirmed')
  const completedDates = dates.filter(d => d.status === 'completed')

  return (
    <div>
      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-white/[0.03] border border-white/[0.08] rounded-xl mb-6 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`
              flex-1 min-w-[100px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all
              ${activeTab === tab.id
                ? 'bg-gradient-to-r from-yellow-500/20 to-red-600/10 text-white border border-yellow-500/30'
                : 'text-white/50 hover:text-white/80 hover:bg-white/5'}
            `}
          >
            <span>{tab.icon}</span>
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'ideas' && (
        <DateIdeasTab
          savedIdeas={savedIdeas}
          onSaveIdea={(idea) => setSavedIdeas(prev => [idea, ...prev])}
          onRemoveIdea={(id) => setSavedIdeas(prev => prev.filter(i => i.id !== id))}
          onPlanDate={(date) => setDates(prev => [date, ...prev])}
        />
      )}
      {activeTab === 'upcoming' && (
        <CalendarTab
          dates={upcomingDates}
          onUpdateDate={(updated) => setDates(prev => prev.map(d => d.id === updated.id ? updated : d))}
          onCancelDate={(id) => setDates(prev => prev.map(d => d.id === id ? { ...d, status: 'cancelled' as const } : d))}
        />
      )}
      {activeTab === 'budget' && (
        <BudgetTab budget={budget} dates={dates} />
      )}
      {activeTab === 'history' && (
        <HistoryTab
          dates={completedDates}
          onRate={(id, updates) => setDates(prev => prev.map(d => d.id === id ? { ...d, ...updates } : d))}
        />
      )}
    </div>
  )
}
