'use client'

interface PlanBadgeProps {
  plan: 'base' | 'elite' | null
  subscriptionStatus?: string
}

export default function PlanBadge({ plan, subscriptionStatus }: PlanBadgeProps) {
  if (!plan || subscriptionStatus === 'inactive') {
    return (
      <span className="inline-flex items-center gap-1 bg-white/5 border border-white/10 rounded-full px-2.5 py-0.5 text-[10px] font-medium text-white/40">
        Free
      </span>
    )
  }

  if (subscriptionStatus === 'past_due') {
    return (
      <span className="inline-flex items-center gap-1 bg-yellow-900/30 border border-yellow-700/40 rounded-full px-2.5 py-0.5 text-[10px] font-medium text-yellow-300">
        Past Due
      </span>
    )
  }

  if (plan === 'elite') {
    return (
      <span className="inline-flex items-center gap-1 bg-brand-900/40 border border-brand-700/40 rounded-full px-2.5 py-0.5 text-[10px] font-medium text-brand-300">
        Elite
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 bg-white/5 border border-white/10 rounded-full px-2.5 py-0.5 text-[10px] font-medium text-white/50">
      Base
    </span>
  )
}
