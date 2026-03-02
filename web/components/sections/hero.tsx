'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Copy, Check, ChevronRight, ArrowDown } from 'lucide-react'

const INSTALL_CMD = 'curl -fsSL https://clapcheeks.tech/install.sh | bash'

export default function Hero() {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(INSTALL_CMD)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center pt-24 pb-20 px-6 overflow-hidden">
      {/* Background orbs */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="orb w-[700px] h-[700px] bg-brand-700"
          style={{ top: '-20%', left: '50%', transform: 'translateX(-50%)' }}
        />
        <div
          className="orb w-[400px] h-[400px] bg-pink-700"
          style={{ top: '30%', left: '10%' }}
        />
        <div
          className="orb w-[300px] h-[300px] bg-orange-700"
          style={{ top: '40%', right: '5%' }}
        />
        {/* Grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />
      </div>

      <div className="relative max-w-4xl mx-auto text-center">
        {/* Announcement badge */}
        <div className="inline-flex items-center gap-2 bg-brand-900/40 border border-brand-700/40 rounded-full px-4 py-1.5 mb-8 animate-fade-in">
          <div className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
          <span className="text-brand-300 text-xs font-medium">Now in public beta &mdash; 7 days free</span>
          <ChevronRight size={12} className="text-brand-400" />
        </div>

        {/* Main headline */}
        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.05] mb-6 animate-slide-up">
          <span className="text-white">Your AI</span>
          <br />
          <span className="gradient-text">Dating Co-Pilot</span>
        </h1>

        {/* Subheadline */}
        <p className="text-lg sm:text-xl text-white/55 leading-relaxed max-w-2xl mx-auto mb-10 animate-fade-in">
          Clapcheeks automates your dating apps, manages your conversations in{' '}
          <span className="text-white/80">your voice</span>, tracks your spending and conversion
          rates &mdash; all running{' '}
          <span className="text-white/80">privately on your Mac</span>.
        </p>

        {/* Install command */}
        <div className="flex items-center justify-between bg-white/3 border border-white/10 rounded-2xl px-5 py-4 mb-6 max-w-xl mx-auto group hover:border-brand-700/50 transition-all duration-300 glow-border">
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

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
          <Link
            href="/#pricing"
            className="group flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white font-semibold px-8 py-4 rounded-xl transition-all duration-200 shadow-xl shadow-brand-900/50 hover:shadow-brand-800/60 animate-glow active:scale-[0.98] text-base"
          >
            Download Free
            <ChevronRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
          </Link>
          <a
            href="#how-it-works"
            className="flex items-center gap-2 bg-white/5 hover:bg-white/8 border border-white/10 hover:border-white/20 text-white/80 hover:text-white font-semibold px-8 py-4 rounded-xl transition-all duration-200 text-base active:scale-[0.98]"
          >
            See how it works
            <ArrowDown size={16} className="animate-bounce" />
          </a>
        </div>

        {/* Trust badges */}
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-white/30">
          <div className="flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 1L7.5 4.5H11L8.5 6.5L9.5 10L6 8L2.5 10L3.5 6.5L1 4.5H4.5L6 1Z" fill="currentColor" opacity="0.6" />
            </svg>
            Privacy-first
          </div>
          <span className="text-white/15">&middot;</span>
          <div className="flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="2" y="5" width="8" height="6" rx="1" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.2" />
              <path d="M4 5V3.5C4 2.12 4.9 1 6 1C7.1 1 8 2.12 8 3.5V5" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.2" />
            </svg>
            All data stays on your Mac
          </div>
          <span className="text-white/15">&middot;</span>
          <span>Supports Tinder, Bumble, Hinge</span>
        </div>

        {/* Social proof */}
        <div className="mt-16 pt-16 border-t border-white/6">
          <p className="text-xs text-white/25 mb-6 uppercase tracking-widest font-medium">Works with</p>
          <div className="flex flex-wrap items-center justify-center gap-8">
            {['Tinder', 'Bumble', 'Hinge', 'iMessage', 'Calendar'].map((app) => (
              <span
                key={app}
                className="text-sm font-semibold text-white/20 tracking-wide"
              >
                {app}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
