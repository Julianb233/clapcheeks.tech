'use client'

import * as React from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { MicButton } from './mic-button'

type BaseInputProps = Omit<React.ComponentProps<'input'>, 'onChange'>

interface VoiceInputProps extends BaseInputProps {
  value?: string
  onChange?: (value: string) => void
  appendMode?: 'append' | 'replace'
  language?: string
  voicePrompt?: string
  micClassName?: string
}

/**
 * Drop-in replacement for <Input> with a mic button on the right edge.
 */
export function VoiceInput({
  value = '',
  onChange,
  appendMode = 'replace',
  language,
  voicePrompt,
  className,
  micClassName,
  disabled,
  ...rest
}: VoiceInputProps) {
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
      <Input
        {...rest}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.value)}
        className={cn('pr-10', className)}
      />
      <div className="absolute inset-y-0 right-1 flex items-center">
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
