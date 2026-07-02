/**
 * AI-10022 — ConfirmModal
 *
 * Styled modal replacement for native confirm(). Used by Send-now and
 * Schedule-send actions in ComposePanel. Shows the message body verbatim
 * + scheduled time + "Confirm" / "Cancel".
 */
"use client"

type Props = {
  open: boolean
  title: string
  body: string
  scheduledFor?: string
  confirmLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({ open, title, body, scheduledFor, confirmLabel = "Send", destructive = false, onConfirm, onCancel }: Props) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-gray-900 border border-purple-800/60 rounded-lg shadow-2xl max-w-md w-full p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-purple-200 mb-2">{title}</h3>
        {scheduledFor && (
          <div className="mb-3 text-xs text-blue-300 bg-blue-950/40 border border-blue-900/40 rounded px-2 py-1">
            📅 fires at {scheduledFor}
          </div>
        )}
        <div className="mb-4 p-3 bg-gray-950 border border-gray-800 rounded text-sm text-gray-200 whitespace-pre-wrap max-h-48 overflow-auto">
          {body}
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded text-sm bg-gray-800 hover:bg-gray-700 text-gray-300"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={
              destructive
                ? "px-3 py-1.5 rounded text-sm bg-red-600 hover:bg-red-500 text-white"
                : "px-3 py-1.5 rounded text-sm bg-purple-600 hover:bg-purple-500 text-white"
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
