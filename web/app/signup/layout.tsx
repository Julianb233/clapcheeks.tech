import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Create Account — Clap Cheeks',
  description: 'Create your Clap Cheeks account and start your AI dating co-pilot journey.',
  robots: { index: false, follow: false },
}

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
