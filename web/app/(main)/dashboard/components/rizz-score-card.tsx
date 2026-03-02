'use client'

import { ArrowUp, ArrowDown, Minus } from 'lucide-react'
import { getRizzColor } from '@/lib/rizz'

interface RizzScoreCardProps {
  score: number
  trend: { direction: 'up' | 'down' | 'same'; delta: number }
  matchRate: number
}

export function RizzScoreCard({ score, trend, matchRate }: RizzScoreCardProps) {
  const color = getRizzColor(score)
  const circumference = 2 * Math.PI * 54
  const offset = circumference - (score / 100) * circumference

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-6">
      <h2 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-4">
        Rizz Score
      </h2>
      <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
        {/* Circular gauge */}
        <div className="relative w-24 h-24 sm:w-32 sm:h-32 shrink-0">
          <svg className="w-24 h-24 sm:w-32 sm:h-32 -rotate-90" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="8" />
            <circle
              cx="60" cy="60" r="54" fill="none"
              stroke={color} strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className="transition-all duration-700"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold text-white">{score}</span>
            <span className="text-white/40 text-xs">/ 100</span>
          </div>
        </div>

        <div className="flex-1 space-y-3">
          {/* Trend */}
          <div className="flex items-center gap-2">
            {trend.direction === 'up' && <ArrowUp className="w-4 h-4 text-green-400" />}
            {trend.direction === 'down' && <ArrowDown className="w-4 h-4 text-red-400" />}
            {trend.direction === 'same' && <Minus className="w-4 h-4 text-white/30" />}
            <span className={`text-sm font-medium ${
              trend.direction === 'up' ? 'text-green-400' :
              trend.direction === 'down' ? 'text-red-400' : 'text-white/30'
            }`}>
              {trend.direction === 'same' ? 'No change' :
                `${trend.direction === 'up' ? '+' : ''}${trend.delta} from last week`}
            </span>
          </div>

          {/* Match rate */}
          <div className="text-sm text-white/50">
            Match rate: <span className="text-white font-medium">{matchRate.toFixed(1)}%</span>
          </div>

          <p className="text-white/30 text-xs">
            Based on reply rate, date conversion, and match rate
          </p>
        </div>
      </div>
    </div>
  )
}
