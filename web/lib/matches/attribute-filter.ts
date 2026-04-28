/**
 * AI-8873 — pure helpers for filtering matches by AI-extracted attribute tags.
 *
 * Attributes were added in AI-8814 (match attribute extraction + tagging) — they
 * live on `clapcheeks_matches.attributes` (JSONB) with shape
 * `{ allergy: AttributeItem[], dietary: [...], schedule: [...], lifestyle: [...],
 *    logistics: [...], comms: [...], _dismissed: [...] }`.
 *
 * `MIN_DISPLAY_CONFIDENCE` mirrors the threshold in
 * `web/components/matches/AttributeChips.tsx` so what the user filters by is
 * always a subset of what the chip UI displays.
 */

import type { MatchAttributes } from '@/components/matches/AttributeChips'
import type { AttributeFilterOption, ClapcheeksMatchRow } from './types'

export type MatchWithAttributes = ClapcheeksMatchRow & {
  attributes?: MatchAttributes | null
}

const CATEGORIES: AttributeFilterOption['category'][] = [
  'allergy',
  'dietary',
  'schedule',
  'lifestyle',
  'logistics',
  'comms',
]

export const MIN_DISPLAY_CONFIDENCE = 0.6

export function makeAttributeKey(
  category: AttributeFilterOption['category'],
  value: string,
): string {
  return `${category}:${value}`
}

/**
 * Reduce a matches list to the union of every visible (≥0.6 confidence,
 * not-dismissed) attribute, with occurrence counts. Sorted: allergy first
 * (safety-critical), then by descending count, then alphabetical.
 */
export function aggregateAttributes(
  matches: ReadonlyArray<MatchWithAttributes>,
): AttributeFilterOption[] {
  const counts = new Map<string, AttributeFilterOption>()

  for (const match of matches) {
    const attrs = match.attributes
    if (!attrs) continue

    const dismissedSet = new Set(
      (attrs._dismissed ?? []).map((d) => `${d.category}:${d.value}`),
    )

    for (const cat of CATEGORIES) {
      const items = attrs[cat]
      if (!Array.isArray(items)) continue
      for (const item of items) {
        if (!item || typeof item.value !== 'string') continue
        if (typeof item.confidence !== 'number') continue
        if (item.confidence < MIN_DISPLAY_CONFIDENCE) continue
        const key = makeAttributeKey(cat, item.value)
        if (dismissedSet.has(key)) continue
        const existing = counts.get(key)
        if (existing) {
          existing.count += 1
        } else {
          counts.set(key, { category: cat, value: item.value, count: 1 })
        }
      }
    }
  }

  return Array.from(counts.values()).sort((a, b) => {
    // Allergies always float to the top
    if (a.category === 'allergy' && b.category !== 'allergy') return -1
    if (b.category === 'allergy' && a.category !== 'allergy') return 1
    if (b.count !== a.count) return b.count - a.count
    return a.value.localeCompare(b.value)
  })
}

/**
 * Pure predicate: returns true when the match carries EVERY one of
 * `selectedKeys` (AND-match). An empty selection always passes.
 */
export function matchHasAllAttributes(
  match: MatchWithAttributes,
  selectedKeys: ReadonlyArray<string>,
): boolean {
  if (selectedKeys.length === 0) return true
  const attrs = match.attributes
  if (!attrs) return false

  const dismissedSet = new Set(
    (attrs._dismissed ?? []).map((d) => `${d.category}:${d.value}`),
  )

  const present = new Set<string>()
  for (const cat of CATEGORIES) {
    const items = attrs[cat]
    if (!Array.isArray(items)) continue
    for (const item of items) {
      if (!item || typeof item.value !== 'string') continue
      if (typeof item.confidence !== 'number') continue
      if (item.confidence < MIN_DISPLAY_CONFIDENCE) continue
      const key = makeAttributeKey(cat, item.value)
      if (dismissedSet.has(key)) continue
      present.add(key)
    }
  }

  return selectedKeys.every((k) => present.has(k))
}
