import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Referrals',
  description: 'Share Clapcheeks with friends and earn free months.',
}

export default function ReferralsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
