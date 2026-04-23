import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ExternalLink } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Affiliate Dashboard — Clapcheeks',
  description: 'Manage your Clapcheeks affiliate account.',
}

export default function AffiliateDashboardPage() {
  const rewardfulKey = process.env.NEXT_PUBLIC_REWARDFUL_API_KEY
  const rewardfulDashboardUrl = process.env.NEXT_PUBLIC_REWARDFUL_DASHBOARD_URL

  // If Rewardful isn't configured yet, don't show an admin TODO to users — 404.
  if (!rewardfulKey) {
    notFound()
  }

  return (
    <div className="pt-16 pb-20 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-3">Affiliate Dashboard</h1>
          <p className="text-white/45 max-w-lg mx-auto">
            Track your referrals, commissions, and payouts.
          </p>
        </div>

        {/* Real Rewardful portal (iframe) */}
        {rewardfulDashboardUrl ? (
          <div className="bg-white/[0.03] border border-white/8 rounded-2xl overflow-hidden mb-8">
            <iframe
              src={rewardfulDashboardUrl}
              title="Affiliate dashboard"
              className="w-full h-[720px] bg-black"
            />
          </div>
        ) : (
          <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-8 text-center mb-8">
            <p className="text-white/60 text-sm">
              Your affiliate dashboard will appear here once your Rewardful account is
              activated. Until then, you can still track conversions via your referral
              links.
            </p>
          </div>
        )}

        <div className="flex items-center justify-center gap-4">
          <Link
            href="/affiliate/apply"
            className="text-brand-400 hover:text-brand-300 text-sm flex items-center gap-1.5 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Apply to become an affiliate
          </Link>
        </div>
      </div>
    </div>
  )
}
