import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PhotoLibrary } from './photo-library'

export const metadata: Metadata = {
  title: 'Photo Library | Clapcheeks',
  description: 'Drag and drop your profile photos into categories.',
}

export default async function ProfilePhotosPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login?next=/profile/photos')
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-6xl mx-auto px-4 md:px-6 pt-24 pb-16">
        <header className="mb-8">
          <h1 className="text-3xl md:text-4xl font-display tracking-tight">
            Photo Library
          </h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
            Drag and drop photos into any category. We will use these to build
            your dating profile and feed the swipe agent. Your files are stored
            privately and only you can see them.
          </p>
        </header>
        <PhotoLibrary />
      </div>
    </main>
  )
}
