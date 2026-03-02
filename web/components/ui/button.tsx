import { cn } from '@/lib/utils'
import { type ButtonHTMLAttributes, forwardRef } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline'
  size?: 'sm' | 'md' | 'lg'
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center font-medium rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 focus:ring-offset-black disabled:opacity-50 disabled:cursor-not-allowed',
          {
            // Variants
            'bg-brand-600 hover:bg-brand-500 text-white shadow-lg shadow-brand-900/40 hover:shadow-brand-800/50 active:scale-[0.98]':
              variant === 'primary',
            'bg-white/8 hover:bg-white/12 border border-white/10 hover:border-white/20 text-white active:scale-[0.98]':
              variant === 'secondary',
            'hover:bg-white/6 text-white/70 hover:text-white': variant === 'ghost',
            'border border-brand-600 hover:bg-brand-600/10 text-brand-400 hover:text-brand-300':
              variant === 'outline',
            // Sizes
            'text-xs px-3 py-1.5 gap-1.5': size === 'sm',
            'text-sm px-5 py-2.5 gap-2': size === 'md',
            'text-base px-7 py-3.5 gap-2.5': size === 'lg',
          },
          className
        )}
        {...props}
      >
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'

export { Button }
