import type { Metadata } from 'next'
import Link from 'next/link'
import Navbar from '@/components/layout/navbar'
import Footer from '@/components/layout/footer'

export const metadata: Metadata = {
  title: 'Features | Clapcheeks',
  description: 'Everything Clapcheeks can do — AI openers, automated swiping, conversation management and more.',
}

const features = [
  {
    id: 'swiping',
    emoji: '👆',
    title: 'AI-Powered Swiping',
    subtitle:
      'The agent evaluates every profile against your preferences and swipes at human-like speed.',
    bullets: [
      'Profile photo analysis using computer vision',
      'Bio keyword matching against your preference profile',
      'Age and distance filters respected at all times',
      'Gaussian timing delays to mimic natural human behavior',
    ],
  },
  {
    id: 'autopilot',
    emoji: '💬',
    title: 'Conversation Autopilot',
    subtitle:
      'Personalized openers. Context-aware replies. Your voice, scaled infinitely.',
    bullets: [
      'NLP tone mirroring — sounds like you, not a bot',
      'Cialdini influence principles baked into message flow',
      'Handles multiple conversations simultaneously',
      'Escalates toward date-setting naturally over time',
    ],
  },
  {
    id: 'booking',
    emoji: '📅',
    title: 'Auto Date Booking',
    subtitle: 'Detects when she\'s ready. Proposes a spot. Books it.',
    bullets: [
      'Date-intent signal detection from conversation patterns',
      'Google Calendar integration for availability checking',
      'Venue suggestions based on your location and preferences',
      'Sends confirmation messages automatically',
    ],
  },
  {
    id: 'platforms',
    emoji: '📱',
    title: 'Cross-Platform',
    subtitle: '10 apps, one agent.',
    bullets: [
      'Tinder, Hinge, Bumble — fully automated core three',
      'Grindr, Feeld, OkCupid, Coffee Meets Bagel',
      'Happn, Plenty of Fish, Her',
      'Single dashboard controls all platforms simultaneously',
    ],
  },
  {
    id: 'analytics',
    emoji: '📊',
    title: 'Analytics Dashboard',
    subtitle: 'Know what\'s working.',
    bullets: [
      'Swipe-to-match rates per platform and preference set',
      'Conversion funnel visualization from match to date',
      'Platform comparison charts — see where you perform best',
      'Spending tracker across platform subscriptions',
    ],
  },
  {
    id: 'privacy',
    emoji: '🔒',
    title: 'Privacy First',
    subtitle: 'Zero cloud data.',
    bullets: [
      'All messages and conversations stay on your Mac',
      'Only anonymized metrics ever sync to the cloud',
      'No third-party data sharing — ever',
      'Open source agent code — verify it yourself',
    ],
  },
]

export default function FeaturesPage() {
  return (
    <div className="min-h-screen bg-black text-white">
      <Navbar />

      {/* Background orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/3 w-[500px] h-[500px] rounded-full bg-[#C9A427]/4 blur-[140px]" />
        <div className="absolute bottom-1/4 right-1/5 w-72 h-72 rounded-full bg-[#C9A427]/3 blur-[100px]" />
      </div>

      <main className="relative z-10 pt-28 pb-24">
        <div className="max-w-6xl mx-auto px-6">

          {/* Header */}
          <div className="text-center mb-20">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium border border-[#C9A427]/30 bg-[#C9A427]/10 text-[#C9A427] mb-6">
              <span className="w-2 h-2 rounded-full bg-[#C9A427] animate-pulse" />
              Full feature suite
            </span>
            <h1 className="text-5xl sm:text-6xl font-bold leading-tight mb-6">
              Everything You Need to{' '}
              <span className="gradient-text">Win</span>
            </h1>
            <p className="text-lg text-white/50 max-w-2xl mx-auto leading-relaxed">
              Clapcheeks is not a simple swipe bot. It&apos;s a full-stack dating
              intelligence system — from first impression to booked date.
            </p>
          </div>

          {/* Features grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature) => (
              <div
                key={feature.id}
                className="alpha-card feature-card rounded-2xl p-8 flex flex-col"
              >
                {/* Icon */}
                <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-5 text-2xl"
                  style={{
                    background: 'rgba(201,164,39,0.1)',
                    border: '1px solid rgba(201,164,39,0.2)',
                  }}
                >
                  {feature.emoji}
                </div>

                <h2 className="text-xl font-bold text-white mb-2">{feature.title}</h2>
                <p className="text-white/45 text-sm leading-relaxed mb-5">
                  {feature.subtitle}
                </p>

                <ul className="space-y-3 mt-auto">
                  {feature.bullets.map((bullet, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center"
                        style={{
                          background: 'rgba(201,164,39,0.15)',
                          border: '1px solid rgba(201,164,39,0.3)',
                        }}
                      >
                        <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                          <path d="M1 3L3 5L7 1" stroke="#C9A427" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                      <span className="text-sm text-white/60 leading-snug">{bullet}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Bottom stats row */}
          <div className="mt-16 glass-card rounded-2xl p-8 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { value: '10', label: 'Dating platforms' },
              { value: '60s', label: 'Install time' },
              { value: '24/7', label: 'Agent runtime' },
              { value: '100%', label: 'Local data' },
            ].map((stat) => (
              <div key={stat.label}>
                <p className="text-3xl font-bold gradient-text mb-1"
                  style={{ fontFamily: 'var(--font-bebas), Impact, sans-serif', letterSpacing: '0.04em' }}
                >
                  {stat.value}
                </p>
                <p className="text-xs text-white/40 uppercase tracking-wider">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="mt-20 text-center">
            <Link
              href="/auth/sign-up"
              className="btn-gold inline-flex items-center justify-center h-14 px-10 rounded-xl text-base"
            >
              Start Your Free Trial
            </Link>
            <p className="mt-4 text-white/25 text-sm">
              All features included during beta &mdash; no credit card required
            </p>
          </div>

        </div>
      </main>

      <Footer />
    </div>
  )
}
