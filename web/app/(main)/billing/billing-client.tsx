'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Invoice {
  id: string
  date: number
  amount: number
  status: string | null
  pdf: string | null
}

interface BillingData {
  subscribed: boolean
  plan: string
  status: string
  currentPeriodEnd?: number
  cancelAtPeriodEnd?: boolean
  card?: {
    brand: string
    last4: string
    expMonth: number
    expYear: number
  } | null
  invoices?: Invoice[]
  upcomingAmount?: number | null
  upcomingDate?: number | null
}

interface BillingClientProps {
  plan: string
  subscriptionStatus: string
  hasStripeCustomer: boolean
}

export default function BillingClient({ plan, subscriptionStatus, hasStripeCustomer }: BillingClientProps) {
  const [billing, setBilling] = useState<BillingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [portalLoading, setPortalLoading] = useState(false)
  const [cancelConfirm, setCancelConfirm] = useState(false)

  useEffect(() => {
    if (!hasStripeCustomer) {
      setLoading(false)
      return
    }
    fetch('/api/billing')
      .then(res => res.json())
      .then(data => setBilling(data))
      .catch(() => setBilling(null))
      .finally(() => setLoading(false))
  }, [hasStripeCustomer])

  async function openPortal() {
    setPortalLoading(true)
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      }
    } catch {
      setPortalLoading(false)
    }
  }

  async function handleCheckout(selectedPlan: string) {
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: selectedPlan }),
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      }
    } catch {
      // ignore
    }
  }

  function formatDate(ts: number) {
    return new Date(ts * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  function formatAmount(cents: number) {
    return `$${(cents / 100).toFixed(2)}`
  }

  // Not subscribed state
  if (!hasStripeCustomer || subscriptionStatus === 'inactive') {
    return (
      <div className="space-y-6">
        <div className="bg-white/5 border border-white/10 rounded-xl p-6 text-center">
          <div className="inline-flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-full px-3 py-1 mb-4">
            <span className="text-white/50 text-xs font-medium">No active subscription</span>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Get started with Clapcheeks</h2>
          <p className="text-white/40 text-sm mb-6">Choose a plan to unlock your AI dating co-pilot.</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
            <button
              onClick={() => handleCheckout('base')}
              className="bg-white/10 hover:bg-white/15 text-white font-semibold px-6 py-2.5 rounded-xl transition-all text-sm w-full sm:w-auto"
            >
              Base — $97/mo
            </button>
            <button
              onClick={() => handleCheckout('elite')}
              className="bg-brand-600 hover:bg-brand-500 text-white font-semibold px-6 py-2.5 rounded-xl transition-all text-sm shadow-lg shadow-brand-900/40 w-full sm:w-auto"
            >
              Elite — $197/mo
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-6 animate-pulse">
            <div className="h-4 bg-white/10 rounded w-1/3 mb-3" />
            <div className="h-3 bg-white/5 rounded w-2/3" />
          </div>
        ))}
      </div>
    )
  }

  const planName = plan === 'elite' ? 'Elite' : 'Base'
  const planPrice = plan === 'elite' ? '$197' : '$97'

  return (
    <div className="space-y-6">
      {/* Current Plan Card */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white/60 text-xs font-semibold uppercase tracking-wider">Current Plan</h2>
          <StatusBadge status={subscriptionStatus} cancelAtPeriodEnd={billing?.cancelAtPeriodEnd} />
        </div>
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-2xl font-bold text-white">{planName}</span>
          <span className="text-white/40 text-sm">{planPrice}/mo</span>
        </div>
        {billing?.currentPeriodEnd && (
          <p className="text-white/40 text-xs mb-4">
            {billing.cancelAtPeriodEnd
              ? `Cancels on ${formatDate(billing.currentPeriodEnd)}`
              : `Renews on ${formatDate(billing.currentPeriodEnd)}`}
          </p>
        )}
        {billing?.upcomingAmount != null && billing?.upcomingDate && !billing.cancelAtPeriodEnd && (
          <p className="text-white/30 text-xs">
            Next charge: {formatAmount(billing.upcomingAmount)} on {formatDate(billing.upcomingDate)}
          </p>
        )}
        <div className="flex items-center gap-3 mt-4">
          {plan === 'base' && (
            <button
              onClick={openPortal}
              className="bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-5 py-2 rounded-xl transition-all"
            >
              Upgrade to Elite
            </button>
          )}
          <button
            onClick={openPortal}
            disabled={portalLoading}
            className="text-white/40 hover:text-white/70 text-xs bg-white/5 hover:bg-white/10 border border-white/10 px-4 py-2 rounded-xl transition-all"
          >
            {portalLoading ? 'Loading...' : 'Manage Subscription'}
          </button>
        </div>
      </div>

      {/* Payment Method */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white/60 text-xs font-semibold uppercase tracking-wider">Payment Method</h2>
          <button
            onClick={openPortal}
            className="text-brand-400 hover:text-brand-300 text-xs transition-colors"
          >
            Update
          </button>
        </div>
        {billing?.card ? (
          <div className="flex items-center gap-3">
            <div className="w-10 h-7 bg-white/10 rounded flex items-center justify-center">
              <span className="text-white/60 text-[10px] font-bold uppercase">{billing.card.brand}</span>
            </div>
            <div>
              <p className="text-white text-sm font-medium">
                **** **** **** {billing.card.last4}
              </p>
              <p className="text-white/30 text-xs">
                Expires {String(billing.card.expMonth).padStart(2, '0')}/{billing.card.expYear}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-white/30 text-sm">No payment method on file</p>
        )}
      </div>

      {/* Invoice History */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-6">
        <h2 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-4">Invoice History</h2>
        {billing?.invoices && billing.invoices.length > 0 ? (
          <div className="space-y-3">
            {billing.invoices.map(inv => (
              <div key={inv.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-0 py-2 border-b border-white/5 last:border-0">
                <div className="flex items-center gap-3 sm:gap-4">
                  <span className="text-white/60 text-xs sm:text-sm">{formatDate(inv.date)}</span>
                  <span className="text-white text-xs sm:text-sm font-medium">{formatAmount(inv.amount)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <InvoiceStatus status={inv.status} />
                  {inv.pdf && (
                    <a
                      href={inv.pdf}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-400 hover:text-brand-300 text-xs transition-colors"
                    >
                      PDF
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-white/30 text-sm">No invoices yet</p>
        )}
      </div>

      {/* Cancel Subscription */}
      {!billing?.cancelAtPeriodEnd && (
        <div className="bg-white/[0.02] border border-white/5 rounded-xl p-6">
          <h2 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-3">Cancel Subscription</h2>
          {!cancelConfirm ? (
            <div>
              <p className="text-white/30 text-sm mb-3">
                Cancel your subscription. You&apos;ll keep access until the end of your billing period.
              </p>
              <button
                onClick={() => setCancelConfirm(true)}
                className="text-red-400/60 hover:text-red-400 text-xs border border-red-500/20 hover:border-red-500/40 px-4 py-2 rounded-xl transition-all"
              >
                Cancel subscription
              </button>
            </div>
          ) : (
            <div>
              <p className="text-white/50 text-sm mb-4">
                Are you sure? Your plan will remain active until the end of the current billing period.
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={openPortal}
                  className="text-red-400 text-xs bg-red-900/20 hover:bg-red-900/40 border border-red-500/30 px-4 py-2 rounded-xl transition-all"
                >
                  Yes, cancel
                </button>
                <button
                  onClick={() => setCancelConfirm(false)}
                  className="text-white/40 text-xs bg-white/5 hover:bg-white/10 border border-white/10 px-4 py-2 rounded-xl transition-all"
                >
                  Keep subscription
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Link to pricing page */}
      <div className="text-center">
        <Link href="/pricing" className="text-white/30 hover:text-white/50 text-xs transition-colors">
          View all plans and features
        </Link>
      </div>
    </div>
  )
}

function StatusBadge({ status, cancelAtPeriodEnd }: { status: string; cancelAtPeriodEnd?: boolean }) {
  if (cancelAtPeriodEnd) {
    return (
      <span className="inline-flex items-center gap-1 bg-yellow-900/30 border border-yellow-700/40 rounded-full px-2.5 py-0.5 text-[10px] font-medium text-yellow-300">
        Cancelling
      </span>
    )
  }
  if (status === 'active') {
    return (
      <span className="inline-flex items-center gap-1 bg-green-900/30 border border-green-700/40 rounded-full px-2.5 py-0.5 text-[10px] font-medium text-green-300">
        Active
      </span>
    )
  }
  if (status === 'past_due') {
    return (
      <span className="inline-flex items-center gap-1 bg-red-900/30 border border-red-500/40 rounded-full px-2.5 py-0.5 text-[10px] font-medium text-red-300">
        Past Due
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 bg-white/5 border border-white/10 rounded-full px-2.5 py-0.5 text-[10px] font-medium text-white/40">
      Inactive
    </span>
  )
}

function InvoiceStatus({ status }: { status: string | null }) {
  if (status === 'paid') {
    return <span className="text-green-400 text-xs">Paid</span>
  }
  if (status === 'open') {
    return <span className="text-yellow-400 text-xs">Open</span>
  }
  if (status === 'void') {
    return <span className="text-white/30 text-xs">Void</span>
  }
  return <span className="text-white/30 text-xs">{status || 'Unknown'}</span>
}
