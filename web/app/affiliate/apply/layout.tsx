import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Apply to Affiliate Program | Clapcheeks',
  description: 'Join the Clapcheeks affiliate program and earn commissions.',
}

export default function AffiliateApplyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
