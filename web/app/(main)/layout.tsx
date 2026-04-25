import type { Metadata } from 'next'
import { headers } from 'next/headers'
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

// Public pages that live under (main)/ but should render without auth.
// Middleware also lists these — keep both in sync.
const PUBLIC_PATHS = new Set<string>([
  '/',
  '/pricing',
  '/platforms',
  '/how-it-works',
  '/features',
  '/press',
])

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const hdrs = await headers()
  const pathname = hdrs.get('x-pathname') || hdrs.get('x-invoke-path') || hdrs.get('next-url') || ''
  const isPublic = PUBLIC_PATHS.has(pathname) || pathname.startsWith('/affiliate/apply')

  if (!isPublic) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect('/login')
  }

  // Show the chrome (sidebar) only for authed surfaces — public marketing
  // pages keep their own navbar/footer.
  if (isPublic) {
    return (
      <>
        {children}
        <Toaster theme="dark" position="bottom-right" richColors closeButton />
      </>
    )
  }

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
