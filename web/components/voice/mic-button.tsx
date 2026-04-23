'use client'

import * as React from 'react'
import { Mic, MicOff, Loader2, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useVoiceRecorder } from './use-voice-recorder'

interface MicButtonProps {
  onTranscript: (text: string) => void
  language?: string
  prompt?: string
  size?: 'sm' | 'md'
  className?: string
  disabled?: boolean
  title?: string
}

/**
 * Standalone mic button — tap to start recording, tap again to stop and transcribe.
 * Emits the transcript string via onTranscript. Composable anywhere.
 */
export function MicButton({
  onTranscript,
  language,
  prompt,
  size = 'md',
  className,
  disabled,
  title,
}: MicButtonProps) {
  const { state, toggle, isRecording, isBusy, error } = useVoiceRecorder({
    onTranscript,
    language,
    prompt,
  })

  const sizing = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8'
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'

  let Icon = Mic
  let label = title || 'Record voice'
  if (isRecording) {
    Icon = Square
    label = 'Stop and transcribe'
  } else if (isBusy) {
    Icon = Loader2
    label = state === 'requesting' ? 'Requesting microphone…' : 'Transcribing…'
  } else if (state === 'error') {
    Icon = MicOff
    label = error ?? 'Microphone error'
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={disabled || isBusy}
      aria-label={label}
      title={label}
      aria-pressed={isRecording}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md border transition-colors',
        sizing,
        isRecording
          ? 'border-red-500/60 bg-red-500/10 text-red-400 animate-pulse hover:bg-red-500/20'
          : 'border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent',
        (disabled || isBusy) && 'opacity-60 cursor-not-allowed',
        className,
      )}
    >
      <Icon className={cn(iconSize, isBusy && 'animate-spin')} />
    </button>
  )
}
