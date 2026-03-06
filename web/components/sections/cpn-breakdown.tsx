'use client'

import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

// ── Without Clapcheeks (manual dating) ──────────────────────────
const WITHOUT = {
  label: 'WITHOUT CLAPCHEEKS',
  subtitle: 'The average guy swiping manually',
  inputs: [
    { label: 'App Subscriptions', value: '$60/mo', detail: 'Tinder Gold + Bumble Premium' },
    { label: 'Dates (food, drinks, activities)', value: '$400/mo', detail: '4 dates × $100 avg' },
    { label: 'Boosts & Super Likes', value: '$40/mo', detail: 'Desperate visibility buys' },
    { label: 'Travel (Uber, gas, parking)', value: '$60/mo', detail: '4 dates × $15 avg' },
  ],
  time: [
    { label: 'Swiping', value: '15 hrs/mo', detail: '~3,000 swipes ÷ 300/hr = 10hr + mindless scrolling' },
    { label: 'Messaging', value: '10 hrs/mo', detail: '~150 messages ÷ 30/hr = 5hr + waiting & re-reading' },
    { label: 'Getting ready + dates', value: '12 hrs/mo', detail: '4 dates × 3 hrs each' },
  ],
  timeCostNote: '37 hrs × $50/hr = $1,850',
  totalMoney: 560,
  totalTimeCost: 1850,
  totalInvestment: 2410,
  nuts: 1,
  cpn: 2410,
  grade: 'F',
  verdict: 'Down astronomical. You\'re paying $2,410 per nut.',
}

// ── With Clapcheeks (AI-automated) ──────────────────────────────
const WITH = {
  label: 'WITH CLAPCHEEKS',
  subtitle: 'AI handles the grind, you close',
  inputs: [
    { label: 'App Subscriptions', value: '$30/mo', detail: 'AI optimizes — you drop premium tiers' },
    { label: 'Dates (food, drinks, activities)', value: '$300/mo', detail: '6 dates × $50 avg (AI picks efficient spots)' },
    { label: 'Clapcheeks Subscription', value: '$29/mo', detail: 'Pays for itself 10x over' },
    { label: 'Travel', value: '$60/mo', detail: '6 dates × $10 avg (AI clusters nearby)' },
  ],
  time: [
    { label: 'Swiping', value: '0 hrs/mo', detail: 'AI swipes 24/7 — you sleep' },
    { label: 'Messaging', value: '1 hr/mo', detail: 'AI handles conversations, you review before dates' },
    { label: 'Getting ready + dates', value: '15 hrs/mo', detail: '6 dates × 2.5 hrs (AI optimizes logistics)' },
  ],
  timeCostNote: '16 hrs × $50/hr = $800',
  totalMoney: 419,
  totalTimeCost: 800,
  totalInvestment: 1219,
  nuts: 4,
  cpn: 305,
  grade: 'D',
  verdict: 'Already 8x better. And it keeps improving as the AI learns your type.',
}

function FormulaLine({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="font-body text-white/50 text-sm">{label}</span>
      <span className={`font-mono text-sm font-bold ${accent ? 'text-yellow-400' : 'text-white'}`}>{value}</span>
    </div>
  )
}

const GRADE_COLORS: Record<string, string> = {
  S: 'from-yellow-400 to-amber-500',
  A: 'from-green-400 to-emerald-500',
  B: 'from-emerald-400 to-teal-500',
  C: 'from-white/80 to-white/60',
  D: 'from-orange-400 to-amber-600',
  F: 'from-red-500 to-red-700',
}

