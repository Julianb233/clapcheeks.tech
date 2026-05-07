'use client'

interface DataUnavailableProps {
  /** Which queries failed, e.g. ['telemetry', 'devices'] */
  failedSources?: string[]
  onRetry?: () => void
}

export default function DataUnavailable({ failedSources, onRetry }: DataUnavailableProps) {
  return (
    <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl p-4 flex items-start gap-3 mb-6">
      <svg
        className="w-4 h-4 text-amber-400 shrink-0 mt-0.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
        />
      </svg>
      <div className="flex-1 min-w-0">
        <div className="text-amber-400 font-semibold text-sm">Live data unavailable — backend unreachable</div>
        <p className="text-white/50 text-xs mt-0.5">
          {failedSources && failedSources.length > 0
            ? `Could not load: ${failedSources.join(', ')}. Showing zeros or cached values.`
            : 'One or more data sources failed. Showing zeros or cached values.'}
        </p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="shrink-0 text-xs text-amber-400 hover:text-amber-300 underline underline-offset-2 transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  )
}
