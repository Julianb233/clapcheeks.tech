import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Dashboard — Outward',
  description: 'Your Outward AI dating co-pilot dashboard.',
}

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-6">
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="orb w-96 h-96 bg-brand-600"
          style={{ top: '20%', left: '50%', transform: 'translateX(-50%)' }}
        />
      </div>

      <div className="relative text-center max-w-lg">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <span className="text-2xl font-bold gradient-text">Outward</span>
          <span className="text-xs text-white/30 font-mono bg-white/5 px-2 py-0.5 rounded">beta</span>
        </div>

        {/* Status badge */}
        <div className="inline-flex items-center gap-2 bg-brand-900/40 border border-brand-700/40 rounded-full px-4 py-1.5 mb-6">
          <div className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
          <span className="text-brand-300 text-xs font-medium">Local agent not detected</span>
        </div>

        <h1 className="text-3xl font-bold text-white mb-3">Your Dashboard</h1>
        <p className="text-white/50 text-base leading-relaxed mb-8">
          Install the Outward local agent to connect your dating apps and start tracking your analytics in real time.
        </p>

        {/* Install command */}
        <div className="code-block px-5 py-4 mb-6 text-left">
          <p className="text-white/30 text-xs font-mono mb-2"># Install Outward on your Mac</p>
          <pre className="text-sm font-mono text-brand-400 whitespace-pre-wrap break-all">
            curl -fsSL https://clapcheeks.tech/install.sh | bash
          </pre>
        </div>

        {/* Feature preview grid */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          {[
            { label: 'Swipes Today', value: '—' },
            { label: 'Matches', value: '—' },
            { label: 'Dates Booked', value: '—' },
          ].map((stat) => (
            <div
              key={stat.label}
              className="bg-white/3 border border-white/8 rounded-xl p-4"
            >
              <div className="text-2xl font-bold text-white/20 mb-1">{stat.value}</div>
              <div className="text-xs text-white/30">{stat.label}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/#how-it-works"
            className="bg-brand-600 hover:bg-brand-500 text-white font-medium px-6 py-3 rounded-xl transition-colors text-sm"
          >
            See how it works
          </Link>
          <Link
            href="/#pricing"
            className="bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium px-6 py-3 rounded-xl transition-colors text-sm"
          >
            View pricing
          </Link>
        </div>

        <p className="text-white/20 text-xs mt-6">
          macOS 13+ required &middot; Apple Silicon &amp; Intel supported
        </p>
      </div>
    </div>
  )
}
