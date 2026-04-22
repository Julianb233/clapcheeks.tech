import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AddMatchForm from './add-match-form'

export const metadata: Metadata = {
  title: 'Add Match - Clapcheeks',
  description: 'Add a new match to get instant intel.',
}

export default async function AddMatchPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-sm">
            ✨
          </div>
          <h1 className="text-2xl md:text-3xl font-semibold">Add Match</h1>
        </div>
        <p className="text-sm text-white/50 mb-8 ml-11">
          Enter what you know — we&apos;ll calculate zodiac, DISC profile, and conversation strategy.
        </p>
        <AddMatchForm />
      </div>
    </div>
  )
}
