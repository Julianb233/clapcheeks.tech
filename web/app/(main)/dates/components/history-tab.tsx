'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { DateRecord, ExpenseCategory } from '@/lib/dates/types'
import { format, parseISO } from 'date-fns'

interface Props {
  dates: DateRecord[]
  onRate: (id: string, updates: Partial<DateRecord>) => void
}

const WENT_WELL_OPTIONS = ['Great conversation', 'Chemistry', 'Fun activity', 'Good food', 'Romantic', 'Made them laugh', 'Natural flow', 'Physical attraction']
const IMPROVE_OPTIONS = ['Awkward silence', 'Too expensive', 'Bad venue', 'No chemistry', 'Ran out of topics', 'Too short', 'Too long', 'Wrong vibe']

export default function HistoryTab({ dates, onRate }: Props) {
  const [ratingId, setRatingId] = useState<string | null>(null)
  const [ratingForm, setRatingForm] = useState<{
    rating: number
    notes: string
    went_well: string[]
    improve: string[]
    actual_cost: string
    expenses: { category: ExpenseCategory; description: string; amount: string }[]
  }>({
    rating: 0,
    notes: '',
    went_well: [],
    improve: [],
    actual_cost: '',
    expenses: [],
  })
  const [submitting, setSubmitting] = useState(false)

  const startRating = (date: DateRecord) => {
    setRatingId(date.id)
    setRatingForm({
      rating: date.rating || 0,
      notes: date.notes || '',
      went_well: date.went_well || [],
      improve: date.improve || [],
      actual_cost: date.actual_cost?.toString() || '',
      expenses: [],
    })
  }

  const handleSubmitRating = async () => {
    if (!ratingId || ratingForm.rating === 0) return
    setSubmitting(true)

    const supabase = createClient()
    const updates: Partial<DateRecord> = {
      rating: ratingForm.rating,
      notes: ratingForm.notes || null,
      went_well: ratingForm.went_well.length > 0 ? ratingForm.went_well : null,
      improve: ratingForm.improve.length > 0 ? ratingForm.improve : null,
      actual_cost: ratingForm.actual_cost ? Number(ratingForm.actual_cost) : null,
    }

    const { error } = await supabase
      .from('clapcheeks_dates')
      .update(updates)
      .eq('id', ratingId)

    // Add expenses if any
    if (ratingForm.expenses.length > 0) {
      await supabase
        .from('clapcheeks_date_expenses')
        .insert(ratingForm.expenses.filter(e => e.amount).map(e => ({
          date_id: ratingId,
          category: e.category,
          description: e.description || undefined,
          amount: Number(e.amount),
        })))
    }

    if (!error) {
      onRate(ratingId, updates)
      setRatingId(null)
    }
    setSubmitting(false)
  }

  const toggleTag = (type: 'went_well' | 'improve', tag: string) => {
    setRatingForm(prev => ({
      ...prev,
      [type]: prev[type].includes(tag) ? prev[type].filter(t => t !== tag) : [...prev[type], tag],
    }))
  }

  const addExpenseLine = () => {
    setRatingForm(prev => ({
      ...prev,
      expenses: [...prev.expenses, { category: 'food' as ExpenseCategory, description: '', amount: '' }],
    }))
  }

  if (dates.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-4xl mb-3">📖</div>
        <p className="text-white/50 text-sm">No completed dates yet. Once you complete a date, it shows here with your notes and ratings.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Timeline */}
      <div className="relative">
        {/* Vertical timeline line */}
        <div className="absolute left-[19px] top-4 bottom-4 w-px bg-white/10" />

        {dates.map((date, i) => (
          <div key={date.id} className="relative pl-12 pb-6">
            {/* Timeline dot */}
            <div className={`absolute left-3 top-1.5 w-4 h-4 rounded-full border-2 ${
              date.rating && date.rating >= 4 ? 'bg-green-500 border-green-400' :
              date.rating && date.rating >= 3 ? 'bg-yellow-500 border-yellow-400' :
              date.rating ? 'bg-red-500 border-red-400' :
              'bg-white/20 border-white/30'
            }`} />

            <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-white font-medium">{date.title}</h4>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    {date.match_name && <span className="text-white/50 text-xs">{date.match_name}</span>}
                    {date.venue_name && <span className="text-white/30 text-xs">@ {date.venue_name}</span>}
                    {date.scheduled_at && (
                      <span className="text-white/30 text-xs">{format(parseISO(date.scheduled_at), 'MMM d, yyyy')}</span>
                    )}
                  </div>
                </div>

                {/* Rating stars or rate button */}
                <div className="shrink-0">
                  {date.rating ? (
                    <div className="flex gap-0.5">
                      {[1, 2, 3, 4, 5].map(s => (
                        <span key={s} className={`text-sm ${s <= date.rating! ? 'text-yellow-400' : 'text-white/10'}`}>★</span>
                      ))}
                    </div>
                  ) : (
                    <button
                      onClick={() => startRating(date)}
                      className="px-3 py-1 rounded-lg bg-yellow-500/10 text-yellow-400 text-xs border border-yellow-500/20 hover:bg-yellow-500/20 transition-all"
                    >
                      Rate
                    </button>
                  )}
                </div>
              </div>

              {/* Notes & tags */}
              {date.notes && (
                <p className="text-white/40 text-sm mt-2 italic">&ldquo;{date.notes}&rdquo;</p>
              )}
              {(date.went_well?.length || date.improve?.length) && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {date.went_well?.map(tag => (
                    <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-400/80 border border-green-500/20">{tag}</span>
                  ))}
                  {date.improve?.map(tag => (
                    <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400/80 border border-red-500/20">{tag}</span>
                  ))}
                </div>
              )}

              {/* Cost */}
              {date.actual_cost && (
                <p className="text-white/30 text-xs mt-2">Spent: ${date.actual_cost.toFixed(0)}</p>
              )}

              {/* Inline rating form */}
              {ratingId === date.id && (
                <div className="mt-4 pt-4 border-t border-white/10 space-y-4">
                  {/* Star rating */}
                  <div>
                    <label className="text-white/50 text-xs uppercase tracking-wider block mb-2">Rating</label>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map(s => (
                        <button
                          key={s}
                          onClick={() => setRatingForm(p => ({ ...p, rating: s }))}
                          className={`text-2xl transition-all ${s <= ratingForm.rating ? 'text-yellow-400 scale-110' : 'text-white/20 hover:text-white/40'}`}
                        >
                          ★
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* What went well */}
                  <div>
                    <label className="text-white/50 text-xs uppercase tracking-wider block mb-2">What went well</label>
                    <div className="flex flex-wrap gap-1.5">
                      {WENT_WELL_OPTIONS.map(tag => (
                        <button
                          key={tag}
                          onClick={() => toggleTag('went_well', tag)}
                          className={`px-2.5 py-1 rounded-lg text-xs transition-all ${
                            ratingForm.went_well.includes(tag)
                              ? 'bg-green-500/20 text-green-300 border border-green-500/40'
                              : 'bg-white/5 text-white/40 border border-white/10 hover:bg-white/10'
                          }`}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* What to improve */}
                  <div>
                    <label className="text-white/50 text-xs uppercase tracking-wider block mb-2">What to improve</label>
                    <div className="flex flex-wrap gap-1.5">
                      {IMPROVE_OPTIONS.map(tag => (
                        <button
                          key={tag}
                          onClick={() => toggleTag('improve', tag)}
                          className={`px-2.5 py-1 rounded-lg text-xs transition-all ${
                            ratingForm.improve.includes(tag)
                              ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                              : 'bg-white/5 text-white/40 border border-white/10 hover:bg-white/10'
                          }`}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="text-white/50 text-xs uppercase tracking-wider block mb-2">Notes</label>
                    <textarea
                      value={ratingForm.notes}
                      onChange={e => setRatingForm(p => ({ ...p, notes: e.target.value }))}
                      placeholder="How did it go? Any key moments?"
                      rows={3}
                      className="w-full px-3 py-2 rounded-lg bg-black/50 border border-white/10 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-yellow-500/50 resize-none"
                    />
                  </div>

                  {/* Actual cost */}
                  <div>
                    <label className="text-white/50 text-xs uppercase tracking-wider block mb-2">Total cost ($)</label>
                    <input
                      type="number"
                      value={ratingForm.actual_cost}
                      onChange={e => setRatingForm(p => ({ ...p, actual_cost: e.target.value }))}
                      placeholder="0"
                      className="w-32 px-3 py-2 rounded-lg bg-black/50 border border-white/10 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-yellow-500/50"
                    />
                  </div>

                  {/* Expenses */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-white/50 text-xs uppercase tracking-wider">Expense Breakdown</label>
                      <button onClick={addExpenseLine} className="text-xs text-yellow-400 hover:text-yellow-300">+ Add</button>
                    </div>
                    {ratingForm.expenses.map((exp, i) => (
                      <div key={i} className="flex gap-2 mb-2">
                        <select
                          value={exp.category}
                          onChange={e => setRatingForm(p => ({ ...p, expenses: p.expenses.map((ex, j) => j === i ? { ...ex, category: e.target.value as ExpenseCategory } : ex) }))}
                          className="px-2 py-1.5 rounded-lg bg-black/50 border border-white/10 text-white text-xs focus:outline-none"
                        >
                          <option value="food">Food</option>
                          <option value="drinks">Drinks</option>
                          <option value="activity">Activity</option>
                          <option value="transport">Transport</option>
                          <option value="gifts">Gifts</option>
                          <option value="other">Other</option>
                        </select>
                        <input
                          type="text"
                          placeholder="Description"
                          value={exp.description}
                          onChange={e => setRatingForm(p => ({ ...p, expenses: p.expenses.map((ex, j) => j === i ? { ...ex, description: e.target.value } : ex) }))}
                          className="flex-1 px-2 py-1.5 rounded-lg bg-black/50 border border-white/10 text-white text-xs placeholder:text-white/30 focus:outline-none"
                        />
                        <input
                          type="number"
                          placeholder="$"
                          value={exp.amount}
                          onChange={e => setRatingForm(p => ({ ...p, expenses: p.expenses.map((ex, j) => j === i ? { ...ex, amount: e.target.value } : ex) }))}
                          className="w-20 px-2 py-1.5 rounded-lg bg-black/50 border border-white/10 text-white text-xs placeholder:text-white/30 focus:outline-none"
                        />
                      </div>
                    ))}
                  </div>

                  {/* Submit */}
                  <div className="flex gap-2">
                    <button
                      onClick={handleSubmitRating}
                      disabled={ratingForm.rating === 0 || submitting}
                      className="px-5 py-2 rounded-lg bg-gradient-to-r from-yellow-500 to-red-600 text-black font-semibold text-xs disabled:opacity-50"
                    >
                      {submitting ? 'Saving...' : 'Save Rating'}
                    </button>
                    <button
                      onClick={() => setRatingId(null)}
                      className="px-4 py-2 rounded-lg bg-white/5 text-white/50 text-xs border border-white/10"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
