'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { VoiceInput, VoiceTextarea } from '@/components/voice'

const PLATFORMS = ['tinder', 'hinge', 'bumble', 'raya', 'the_league', 'feeld', 'other'] as const
const QUICK_TAGS = ['hot', 'funny', 'smart', 'creative', 'adventurous', 'chill', 'ambitious', 'sweet'] as const

export default function AddMatchForm() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [platform, setPlatform] = useState<string>('tinder')
  const [age, setAge] = useState('')
  const [birthday, setBirthday] = useState('')
  const [igHandle, setIgHandle] = useState('')
  const [bio, setBio] = useState('')
  const [notes, setNotes] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  const toggleTag = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/match-profile/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          platform,
          age: age || null,
          birthday: birthday || null,
          ig_handle: igHandle.trim() || null,
          bio: bio.trim() || null,
          notes: notes.trim() || null,
          quick_tags: selectedTags,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to add match')

      router.push(`/matches/${data.profile.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Name */}
      <div>
        <label className="block text-sm font-medium text-white/70 mb-1.5">Name *</label>
        <VoiceInput
          type="text"
          value={name}
          onChange={setName}
          placeholder="Their first name"
          className="w-full h-auto px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50"
          required
        />
      </div>

      {/* Platform */}
      <div>
        <label className="block text-sm font-medium text-white/70 mb-1.5">Platform</label>
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setPlatform(p)}
              className={`px-3 py-1.5 rounded-lg text-sm capitalize transition-all ${
                platform === p
                  ? 'bg-pink-600 text-white'
                  : 'bg-white/5 border border-white/10 text-white/60 hover:bg-white/10'
              }`}
            >
              {p.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Age + Birthday */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-white/70 mb-1.5">Age</label>
          <input
            type="number"
            value={age}
            onChange={e => setAge(e.target.value)}
            placeholder="25"
            min="18"
            max="99"
            className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-white/70 mb-1.5">Birthday</label>
          <input
            type="date"
            value={birthday}
            onChange={e => setBirthday(e.target.value)}
            className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50"
          />
        </div>
      </div>

      {/* Instagram Handle */}
      <div>
        <label className="block text-sm font-medium text-white/70 mb-1.5">Instagram Handle</label>
        <VoiceInput
          type="text"
          value={igHandle}
          onChange={setIgHandle}
          placeholder="@their_handle"
          className="w-full h-auto px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50"
        />
      </div>

      {/* Bio */}
      <div>
        <label className="block text-sm font-medium text-white/70 mb-1.5">Bio / Profile Text</label>
        <VoiceTextarea
          value={bio}
          onChange={setBio}
          placeholder="Paste their bio or prompts here..."
          rows={4}
          className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 resize-none"
        />
      </div>

      {/* Quick Tags */}
      <div>
        <label className="block text-sm font-medium text-white/70 mb-1.5">Quick Tags</label>
        <div className="flex flex-wrap gap-2">
          {QUICK_TAGS.map(tag => (
            <button
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
              className={`px-3 py-1.5 rounded-full text-sm capitalize transition-all ${
                selectedTags.includes(tag)
                  ? 'bg-purple-600 text-white'
                  : 'bg-white/5 border border-white/10 text-white/60 hover:bg-white/10'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-sm font-medium text-white/70 mb-1.5">Notes</label>
        <VoiceTextarea
          value={notes}
          onChange={setNotes}
          placeholder="Anything else to remember..."
          rows={2}
          className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 resize-none"
        />
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 rounded-lg bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 font-medium text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Adding & Enriching...' : 'Add Match & Get Intel'}
      </button>
    </form>
  )
}
