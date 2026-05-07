/**
 * AI-9526 F10 — DataUnavailable banner.
 *
 * Surfaces when 2+ Convex queries fail in a single page load. Keeps the
 * dashboard from silently rendering empty/zero values that look like real
 * data. Each error is a short string ("telemetry", "spending", etc.).
 */
type Props = {
  errors: string[]
}

export default function DataUnavailable({ errors }: Props) {
  if (!errors || errors.length === 0) return null
  return (
    <div
      role="alert"
      className="mb-4 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200"
    >
      <div className="font-mono uppercase tracking-wider text-[10px] text-yellow-400 mb-1">
        Data Unavailable
      </div>
      <div className="text-yellow-100/90">
        Some live data could not be loaded ({errors.length} source
        {errors.length === 1 ? '' : 's'}). Showing last-known values where
        possible.
      </div>
      <div className="mt-1 text-xs text-yellow-300/80 font-mono">
        {errors.join(', ')}
      </div>
    </div>
  )
}
