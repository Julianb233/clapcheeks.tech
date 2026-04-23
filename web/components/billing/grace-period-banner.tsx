'use client'

import { useEffect, useState } from 'react'

interface BillingStatus {
  hasAccess: boolean
  status: 'active' | 'past_due' | 'grace_period' | 'expired' | 'free'
  gracePeriodEnd: string | null
  daysRemaining: number | null
}

export function GracePeriodBanner() {
  const [status, setStatus] = useState<BillingStatus | null>(null)

  useEffect(() => {
    fetch('/api/billing/status')
      .then(r => r.json())
      .then(setStatus)
      .catch(() => {})
  }, [])

  if (!status || status.status === 'active' || status.status === 'free') return null

  if (status.status === 'grace_period') {
    return (
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-6">
        <div className="flex items-center gap-3">
          <span className="text-amber-400 text-lg">⚠️</span>
          <div>
            <p className="text-amber-200 font-medium text-sm">
              Payment issue — {status.daysRemaining} day{status.daysRemaining !== 1 ? 's' : ''} remaining
            </p>
            <p className="text-amber-200/60 text-xs mt-1">
              Your last payment failed. Update your payment method to avoid losing access.
              {status.gracePeriodEnd && (
                <> Access expires {new Date(status.gracePeriodEnd).toLocaleDateString()}.</>
              )}
            </p>
          </div>
          <a
            href="/billing"
            className="ml-auto shrink-0 bg-amber-500 hover:bg-amber-600 text-black text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
          >
            Update Payment
          </a>
        </div>
      </div>
    )
  }

  if (status.status === 'expired') {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6">
        <div className="flex items-center gap-3">
          <span className="text-red-400 text-lg">🚫</span>
          <div>
            <p className="text-red-200 font-medium text-sm">
              Subscription expired
            </p>
            <p className="text-red-200/60 text-xs mt-1">
              Your grace period has ended. Resubscribe to restore access.
            </p>
          </div>
          <a
            href="/pricing"
            className="ml-auto shrink-0 bg-red-500 hover:bg-red-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
          >
            Resubscribe
          </a>
        </div>
      </div>
    )
  }

  if (status.status === 'past_due') {
    return (
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-6">
        <div className="flex items-center gap-3">
          <span className="text-amber-400 text-lg">⚠️</span>
          <div>
            <p className="text-amber-200 font-medium text-sm">
              Payment past due
            </p>
            <p className="text-amber-200/60 text-xs mt-1">
              Please update your payment method to continue using Clapcheeks.
            </p>
          </div>
          <a
            href="/billing"
            className="ml-auto shrink-0 bg-amber-500 hover:bg-amber-600 text-black text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
          >
            Fix Payment
          </a>
        </div>
      </div>
    )
  }

  return null
}