function CPNCard({ data, highlight }: { data: typeof WITHOUT; highlight?: boolean }) {
  const borderColor = highlight ? 'rgba(201,164,39,0.4)' : 'rgba(255,255,255,0.08)'
  const bgGlow = highlight
    ? 'radial-gradient(ellipse at top, rgba(201,164,39,0.06) 0%, transparent 60%)'
    : 'none'

  return (
    <div
      className="rounded-2xl p-6 sm:p-8 relative overflow-hidden"
      style={{
        background: `linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(0,0,0,0.5) 100%)`,
        border: `1px solid ${borderColor}`,
      }}
    >
      {/* Glow overlay for "with" card */}
      {highlight && (
        <div className="absolute inset-0 pointer-events-none" style={{ background: bgGlow }} />
      )}

      {/* Header */}
      <div className="relative mb-6">
        <div className="flex items-center gap-2 mb-1">
          {highlight && (
            <span className="inline-block w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
          )}
          <h3 className={`font-display text-2xl sm:text-3xl uppercase tracking-wide ${highlight ? 'gold-text' : 'text-white/40'}`}>
            {data.label}
          </h3>
        </div>
        <p className="font-body text-white/30 text-sm">{data.subtitle}</p>
      </div>

      {/* Money breakdown */}
      <div className="relative mb-4">
        <div className="font-body text-white/25 text-[10px] font-bold tracking-widest uppercase mb-2">
          Money Spent
        </div>
        {data.inputs.map((item) => (
          <div key={item.label} className="mb-2">
            <FormulaLine label={item.label} value={item.value} />
            <p className="font-body text-white/20 text-xs pl-2 border-l border-white/5">{item.detail}</p>
          </div>
        ))}
      </div>

      {/* Divider */}
      <div className="h-px mb-4" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)' }} />

      {/* Time breakdown */}
      <div className="relative mb-4">
        <div className="font-body text-white/25 text-[10px] font-bold tracking-widest uppercase mb-2">
          Time Cost
        </div>
        {data.time.map((item) => (
          <div key={item.label} className="mb-2">
            <FormulaLine label={item.label} value={item.value} />
            <p className="font-body text-white/20 text-xs pl-2 border-l border-white/5">{item.detail}</p>
          </div>
        ))}
        <div className="mt-3 px-3 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <p className="font-mono text-xs text-white/40">{data.timeCostNote}</p>
        </div>
      </div>

      {/* Divider */}
      <div className="h-px mb-4" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)' }} />

      {/* Formula */}
      <div className="relative mb-6">
        <div className="font-body text-white/25 text-[10px] font-bold tracking-widest uppercase mb-3">
          The Formula
        </div>
        <div className="space-y-1 px-3 py-3 rounded-lg" style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="font-mono text-xs text-white/50">
            CPN = (Money + TimeCost + Travel) ÷ Nuts
          </div>
          <div className="font-mono text-xs text-white/50">
            CPN = (${data.totalMoney} + ${data.totalTimeCost}) ÷ {data.nuts}
          </div>
          <div className="font-mono text-sm text-white font-bold">
            CPN = <span className={highlight ? 'text-yellow-400' : 'text-red-400'}>${data.cpn.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Grade */}
      <div className="flex items-center gap-4">
        <div
          className={`w-16 h-16 rounded-xl flex items-center justify-center font-display text-3xl bg-gradient-to-br ${GRADE_COLORS[data.grade] || 'from-white to-white/60'}`}
          style={{ color: '#000' }}
        >
          {data.grade}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display text-xl text-white uppercase">
            ${data.cpn.toLocaleString()}/NUT
          </div>
          <p className="font-body text-white/40 text-xs leading-relaxed">{data.verdict}</p>
        </div>
      </div>
    </div>
  )
}

