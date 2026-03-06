import { ArrowUp, ArrowDown, Minus } from 'lucide-react'

interface TrendCardProps {
  label: string
  value: string
  trend?: { direction: 'up' | 'down' | 'same'; delta: number }
  /** When true, down=green (good) and up=red (bad) — used for cost metrics like CPN */
  invertColors?: boolean
}

export function TrendCard({ label, value, trend, invertColors }: TrendCardProps) {
  const upColor = invertColors ? 'text-red-400' : 'text-green-400'
  const downColor = invertColors ? 'text-green-400' : 'text-red-400'

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
      <div className="text-2xl font-bold text-white mb-1">{value}</div>
      <div className="text-white/40 text-xs mb-1">{label}</div>
      {trend && trend.direction !== 'same' && (
        <div className={`inline-flex items-center gap-1 text-xs ${
          trend.direction === 'up' ? upColor : downColor
        }`}>
          {trend.direction === 'up' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
          {Math.abs(trend.delta)}%
        </div>
      )}
      {trend && trend.direction === 'same' && (
        <div className="inline-flex items-center gap-1 text-xs text-white/30">
          <Minus className="w-3 h-3" /> steady
        </div>
      )}
    </div>
  )
}
