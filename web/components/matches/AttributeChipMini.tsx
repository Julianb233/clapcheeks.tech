'use client'

import type { AttributeCategory, AttributeItem } from './AttributeChip'
import type { MatchAttributes } from './AttributeChips'

// Compact icon-only variant for the matches grid
const CATEGORY_ICONS: Record<AttributeCategory, string> = {
  allergy:   '⚠',
  dietary:   '🥗',
  schedule:  '🕐',
  lifestyle: '✨',
  logistics: '📍',
  comms:     '💬',
}

const CATEGORY_STYLES: Record<AttributeCategory, string> = {
  allergy:   'bg-red-500/20 text-red-300 border-red-500/40 ring-1 ring-red-500/30',
  dietary:   'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  schedule:  'bg-blue-500/15 text-blue-300 border-blue-500/25',
  lifestyle: 'bg-purple-500/15 text-purple-300 border-purple-500/25',
  logistics: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  comms:     'bg-teal-500/15 text-teal-300 border-teal-500/25',
}

const DISPLAY_ORDER: AttributeCategory[] = [
  'allergy',
  'dietary',
  'schedule',
  'lifestyle',
  'logistics',
  'comms',
]

const MIN_DISPLAY_CONFIDENCE = 0.60
const MAX_MINI_CHIPS = 4  // cap to keep the grid clean

type Props = {
  attributes: MatchAttributes | null | undefined
  className?: string
}

export default function AttributeChipMini({ attributes, className = '' }: Props) {
  if (!attributes) return null

  // Collect all chips (allergies first)
  const chips: { category: AttributeCategory; item: AttributeItem }[] = []
  for (const cat of DISPLAY_ORDER) {
    const items = (attributes[cat] || []).filter(
      (i) => i.confidence >= MIN_DISPLAY_CONFIDENCE,
    )
    for (const item of items) {
      chips.push({ category: cat, item })
    }
  }

  if (chips.length === 0) return null

  const shown = chips.slice(0, MAX_MINI_CHIPS)
  const overflow = chips.length - shown.length

  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {shown.map(({ category, item }) => (
        <span
          key={`${category}:${item.value}`}
          title={`${item.value} (${category})`}
          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border text-[10px] font-medium leading-none ${CATEGORY_STYLES[category]}`}
        >
          <span aria-hidden="true">{CATEGORY_ICONS[category]}</span>
          <span className="hidden sm:inline truncate max-w-[60px]">{item.value}</span>
        </span>
      ))}
      {overflow > 0 && (
        <span className="text-[10px] text-white/30 self-center font-mono">+{overflow}</span>
      )}
    </div>
  )
}
