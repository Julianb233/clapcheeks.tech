'use client'

import { useState, useRef, useEffect } from 'react'

export type AttributeCategory = 'allergy' | 'dietary' | 'schedule' | 'lifestyle' | 'logistics' | 'comms'

export type AttributeItem = {
  value: string
  confidence: number
  source_msg_excerpt: string
  source_msg_index: number
}

// Category → color classes (dark-mode, matching project palette)
const CATEGORY_STYLES: Record<AttributeCategory, { chip: string; label: string }> = {
  allergy:   { chip: 'bg-red-500/15 text-red-200 border-red-500/50',        label: 'text-red-300' },
  dietary:   { chip: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30', label: 'text-emerald-400' },
  schedule:  { chip: 'bg-blue-500/15 text-blue-200 border-blue-500/30',     label: 'text-blue-400' },
  lifestyle: { chip: 'bg-purple-500/15 text-purple-200 border-purple-500/30', label: 'text-purple-400' },
  logistics: { chip: 'bg-amber-500/15 text-amber-200 border-amber-500/30',  label: 'text-amber-400' },
  comms:     { chip: 'bg-teal-500/15 text-teal-200 border-teal-500/30',     label: 'text-teal-400' },
}

const CATEGORY_ICONS: Record<AttributeCategory, string> = {
  allergy:   '⚠',
  dietary:   '🥗',
  schedule:  '🕐',
  lifestyle: '✨',
  logistics: '📍',
  comms:     '💬',
}

type Props = {
  category: AttributeCategory
  item: AttributeItem
  onDismiss?: (category: AttributeCategory, value: string) => void | Promise<void>
  /** Show popover on click (default true) */
  interactive?: boolean
}

export default function AttributeChip({ category, item, onDismiss, interactive = true }: Props) {
  const [open, setOpen] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const styles = CATEGORY_STYLES[category]
  const isAllergy = category === 'allergy'

  // Close popover on outside click
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  async function handleDismiss() {
    if (!onDismiss) return
    setDismissing(true)
    try {
      await onDismiss(category, item.value)
      setOpen(false)
    } finally {
      setDismissing(false)
    }
  }

  const confidencePct = Math.round(item.confidence * 100)

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => interactive && setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium transition-all ${styles.chip} ${
          isAllergy ? 'ring-1 ring-red-500/40 font-semibold' : ''
        } ${interactive ? 'hover:brightness-125 cursor-pointer' : 'cursor-default'}`}
        aria-label={`${item.value} — ${category}`}
        aria-expanded={open}
      >
        {isAllergy && (
          <span className="text-red-300 leading-none" aria-hidden="true">⚠</span>
        )}
        {item.value}
      </button>

      {/* Source popover */}
      {open && interactive && (
        <div className="absolute left-0 bottom-full mb-2 z-50 w-72 rounded-xl border border-white/15 bg-black/90 backdrop-blur-sm shadow-2xl p-4 text-left">
          {/* Category label */}
          <div className={`text-[10px] uppercase tracking-widest font-mono mb-2 ${styles.label}`}>
            {CATEGORY_ICONS[category]} {category}
          </div>

          {/* Value */}
          <div className="text-sm font-semibold text-white mb-1">{item.value}</div>

          {/* Source excerpt */}
          {item.source_msg_excerpt && (
            <div className="text-[11px] text-white/60 bg-white/5 border border-white/10 rounded-lg px-2.5 py-2 mb-2 italic leading-snug">
              &ldquo;{item.source_msg_excerpt}&rdquo;
            </div>
          )}

          {/* Confidence */}
          <div className="flex items-center gap-2 mb-3">
            <div className="text-[10px] text-white/40 font-mono">Confidence</div>
            <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  item.confidence >= 0.80 ? 'bg-emerald-400' :
                  item.confidence >= 0.60 ? 'bg-amber-400' : 'bg-red-400'
                }`}
                style={{ width: `${confidencePct}%` }}
              />
            </div>
            <div className="text-[10px] text-white/60 font-mono">{confidencePct}%</div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[11px] px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors border border-white/10"
            >
              Close
            </button>
            {onDismiss && (
              <button
                type="button"
                onClick={() => void handleDismiss()}
                disabled={dismissing}
                className="text-[11px] px-2.5 py-1 rounded-md bg-white/5 hover:bg-red-500/20 text-white/60 hover:text-red-300 transition-colors border border-white/10 hover:border-red-500/30 disabled:opacity-50"
              >
                {dismissing ? 'Dismissing...' : 'Dismiss'}
              </button>
            )}
          </div>

          {/* Caret */}
          <div className="absolute left-4 bottom-[-5px] w-2.5 h-2.5 border-r border-b border-white/15 bg-black/90 rotate-45" />
        </div>
      )}
    </div>
  )
}
