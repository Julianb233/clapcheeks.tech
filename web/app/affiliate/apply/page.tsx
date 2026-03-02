'use client'

import { useState } from 'react'
import Link from 'next/link'
import { DollarSign, BarChart3, Clock, CheckCircle2, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function AffiliateApplyPage() {
  const [form, setForm] = useState({
    name: '',
    email: '',
    platform: '',
    audience_size: '',
    message: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')

    const res = await fetch('/api/affiliate/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })

    if (!res.ok) {
      const data = await res.json()
      setError(data.error || 'Something went wrong')
      setSubmitting(false)
      return
    }

    setSubmitted(true)
    setSubmitting(false)
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-full bg-green-900/40 border border-green-700/40 flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-8 h-8 text-green-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">Application Received</h1>
          <p className="text-white/45 mb-6">
            We'll review your application and get back to you within 48 hours. Check your email for updates.
          </p>
          <Link
            href="/"
            className="text-brand-400 hover:text-brand-300 text-sm transition-colors"
          >
            Back to home
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black">
      {/* Nav */}
      <div className="border-b border-white/6 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-white/40 hover:text-white/70 text-sm transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Back to Outward
          </Link>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-16">
        {/* Hero */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-brand-900/40 border border-brand-700/40 rounded-full px-4 py-1.5 mb-5">
            <DollarSign className="w-3.5 h-3.5 text-brand-300" />
            <span className="text-brand-300 text-xs font-medium">Affiliate Program</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
            Become a Outward Affiliate
          </h1>
          <p className="text-white/45 text-xl max-w-xl mx-auto">
            Earn 25% recurring commission on every subscriber you refer
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-12">
          {/* Left: Details */}
          <div>
            {/* Perks */}
            <div className="space-y-6 mb-10">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-brand-900/40 border border-brand-700/40 flex items-center justify-center shrink-0">
                  <DollarSign className="w-5 h-5 text-brand-300" />
                </div>
                <div>
                  <h3 className="text-white font-medium mb-1">25% Recurring Commission</h3>
                  <p className="text-white/40 text-sm">Earn $24.25/mo per Base subscriber or $49.25/mo per Elite subscriber. For the lifetime of their subscription.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-brand-900/40 border border-brand-700/40 flex items-center justify-center shrink-0">
                  <Clock className="w-5 h-5 text-brand-300" />
                </div>
                <div>
                  <h3 className="text-white font-medium mb-1">60-Day Cookie Window</h3>
                  <p className="text-white/40 text-sm">If someone clicks your link and subscribes within 60 days, you get credit. Even if they leave and come back.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-brand-900/40 border border-brand-700/40 flex items-center justify-center shrink-0">
                  <BarChart3 className="w-5 h-5 text-brand-300" />
                </div>
                <div>
                  <h3 className="text-white font-medium mb-1">Real-Time Dashboard</h3>
                  <p className="text-white/40 text-sm">Track clicks, signups, and commissions in real time. Monthly payouts via Stripe with $50 minimum.</p>
                </div>
              </div>
            </div>

            {/* Earnings example */}
            <div className="bg-white/[0.03] border border-white/8 rounded-xl p-5">
              <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-4">Earning Potential</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white/40">10 Base subscribers</span>
                  <span className="text-brand-400 font-medium">$242.50/mo</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white/40">10 Elite subscribers</span>
                  <span className="text-brand-400 font-medium">$492.50/mo</span>
                </div>
                <div className="border-t border-white/8 pt-3 flex items-center justify-between text-sm">
                  <span className="text-white/40">50 mixed subscribers</span>
                  <span className="text-white font-bold">$1,500+/mo</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Application form */}
          <div>
            <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-6">
              <h2 className="text-white font-semibold text-lg mb-5">Apply now</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-white/60 text-sm mb-1.5">Name *</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-brand-500/50 transition-colors"
                    placeholder="Your name"
                  />
                </div>
                <div>
                  <label className="block text-white/60 text-sm mb-1.5">Email *</label>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-brand-500/50 transition-colors"
                    placeholder="you@example.com"
                  />
                </div>
                <div>
                  <label className="block text-white/60 text-sm mb-1.5">Platform *</label>
                  <select
                    required
                    value={form.platform}
                    onChange={(e) => setForm({ ...form, platform: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-brand-500/50 transition-colors"
                  >
                    <option value="" className="bg-black">Select your platform</option>
                    <option value="YouTube" className="bg-black">YouTube</option>
                    <option value="Instagram" className="bg-black">Instagram</option>
                    <option value="Twitter" className="bg-black">Twitter / X</option>
                    <option value="TikTok" className="bg-black">TikTok</option>
                    <option value="Blog" className="bg-black">Blog / Website</option>
                    <option value="Podcast" className="bg-black">Podcast</option>
                    <option value="Other" className="bg-black">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-white/60 text-sm mb-1.5">Audience Size</label>
                  <input
                    type="text"
                    value={form.audience_size}
                    onChange={(e) => setForm({ ...form, audience_size: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-brand-500/50 transition-colors"
                    placeholder="e.g. 50K followers"
                  />
                </div>
                <div>
                  <label className="block text-white/60 text-sm mb-1.5">Why do you want to partner?</label>
                  <textarea
                    value={form.message}
                    onChange={(e) => setForm({ ...form, message: e.target.value })}
                    rows={3}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-brand-500/50 transition-colors resize-none"
                    placeholder="Tell us about your audience and how you'd promote Outward"
                  />
                </div>

                {error && (
                  <p className="text-red-400 text-sm">{error}</p>
                )}

                <Button
                  type="submit"
                  disabled={submitting}
                  className="w-full h-11 bg-gradient-to-r from-brand-500 to-brand-700 hover:from-brand-600 hover:to-brand-800 text-white font-medium"
                >
                  {submitting ? 'Submitting...' : 'Submit Application'}
                </Button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
