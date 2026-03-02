import Link from 'next/link'
import { Check, ChevronRight, Smartphone, Zap, Mail, Terminal, Shield } from 'lucide-react'

export const metadata = {
  title: 'Dedicated Device Add-On — Clap Cheeks',
  description:
    'Plug in a $99 Android phone and let Clap Cheeks swipe 24/7. No laptop required. Matches waiting when you wake up.',
}

// ── Hero ──────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="relative min-h-[90vh] flex flex-col items-center justify-center pt-28 pb-20 px-6 overflow-hidden">
      {/* Background orbs */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="orb w-[700px] h-[700px] bg-brand-800"
          style={{ top: '-15%', left: '50%', transform: 'translateX(-50%)' }}
        />
        <div
          className="orb w-[400px] h-[400px] bg-pink-900"
          style={{ top: '35%', left: '-5%' }}
        />
        <div
          className="orb w-[300px] h-[300px] bg-purple-900"
          style={{ top: '30%', right: '0%' }}
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
        {/* Badge */}
        <div className="inline-flex items-center gap-2 bg-brand-900/40 border border-brand-700/40 rounded-full px-4 py-1.5 mb-8">
          <div className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
          <span className="text-brand-300 text-xs font-medium">Always-On Device Add-On</span>
        </div>

        {/* Headline */}
        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.05] mb-6">
          <span className="text-white">Set It and</span>
          <br />
          <span className="gradient-text">Forget It. Swipe 24/7.</span>
        </h1>

        {/* Subheadline */}
        <p className="text-lg sm:text-xl text-white/55 leading-relaxed max-w-2xl mx-auto mb-10">
          Plug in a{' '}
          <span className="text-white/80">$99 Android phone</span>. Let Clap Cheeks run your
          dating apps around the clock &mdash; even when your{' '}
          <span className="text-white/80">laptop is closed</span>.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
          <Link
            href="/#pricing"
            className="group flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white font-semibold px-8 py-4 rounded-xl transition-all duration-200 shadow-xl shadow-brand-900/50 hover:shadow-brand-800/60 active:scale-[0.98] text-base"
          >
            Add Device Plan &mdash; $49/mo
            <ChevronRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
          </Link>
          <a
            href="#how-it-works"
            className="flex items-center gap-2 bg-white/5 hover:bg-white/8 border border-white/10 hover:border-white/20 text-white/80 hover:text-white font-semibold px-8 py-4 rounded-xl transition-all duration-200 text-base active:scale-[0.98]"
          >
            See how it works
          </a>
        </div>

        {/* Device diagram */}
        <div className="flex items-center justify-center gap-4 sm:gap-6 mt-4">
          {/* Phone */}
          <div className="flex flex-col items-center gap-2">
            <div className="w-16 h-28 sm:w-20 sm:h-36 bg-white/[0.04] border border-white/12 rounded-2xl flex flex-col items-center justify-center gap-2 shadow-xl">
              <Smartphone size={24} className="text-brand-400" />
              <div className="text-[10px] text-white/30 font-mono">Android</div>
            </div>
            <span className="text-xs text-white/30">Your phone</span>
          </div>

          {/* Arrow */}
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-1">
              <div className="h-px w-8 sm:w-12 bg-gradient-to-r from-brand-700/30 to-brand-500" />
              <div className="w-1.5 h-1.5 rounded-full bg-brand-400" />
              <div className="h-px w-8 sm:w-12 bg-gradient-to-r from-brand-500 to-brand-700/30" />
            </div>
            <span className="text-[10px] text-white/20 font-mono">Wi-Fi</span>
          </div>

          {/* Server */}
          <div className="flex flex-col items-center gap-2">
            <div className="w-16 h-28 sm:w-20 sm:h-36 bg-white/[0.04] border border-brand-700/30 rounded-2xl flex flex-col items-center justify-center gap-2 shadow-xl shadow-brand-900/30">
              <Zap size={24} className="text-brand-400" />
              <div className="text-[10px] text-white/30 font-mono">Clap Cheeks</div>
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <span className="text-xs text-white/30">AI engine</span>
          </div>

          {/* Arrow */}
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-1">
              <div className="h-px w-8 sm:w-12 bg-gradient-to-r from-brand-700/30 to-pink-500/60" />
              <div className="w-1.5 h-1.5 rounded-full bg-pink-400" />
              <div className="h-px w-8 sm:w-12 bg-gradient-to-r from-pink-500/60 to-brand-700/30" />
            </div>
            <span className="text-[10px] text-white/20 font-mono">matches</span>
          </div>

          {/* Matches */}
          <div className="flex flex-col items-center gap-2">
            <div className="w-16 h-28 sm:w-20 sm:h-36 bg-white/[0.04] border border-pink-800/40 rounded-2xl flex flex-col items-center justify-center gap-1.5 shadow-xl">
              <div className="text-lg">+23</div>
              <div className="text-[10px] text-pink-400 font-semibold">matches</div>
              <div className="text-[10px] text-white/20">while you slept</div>
            </div>
            <span className="text-xs text-white/30">Your inbox</span>
          </div>
        </div>
      </div>
    </section>
  )
}

