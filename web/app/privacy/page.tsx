import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Privacy Policy — Outward',
  description: 'How Outward handles your data. Short version: your data stays on your Mac.',
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-black">
      <div className="border-b border-white/6 px-6 py-4">
        <div className="max-w-3xl mx-auto">
          <Link href="/" className="flex items-center gap-2 text-white/40 hover:text-white/70 text-sm transition-colors w-fit">
            <ArrowLeft className="w-4 h-4" />
            Back to Outward
          </Link>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold text-white mb-2">Privacy Policy</h1>
        <p className="text-white/30 text-sm mb-12">Last updated: March 2026</p>

        <div className="space-y-8 text-white/60 text-sm leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Overview</h2>
            <p>
              Outward is built with privacy at its core. The local agent runs entirely on your Mac. Your dating app messages, match data, photos, and personal conversations never leave your device. We only collect what is strictly necessary to operate the service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">What Stays on Your Mac</h2>
            <ul className="list-disc list-inside space-y-2">
              <li>All dating app messages and conversation history</li>
              <li>Match profiles, photos, and personal data</li>
              <li>Your AI voice model and conversation style preferences</li>
              <li>Browser sessions and dating app credentials</li>
              <li>Local database of swipes, matches, and interactions</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">What We Collect</h2>
            <ul className="list-disc list-inside space-y-2">
              <li><strong className="text-white">Account information:</strong> Email address, name (for authentication and billing)</li>
              <li><strong className="text-white">Anonymized analytics:</strong> Aggregate swipe counts, match rates, and usage metrics (no personal content)</li>
              <li><strong className="text-white">Billing data:</strong> Processed securely via Stripe. We never see or store your full card number</li>
              <li><strong className="text-white">Agent heartbeat:</strong> Online/offline status of your local agent (no content transmitted)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">How We Use Your Data</h2>
            <ul className="list-disc list-inside space-y-2">
              <li>To authenticate your account and manage your subscription</li>
              <li>To display your analytics dashboard in the web app</li>
              <li>To improve our AI models using only anonymized, aggregate data</li>
              <li>To send you product updates and important account notifications</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Third-Party Services</h2>
            <ul className="list-disc list-inside space-y-2">
              <li><strong className="text-white">Supabase:</strong> Authentication and database hosting</li>
              <li><strong className="text-white">Stripe:</strong> Payment processing</li>
              <li><strong className="text-white">Vercel:</strong> Web application hosting and analytics</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Data Deletion</h2>
            <p>
              You can delete your account at any time from your dashboard settings. When you delete your account, we remove all your data from our servers within 30 days. Local data on your Mac is yours to keep or delete as you choose.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Cookies</h2>
            <p>
              We use essential cookies for authentication and session management. We also use Vercel Analytics for anonymous page view tracking. We use a referral tracking cookie (30-day expiry) when you visit via a referral link.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Contact</h2>
            <p>
              Questions about this policy? Email us at{' '}
              <a href="mailto:privacy@clapcheeks.tech" className="text-brand-400 hover:text-brand-300 transition-colors">
                privacy@clapcheeks.tech
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
