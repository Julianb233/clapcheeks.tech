import type { Metadata } from 'next'
import Link from 'next/link'
import Navbar from '@/components/layout/navbar'
import Footer from '@/components/layout/footer'

export const metadata: Metadata = {
  title: 'How It Works | Clapcheeks',
  description: 'Learn how to set up and use Clapcheeks in minutes.',
}

const steps = [
  {
    number: '01',
    title: 'Install the Agent',
    description:
      'Run one command on your Mac. The Clapcheeks daemon installs in under 60 seconds.',
    code: 'curl -fsSL https://clapcheeks.tech/install.sh | bash',
    hasCode: true,
  },
  {
    number: '02',
    title: 'Connect Your Apps',
    description:
      'Log into Tinder, Hinge, Bumble once. Sessions persist — no re-auth needed.',
    hasCode: false,
  },
  {
    number: '03',
    title: 'Set Your Preferences',
    description:
      'Tell the AI your type, your vibe, your conversation style. It adapts to you.',
    hasCode: false,
  },
  {
    number: '04',
    title: 'Let It Run',
    description:
      'The agent swipes, messages, and books dates. You get notified when someone\'s ready to meet.',
    hasCode: false,
  },
]

const requirements = [
  { label: 'Operating System', value: 'macOS 12 Monterey or later' },
  { label: 'Architecture', value: 'Apple Silicon (M1+) or Intel' },
  { label: 'RAM', value: '4GB minimum' },
  { label: 'Storage', value: '500MB free space' },
]

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-black text-white">
      <Navbar />

      {/* Background orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-[#C9A427]/5 blur-[120px]" />
        <div className="absolute bottom-1/3 right-1/4 w-80 h-80 rounded-full bg-[#C9A427]/4 blur-[100px]" />
      </div>

      <main className="relative z-10 pt-28 pb-24">
        <div className="max-w-5xl mx-auto px-6">

          {/* Header */}
          <div className="text-center mb-20">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium border border-[#C9A427]/30 bg-[#C9A427]/10 text-[#C9A427] mb-6">
              <span className="w-2 h-2 rounded-full bg-[#C9A427] animate-pulse" />
              Setup in 60 seconds
            </span>
            <h1 className="text-5xl sm:text-6xl font-bold leading-tight mb-6">
              How{' '}
              <span className="gradient-text">Clapcheeks</span>{' '}
              Works
            </h1>
            <p className="text-lg text-white/50 max-w-xl mx-auto leading-relaxed">
              From install to your first automated date booking — four steps,
              no technical experience required.
            </p>
          </div>

          {/* Steps */}
          <div className="relative">
            {/* Vertical connector line */}
            <div className="hidden md:block absolute left-[2.75rem] top-12 bottom-12 w-px bg-gradient-to-b from-[#C9A427]/40 via-[#C9A427]/20 to-transparent" />

            <div className="space-y-10">
              {steps.map((step, idx) => (
                <div
                  key={step.number}
                  className="relative flex flex-col md:flex-row gap-6 md:gap-10"
                >
                  {/* Number badge */}
                  <div className="flex-shrink-0">
                    <div
                      className="w-[5.5rem] h-[5.5rem] rounded-2xl flex items-center justify-center relative z-10"
                      style={{
                        background:
                          'linear-gradient(135deg, rgba(201,164,39,0.15) 0%, rgba(201,164,39,0.05) 100%)',
                        border: '1px solid rgba(201,164,39,0.3)',
                      }}
                    >
                      <span
                        className="text-3xl font-bold gradient-text"
                        style={{ fontFamily: 'var(--font-bebas), Impact, sans-serif' }}
                      >
                        {step.number}
                      </span>
                    </div>
                  </div>

                  {/* Content card */}
                  <div className="flex-1 alpha-card rounded-2xl p-8 gold-border-hover">
                    {/* Step label */}
                    <p className="text-xs font-semibold text-[#C9A427]/60 uppercase tracking-widest mb-2">
                      Step {idx + 1} of {steps.length}
                    </p>
                    <h2 className="text-2xl font-bold text-white mb-3">{step.title}</h2>
                    <p className="text-white/50 leading-relaxed mb-4">{step.description}</p>

                    {step.hasCode && step.code && (
                      <div className="code-block px-5 py-4 rounded-xl mt-4">
                        <p className="text-[10px] text-white/25 font-mono mb-2 uppercase tracking-wider">
                          Terminal
                        </p>
                        <p className="text-sm font-mono text-[#C9A427] break-all select-all">
                          {step.code}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Requirements */}
          <div className="mt-20">
            <h2 className="text-2xl font-bold text-white mb-8 text-center">
              System Requirements
            </h2>
            <div className="glass-card rounded-2xl p-8 grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl mx-auto">
              {requirements.map((req) => (
                <div key={req.label} className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-[#C9A427]/60 uppercase tracking-wider">
                    {req.label}
                  </span>
                  <span className="text-white/80 font-medium">{req.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* CTA */}
          <div className="mt-20 text-center">
            <p className="text-white/40 text-sm mb-6">
              Ready to automate your dating life?
            </p>
            <Link
              href="/auth/sign-up"
              className="btn-gold inline-flex items-center justify-center h-14 px-10 rounded-xl text-base"
            >
              Get Started Free
            </Link>
            <p className="mt-4 text-white/25 text-sm">
              No credit card required &mdash; free trial included
            </p>
          </div>

        </div>
      </main>

      <Footer />
    </div>
  )
}
