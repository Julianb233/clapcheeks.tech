import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PhotoLibrary from './photo-library'

export const metadata: Metadata = { title: 'Photo Library | Clapcheeks' }

export default async function PhotoLibraryPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  return (
    <div className="min-h-screen bg-black">
      <PhotoLibrary />
    </div>
  )
}