// ── How It Works ──────────────────────────────────────────────────────────────

const steps = [
  {
    number: '01',
    title: 'Get any Android phone',
    description:
      'We recommend the Motorola Moto G (~$89 on Amazon). Any Android 10+ works. You probably have one in a drawer already.',
    detail: 'iPhone also works but requires a Mac running 24/7. Android is simpler and cheaper.',
  },
  {
    number: '02',
    title: 'Plug it into power',
    description:
      'Leave it on your desk, nightstand, or a shelf. One USB cable. That\'s the whole "setup." No rooting, no developer mode, no configuration.',
    detail: 'The device stays on your local network. Nothing is exposed to the internet.',
  },
  {
    number: '03',
    title: 'Clap Cheeks runs 24/7',
    description:
      'Swipes while you sleep. Sends opening messages when you\'re in meetings. Keeps conversations moving when you\'re living your life. Matches waiting when you wake up.',
    detail: 'Human-like timing and session patterns. No suspicious bot behavior.',
  },
]

function HowItWorks() {
  return (
    <section id="how-it-works" className="py-28 px-6 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="orb w-[600px] h-[600px] bg-brand-900"
          style={{ top: '-5%', left: '-10%' }}
        />
      </div>

      <div className="max-w-7xl mx-auto relative">
        <div className="text-center mb-20">
          <div className="inline-flex items-center gap-2 bg-brand-900/40 border border-brand-700/40 rounded-full px-4 py-1.5 mb-5">
            <span className="text-brand-300 text-xs font-medium">Three steps</span>
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-5">
            Up and running in minutes
          </h2>
          <p className="text-white/45 text-lg max-w-lg mx-auto leading-relaxed">
            If you can plug in a phone charger, you can set this up.
          </p>
        </div>

        <div className="max-w-4xl mx-auto">
          {steps.map((step, i) => (
            <div key={step.number} className="flex gap-8 mb-16 last:mb-0 group">
              <div className="flex flex-col items-center shrink-0">
                <div className="w-12 h-12 rounded-2xl bg-brand-900/60 border border-brand-700/50 flex items-center justify-center group-hover:bg-brand-800/60 group-hover:border-brand-600/60 transition-all duration-300">
                  <span className="text-brand-400 text-sm font-bold font-mono">{step.number}</span>
                </div>
                {i < steps.length - 1 && (
                  <div className="w-px flex-1 mt-4 bg-gradient-to-b from-brand-800/50 to-transparent" />
                )}
              </div>

              <div className="pb-4 min-w-0">
                <h3 className="text-xl font-bold text-white mb-3 group-hover:text-brand-300 transition-colors">
                  {step.title}
                </h3>
                <p className="text-white/50 leading-relaxed mb-4">{step.description}</p>
                <p className="text-xs text-white/25 flex items-start gap-1.5">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="mt-0.5 shrink-0">
                    <circle cx="6" cy="6" r="5" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.2" />
                    <path d="M6 5v4M6 3.5v.5" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  {step.detail}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── What You Get ──────────────────────────────────────────────────────────────

const features = [
  {
    icon: <Zap size={20} className="text-brand-400" />,
    title: '24/7 autonomous swiping',
    description: 'Tinder, Bumble, and Hinge running around the clock on all three simultaneously.',
  },
  {
    icon: <Shield size={20} className="text-brand-400" />,
    title: 'Human-like behavior',
    description: 'Randomized delays, session limits, natural scroll patterns. No ban risk.',
  },
  {
    icon: <Mail size={20} className="text-brand-400" />,
    title: 'Daily match digest',
    description: 'Email every morning with new matches, conversation updates, and stats.',
  },
  {
    icon: <Check size={20} className="text-brand-400" />,
    title: 'Works with your existing plan',
    description: 'Stacks on top of Starter, Pro, or Elite. iMessage AI still runs on your Mac.',
  },
  {
    icon: <Terminal size={20} className="text-brand-400" />,
    title: 'Remote control via CLI',
    description: (
      <>
        <code className="text-brand-400 text-xs bg-white/5 px-1.5 py-0.5 rounded font-mono">clapcheeks device status</code>
        {' '}and{' '}
        <code className="text-brand-400 text-xs bg-white/5 px-1.5 py-0.5 rounded font-mono">clapcheeks device pause</code>
        {' '}from anywhere.
      </>
    ),
  },
  {
    icon: <Smartphone size={20} className="text-brand-400" />,
    title: 'No laptop required',
    description: 'Close your MacBook. Pack your bag. The device keeps going independently.',
  },
]

function WhatYouGet() {
  return (
    <section className="py-28 px-6 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="orb w-[500px] h-[500px] bg-pink-900/40"
          style={{ top: '10%', right: '-10%' }}
        />
      </div>

      <div className="max-w-7xl mx-auto relative">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-brand-900/40 border border-brand-700/40 rounded-full px-4 py-1.5 mb-5">
            <span className="text-brand-300 text-xs font-medium">What&apos;s included</span>
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-5">
            Everything always on
          </h2>
          <p className="text-white/45 text-lg max-w-lg mx-auto leading-relaxed">
            Add $49/mo to any plan. The device does the heavy lifting while you live your life.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-5xl mx-auto">
          {features.map((f, i) => (
            <div
              key={i}
              className="bg-white/[0.02] border border-white/8 hover:border-brand-700/40 rounded-2xl p-6 transition-all duration-300 group"
            >
              <div className="w-10 h-10 rounded-xl bg-brand-900/60 border border-brand-700/40 flex items-center justify-center mb-4 group-hover:bg-brand-800/60 transition-colors">
                {f.icon}
              </div>
              <h3 className="text-base font-semibold text-white mb-2">{f.title}</h3>
              <p className="text-sm text-white/45 leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Android vs iPhone comparison ──────────────────────────────────────────────

function ComparisonTable() {
  const rows = [
    { label: 'Upfront cost', android: '~$89 (Moto G)', iphone: '$699+ (iPhone 14)' },
    { label: 'Needs Mac running?', android: 'No', iphone: 'Yes (for iMessage bridge)' },
    { label: '24/7 swiping', android: 'Yes', iphone: 'Yes, but Mac must stay on' },
    { label: 'Setup complexity', android: 'Plug in + done', iphone: 'Mac config required' },
    { label: 'Power draw', android: 'Minimal (charger only)', iphone: 'Mac + iPhone charging' },
    { label: 'Recommended?', android: 'Yes — best choice', iphone: 'Use if you already have one' },
  ]

  return (
    <section className="py-28 px-6 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="orb w-[600px] h-[600px] bg-brand-900/50"
          style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
        />
      </div>

      <div className="max-w-7xl mx-auto relative">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-brand-900/40 border border-brand-700/40 rounded-full px-4 py-1.5 mb-5">
            <span className="text-brand-300 text-xs font-medium">Honest comparison</span>
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-5">
            Android vs. iPhone
          </h2>
          <p className="text-white/45 text-lg max-w-lg mx-auto leading-relaxed">
            For this use case, Android wins. Here&apos;s why.
          </p>
        </div>

        <div className="max-w-3xl mx-auto">
          <div className="bg-white/[0.02] border border-white/8 rounded-2xl overflow-hidden">
            {/* Header row */}
            <div className="grid grid-cols-3 border-b border-white/8">
              <div className="px-6 py-4 text-xs text-white/30 font-semibold uppercase tracking-widest" />
              <div className="px-6 py-4 border-l border-white/8">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-sm font-bold text-white">Android</span>
                </div>
                <p className="text-[10px] text-white/30 mt-0.5">Recommended</p>
              </div>
              <div className="px-6 py-4 border-l border-white/8">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-white/20" />
                  <span className="text-sm font-bold text-white/50">iPhone</span>
                </div>
                <p className="text-[10px] text-white/20 mt-0.5">Works, but...</p>
              </div>
            </div>

            {rows.map((row, i) => (
              <div
                key={row.label}
                className={`grid grid-cols-3 ${i < rows.length - 1 ? 'border-b border-white/6' : ''}`}
              >
                <div className="px-6 py-4 text-sm text-white/40">{row.label}</div>
                <div className="px-6 py-4 border-l border-white/6 text-sm text-emerald-400 font-medium">
                  {row.android}
                </div>
                <div className="px-6 py-4 border-l border-white/6 text-sm text-white/35">
                  {row.iphone}
                </div>
              </div>
            ))}
          </div>

          <p className="text-center text-xs text-white/25 mt-5">
            <a
              href="https://www.amazon.com/s?k=motorola+moto+g"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-400 hover:text-brand-300 transition-colors"
            >
              Find Motorola Moto G on Amazon &rarr;
            </a>
          </p>
        </div>
      </div>
    </section>
  )
}

// ── iMessage Note ─────────────────────────────────────────────────────────────

function IMessageNote() {
  return (
    <section className="py-16 px-6">
      <div className="max-w-3xl mx-auto">
        <div className="bg-brand-900/20 border border-brand-700/30 rounded-2xl p-8">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-brand-900/60 border border-brand-700/40 flex items-center justify-center shrink-0">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M9 1C4.58 1 1 4.13 1 8c0 1.77.68 3.38 1.8 4.64L2 17l4.58-1.53C7.29 15.82 8.12 16 9 16c4.42 0 8-3.13 8-7s-3.58-7-8-7z" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.4" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-bold text-white mb-2">Already have a Mac?</h3>
              <p className="text-sm text-white/50 leading-relaxed">
                The standard Clap Cheeks plan includes{' '}
                <span className="text-white/70">iMessage AI</span> &mdash; reads your conversations
                and suggests replies in your voice. The Device add-on layers{' '}
                <span className="text-white/70">24/7 autonomous swiping on top</span>, so you get
                both: intelligent conversation handling on your Mac and non-stop swiping on the
                dedicated phone. Best of both worlds.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ── Pricing ───────────────────────────────────────────────────────────────────

function Pricing() {
  return (
    <section id="pricing" className="py-28 px-6 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="orb w-[700px] h-[700px] bg-brand-900"
          style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
        />
      </div>

      <div className="max-w-7xl mx-auto relative">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-brand-900/40 border border-brand-700/40 rounded-full px-4 py-1.5 mb-5">
            <span className="text-brand-300 text-xs font-medium">Simple add-on pricing</span>
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-5">
            Add it to any plan
          </h2>
          <p className="text-white/45 text-lg max-w-lg mx-auto leading-relaxed">
            One flat fee on top of your existing subscription. Cancel anytime.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
          {/* Add-on card */}
          <div className="relative flex flex-col rounded-2xl p-6 bg-white/[0.02] border border-white/8 hover:border-white/15 transition-all duration-300">
            <div className="mb-6 pt-2">
              <h3 className="text-base font-bold text-white/70 mb-1">Device Add-On</h3>
              <div className="flex items-baseline gap-1 mb-2">
                <span className="text-4xl font-extrabold text-white">$49</span>
                <span className="text-white/35 text-sm">/mo</span>
              </div>
              <p className="text-xs text-white/35">Added to any existing plan</p>
            </div>

            <div className="h-px mb-6 bg-white/6" />

            <ul className="space-y-3 flex-1 mb-8">
              {[
                '24/7 swiping on Tinder, Bumble & Hinge',
                'Human-like timing (no ban risk)',
                'Daily match digest by email',
                'Remote pause/resume via CLI',
                'Works with Starter, Pro, or Elite',
              ].map((f) => (
                <li key={f} className="flex items-start gap-2.5">
                  <div className="mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0 bg-white/6 border border-white/10">
                    <Check size={9} className="text-white/40" />
                  </div>
                  <span className="text-sm text-white/55 leading-snug">{f}</span>
                </li>
              ))}
            </ul>

            <Link
              href="/#pricing"
              className="block text-center font-semibold text-sm py-3 rounded-xl transition-all duration-200 active:scale-[0.98] bg-white/6 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white"
            >
              Add to my plan
            </Link>
          </div>

          {/* Bundle card */}
          <div className="relative flex flex-col rounded-2xl p-6 bg-brand-900/30 border border-brand-600/60 pricing-popular transition-all duration-300">
            <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
              <span className="bg-gradient-to-r from-brand-600 to-brand-500 text-white text-xs font-bold px-4 py-1 rounded-full shadow-lg shadow-brand-900/50 whitespace-nowrap">
                BEST VALUE
              </span>
            </div>

            <div className="mb-6 pt-2">
              <h3 className="text-base font-bold text-brand-300 mb-1">Device Bundle</h3>
              <div className="flex items-baseline gap-1 mb-1">
                <span className="text-4xl font-extrabold text-white">$89</span>
                <span className="text-white/35 text-sm">/mo</span>
              </div>
              <p className="text-xs text-white/35">
                Pro plan ($59) + Device ($49) &mdash;{' '}
                <span className="text-emerald-400 font-semibold">save $19/mo</span>
              </p>
            </div>

            <div className="h-px mb-6 bg-gradient-to-r from-transparent via-brand-600 to-transparent" />

            <ul className="space-y-3 flex-1 mb-8">
              {[
                'Everything in Pro plan',
                '3 dating apps simultaneously',
                'Unlimited AI swipes per day',
                'Full analytics + conversion tracking',
                'AI coaching & weekly recommendations',
                'Date booking & calendar sync',
                '+ All Device Add-On features',
                'Priority support',
              ].map((f) => (
                <li key={f} className="flex items-start gap-2.5">
                  <div className="mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0 bg-brand-600/30 border border-brand-600/50">
                    <Check size={9} className="text-brand-400" />
                  </div>
                  <span className="text-sm text-white/55 leading-snug">{f}</span>
                </li>
              ))}
            </ul>

            <Link
              href="/#pricing"
              className="block text-center font-semibold text-sm py-3 rounded-xl transition-all duration-200 active:scale-[0.98] bg-brand-600 hover:bg-brand-500 text-white shadow-lg shadow-brand-900/40"
            >
              Get the Bundle
            </Link>
          </div>
        </div>

        <div className="text-center mt-10 space-y-2">
          <p className="text-xs text-white/25">
            Phone not included &middot;{' '}
            <a
              href="https://www.amazon.com/s?k=motorola+moto+g"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-400 hover:text-brand-300 transition-colors"
            >
              Recommended: Motorola Moto G (~$89 on Amazon)
            </a>
          </p>
          <p className="text-xs text-white/20">Cancel anytime &middot; All prices USD</p>
        </div>
      </div>
    </section>
  )
}

// ── FAQ ───────────────────────────────────────────────────────────────────────

const faqs = [
  {
    q: "Won't dating apps ban me?",
    a: "Clap Cheeks uses human-like timing — randomized delays between swipes, natural session lengths, and breaks that mirror real user behavior. We've tuned this carefully. There's no batch swiping or suspicious patterns that trigger ban detection.",
  },
  {
    q: 'Do I need to leave my laptop on?',
    a: 'No. That\'s the whole point. The dedicated Android phone runs independently over Wi-Fi. Your MacBook can be closed, off, or across the country. The device handles everything.',
  },
  {
    q: 'What Android phone should I get?',
    a: 'We recommend the Motorola Moto G (~$89). It\'s cheap, reliable, runs Android 13, and handles the workload easily. Any Android 10+ device works — you may already have an old phone in a drawer.',
  },
  {
    q: "What about iPhone?",
    a: "iPhone works, but it requires a Mac running 24/7 to bridge iMessage and dating app sessions. Android is cheaper to leave plugged in permanently and doesn't depend on your Mac at all. If you have an old iPhone lying around and don't mind leaving your Mac on, it'll work.",
  },
  {
    q: 'Is my data private?',
    a: 'Swipe actions and session data stay on your device. Only aggregate match counts reach our servers for your daily digest. We never store who you swiped on, your conversation content, or your match profiles.',
  },
]

function FAQ() {
  return (
    <section className="py-28 px-6 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="orb w-[500px] h-[500px] bg-purple-900/30"
          style={{ bottom: '0%', left: '50%', transform: 'translateX(-50%)' }}
        />
      </div>

      <div className="max-w-7xl mx-auto relative">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-brand-900/40 border border-brand-700/40 rounded-full px-4 py-1.5 mb-5">
            <span className="text-brand-300 text-xs font-medium">Questions</span>
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-5">
            Frequently asked
          </h2>
        </div>

        <div className="max-w-3xl mx-auto space-y-4">
          {faqs.map((faq) => (
            <div
              key={faq.q}
              className="bg-white/[0.02] border border-white/8 hover:border-white/12 rounded-2xl p-6 transition-all duration-200"
            >
              <h3 className="text-base font-semibold text-white mb-3">{faq.q}</h3>
              <p className="text-sm text-white/50 leading-relaxed">{faq.a}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Final CTA ─────────────────────────────────────────────────────────────────

function FinalCTA() {
  return (
    <section className="py-28 px-6 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="orb w-[800px] h-[800px] bg-brand-900"
          style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
        />
      </div>

      <div className="max-w-4xl mx-auto text-center relative">
        <div className="inline-flex items-center gap-2 bg-brand-900/40 border border-brand-700/40 rounded-full px-4 py-1.5 mb-8">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-brand-300 text-xs font-medium">Device add-on available now</span>
        </div>

        <h2 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight mb-6">
          <span className="text-white">Plug it in.</span>
          <br />
          <span className="gradient-text">Wake up to matches.</span>
        </h2>

        <p className="text-white/50 text-lg max-w-xl mx-auto mb-10 leading-relaxed">
          $49/mo on top of any plan. One Android phone. Zero laptops left running overnight.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/#pricing"
            className="group flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white font-semibold px-8 py-4 rounded-xl transition-all duration-200 shadow-xl shadow-brand-900/50 hover:shadow-brand-800/60 active:scale-[0.98] text-base"
          >
            Add Device Plan &mdash; $49/mo
            <ChevronRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
          </Link>
          <Link
            href="/#pricing"
            className="flex items-center gap-2 bg-white/5 hover:bg-white/8 border border-white/10 hover:border-white/20 text-white/80 hover:text-white font-semibold px-8 py-4 rounded-xl transition-all duration-200 text-base active:scale-[0.98]"
          >
            View all plans
          </Link>
        </div>

        <p className="text-xs text-white/20 mt-8">
          Cancel anytime &middot; Works with Starter, Pro, and Elite &middot; Phone not included
        </p>
      </div>
    </section>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DevicePage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <WhatYouGet />
      <ComparisonTable />
      <IMessageNote />
      <Pricing />
      <FAQ />
      <FinalCTA />
    </>
  )
}
