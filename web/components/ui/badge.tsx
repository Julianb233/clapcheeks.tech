import { cn } from '@/lib/utils'
import type { HTMLAttributes } from 'react'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'brand' | 'success' | 'warning'
}

export function Badge({ className, variant = 'default', children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1',
        {
          'bg-white/8 text-white/70 border border-white/10': variant === 'default',
          'bg-brand-900/60 text-brand-300 border border-brand-700/50': variant === 'brand',
          'bg-emerald-900/60 text-emerald-300 border border-emerald-700/50': variant === 'success',
          'bg-amber-900/60 text-amber-300 border border-amber-700/50': variant === 'warning',
        },
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}
