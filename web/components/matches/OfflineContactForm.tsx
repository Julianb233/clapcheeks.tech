'use client'

import * as React from 'react'
import { Plus } from 'lucide-react'

/**
 * Stub — unblocks production build while full "add offline match" flow
 * is designed. When a user wants to track someone they met IRL, this
 * opens a minimal form that inserts a row into `clapcheeks_matches`
 * with source='offline'.
 *
 * TODO (AI-8594 follow-on): replace this stub with a proper dialog that
 * takes name, phone, platform, notes and posts to /api/matches.
 */
export default function OfflineContactForm() {
  const [open, setOpen] = React.useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-mono text-white/70 transition-colors hover:bg-white/10 hover:text-white"
      >
        <Plus className="h-3.5 w-3.5" />
        Add offline match
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="rounded-xl border border-white/10 bg-[#0a0a12] p-6 max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-medium text-white mb-2">Coming soon</h2>
            <p className="text-sm text-white/60 mb-4">
              Offline match tracking is on the roadmap — add someone you met in person and
              Clapcheeks will still draft messages for them.
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg bg-white/10 hover:bg-white/20 px-4 py-2 text-sm text-white transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  )
}
