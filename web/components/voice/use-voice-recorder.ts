'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type RecorderState = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'error'

interface UseVoiceRecorderOptions {
  onTranscript: (text: string) => void
  language?: string
  prompt?: string
  onError?: (err: Error) => void
}

interface UseVoiceRecorderReturn {
  state: RecorderState
  error: string | null
  start: () => Promise<void>
  stop: () => Promise<void>
  toggle: () => Promise<void>
  isRecording: boolean
  isBusy: boolean
}

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm'
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ]
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return ''
}

export function useVoiceRecorder({
  onTranscript,
  language = 'en',
  prompt,
  onError,
}: UseVoiceRecorderOptions): UseVoiceRecorderReturn {
  const [state, setState] = useState<RecorderState>('idle')
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mimeRef = useRef<string>('')

  const cleanup = useCallback(() => {
    recorderRef.current = null
    chunksRef.current = []
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  useEffect(() => () => cleanup(), [cleanup])

  const transcribe = useCallback(
    async (blob: Blob) => {
      setState('transcribing')
      const fd = new FormData()
      const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm'
      fd.append('audio', blob, `clip.${ext}`)
      fd.append('language', language)
      if (prompt) fd.append('prompt', prompt)
      try {
        const res = await fetch('/api/transcribe', { method: 'POST', body: fd })
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}))
          const msg = (detail as { error?: string }).error ?? `HTTP ${res.status}`
          throw new Error(msg)
        }
        const data = (await res.json()) as { text?: string }
        const text = (data.text ?? '').trim()
        if (text) onTranscript(text)
        setState('idle')
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Transcription failed'
        setError(msg)
        setState('error')
        onError?.(err instanceof Error ? err : new Error(msg))
      }
    },
    [language, prompt, onTranscript, onError],
  )

  const start = useCallback(async () => {
    if (state === 'recording' || state === 'requesting') return
    setError(null)
    setState('requesting')
    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone not supported in this browser')
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = pickMimeType()
      mimeRef.current = mime
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      recorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeRef.current || 'audio/webm' })
        cleanup()
        if (blob.size > 0) {
          void transcribe(blob)
        } else {
          setState('idle')
        }
      }
      recorder.onerror = (e) => {
        const errEvent = e as unknown as { error?: Error }
        const errObj = errEvent.error ?? new Error('Recorder error')
        setError(errObj.message)
        setState('error')
        cleanup()
      }

      recorder.start()
      setState('recording')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Microphone denied'
      setError(msg)
      setState('error')
      cleanup()
      onError?.(err instanceof Error ? err : new Error(msg))
    }
  }, [state, cleanup, transcribe, onError])

  const stop = useCallback(async () => {
    const r = recorderRef.current
    if (r && r.state !== 'inactive') {
      r.stop()
    } else {
      setState('idle')
    }
  }, [])

  const toggle = useCallback(async () => {
    if (state === 'recording') return stop()
    return start()
  }, [state, start, stop])

  return {
    state,
    error,
    start,
    stop,
    toggle,
    isRecording: state === 'recording',
    isBusy: state === 'requesting' || state === 'transcribing',
  }
}
