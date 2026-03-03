import type { Metadata } from 'next'
import Link from 'next/link'
import Navbar from '@/components/layout/navbar'
import Footer from '@/components/layout/footer'

export const metadata: Metadata = {
  title: 'Download | Clapcheeks',
  description: 'Install the Clapcheeks Mac agent with one command.',
}

const systemRequirements = [
  { icon: '🍎', label: 'macOS 12 Monterey or later' },
  { icon: '💻', label: 'Apple Silicon (M1+) or Intel' },
  { icon: '🧠', label: '4GB RAM minimum' },
  { icon: '📡', label: 'Internet connection required' },
]

const whatGetsInstalled = [
  {
    name: 'Clapcheeks daemon',
    size: '~45MB',
    description: 'The core background agent that runs your automation',
  },
  {
    name: 'Browser profiles',
    size: '~80MB',
    description: 'Isolated browser sessions for each dating platform',
  },
  {
    name: 'Local AI model',
    size: '~4GB',
    description: 'Ollama-powered conversation engine (optional, improves quality)',
  },
  {
    name: 'CLI tools',
    size: '<1MB',
    description: 'clapcheeks start · clapcheeks status · clapcheeks stop',
  },
]

const afterInstallSteps = [
  {
    step: '1',
    command: 'clapcheeks setup',
    label: 'Run initial setup',
    description: 'Walks you through preferences, platforms, and conversation style.',
  },
  {
    step: '2',
    command: null,
    label: 'Log into your apps',
    description: 'Clapcheeks opens each platform in a managed browser. Log in once — sessions persist.',
  },
  {
    step: '3',
    command: 'clapcheeks start',
    label: 'Start the agent',
    description: 'The daemon launches in the background and begins working immediately.',
  },
]

export default function DownloadPage() {
  return (
    <div className="min-h-screen bg-black text-white">
      <Navbar />

      {/* Background orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/4 w-[500px] h-[500px] rounded-full bg-[#C9A427]/5 blur-[150px]" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full bg-[#C9A427]/3 blur-[100px]" />
      </div>

      <main className="relative z-10 pt-28 pb-24">
        <div className="max-w-4xl mx-auto px-6">

          {/* Hero */}
          <div className="text-center mb-14">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium border border-[#C9A427]/30 bg-[#C9A427]/10 text-[#C9A427] mb-6">
              <span className="w-2 h-2 rounded-full bg-[#C9A427] animate-pulse" />
              macOS only &mdash; Windows coming soon
            </span>
            <h1 className="text-5xl sm:text-7xl font-bold leading-tight mb-6">
              Get Started in{' '}
              <span className="gradient-text">60 Seconds</span>
            </h1>
            <p className="text-lg text-white/50 max-w-xl mx-auto leading-relaxed">
              One command installs everything. No Homebrew, no dependencies,
              no configuration files to edit by hand.
            </p>
          </div>

          {/* Install command */}
          <div className="mb-14">
            <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-3 text-center">
              Paste in Terminal
            </p>
            <div
              className="code-block rounded-2xl px-6 py-6 flex flex-col sm:flex-row items-start sm:items-center gap-4"
            >
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-white/20 font-mono mb-2 uppercase tracking-wider">
                  bash
                </p>
                <p className="text-base sm:text-lg font-mono text-[#C9A427] break-all select-all leading-relaxed">
                  curl -fsSL https://clapcheeks.tech/install.sh | bash
                </p>
              </div>
              {/* Copy hint */}
              <div className="flex-shrink-0">
                <span
                  className="text-xs font-medium px-3 py-2 rounded-lg cursor-default select-none"
                  style={{
                    background: 'rgba(201,164,39,0.1)',
                    border: '1px solid rgba(201,164,39,0.2)',
                    color: 'rgba(201,164,39,0.7)',
                  }}
                >
                  Select &amp; copy
                </span>
              </div>
            </div>

            {/* Primary CTA under install command */}
            <div className="mt-8 text-center">
              <Link
                href="/auth/sign-up"
                className="btn-gold inline-flex items-center justify-center h-14 px-12 rounded-xl text-base"
              >
                Create Free Account
              </Link>
              <p className="mt-3 text-white/25 text-sm">
                Account required to activate the agent after install
              </p>
            </div>
          </div>

          <hr className="section-slash mb-14" />

          {/* Two column: requirements + what gets installed */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-14">

            {/* System requirements */}
            <div className="alpha-card rounded-2xl p-7">
              <h2 className="text-lg font-bold text-white mb-5">System Requirements</h2>
              <ul className="space-y-4">
                {systemRequirements.map((req) => (
                  <li key={req.label} className="flex items-center gap-4">
                    <span className="text-xl w-8 text-center flex-shrink-0">{req.icon}</span>
                    <span className="text-sm text-white/60 leading-snug">{req.label}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* What gets installed */}
            <div className="alpha-card rounded-2xl p-7">
              <h2 className="text-lg font-bold text-white mb-5">What Gets Installed</h2>
              <ul className="space-y-5">
                {whatGetsInstalled.map((item) => (
                  <li key={item.name} className="flex items-start gap-3">
                    <span
                      className="mt-0.5 flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded font-mono"
                      style={{
                        background: 'rgba(201,164,39,0.1)',
                        border: '1px solid rgba(201,164,39,0.2)',
                        color: '#C9A427',
                      }}
                    >
                      {item.size}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-white/80">{item.name}</p>
                      <p className="text-xs text-white/35 leading-snug mt-0.5">{item.description}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* After install steps */}
          <div className="mb-14">
            <h2 className="text-2xl font-bold text-white mb-8 text-center">
              After Install
            </h2>
            <div className="space-y-4">
              {afterInstallSteps.map((item) => (
                <div
                  key={item.step}
                  className="glass-card rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center gap-5"
                >
                  {/* Step number */}
                  <div
                    className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg"
                    style={{
                      background: 'linear-gradient(135deg, rgba(201,164,39,0.2), rgba(201,164,39,0.05))',
                      border: '1px solid rgba(201,164,39,0.3)',
                      color: '#C9A427',
                      fontFamily: 'var(--font-bebas), Impact, sans-serif',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {item.step}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-white mb-1">{item.label}</p>
                    {item.command && (
                      <code
                        className="inline-block text-sm font-mono px-3 py-1 rounded-lg mb-2"
                        style={{
                          background: 'rgba(201,164,39,0.08)',
                          border: '1px solid rgba(201,164,39,0.15)',
                          color: '#C9A427',
                        }}
                      >
                        {item.command}
                      </code>
                    )}
                    <p className="text-sm text-white/40 leading-relaxed">{item.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sign in link */}
          <div className="text-center">
            <p className="text-white/30 text-sm">
              Already have an account?{' '}
              <Link
                href="/auth/sign-in"
                className="text-[#C9A427]/70 hover:text-[#C9A427] transition-colors underline underline-offset-2"
              >
                Sign in
              </Link>
            </p>
          </div>

        </div>
      </main>

      <Footer />
    </div>
  )
}