export default function CPNBreakdown() {
  const sectionRef = useRef<HTMLElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const cardsRef = useRef<HTMLDivElement>(null)
  const savingsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(headerRef.current, {
        opacity: 0,
        y: 50,
        duration: 0.8,
        ease: 'power3.out',
        scrollTrigger: { trigger: headerRef.current, start: 'top 85%' },
      })

      const cards = cardsRef.current?.querySelectorAll('.cpn-card')
      if (cards) {
        gsap.from(cards, {
          opacity: 0,
          y: 60,
          stagger: 0.2,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: { trigger: cardsRef.current, start: 'top 80%' },
        })
      }

      gsap.from(savingsRef.current, {
        opacity: 0,
        scale: 0.95,
        duration: 0.7,
        ease: 'power3.out',
        scrollTrigger: { trigger: savingsRef.current, start: 'top 90%' },
      })
    }, sectionRef)

    return () => ctx.revert()
  }, [])

  const savingsPct = Math.round(((WITHOUT.cpn - WITH.cpn) / WITHOUT.cpn) * 100)
  const savingsMultiple = Math.round(WITHOUT.cpn / WITH.cpn)

  return (
    <section ref={sectionRef} className="py-28 px-6 relative overflow-hidden">
      {/* Background accents */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute top-0 left-0 right-0 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(201,164,39,0.3), transparent)' }}
        />
        <div
          className="absolute"
          style={{
            top: '10%',
            left: '-10%',
            width: '600px',
            height: '600px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(232,41,30,0.04) 0%, transparent 70%)',
            filter: 'blur(60px)',
          }}
        />
        <div
          className="absolute"
          style={{
            bottom: '10%',
            right: '-10%',
            width: '600px',
            height: '600px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(201,164,39,0.05) 0%, transparent 70%)',
            filter: 'blur(60px)',
          }}
        />
      </div>

      <div className="max-w-6xl mx-auto relative">
        {/* Header */}
        <div ref={headerRef} className="text-center mb-16">
          <div className="flex items-center justify-center gap-3 mb-5">
            <div className="h-px w-8 bg-red-500" />
            <span className="text-red-500 text-xs font-body font-bold tracking-widest uppercase">
              The only metric that matters
            </span>
            <div className="h-px w-8 bg-red-500" />
          </div>
          <h2 className="font-display text-5xl sm:text-6xl lg:text-7xl xl:text-8xl text-white mb-4 uppercase leading-none">
            COST PER
            <br />
            <span className="gold-text">NUT.</span>
          </h2>
          <p className="font-body text-white/45 text-lg leading-relaxed max-w-2xl mx-auto">
            CPN factors in <span className="text-white/70">everything</span> — money, time, travel, opportunity cost.
            Not just what you swiped on Tinder Gold. Here&apos;s what happens when you let AI
            handle the grind.
          </p>

          {/* Formula display */}
          <div
            className="inline-block mt-8 px-6 py-3 rounded-xl"
            style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(201,164,39,0.2)' }}
          >
            <code className="font-mono text-sm text-yellow-400">
              CPN = (MoneySpent + TimeCost + TravelCost) ÷ Nuts
            </code>
          </div>
        </div>

        {/* Side-by-side comparison */}
        <div ref={cardsRef} className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-12">
          <div className="cpn-card">
            <CPNCard data={WITHOUT} />
          </div>
          <div className="cpn-card">
            <CPNCard data={WITH} highlight />
          </div>
        </div>

        {/* Savings callout */}
        <div
          ref={savingsRef}
          className="text-center py-8 px-6 rounded-2xl relative overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, rgba(201,164,39,0.08) 0%, rgba(0,0,0,0.6) 50%, rgba(201,164,39,0.05) 100%)',
            border: '1px solid rgba(201,164,39,0.25)',
          }}
        >
          <div className="relative">
            <div className="font-display text-6xl sm:text-7xl lg:text-8xl gold-text mb-2">
              {savingsMultiple}x
            </div>
            <div className="font-display text-2xl sm:text-3xl text-white uppercase mb-3">
              MORE EFFICIENT
            </div>
            <p className="font-body text-white/40 text-sm max-w-lg mx-auto leading-relaxed">
              That&apos;s a <span className="text-yellow-400 font-bold">{savingsPct}%</span> reduction in cost per nut.
              Same apps. Same you. Just smarter execution.
              The AI swipes, messages, and books — you show up and close.
            </p>
          </div>
        </div>

        {/* Bottom breakdown pills */}
        <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Time Saved', value: '21 hrs/mo', detail: '37 → 16 hours' },
            { label: 'More Dates', value: '+50%', detail: '4 → 6 per month' },
            { label: 'More Nuts', value: '4x', detail: '1 → 4 per month' },
            { label: 'CPN Drop', value: `-${savingsPct}%`, detail: `$${WITHOUT.cpn.toLocaleString()} → $${WITH.cpn}` },
          ].map((pill) => (
            <div key={pill.label} className="text-center py-4 px-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="font-display text-2xl text-yellow-400 mb-1">{pill.value}</div>
              <div className="font-body text-white/60 text-xs font-semibold mb-0.5">{pill.label}</div>
              <div className="font-body text-white/25 text-[10px]">{pill.detail}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
