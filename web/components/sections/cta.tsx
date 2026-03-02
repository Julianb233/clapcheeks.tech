'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Copy, Check, ChevronRight } from 'lucide-react'

const INSTALL_CMD = 'curl -fsSL https://clapcheeks.tech/install.sh | bash'

export default function CTA() {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(INSTALL_CMD)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section className="py-28 px-6 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="orb w-[800px] h-[800px] bg-brand-800"
          style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
        />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              'radial-gradient(circle at center, rgba(139,92,246,0.4) 0%, transparent 60%)',
          }}
        />
      </div>

      <div className="max-w-3xl mx-auto relative text-center">
        {/* Icon */}
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-brand-900/60">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <path
              d="M14 3L4 9V16C4 21 8.5 25.5 14 26.5C19.5 25.5 24 21 24 16V9L14 3Z"
              stroke="white"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <circle cx="14" cy="15" r="3" fill="white" />
          </svg>
        </div>

        <h2 className="text-4xl sm:text-5xl font-extrabold text-white mb-5 leading-tight">
          Ready to level up{' '}
          <span className="gradient-text">your dating life?</span>
        </h2>

        <p className="text-white/50 text-lg leading-relaxed max-w-xl mx-auto mb-10">
          Join thousands of people using Clap Cheeks to date smarter. Get matches, have better
          conversations, and book more dates — on autopilot.
        </p>

        {/* Install command */}
        <div className="flex items-center justify-between bg-white/3 border border-white/10 hover:border-brand-700/50 rounded-2xl px-5 py-4 mb-6 max-w-lg mx-auto group transition-all duration-300 glow-border">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-white/25 font-mono text-sm shrink-0">$</span>
            <code className="text-sm font-mono text-brand-400 truncate">{INSTALL_CMD}</code>
          </div>
          <button
            onClick={handleCopy}
            className="ml-3 shrink-0 p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-all duration-200"
            aria-label="Copy install command"
          >
            {copied ? (
              <Check size={14} className="text-emerald-400" />
            ) : (
              <Copy size={14} />
            )}
          </button>
        </div>

        {/* CTA buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-6">
          <Link
            href="/#pricing"
            className="group flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white font-semibold px-8 py-4 rounded-xl transition-all duration-200 shadow-xl shadow-brand-900/50 hover:shadow-brand-800/60 active:scale-[0.98] text-base"
          >
            Start free trial
            <ChevronRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
          </Link>
          <Link
            href="/dashboard"
            className="flex items-center gap-2 bg-white/5 hover:bg-white/8 border border-white/10 hover:border-white/20 text-white/80 hover:text-white font-semibold px-8 py-4 rounded-xl transition-all duration-200 text-base active:scale-[0.98]"
          >
            Sign in to dashboard
          </Link>
        </div>

        <p className="text-xs text-white/25">
          No credit card required for 7-day trial &middot; Cancel anytime &middot; macOS 13+
        </p>

        {/* Stats row */}
        <div className="mt-16 pt-12 border-t border-white/6 grid grid-cols-3 gap-8 max-w-md mx-auto">
          {[
            { value: '50k+', label: 'Swipes automated' },
            { value: '4.9★', label: 'Average rating' },
            { value: '7 days', label: 'Free trial' },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-2xl font-bold gradient-text mb-1">{stat.value}</div>
              <div className="text-xs text-white/30">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
