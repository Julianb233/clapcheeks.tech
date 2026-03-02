'use client'

const OPTIONS = [7, 30, 90] as const

interface DateRangePickerProps {
  value: number
  onChange: (days: number) => void
}

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  return (
    <div className="flex items-center gap-2">
      {OPTIONS.map((days) => (
        <button
          key={days}
          onClick={() => onChange(days)}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
            value === days
              ? 'bg-brand-600 text-white'
              : 'bg-white/5 text-white/50 hover:bg-white/10 border border-white/10'
          }`}
        >
          {days}d
        </button>
      ))}
    </div>
  )
}
