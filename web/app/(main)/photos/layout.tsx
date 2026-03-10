import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Photo Scoring',
  description: 'Get AI feedback on your dating profile photos.',
}

export default function PhotosLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
