'use client'

import { useState, useEffect, useCallback } from 'react'
import { Send, Phone, CheckCircle, Clock, XCircle, RefreshCw } from 'lucide-react'
import { VoiceInput, VoiceTextarea } from '@/components/voice'

type OpenerStyle = 'witty' | 'warm' | 'direct'
type MessageStatus = 'queued' | 'sent' | 'failed'

interface QueuedMessage {
  id?: string
  _id?: string
  recipient_handle: string
  body: string
  status: MessageStatus
  created_at: string
}

interface SelfTestRecipient {
  configured: boolean
  last4: string | null
}

interface LiveSendGate {
  ready: boolean
  missing: string[]
  issues?: string[]
  sample_override_required: boolean
  required_permission: string
  runbook: string
  no_send_performed: boolean
  preflight?: {
    exists: boolean
    ready: boolean
    fresh: boolean
    age_seconds: number | null
    max_age_seconds: number
    phone_last4: string | null
    body_length: number | null
    body_sha256: string | null
    no_send_performed: boolean | null
  }
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
  const [dryRun, setDryRun] = useState(true)
  const [confirmLiveSend, setConfirmLiveSend] = useState(false)
  const [liveSendPhrase, setLiveSendPhrase] = useState('')
  const [useSelfTestRecipient, setUseSelfTestRecipient] = useState(false)
  const [selfTestRecipient, setSelfTestRecipient] = useState<SelfTestRecipient>({
    configured: false,
    last4: null,
  })
  const [liveSendGate, setLiveSendGate] = useState<LiveSendGate | null>(null)
  const liveSendLocked = !dryRun && liveSendGate?.ready !== true
  const requiredLivePhrase = liveSendGate?.required_permission || 'SEND LIVE TO JULIAN'

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/imessage/test')
      if (res.ok) {
        const data = await res.json()
        setHistory(data.messages || [])
        if (data.self_test_recipient) setSelfTestRecipient(data.self_test_recipient)
        if (data.live_send_gate) setLiveSendGate(data.live_send_gate)
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
    if (!useSelfTestRecipient && !cleanPhone) {
      setError('Enter a phone number to test with.')
      return
    }
    if (useSelfTestRecipient && !selfTestRecipient.configured) {
      setError('Self-test recipient is not configured on this server.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/imessage/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: cleanPhone,
          use_self_test_recipient: useSelfTestRecipient,
          message: useCustom && message.trim() ? message.trim() : undefined,
          opener_style: style,
          dry_run: dryRun,
          confirm_send: !dryRun && confirmLiveSend,
          live_send_phrase: liveSendPhrase.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to queue message.')
      } else {
        setSuccess(data.message)
        if (!dryRun) {
          setPhone('')
          setMessage('')
          setConfirmLiveSend(false)
          setLiveSendPhrase('')
        }
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
        <div className="mb-2 flex items-center justify-between gap-3">
          <label className="text-white/50 text-xs font-medium">Phone Number</label>
          <button
            type="button"
            onClick={() => setUseSelfTestRecipient((v) => !v)}
            disabled={!selfTestRecipient.configured}
            className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-white/50 transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {useSelfTestRecipient
              ? 'Using self-test'
              : selfTestRecipient.configured
                ? `Use self-test ••••${selfTestRecipient.last4}`
                : 'Self-test not configured'}
          </button>
        </div>
        <VoiceInput
          type="tel"
          placeholder="+1 (555) 000-0000"
          value={phone}
          onChange={setPhone}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          disabled={useSelfTestRecipient}
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
      <div className="mb-3 rounded-xl border border-white/10 bg-black/25 p-3">
        <label className="flex items-start gap-2 text-xs text-white/60">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => {
              setDryRun(e.target.checked)
              setConfirmLiveSend(false)
            }}
            className="mt-0.5"
          />
          <span>Dry run only. Validate the phone and queue shape without sending.</span>
        </label>
        {!dryRun && (
          <label className="mt-2 flex items-start gap-2 text-xs text-red-200">
            <input
              type="checkbox"
              checked={confirmLiveSend}
              onChange={(e) => {
                setConfirmLiveSend(e.target.checked)
                if (!e.target.checked) setLiveSendPhrase('')
              }}
              className="mt-0.5"
            />
            <span>I understand this queues a real iMessage from this Mac.</span>
          </label>
        )}
        {liveSendLocked && (
          <div className="mt-2 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[11px] leading-relaxed text-amber-100">
            Live iMessage queueing is locked until the explicit live-send env and preflight gate are ready.
          </div>
        )}
        {!dryRun && confirmLiveSend && (
          <input
            type="text"
            value={liveSendPhrase}
            onChange={(e) => setLiveSendPhrase(e.target.value)}
            placeholder={`Type ${requiredLivePhrase}`}
            className="mt-2 w-full rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-100 placeholder-red-100/30 outline-none focus:border-red-300/50"
          />
        )}
      </div>

      <button
        onClick={handleSend}
        disabled={loading || (!dryRun && (liveSendLocked || !confirmLiveSend || liveSendPhrase.trim() !== requiredLivePhrase))}
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
            {dryRun ? 'Verify Test iMessage' : 'Send Live Test iMessage'}
          </>
        )}
      </button>

