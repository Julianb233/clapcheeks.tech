/**
 * AI-10022 — EditDiffStrip
 *
 * Compact strip rendered below the draft textarea. Shows |edited - original|
 * char count + a one-line word-level diff visualization on hover. Surfaces
 * the closed-loop learner's input signal: every char the operator changes
 * is what trains the voice profile.
 */
"use client"

import { useMemo, useState } from "react"

function tokenize(s: string): string[] {
  return s.split(/(\s+)/).filter((t) => t.length > 0)
}

// Tiny LCS-based word diff. Good enough for short messages (<240 chars).
function diffTokens(a: string[], b: string[]): { kind: "same" | "add" | "del"; text: string }[] {
  const n = a.length, m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: { kind: "same" | "add" | "del"; text: string }[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ kind: "same", text: a[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ kind: "del", text: a[i] }); i++ }
    else { out.push({ kind: "add", text: b[j] }); j++ }
  }
  while (i < n) { out.push({ kind: "del", text: a[i++] }) }
  while (j < m) { out.push({ kind: "add", text: b[j++] }) }
  return out
}

export function EditDiffStrip({ original, edited }: { original: string; edited: string }) {
  const [show, setShow] = useState(false)
  const delta = useMemo(() => Math.abs(edited.length - original.length), [original, edited])
  const tokens = useMemo(() => (show ? diffTokens(tokenize(original), tokenize(edited)) : []), [show, original, edited])

  if (!original || !edited || original.trim() === edited.trim()) {
    return (
      <div className="mt-1 text-[10px] text-gray-600">
        unedited — AI draft will ship as-is
      </div>
    )
  }

  const direction = edited.length > original.length ? "added" : "removed"
  return (
    <div className="mt-1">
      <button
        onClick={() => setShow((v) => !v)}
        className="text-[10px] text-emerald-400 hover:text-emerald-300"
      >
        {show ? "▼" : "▶"} you changed {delta} char{delta === 1 ? "" : "s"} ({direction})
      </button>
      {show && tokens.length > 0 && (
        <div className="mt-1 p-2 bg-gray-950 border border-gray-800 rounded text-[11px] leading-relaxed">
          {tokens.map((t, i) => {
            if (t.kind === "same") return <span key={i} className="text-gray-400">{t.text}</span>
            if (t.kind === "add") return <span key={i} className="text-emerald-400 bg-emerald-900/30">{t.text}</span>
            return <span key={i} className="text-red-400 bg-red-900/30 line-through">{t.text}</span>
          })}
        </div>
      )}
    </div>
  )
}
