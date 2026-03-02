'use client'

import Link from 'next/link'

interface EliteOnlyProps {
  isElite: boolean
  children: React.ReactNode
  fallback?: React.ReactNode
  featureName?: string
}

export default function EliteOnly({ isElite, children, fallback, featureName }: EliteOnlyProps) {
  if (isElite) {
    return <>{children}</>
  }

  if (fallback) {
    return <>{fallback}</>
  }

  return (
    <div className="relative rounded-xl bg-white/5 border border-white/10 p-5 text-center">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/60 rounded-xl" />
      <div className="relative z-10 py-6">
        <div className="inline-flex items-center gap-1.5 bg-brand-900/40 border border-brand-700/40 rounded-full px-3 py-1 mb-3">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-brand-400">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
          <span className="text-brand-300 text-xs font-medium">Elite</span>
        </div>
        {featureName && (
          <p className="text-white/50 text-sm mb-3">{featureName} is an Elite feature</p>
        )}
        <Link
          href="/pricing"
          className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-5 py-2 rounded-xl transition-all"
        >
          Upgrade to Elite
        </Link>
      </div>
    </div>
  )
}
