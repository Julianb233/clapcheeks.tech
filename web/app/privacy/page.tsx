import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, Shield } from 'lucide-react'
import PageOrbs from '@/components/page-orbs'

export const metadata: Metadata = {
  title: 'Privacy Policy — Clapcheeks',
  description: 'How Clapcheeks handles your data. Short version: your data stays on your Mac.',
}

function BulletIcon() {
  return (
    <svg className="w-4 h-4 text-brand-400 mt-0.5 shrink-0" viewBox="0 0 16 16" fill="none">
      <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.5 8l2 2 3.5-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function PrivacyPage() {
  return (
    <div className="relative min-h-screen bg-black">
      <PageOrbs />
      <div className="relative" style={{ zIndex: 1 }}>
        <div className="border-b border-white/6 px-6 py-4">
          <div className="max-w-3xl mx-auto">
            <Link href="/" className="flex items-center gap-2 text-white/40 hover:text-white/70 text-sm transition-colors w-fit">
              <ArrowLeft className="w-4 h-4" />
              Back to Clapcheeks
            </Link>
          </div>
        </div>

        <div className="max-w-3xl mx-auto px-6 py-16">
          {/* Privacy badge */}
          <div className="flex justify-center mb-6 animate-fade-in">
            <div className="inline-flex items-center gap-2 rounded-full bg-brand-500/10 border border-brand-500/20 px-4 py-1.5">
              <Shield className="w-4 h-4 text-brand-400" />
              <span className="text-brand-300 text-xs font-medium tracking-wide uppercase">Privacy First</span>
            </div>
          </div>

          <h1 className="text-4xl font-bold gradient-text mb-2 animate-slide-up text-center">Privacy Policy</h1>
          <p className="text-white/30 text-sm mb-12 animate-slide-up delay-150 text-center">Last updated: March 2026</p>

          <div className="prose-section space-y-8 text-white/60 text-sm leading-relaxed">
            <section className="animate-fade-in delay-150">
              <h2 className="text-xl font-semibold text-white mb-3">Overview</h2>
              <p>
                Clapcheeks is built with privacy at its core. The local agent runs entirely on your Mac. Your dating app messages, match data, photos, and personal conversations never leave your device. We only collect what is strictly necessary to operate the service.
              </p>
            </section>

            <section className="animate-fade-in delay-300">
              <h2 className="text-xl font-semibold text-white mb-3">What Stays on Your Mac</h2>
              <ul className="space-y-2.5">
                <li className="flex items-start gap-2.5"><BulletIcon />All dating app messages and conversation history</li>
                <li className="flex items-start gap-2.5"><BulletIcon />Match profiles, photos, and personal data</li>
                <li className="flex items-start gap-2.5"><BulletIcon />Your AI voice model and conversation style preferences</li>
                <li className="flex items-start gap-2.5"><BulletIcon />Browser sessions and dating app credentials</li>
                <li className="flex items-start gap-2.5"><BulletIcon />Local database of swipes, matches, and interactions</li>
              </ul>
            </section>

            <section className="animate-fade-in delay-500">
              <h2 className="text-xl font-semibold text-white mb-3">What We Collect</h2>
              <ul className="space-y-2.5">
                <li className="flex items-start gap-2.5"><BulletIcon /><span><strong className="text-brand-300">Account information:</strong> Email address, name (for authentication and billing)</span></li>
                <li className="flex items-start gap-2.5"><BulletIcon /><span><strong className="text-brand-300">Anonymized analytics:</strong> Aggregate swipe counts, match rates, and usage metrics (no personal content)</span></li>
                <li className="flex items-start gap-2.5"><BulletIcon /><span><strong className="text-brand-300">Billing data:</strong> Processed securely via Stripe. We never see or store your full card number</span></li>
                <li className="flex items-start gap-2.5"><BulletIcon /><span><strong className="text-brand-300">Agent heartbeat:</strong> Online/offline status of your local agent (no content transmitted)</span></li>
              </ul>
            </section>

            <section className="animate-fade-in delay-700">
              <h2 className="text-xl font-semibold text-white mb-3">How We Use Your Data</h2>
              <ul className="space-y-2.5">
                <li className="flex items-start gap-2.5"><BulletIcon />To authenticate your account and manage your subscription</li>
                <li className="flex items-start gap-2.5"><BulletIcon />To display your analytics dashboard in the web app</li>
                <li className="flex items-start gap-2.5"><BulletIcon />To improve our AI models using only anonymized, aggregate data</li>
                <li className="flex items-start gap-2.5"><BulletIcon />To send you product updates and important account notifications</li>
              </ul>
            </section>

            <section className="animate-fade-in delay-1000">
              <h2 className="text-xl font-semibold text-white mb-3">Third-Party Services</h2>
              <ul className="space-y-2.5">
                <li className="flex items-start gap-2.5"><BulletIcon /><span><strong className="text-brand-300">Supabase:</strong> Authentication and database hosting</span></li>
                <li className="flex items-start gap-2.5"><BulletIcon /><span><strong className="text-brand-300">Stripe:</strong> Payment processing</span></li>
                <li className="flex items-start gap-2.5"><BulletIcon /><span><strong className="text-brand-300">Vercel:</strong> Web application hosting and analytics</span></li>
              </ul>
            </section>

            <section className="animate-fade-in delay-1000">
              <h2 className="text-xl font-semibold text-white mb-3">Data Deletion</h2>
              <p>
                You can delete your account at any time from your dashboard settings. When you delete your account, we remove all your data from our servers within 30 days. Local data on your Mac is yours to keep or delete as you choose.
              </p>
            </section>

            <section className="animate-fade-in delay-1000">
              <h2 className="text-xl font-semibold text-white mb-3">Cookies</h2>
              <p>
                We use essential cookies for authentication and session management. We also use Vercel Analytics for anonymous page view tracking. We use a referral tracking cookie (30-day expiry) when you visit via a referral link.
              </p>
            </section>

            <section className="animate-fade-in delay-1000">
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
    </div>
  )
}
