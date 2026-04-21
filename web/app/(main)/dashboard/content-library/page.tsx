import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ContentLibraryClient from './content-library-client'

export const metadata: Metadata = {
  title: 'Content Library',
  description: 'Upload, categorize, and schedule Instagram posts.',
}

export type LibraryRow = {
  id: string
  user_id: string
  media_path: string
  media_type: string
  category: string
  caption: string | null
  target_time_of_day: string | null
  posted_at: string | null
  platform_post_id: string | null
  post_type: string
  performance_jsonb: Record<string, unknown> | null
  created_at: string
  updated_at: string
  signed_url?: string | null
}

export type QueueRow = {
  id: string
  content_library_id: string
  scheduled_for: string
  status: string
  posted_at: string | null
  error: string | null
}

export default async function ContentLibraryPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let library: LibraryRow[] = []
  let queue: QueueRow[] = []
  let fetchError: string | null = null

  try {
    const { data, error } = await (supabase as any)
      .from('clapcheeks_content_library')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) {
      fetchError = error.message
    } else if (data) {
      library = data as LibraryRow[]
    }
  } catch (e) {
    fetchError = (e as Error).message
  }

  try {
    const { data } = await (supabase as any)
      .from('clapcheeks_posting_queue')
      .select('id, content_library_id, scheduled_for, status, posted_at, error')
      .eq('user_id', user.id)
      .in('status', ['pending', 'in_progress'])
      .order('scheduled_for', { ascending: true })
      .limit(100)
    if (data) queue = data as QueueRow[]
  } catch {
    // non-fatal
  }

  // Best-effort signed URLs for the first 50 items. The public URL
  // would work too but signed URLs let us keep the bucket private.
  const withUrls = await Promise.all(
    library.slice(0, 50).map(async (row) => {
      try {
        const { data } = await supabase
          .storage
          .from('julian-content')
          .createSignedUrl(row.media_path, 3600)
        return { ...row, signed_url: data?.signedUrl ?? null }
      } catch {
        return { ...row, signed_url: null }
      }
    }),
  )
  const hydrated = [...withUrls, ...library.slice(50)]

  return (
    <div className="min-h-screen px-4 py-8 md:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold text-white">Content Library</h1>
          <p className="mt-2 text-white/60">
            Upload IG-ready media. We categorize, schedule, and post on your
            behalf - respecting the 60/20/10/10 ratio so you stay human.
          </p>
        </header>

        {fetchError && (
          <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-red-300">
            Failed to load library: {fetchError}
          </div>
        )}

        <ContentLibraryClient
          initialLibrary={hydrated}
          initialQueue={queue}
          userId={user.id}
        />
      </div>
    </div>
  )
}
