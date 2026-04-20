'use client'

import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { generateDateIdeas, getIdeaCategories, getVibeOptions } from '@/lib/dates/ideas'
import type { DateIdea, DateRecord, IdeaCategory, DateVibe } from '@/lib/dates/types'

interface Props {
  savedIdeas: DateIdea[]
  onSaveIdea: (idea: DateIdea) => void
  onRemoveIdea: (id: string) => void
  onPlanDate: (date: DateRecord) => void
}

export default function DateIdeasTab({ savedIdeas, onSaveIdea, onRemoveIdea, onPlanDate }: Props) {
  const [generatedIdeas, setGeneratedIdeas] = useState<ReturnType<typeof generateDateIdeas>>([])
  const [selectedVibes, setSelectedVibes] = useState<DateVibe[]>([])
  const [selectedCategories, setSelectedCategories] = useState<IdeaCategory[]>([])
  const [budgetFilter, setBudgetFilter] = useState<string>('')
  const [saving, setSaving] = useState<string | null>(null)
  const [planning, setPlanning] = useState<string | null>(null)
  const [planForm, setPlanForm] = useState<{ title: string; scheduled_at: string; venue_name: string }>({ title: '', scheduled_at: '', venue_name: '' })

  const categories = getIdeaCategories()
  const vibes = getVibeOptions()

  const handleGenerate = useCallback(() => {
    const ideas = generateDateIdeas({
      vibes: selectedVibes.length > 0 ? selectedVibes : undefined,
      categories: selectedCategories.length > 0 ? selectedCategories : undefined,
      budget: budgetFilter || undefined,
      count: 5,
    })
    setGeneratedIdeas(ideas)
  }, [selectedVibes, selectedCategories, budgetFilter])

  const handleSave = async (idea: (typeof generatedIdeas)[0]) => {
    setSaving(idea.title)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('clapcheeks_date_ideas')
      .insert({
        title: idea.title,
        description: idea.description,
        category: idea.category,
        estimated_cost_range: idea.estimated_cost_range,
        duration_minutes: idea.duration_minutes,
        best_for: idea.best_for,
        location_type: idea.location_type,
        saved: true,
        ai_generated: false,
      })
      .select()
      .single()

    if (!error && data) onSaveIdea(data as DateIdea)
    setSaving(null)
  }

  const handleRemove = async (id: string) => {
    const supabase = createClient()
    await supabase.from('clapcheeks_date_ideas').delete().eq('id', id)
    onRemoveIdea(id)
  }

  const handlePlanFromIdea = async (idea: DateIdea | (typeof generatedIdeas)[0]) => {
    if (planning === idea.title) {
      // Submit the plan form
      const supabase = createClient()
      const { data, error } = await supabase
        .from('clapcheeks_dates')
        .insert({
          title: planForm.title || idea.title,
          description: idea.description,
          venue_name: planForm.venue_name || undefined,
          scheduled_at: planForm.scheduled_at || undefined,
          estimated_cost: idea.estimated_cost_range === '$' ? 30 : idea.estimated_cost_range === '$$' ? 75 : 150,
          status: planForm.scheduled_at ? 'planned' : 'idea',
          tags: [idea.category],
        })
        .select()
        .single()

      if (!error && data) onPlanDate(data as DateRecord)
      setPlanning(null)
      setPlanForm({ title: '', scheduled_at: '', venue_name: '' })
    } else {
      setPlanning(idea.title)
      setPlanForm({ title: idea.title, scheduled_at: '', venue_name: '' })
    }
  }

  const toggleVibe = (v: DateVibe) => setSelectedVibes(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])
  const toggleCategory = (c: IdeaCategory) => setSelectedCategories(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])

  return (
    <div className="space-y-6">
      {/* Generator controls */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5">
        <h2 className="text-white font-semibold text-lg mb-4">Generate Date Ideas</h2>

        {/* Vibes */}
        <div className="mb-4">
          <label className="text-white/50 text-xs uppercase tracking-wider mb-2 block">Vibe</label>
          <div className="flex flex-wrap gap-2">
            {vibes.map(v => (
              <button
                key={v.value}
                onClick={() => toggleVibe(v.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  selectedVibes.includes(v.value)
                    ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40'
                    : 'bg-white/5 text-white/50 border border-white/10 hover:bg-white/10'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {/* Categories */}
        <div className="mb-4">
          <label className="text-white/50 text-xs uppercase tracking-wider mb-2 block">Category</label>
          <div className="flex flex-wrap gap-2">
            {categories.map(c => (
              <button
                key={c.value}
                onClick={() => toggleCategory(c.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  selectedCategories.includes(c.value)
                    ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40'
                    : 'bg-white/5 text-white/50 border border-white/10 hover:bg-white/10'
                }`}
              >
                {c.emoji} {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Budget */}
        <div className="mb-4">
          <label className="text-white/50 text-xs uppercase tracking-wider mb-2 block">Max Budget</label>
          <div className="flex gap-2">
            {['$', '$$', '$$$'].map(b => (
              <button
                key={b}
                onClick={() => setBudgetFilter(prev => prev === b ? '' : b)}
                className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  budgetFilter === b
                    ? 'bg-green-500/20 text-green-300 border border-green-500/40'
                    : 'bg-white/5 text-white/50 border border-white/10 hover:bg-white/10'
                }`}
              >
                {b}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleGenerate}
          className="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-gradient-to-r from-yellow-500 to-red-600 text-black font-semibold text-sm hover:opacity-90 transition-opacity"
        >
          Generate Ideas
        </button>
      </div>

      {/* Generated ideas */}
      {generatedIdeas.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-white/70 text-sm font-medium">Generated for you</h3>
          {generatedIdeas.map((idea, i) => (
            <div key={i} className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <h4 className="text-white font-medium">{idea.title}</h4>
                  <p className="text-white/40 text-sm mt-1">{idea.description}</p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-white/40 border border-white/10">
                      {idea.estimated_cost_range}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-white/40 border border-white/10">
                      {idea.duration_minutes}min
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-white/40 border border-white/10">
                      {idea.location_type}
                    </span>
                    {idea.best_for.map(v => (
                      <span key={v} className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400/70 border border-yellow-500/20">
                        {v.replace('_', ' ')}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleSave(idea)}
                    disabled={saving === idea.title}
                    className="px-3 py-1.5 rounded-lg bg-white/5 text-white/60 text-xs border border-white/10 hover:bg-white/10 transition-all disabled:opacity-50"
                  >
                    {saving === idea.title ? '...' : 'Save'}
                  </button>
                  <button
                    onClick={() => handlePlanFromIdea(idea as unknown as DateIdea)}
                    className="px-3 py-1.5 rounded-lg bg-yellow-500/20 text-yellow-300 text-xs border border-yellow-500/30 hover:bg-yellow-500/30 transition-all"
                  >
                    Plan
                  </button>
                </div>
              </div>

              {/* Plan form inline */}
              {planning === idea.title && (
                <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
                  <input
                    type="text"
                    placeholder="Venue name (optional)"
                    value={planForm.venue_name}
                    onChange={e => setPlanForm(p => ({ ...p, venue_name: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-black/50 border border-white/10 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-yellow-500/50"
                  />
                  <input
                    type="datetime-local"
                    value={planForm.scheduled_at}
                    onChange={e => setPlanForm(p => ({ ...p, scheduled_at: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-black/50 border border-white/10 text-white text-sm focus:outline-none focus:border-yellow-500/50"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handlePlanFromIdea(idea as unknown as DateIdea)}
                      className="px-4 py-2 rounded-lg bg-gradient-to-r from-yellow-500 to-red-600 text-black font-semibold text-xs"
                    >
                      Create Date
                    </button>
                    <button
                      onClick={() => { setPlanning(null); setPlanForm({ title: '', scheduled_at: '', venue_name: '' }) }}
                      className="px-4 py-2 rounded-lg bg-white/5 text-white/50 text-xs border border-white/10"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Saved ideas */}
      {savedIdeas.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-white/70 text-sm font-medium">Saved Ideas ({savedIdeas.length})</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {savedIdeas.map(idea => (
              <div key={idea.id} className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="text-white font-medium text-sm">{idea.title}</h4>
                    <p className="text-white/40 text-xs mt-1 line-clamp-2">{idea.description}</p>
                    <div className="flex gap-1 mt-2">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/40">{idea.category}</span>
                      {idea.estimated_cost_range && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/40">{idea.estimated_cost_range}</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemove(idea.id)}
                    className="text-white/30 hover:text-red-400 text-xs transition-colors"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {generatedIdeas.length === 0 && savedIdeas.length === 0 && (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">💡</div>
          <p className="text-white/50 text-sm">Set your preferences above and generate personalized date ideas.</p>
        </div>
      )}
    </div>
  )
}
