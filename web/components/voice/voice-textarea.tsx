'use client'

import * as React from 'react'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { MicButton } from './mic-button'

type BaseTextareaProps = Omit<React.ComponentProps<'textarea'>, 'onChange'>

interface VoiceTextareaProps extends BaseTextareaProps {
  value?: string
  onChange?: (value: string) => void
  appendMode?: 'append' | 'replace'
  language?: string
  voicePrompt?: string
  micClassName?: string
}

/**
 * Drop-in replacement for <Textarea> with a mic button in the bottom-right.
 * Call sites use a controlled `value` + `onChange(value)` (string, not event)
 * so voice transcripts can be appended cleanly.
 */
export function VoiceTextarea({
  value = '',
  onChange,
  appendMode = 'append',
  language,
  voicePrompt,
  className,
  micClassName,
  disabled,
  ...rest
}: VoiceTextareaProps) {
  const handleTranscript = React.useCallback(
    (text: string) => {
      if (!onChange) return
      if (appendMode === 'replace') {
        onChange(text)
        return
      }
      const base = value ?? ''
      const needsSpace = base.length > 0 && !/\s$/.test(base)
      onChange(base + (needsSpace ? ' ' : '') + text)
    },
    [appendMode, onChange, value],
  )

  return (
    <div className="relative w-full">
      <Textarea
        {...rest}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.value)}
        className={cn('pr-12', className)}
      />
      <div className="absolute bottom-2 right-2">
        <MicButton
          onTranscript={handleTranscript}
          language={language}
          prompt={voicePrompt}
          disabled={disabled}
          size="sm"
          className={micClassName}
        />
      </div>
    </div>
  )
}
