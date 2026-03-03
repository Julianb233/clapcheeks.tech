import Link from 'next/link'
import Navbar from '@/components/layout/navbar'
import Footer from '@/components/layout/footer'

const platforms = [
  {
    name: 'Tinder',
    emoji: '🔥',
    description:
      'The volume play. 100 right swipes/day, instant opener on match, full conversation automation.',
    tier: 'core',
  },
  {
    name: 'Hinge',
    emoji: '💘',
    description:
      'Quality over quantity. Rose strategy, targeted comment automation, date-booking focus.',
    tier: 'core',
  },
  {
    name: 'Bumble',
    emoji: '🐝',
    description:
      'She messages first — the AI handles her reply instantly. 60 right swipes/day.',
    tier: 'core',
  },
  {
    name: 'Grindr',
    emoji: '🟡',
    description:
      'Tap-based fast matching. Real-time reply mode for rapid-fire conversations.',
    tier: 'supported',
  },
  {
    name: 'Feeld',
    emoji: '✨',
    description:
      'Open to all connection types. Tone adapts accordingly for genuine conversations.',
    tier: 'supported',
  },
  {
    name: 'OkCupid',
    emoji: '💚',
    description:
      'Question-match analysis. Openers reference shared answers for high response rates.',
    tier: 'supported',
  },
  {
    name: 'Coffee Meets Bagel',
    emoji: '☕',
    description:
      'One curated match per day. Max-quality opener generation for that single shot.',
    tier: 'supported',
  },
  {
    name: 'Happn',
    emoji: '📍',
    description:
      'Location-based context baked into every opener. Hyper-personalized from the first message.',
    tier: 'supported',
  },
  {
    name: 'Plenty of Fish',
    emoji: '🐠',
    description:
      'High volume platform. Automated message filtering removes low-intent conversations.',
    tier: 'supported',
  },
  {
    name: 'Her',
    emoji: '🏳️‍🌈',
    description:
      'LGBTQ+ focused. Inclusive tone settings tuned for the Her community.',
    tier: 'supported',
  },
]

export default function PlatformsPage() {
  const corePlatforms = platforms.filter((p) => p.tier === 'core')
  const supportedPlatforms = platforms.filter((p) => p.tier === 'supported')

  return (
    <div className="min-h-screen bg-black text-white">
      <Navbar />

      {/* Background orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 right-1/4 w-[400px] h-[400px] rounded-full bg-[#C9A427]/5 blur-[130px]" />
        <div className="absolute bottom-1/3 left-1/5 w-64 h-64 rounded-full bg-[#C9A427]/4 blur-[90px]" />
      </div>

      <main className="relative z-10 pt-28 pb-24">
        <div className="max-w-6xl mx-auto px-6">

          {/* Header */}
          <div className="text-center mb-10">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium border border-[#C9A427]/30 bg-[#C9A427]/10 text-[#C9A427] mb-6">
              <span className="w-2 h-2 rounded-full bg-[#C9A427] animate-pulse" />
              10 platforms supported
            </span>
            <h1 className="text-5xl sm:text-6xl font-bold leading-tight mb-6">
              One Agent.{' '}
              <span className="gradient-text">Every Platform.</span>
            </h1>
            <p className="text-lg text-white/50 max-w-2xl mx-auto leading-relaxed">
              Clapcheeks runs across all major dating apps from a single dashboard.
              Set your preferences once — the agent adapts to each platform automatically.
            </p>
          </div>

          {/* Automation note */}
          <div className="glass-card rounded-2xl px-6 py-4 mb-14 max-w-3xl mx-auto flex items-start gap-4">
            <span className="text-[#C9A427] text-lg mt-0.5 flex-shrink-0">ℹ</span>
            <p className="text-sm text-white/50 leading-relaxed">
              Platform support is automated via Playwright browser automation.{' '}
              <span className="text-white/70">No API keys or rate-limit violations</span> —
              Clapcheeks operates through the same browser interface you use manually.
            </p>
          </div>

          {/* Core platforms */}
          <div className="mb-12">
            <div className="flex items-center gap-4 mb-6">
              <h2 className="text-xl font-bold text-white">Core Platforms</h2>
              <span className="text-xs px-3 py-1 rounded-full font-semibold uppercase tracking-wider"
                style={{
                  background: 'rgba(201,164,39,0.15)',
                  border: '1px solid rgba(201,164,39,0.3)',
                  color: '#C9A427',
                }}
              >
                Full automation
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {corePlatforms.map((platform) => (
                <PlatformCard key={platform.name} platform={platform} featured />
              ))}
            </div>
          </div>

          {/* Supported platforms */}
          <div>
            <div className="flex items-center gap-4 mb-6">
              <h2 className="text-xl font-bold text-white">Also Supported</h2>
              <span className="text-xs px-3 py-1 rounded-full font-semibold uppercase tracking-wider"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: 'rgba(255,255,255,0.4)',
                }}
              >
                Active automation
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {supportedPlatforms.map((platform) => (
                <PlatformCard key={platform.name} platform={platform} />
              ))}
            </div>
          </div>

          {/* Roadmap note */}
          <div className="mt-14 text-center">
            <p className="text-white/30 text-sm">
              More platforms added every month.{' '}
              <a
                href="mailto:hello@clapcheeks.tech"
                className="text-[#C9A427]/70 hover:text-[#C9A427] transition-colors underline underline-offset-2"
              >
                Request a platform
              </a>
            </p>
          </div>

          {/* CTA */}
          <div className="mt-16 text-center">
            <Link
              href="/auth/sign-up"
              className="btn-gold inline-flex items-center justify-center h-14 px-10 rounded-xl text-base"
            >
              Connect Your Apps
            </Link>
            <p className="mt-4 text-white/25 text-sm">
              All 10 platforms available on every plan
            </p>
          </div>

        </div>
      </main>

      <Footer />
    </div>
  )
}

function PlatformCard({
  platform,
  featured = false,
}: {
  platform: (typeof platforms)[number]
  featured?: boolean
}) {
  return (
    <div
      className={`alpha-card feature-card rounded-2xl p-6 flex flex-col gap-4 ${
        featured ? 'gold-border' : ''
      }`}
    >
      {/* Top row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.07)',
            }}
          >
            {platform.emoji}
          </div>
          <h3 className="font-bold text-white">{platform.name}</h3>
        </div>

        {/* Supported badge */}
        <span
          className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full flex items-center gap-1.5"
          style={{
            background: 'rgba(16,185,129,0.12)',
            border: '1px solid rgba(16,185,129,0.25)',
            color: '#10b981',
          }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
          Supported
        </span>
      </div>

      {/* Description */}
      <p className="text-sm text-white/45 leading-relaxed">{platform.description}</p>

      {/* Core badge */}
      {featured && (
        <div className="mt-auto">
          <span
            className="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full"
            style={{
              background: 'rgba(201,164,39,0.12)',
              border: '1px solid rgba(201,164,39,0.25)',
              color: '#C9A427',
            }}
          >
            Full automation
          </span>
        </div>
      )}
    </div>
  )
}
