'use client'

import { useState } from 'react'

export default function ManageBillingButton() {
  const [loading, setLoading] = useState(false)

  async function handlePortal() {
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/portal', {
        method: 'POST',
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
    <button
      onClick={handlePortal}
      disabled={loading}
      className="text-white/40 hover:text-white/70 text-xs bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition-all cursor-pointer"
    >
      {loading ? 'Loading...' : 'Manage Billing'}
    </button>
  )
}
