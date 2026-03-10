import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'AI Coaching',
  description: 'Get AI-powered dating tips and conversation coaching.',
}

export default function CoachingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