      <p className="text-white/25 text-[11px] text-center mt-2">
        Live sends require Mac agent running · <code className="font-mono">clapcheeks start</code>
      </p>

      {liveSendGate && (
        <div className="mt-3 rounded-xl border border-white/10 bg-black/25 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold text-white/65">Final live-send gate</div>
            <div className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
              liveSendGate.ready ? 'bg-emerald-400/15 text-emerald-200' : 'bg-amber-400/15 text-amber-200'
            }`}>
              {liveSendGate.ready ? 'Preflight ready' : `${liveSendGate.missing.length} env missing`}
            </div>
          </div>
          <div className="mt-2 text-[11px] leading-relaxed text-white/40">
            Permission phrase: <code className="font-mono text-white/55">{liveSendGate.required_permission}</code>
          </div>
          <div className="mt-1 text-[11px] leading-relaxed text-white/35">
            Live dashboard sends must match the env-confirmed destination and message body before anything is queued.
          </div>
          {liveSendGate.preflight && (
            <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[11px] font-semibold text-white/55">Preflight freshness</div>
                <div className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  liveSendGate.preflight.ready && liveSendGate.preflight.fresh
                    ? 'bg-emerald-400/15 text-emerald-200'
                    : 'bg-amber-400/15 text-amber-200'
                }`}>
                  {liveSendGate.preflight.ready && liveSendGate.preflight.fresh ? 'Fresh' : 'Refresh required'}
                </div>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-2 text-[10px] text-white/35">
                <div>Age: {liveSendGate.preflight.age_seconds === null ? 'n/a' : `${liveSendGate.preflight.age_seconds}s`}</div>
                <div>Max: {liveSendGate.preflight.max_age_seconds}s</div>
                <div>Last4: {liveSendGate.preflight.phone_last4 || 'n/a'}</div>
                <div>Body: {liveSendGate.preflight.body_length ?? 'n/a'} chars</div>
              </div>
            </div>
          )}
          {liveSendGate.sample_override_required && (
            <div className="mt-2 text-[11px] text-amber-200">
              Sample 2944 needs explicit override before live harness.
            </div>
          )}
          {liveSendGate.issues && liveSendGate.issues.length > 0 && (
            <div className="mt-2 space-y-1">
              {liveSendGate.issues.map((issue) => (
                <div key={issue} className="text-[11px] text-amber-100/80">
                  {issue}
                </div>
              ))}
            </div>
          )}
          {liveSendGate.missing.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {liveSendGate.missing.map((name) => (
                <span key={name} className="rounded-md bg-white/[0.04] px-2 py-1 font-mono text-[10px] text-white/40">
                  {name}
                </span>
              ))}
            </div>
          )}
          <div className="mt-2 text-[10px] text-white/25">
            Runbook: <code className="font-mono">{liveSendGate.runbook}</code> · no live send performed
          </div>
        </div>
      )}

      {/* History */}
      {!historyLoading && history.length > 0 && (
        <div className="mt-6">
          <h3 className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">
            Recent Test Messages
          </h3>
          <div className="space-y-2">
            {history.map((msg, index) => (
              <div
                key={msg.id || msg._id || `${msg.recipient_handle}-${msg.created_at}-${index}`}
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
