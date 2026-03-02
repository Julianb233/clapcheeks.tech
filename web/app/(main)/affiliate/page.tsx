import type { Metadata } from 'next'
import Link from 'next/link'
import { ExternalLink, Settings } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Affiliate Dashboard — Outward',
  description: 'Manage your Outward affiliate account.',
}

export default function AffiliateDashboardPage() {
  return (
    <div className="pt-16 pb-20 px-6">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-white mb-3">Affiliate Dashboard</h1>
          <p className="text-white/45 max-w-lg mx-auto">
            Track your referrals, commissions, and payouts.
          </p>
        </div>

        {/* Placeholder for Rewardful integration */}
        <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-8 text-center mb-8">
          <Settings className="w-10 h-10 text-white/20 mx-auto mb-4" />
          <h2 className="text-white font-semibold mb-2">Rewardful Dashboard Coming Soon</h2>
          <p className="text-white/40 text-sm mb-6 max-w-md mx-auto">
            Once your affiliate account is approved, your real-time tracking dashboard will appear here.
            You'll be able to see clicks, signups, commissions, and payout history.
          </p>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-left max-w-md mx-auto">
            <p className="text-white/30 text-xs font-mono mb-2">Integration setup (admin):</p>
            <p className="text-white/50 text-xs font-mono">
              1. Set <code className="text-brand-400">NEXT_PUBLIC_REWARDFUL_API_KEY</code> in .env<br />
              2. Add Rewardful script to layout.tsx<br />
              3. Embed affiliate portal iframe here
            </p>
          </div>
        </div>

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
