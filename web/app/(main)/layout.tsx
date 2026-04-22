import type { Metadata } from 'next'
import AppSidebar from '@/components/layout/app-sidebar'
import PageOrbs from '@/components/page-orbs'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Toaster } from 'sonner'

export const metadata: Metadata = {
  title: {
    template: '%s | Clapcheeks',
    default: 'Clapcheeks',
  },
}

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  // Gate the entire authed surface. Unauthed visits bounce to /login.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <>
      <PageOrbs subtle />
      <div className="relative min-h-screen" style={{ zIndex: 1 }}>
        <AppSidebar />
        <div className="lg:pl-[260px]">
          <main className="min-h-screen">{children}</main>
        </div>
      </div>
      <Toaster theme="dark" position="bottom-right" richColors closeButton />
    </>
  )
}
