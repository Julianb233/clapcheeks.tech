'use client'

import { useState, useCallback } from 'react'
import AttributeChip, { type AttributeCategory, type AttributeItem } from './AttributeChip'

export type MatchAttributes = {
  allergy?: AttributeItem[]
  dietary?: AttributeItem[]
  schedule?: AttributeItem[]
  lifestyle?: AttributeItem[]
  logistics?: AttributeItem[]
  comms?: AttributeItem[]
  _dismissed?: { category: string; value: string; dismissed_at: string }[]
  _extracted_at?: string
  _model_used?: string
}

// Display order: allergies ALWAYS first, then the rest
const DISPLAY_ORDER: AttributeCategory[] = [
  'allergy',
  'dietary',
  'schedule',
  'lifestyle',
  'logistics',
  'comms',
]

// Confidence threshold for visible display
const MIN_DISPLAY_CONFIDENCE = 0.60

type Props = {
  matchId: string
  attributes: MatchAttributes | null | undefined
  /** If true, chips are clickable with dismiss action. Default true. */
  interactive?: boolean
  onAttributesChange?: (updated: MatchAttributes) => void
}

export default function AttributeChips({
  matchId,
  attributes,
  interactive = true,
  onAttributesChange,
}: Props) {
  const [localAttrs, setLocalAttrs] = useState<MatchAttributes>(attributes || {})
  const [dismissError, setDismissError] = useState<string | null>(null)

  const handleDismiss = useCallback(
    async (category: AttributeCategory, value: string) => {
      setDismissError(null)
      try {
        const res = await fetch(`/api/matches/${matchId}/attributes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'dismiss', category, value }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }))
          throw new Error(err.error || `Dismiss failed (${res.status})`)
        }
        const data = await res.json()
        const updated: MatchAttributes = data.attributes || {}
        setLocalAttrs(updated)
        onAttributesChange?.(updated)
      } catch (e) {
        setDismissError((e as Error).message)
      }
    },
    [matchId, onAttributesChange],
  )

  // Count total visible chips
  let totalChips = 0
  for (const cat of DISPLAY_ORDER) {
    const items = localAttrs[cat] || []
    totalChips += items.filter((i) => i.confidence >= MIN_DISPLAY_CONFIDENCE).length
  }

  if (totalChips === 0) return null

  const extractedAt = localAttrs._extracted_at
    ? new Date(localAttrs._extracted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 items-center">
        {DISPLAY_ORDER.map((cat) => {
          const items = (localAttrs[cat] || []).filter(
            (i) => i.confidence >= MIN_DISPLAY_CONFIDENCE,
          )
          if (items.length === 0) return null
          return items.map((item) => (
            <AttributeChip
              key={`${cat}:${item.value}`}
              category={cat}
              item={item}
              onDismiss={interactive ? handleDismiss : undefined}
              interactive={interactive}
            />
          ))
        })}

        {extractedAt && (
          <span className="text-[10px] text-white/25 font-mono ml-1 self-center">
            AI · {extractedAt}
          </span>
        )}
      </div>

      {dismissError && (
        <p className="text-[10px] text-red-400 mt-1">{dismissError}</p>
      )}
    </div>
  )
}
