'use client'

import { useState } from 'react'
import { analytics } from '@/lib/posthog'

interface CheckoutButtonProps {
  plan: string
  addons?: string[]
  children: React.ReactNode
  className?: string
}

export default function CheckoutButton({ plan, addons, children, className }: CheckoutButtonProps) {
  const [loading, setLoading] = useState(false)

  async function handleCheckout() {
    setLoading(true)
    analytics.checkoutStarted(plan, 0)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, addons }),
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      }
    } catch {
      setLoading(false)
    }
  }

  return (
    <button onClick={handleCheckout} disabled={loading} className={className}>
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading...
        </span>
      ) : (
        children
      )}
    </button>
  )
}
