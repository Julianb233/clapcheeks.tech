import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Intelligence',
  description: 'AI-powered opener generation and conversation intelligence.',
}

export default function IntelligenceLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
