'use client'

import { useState, useEffect, useCallback } from 'react'
import { Send, Phone, CheckCircle, Clock, XCircle, RefreshCw } from 'lucide-react'
import { VoiceInput, VoiceTextarea } from '@/components/voice'

type OpenerStyle = 'witty' | 'warm' | 'direct'
type MessageStatus = 'queued' | 'sent' | 'failed'

interface QueuedMessage {
  id: string
  recipient_handle: string
  body: string
  status: MessageStatus
  created_at: string
}

const STYLE_LABELS: Record<OpenerStyle, { label: string; desc: string; color: string }> = {
  witty:  { label: 'Witty',  desc: 'Playful & confident',  color: 'border-blue-500/40 bg-blue-500/10 text-blue-300' },
  warm:   { label: 'Warm',   desc: 'Friendly & genuine',   color: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  direct: { label: 'Direct', desc: 'Straightforward',      color: 'border-green-500/40 bg-green-500/10 text-green-300' },
}

const STATUS_ICON: Record<MessageStatus, React.ReactNode> = {
  queued: <Clock className="w-3.5 h-3.5 text-amber-400" />,
  sent:   <CheckCircle className="w-3.5 h-3.5 text-green-400" />,
  failed: <XCircle className="w-3.5 h-3.5 text-red-400" />,
}

const STATUS_LABEL: Record<MessageStatus, string> = {
  queued: 'Queued — sending in ~30s',
  sent:   'Sent via iMessage',
  failed: 'Failed to send',
}

export default function IMessageTestPanel() {
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const [style, setStyle] = useState<OpenerStyle>('warm')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [history, setHistory] = useState<QueuedMessage[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [useCustom, setUseCustom] = useState(false)

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/imessage/test')
      if (res.ok) {
        const data = await res.json()
        setHistory(data.messages || [])
      }
    } catch {
      // silent
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    loadHistory()
    const interval = setInterval(loadHistory, 15000) // poll every 15s to catch status updates
    return () => clearInterval(interval)
  }, [loadHistory])

  async function handleSend() {
    setError(null)
    setSuccess(null)

    const cleanPhone = phone.trim()
    if (!cleanPhone) {
      setError('Enter a phone number to test with.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/imessage/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: cleanPhone,
          message: useCustom && message.trim() ? message.trim() : undefined,
          opener_style: style,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to queue message.')
      } else {
        setSuccess(data.message)
        setPhone('')
        setMessage('')
        loadHistory()
      }
    } catch {
      setError('Network error. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-white font-semibold flex items-center gap-2">
            <Phone className="w-4 h-4 text-[#8B5CF6]" />
            Test iMessage Automation
          </h2>
          <p className="text-white/40 text-xs mt-0.5">
            Queue a real iMessage — your Mac agent sends it within 30 seconds.
          </p>
        </div>
        <button
          onClick={loadHistory}
          className="text-white/30 hover:text-white/60 transition-colors p-1.5 rounded-lg hover:bg-white/5"
          title="Refresh status"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Phone input */}
      <div className="mb-4">
        <label className="text-white/50 text-xs font-medium block mb-1.5">Phone Number</label>
        <VoiceInput
          type="tel"
          placeholder="+1 (555) 000-0000"
          value={phone}
          onChange={setPhone}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          className="w-full h-auto bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-white/25 text-sm focus:outline-none focus:border-[#8B5CF6]/50 focus:ring-1 focus:ring-[#8B5CF6]/30 transition-all"
        />
        <p className="text-white/25 text-[11px] mt-1">US numbers: 10 digits. International: include + and country code.</p>
      </div>

      {/* Opener style */}
      <div className="mb-4">
        <label className="text-white/50 text-xs font-medium block mb-1.5">Opener Style</label>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(STYLE_LABELS) as OpenerStyle[]).map(s => (
            <button
              key={s}
              onClick={() => setStyle(s)}
              className={`rounded-xl p-3 border text-left transition-all ${
                style === s
                  ? STYLE_LABELS[s].color + ' border-opacity-80'
                  : 'border-white/8 bg-white/[0.02] text-white/40 hover:bg-white/[0.04]'
              }`}
            >
              <div className="text-xs font-semibold">{STYLE_LABELS[s].label}</div>
              <div className="text-[10px] opacity-70 mt-0.5">{STYLE_LABELS[s].desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Custom message toggle */}
      <div className="mb-4">
        <button
          onClick={() => setUseCustom(!useCustom)}
          className="text-[#8B5CF6] text-xs hover:text-[#A855F7] transition-colors"
        >
          {useCustom ? '↑ Use AI-generated opener' : '↓ Write custom message'}
        </button>
        {useCustom && (
          <VoiceTextarea
            placeholder="Type your message here..."
            value={message}
            onChange={setMessage}
            rows={3}
            className="w-full mt-2 bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-white/25 text-sm focus:outline-none focus:border-[#8B5CF6]/50 focus:ring-1 focus:ring-[#8B5CF6]/30 transition-all resize-none"
          />
        )}
      </div>

      {/* Feedback */}
      {error && (
        <div className="mb-3 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-3 text-xs text-green-400 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
          {success}
        </div>
      )}

      {/* Send button */}
      <button
        onClick={handleSend}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 h-11 rounded-xl font-semibold text-sm transition-all
          bg-gradient-to-r from-[#8B5CF6] to-[#7C3AED] text-white
          hover:from-[#7C3AED] hover:to-[#6D28D9]
          disabled:opacity-50 disabled:cursor-not-allowed
          shadow-[0_0_20px_rgba(139,92,246,0.25)]"
      >
        {loading ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin" />
            Queuing...
          </>
        ) : (
          <>
            <Send className="w-4 h-4" />
            Send Test iMessage
          </>
        )}
      </button>

      <p className="text-white/25 text-[11px] text-center mt-2">
        Requires Mac agent running · <code className="font-mono">clapcheeks start</code>
      </p>

      {/* History */}
      {!historyLoading && history.length > 0 && (
        <div className="mt-6">
          <h3 className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">
            Recent Test Messages
          </h3>
          <div className="space-y-2">
            {history.map(msg => (
              <div
                key={msg.id}
                className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-white/70 text-xs font-mono mb-1">{msg.recipient_handle}</div>
                    <div className="text-white/50 text-xs leading-relaxed truncate">{msg.body}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {STATUS_ICON[msg.status]}
                    <span className={`text-[10px] ${
                      msg.status === 'sent' ? 'text-green-400' :
                      msg.status === 'failed' ? 'text-red-400' : 'text-amber-400'
                    }`}>
                      {STATUS_LABEL[msg.status]}
                    </span>
                  </div>
                </div>
                <div className="text-white/20 text-[10px] mt-1.5">
                  {new Date(msg.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
