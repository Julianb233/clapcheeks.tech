import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getDates, getSavedIdeas, getBudgetSummary } from '@/lib/dates'
import DatePlannerClient from './components/date-planner-client'

export const metadata: Metadata = {
  title: 'Date Planner — Clapcheeks',
  description: 'Plan, track, and rate your dates.',
}

export default async function DatePlannerPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [dates, savedIdeas, budget] = await Promise.all([
    getDates(supabase, user.id),
    getSavedIdeas(supabase, user.id),
    getBudgetSummary(supabase, user.id),
  ])

  return (
    <div className="min-h-screen bg-black px-4 md:px-6 py-6 md:py-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="font-display text-3xl md:text-4xl text-white uppercase tracking-wide gold-text">
            Date Planner
          </h1>
          <p className="text-white/40 text-sm mt-1">
            Plan, book, and track your dates. Never wing it again.
          </p>
        </div>
        <DatePlannerClient
          initialDates={dates}
          initialSavedIdeas={savedIdeas}
          initialBudget={budget}
        />
      </div>
    </div>
  )
}
