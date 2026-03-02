import type { Metadata } from 'next'
import Link from 'next/link'
import { Download, Mail, ArrowLeft } from 'lucide-react'
import PageOrbs from '@/components/page-orbs'

export const metadata: Metadata = {
  title: 'Press & Media — Clapcheeks',
  description: 'Press kit, brand assets, and media resources for Clapcheeks.',
}

export default function PressPage() {
  const brandColors = [
    { name: 'Purple', hex: '#7c3aed', className: 'bg-[#7c3aed]' },
    { name: 'Pink', hex: '#ec4899', className: 'bg-[#ec4899]' },
    { name: 'Black', hex: '#000000', className: 'bg-black border border-white/20' },
    { name: 'White', hex: '#FFFFFF', className: 'bg-white' },
  ]

  return (
    <div className="relative min-h-screen bg-black">
      <PageOrbs />
      <div className="relative" style={{ zIndex: 1 }}>
        {/* Nav */}
        <div className="border-b border-white/6 px-6 py-4">
          <div className="max-w-5xl mx-auto">
            <Link href="/" className="flex items-center gap-2 text-white/40 hover:text-white/70 text-sm transition-colors w-fit">
              <ArrowLeft className="w-4 h-4" />
              Back to Clapcheeks
            </Link>
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-6 py-16">
          {/* Hero */}
          <div className="text-center mb-16">
            <h1 className="text-4xl sm:text-5xl font-bold gradient-text mb-4 animate-slide-up">Press & Media</h1>
            <p className="text-white/45 text-lg max-w-xl mx-auto animate-slide-up delay-150">
              Everything you need to write about Clapcheeks. Download brand assets, get product info, and reach out to our team.
            </p>
          </div>

          {/* Brand Assets */}
          <section className="mb-16">
            <h2 className="text-2xl font-bold text-white mb-6 border-l-2 border-brand-600/50 pl-3">Brand Assets</h2>
            <div className="grid sm:grid-cols-3 gap-4 mb-8">
              <div className="feature-card bg-white/[0.03] border border-white/8 rounded-xl p-6 text-center hover:border-purple-500/30 animate-fade-in delay-150">
                <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-[#7c3aed] to-[#ec4899] flex items-center justify-center mx-auto mb-4">
                  <svg width="28" height="28" viewBox="0 0 14 14" fill="none">
                    <path d="M7 1L2 4.5V9.5L7 13L12 9.5V4.5L7 1Z" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
                    <circle cx="7" cy="7" r="1.5" fill="white" />
                  </svg>
                </div>
                <p className="text-white text-sm font-medium mb-1">Logo SVG</p>
                <p className="text-white/30 text-xs">Vector format</p>
              </div>
              <div className="feature-card bg-white/[0.03] border border-white/8 rounded-xl p-6 text-center hover:border-purple-500/30 animate-fade-in delay-300">
                <div className="w-16 h-16 rounded-xl bg-black border border-white/20 flex items-center justify-center mx-auto mb-4">
                  <span className="text-white font-bold text-sm">PNG</span>
                </div>
                <p className="text-white text-sm font-medium mb-1">Logo Dark</p>
                <p className="text-white/30 text-xs">For light backgrounds</p>
              </div>
              <div className="feature-card bg-white/[0.03] border border-white/8 rounded-xl p-6 text-center hover:border-purple-500/30 animate-fade-in delay-500">
                <div className="w-16 h-16 rounded-xl bg-white flex items-center justify-center mx-auto mb-4">
                  <span className="text-black font-bold text-sm">PNG</span>
                </div>
                <p className="text-white text-sm font-medium mb-1">Logo Light</p>
                <p className="text-white/30 text-xs">For dark backgrounds</p>
              </div>
            </div>
          </section>

          {/* Brand Colors */}
          <section className="mb-16">
            <h2 className="text-2xl font-bold text-white mb-6 border-l-2 border-brand-600/50 pl-3">Brand Colors</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {brandColors.map((color, i) => (
                <div key={color.name} className={`feature-card bg-white/[0.03] border border-white/8 rounded-xl p-5 hover:border-purple-500/30 animate-fade-in delay-${[150, 300, 500, 700][i]}`}>
                  <div className={`w-full h-20 rounded-lg mb-4 ${color.className}`} />
                  <p className="text-white font-medium mb-1">{color.name}</p>
                  <p className="text-brand-300 text-sm font-mono">{color.hex}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Typography */}
          <section className="mb-16">
            <h2 className="text-2xl font-bold text-white mb-6 border-l-2 border-brand-600/50 pl-3">Typography</h2>
            <div className="feature-card bg-white/[0.03] border border-white/8 rounded-xl p-6 hover:border-purple-500/30 animate-fade-in">
              <div className="flex items-center justify-between mb-4">
                <span className="text-white font-medium">Primary Font</span>
                <span className="text-white/40 text-sm">Inter (Google Fonts)</span>
              </div>
              <div className="space-y-3">
                <p className="text-3xl text-white font-bold">Clapcheeks — AI Dating Co-Pilot</p>
                <p className="text-lg text-white/60">The quick brown fox jumps over the lazy dog</p>
                <p className="text-sm text-white/40">ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789</p>
              </div>
            </div>
          </section>

          {/* Product Screenshots */}
          <section className="mb-16">
            <h2 className="text-2xl font-bold text-white mb-6 border-l-2 border-brand-600/50 pl-3">Product Screenshots</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {['Dashboard', 'Analytics', 'Pricing', 'Referrals'].map((name, i) => (
                <div key={name} className={`feature-card bg-white/[0.03] border border-white/8 rounded-xl p-6 aspect-video flex items-center justify-center hover:border-purple-500/30 animate-fade-in delay-${[150, 300, 500, 700][i]}`}>
                  <div className="text-center">
                    <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center mx-auto mb-2">
                      <Download className="w-5 h-5 text-white/20" />
                    </div>
                    <p className="text-white/30 text-sm">{name} Screenshot</p>
                    <p className="text-white/15 text-xs">Coming soon</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Company Info */}
          <section className="mb-16">
            <h2 className="text-2xl font-bold text-white mb-6 border-l-2 border-brand-600/50 pl-3">About Clapcheeks</h2>
            <div className="feature-card bg-white/[0.03] border border-white/8 rounded-xl p-6 space-y-4 hover:border-purple-500/30 animate-fade-in">
              <div>
                <p className="text-white/40 text-xs uppercase tracking-wider mb-1">One-liner</p>
                <p className="text-white">Clapcheeks is a privacy-first AI dating co-pilot that runs locally on your Mac, automating swipes, conversations, and date booking across Tinder, Bumble, and Hinge.</p>
              </div>
              <div className="grid sm:grid-cols-3 gap-4 pt-2">
                <div>
                  <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Founded</p>
                  <p className="text-white text-sm">2025</p>
                </div>
                <div>
                  <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Location</p>
                  <p className="text-white text-sm">Remote</p>
                </div>
                <div>
                  <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Category</p>
                  <p className="text-white text-sm">AI / Dating / Productivity</p>
                </div>
              </div>
            </div>
          </section>

          {/* Contact */}
          <section className="mb-16">
            <h2 className="text-2xl font-bold text-white mb-6 border-l-2 border-brand-600/50 pl-3">Contact</h2>
            <div className="feature-card bg-white/[0.03] border border-white/8 rounded-xl p-6 hover:border-purple-500/30 animate-fade-in">
              <div className="flex items-center gap-3">
                <Mail className="w-5 h-5 text-brand-400" />
                <a href="mailto:press@clapcheeks.tech" className="text-brand-400 hover:text-brand-300 transition-colors">
                  press@clapcheeks.tech
                </a>
              </div>
            </div>
          </section>

          {/* Download Press Kit CTA */}
          <div className="text-center animate-fade-in delay-300">
            <div className="inline-block rounded-xl p-[1px] bg-gradient-to-r from-purple-500/50 via-pink-500/50 to-orange-500/50">
              <div className="flex items-center gap-3 bg-black/90 rounded-xl px-8 py-5">
                <Download className="w-5 h-5 text-brand-400" />
                <span className="text-white/60 text-sm">Full press kit download coming soon</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
