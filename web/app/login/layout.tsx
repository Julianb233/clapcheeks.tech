import type { Metadata } from 'next'
import { Suspense } from 'react'

export const metadata: Metadata = {
  title: 'Sign In — Clapcheeks',
  description: 'Sign in to your Clapcheeks account.',
  robots: { index: false, follow: false },
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <Suspense>{children}</Suspense>
}
