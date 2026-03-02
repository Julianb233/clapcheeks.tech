'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { Copy, Share2, Users, Gift, CheckCircle2, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Referral {
  id: string
  referee_id: string | null
  status: string
  created_at: string
}

export default function ReferralsPage() {
  const [refCode, setRefCode] = useState<string | null>(null)
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [credits, setCredits] = useState(0)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Get profile with ref_code
      const { data: profile } = await supabase
        .from('profiles')
        .select('ref_code, referral_credits')
        .eq('id', user.id)
        .single()

      if (profile?.ref_code) {
        setRefCode(profile.ref_code)
      } else {
        // Generate one
        const res = await fetch('/api/referral/generate', { method: 'POST' })
        const data = await res.json()
        if (data.ref_code) setRefCode(data.ref_code)
      }

      setCredits(profile?.referral_credits || 0)

      // Get referrals
      const { data: refs } = await supabase
        .from('clapcheeks_referrals')
        .select('id, referee_id, status, created_at')
        .eq('referrer_id', user.id)
        .order('created_at', { ascending: false })

      setReferrals(refs || [])
      setLoading(false)
    }
    load()
  }, [supabase])

  const referralLink = refCode ? `https://clapcheeks.tech/?ref=${refCode}` : ''

  const copyLink = async () => {
    if (!referralLink) return
    await navigator.clipboard.writeText(referralLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const shareTwitter = () => {
    const text = encodeURIComponent(
      'Check out Clap Cheeks — the AI dating co-pilot that runs privately on your Mac. Use my link:'
    )
    window.open(
      `https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(referralLink)}`,
      '_blank'
    )
  }

  const converted = referrals.filter((r) => r.status === 'converted' || r.status === 'credited').length
  const credited = referrals.filter((r) => r.status === 'credited').length

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-white/40 text-sm">Loading...</div>
      </div>
    )
  }

  return (
    <div className="pt-16 pb-20 px-6">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-brand-900/40 border border-brand-700/40 rounded-full px-4 py-1.5 mb-5">
            <Gift className="w-3.5 h-3.5 text-brand-300" />
            <span className="text-brand-300 text-xs font-medium">Referral Program</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3">
            Give a month, get a month
          </h1>
          <p className="text-white/45 text-lg max-w-lg mx-auto">
            Share Clap Cheeks with friends. When they subscribe, you both win.
          </p>
        </div>

        {/* Referral Link Card */}
        <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-6 mb-6">
          <h2 className="text-white font-semibold mb-3">Your referral link</h2>
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-3 font-mono text-sm text-brand-400 truncate">
              {referralLink || 'Generating...'}
            </div>
            <Button
              onClick={copyLink}
              variant="outline"
              className="border-white/10 bg-white/5 hover:bg-white/10 text-white shrink-0"
            >
              {copied ? <CheckCircle2 className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
              <span className="ml-2">{copied ? 'Copied' : 'Copy'}</span>
            </Button>
          </div>

          {/* Share buttons */}
          <div className="flex items-center gap-3 mt-4">
            <Button
              onClick={shareTwitter}
              variant="outline"
              size="sm"
              className="border-white/10 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white"
            >
              <Share2 className="w-3.5 h-3.5 mr-1.5" />
              Twitter / X
            </Button>
            <Button
              onClick={copyLink}
              variant="outline"
              size="sm"
              className="border-white/10 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white"
            >
              <Copy className="w-3.5 h-3.5 mr-1.5" />
              Copy Link
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          <div className="bg-white/[0.03] border border-white/8 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-white">{referrals.length}</div>
            <div className="text-white/40 text-xs mt-1">Referrals Sent</div>
          </div>
          <div className="bg-white/[0.03] border border-white/8 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-white">{converted}</div>
            <div className="text-white/40 text-xs mt-1">Converted</div>
          </div>
          <div className="bg-white/[0.03] border border-white/8 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-brand-400">{credits}</div>
            <div className="text-white/40 text-xs mt-1">Credits Earned</div>
          </div>
        </div>

        {/* How it works */}
        <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-6 mb-8">
          <h2 className="text-white font-semibold mb-5">How it works</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="w-10 h-10 rounded-full bg-brand-900/60 border border-brand-700/40 flex items-center justify-center mx-auto mb-3">
                <span className="text-brand-300 font-bold text-sm">1</span>
              </div>
              <h3 className="text-white text-sm font-medium mb-1">Share your link</h3>
              <p className="text-white/40 text-xs">Send your unique referral link to friends</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 rounded-full bg-brand-900/60 border border-brand-700/40 flex items-center justify-center mx-auto mb-3">
                <span className="text-brand-300 font-bold text-sm">2</span>
              </div>
              <h3 className="text-white text-sm font-medium mb-1">Friend subscribes</h3>
              <p className="text-white/40 text-xs">They sign up and start a paid subscription</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 rounded-full bg-brand-900/60 border border-brand-700/40 flex items-center justify-center mx-auto mb-3">
                <span className="text-brand-300 font-bold text-sm">3</span>
              </div>
              <h3 className="text-white text-sm font-medium mb-1">You get 1 free month</h3>
              <p className="text-white/40 text-xs">Credit applied to your next invoice automatically</p>
            </div>
          </div>
        </div>

        {/* Referral List */}
        {referrals.length > 0 && (
          <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-6">
            <h2 className="text-white font-semibold mb-4">Your referrals</h2>
            <div className="space-y-3">
              {referrals.map((ref) => (
                <div
                  key={ref.id}
                  className="flex items-center justify-between py-3 border-b border-white/5 last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <Users className="w-4 h-4 text-white/30" />
                    <span className="text-white/60 text-sm">
                      Referral #{ref.id.slice(0, 8)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-white/30 text-xs">
                      {new Date(ref.created_at).toLocaleDateString()}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        ref.status === 'credited'
                          ? 'bg-green-900/40 text-green-400 border border-green-700/40'
                          : ref.status === 'converted'
                          ? 'bg-blue-900/40 text-blue-400 border border-blue-700/40'
                          : 'bg-white/5 text-white/40 border border-white/10'
                      }`}
                    >
                      {ref.status === 'credited' && <CheckCircle2 className="w-3 h-3 inline mr-1" />}
                      {ref.status === 'pending' && <Clock className="w-3 h-3 inline mr-1" />}
                      {ref.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {referrals.length === 0 && (
          <div className="text-center py-12">
            <Users className="w-10 h-10 text-white/15 mx-auto mb-3" />
            <p className="text-white/30 text-sm">No referrals yet. Share your link to get started.</p>
          </div>
        )}
      </div>
    </div>
  )
}
