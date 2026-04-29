'use client'

import { useEffect, useState, useCallback } from 'react'
import { formatDistanceToNow, format, parseISO, isBefore } from 'date-fns'
import { VoiceInput, VoiceTextarea } from '@/components/voice'

type ScheduledMessage = {
  id: string
  match_name: string
  platform: string
  phone: string | null
  message_text: string
  scheduled_at: string
  status: 'pending' | 'approved' | 'rejected' | 'sent' | 'failed'
  sequence_type: 'follow_up' | 'manual' | 'app_to_text'
  delay_hours: number | null
  rejection_reason: string | null
  sent_at: string | null
  god_draft_id: string | null
  created_at: string
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  approved: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  rejected: 'bg-red-500/20 text-red-400 border-red-500/30',
  sent: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  failed: 'bg-red-500/20 text-red-400 border-red-500/30',
}

const SEQ_LABELS: Record<string, string> = {
  follow_up: 'Follow-up',
  manual: 'Manual',
  app_to_text: 'App → Text',
}

export default function ScheduledPage() {
  const [messages, setMessages] = useState<ScheduledMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('pending')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showCompose, setShowCompose] = useState(false)
  const [compose, setCompose] = useState<{
    match_name: string
    phone: string
    message_text: string
    scheduled_at: string
    sequence_type: 'manual' | 'app_to_text' | 'follow_up'
    delay_hours: string
  }>({
    match_name: '',
    phone: '',
    message_text: '',
    scheduled_at: '',
    sequence_type: 'manual',
    delay_hours: '',
  })
  const [composing, setComposing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadMessages = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/scheduled-messages?status=${filter}&limit=100`)
      const data = await res.json()
      setMessages(data.messages ?? [])
    } catch {
      setError('Failed to load messages')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { loadMessages() }, [loadMessages])

  async function approve(id: string) {
    setActionLoading(id + '-approve')
    await fetch(`/api/scheduled-messages/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })
    await loadMessages()
    setActionLoading(null)
  }

  async function reject(id: string) {
    const reason = prompt('Rejection reason (optional):') ?? ''
    setActionLoading(id + '-reject')
    await fetch(`/api/scheduled-messages/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'rejected', rejection_reason: reason }),
    })
    await loadMessages()
    setActionLoading(null)
  }

  async function sendNow(id: string) {
    setActionLoading(id + '-send')
    const res = await fetch('/api/scheduled-messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    const data = await res.json()
    if (!res.ok) setError(data.error ?? 'Send failed')
    await loadMessages()
    setActionLoading(null)
  }

  async function deleteMsg(id: string) {
    if (!confirm('Delete this scheduled message?')) return
    setActionLoading(id + '-delete')
    await fetch(`/api/scheduled-messages/${id}`, { method: 'DELETE' })
    await loadMessages()
    setActionLoading(null)
  }

  async function submitCompose() {
    if (!compose.match_name || !compose.message_text || !compose.scheduled_at) {
      setError('Name, message, and schedule time are required')
      return
    }
    // datetime-local returns naive "YYYY-MM-DDTHH:mm" — interpret in the
    // browser's local TZ and send a real ISO so Postgres TIMESTAMPTZ stores
    // the moment Julian actually meant.
    const localDate = new Date(compose.scheduled_at)
    if (isNaN(localDate.getTime())) {
      setError('Invalid schedule time')
      return
    }
    setComposing(true)
    const res = await fetch('/api/scheduled-messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        match_name: compose.match_name,
        phone: compose.phone || null,
        message_text: compose.message_text,
        scheduled_at: localDate.toISOString(),
        sequence_type: compose.sequence_type,
        delay_hours: compose.delay_hours ? parseInt(compose.delay_hours) : null,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Failed to create')
    } else {
      setShowCompose(false)
      setCompose({ match_name: '', phone: '', message_text: '', scheduled_at: '', sequence_type: 'manual', delay_hours: '' })
      setFilter('pending')
      await loadMessages()
    }
    setComposing(false)
  }

  const pending = messages.filter(m => m.status === 'pending').length

  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-8">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-sm">
                ⏰
              </div>
              <h1 className="text-2xl md:text-3xl font-semibold">Scheduled Messages</h1>
              {pending > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300 text-xs font-medium border border-yellow-500/30">
                  {pending} pending
                </span>
              )}
            </div>
            <p className="text-sm text-white/50 ml-11">
              Approve, reject, or reschedule follow-ups before they fire.
            </p>
          </div>
          <button
            onClick={() => setShowCompose(true)}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-sm font-medium transition-all"
          >
            + Schedule Message
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center justify-between">
            {error}
            <button onClick={() => setError(null)} className="text-red-400/60 hover:text-red-400 ml-4">✕</button>
          </div>
        )}

        {/* Compose Modal */}
        {showCompose && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <div className="bg-[#0a0a14] border border-white/10 rounded-2xl p-6 w-full max-w-md">
              <h2 className="text-lg font-semibold mb-4">Schedule a Message</h2>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-white/50 mb-1 block">Match Name *</label>
                  <VoiceInput
                    className="w-full h-auto bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50"
                    placeholder="e.g. Sofia"
                    value={compose.match_name}
                    onChange={(v) => setCompose(p => ({ ...p, match_name: v }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-white/50 mb-1 block">Phone (for iMessage)</label>
                  <VoiceInput
                    className="w-full h-auto bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50"
                    placeholder="+16195550123"
                    value={compose.phone}
                    onChange={(v) => setCompose(p => ({ ...p, phone: v }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-white/50 mb-1 block">Message *</label>
                  <VoiceTextarea
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 resize-none"
                    rows={3}
                    placeholder="Hey, just wanted to check in..."
                    value={compose.message_text}
                    onChange={(v) => setCompose(p => ({ ...p, message_text: v }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-white/50 mb-1 block">Send At *</label>
                  <input
                    type="datetime-local"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500/50"
                    value={compose.scheduled_at}
                    onChange={e => setCompose(p => ({ ...p, scheduled_at: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-white/50 mb-1 block">Type</label>
                  <select
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500/50"
                    value={compose.sequence_type}
                    onChange={e => setCompose(p => ({ ...p, sequence_type: e.target.value as 'manual' | 'follow_up' | 'app_to_text' }))}
                  >
                    <option value="manual">Manual</option>
                    <option value="follow_up">Follow-up</option>
                    <option value="app_to_text">App → Text transition</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-3 mt-5">
                <button
                  onClick={() => setShowCompose(false)}
                  className="flex-1 px-4 py-2 rounded-lg border border-white/10 text-sm text-white/60 hover:text-white hover:border-white/20 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={submitCompose}
                  disabled={composing}
                  className="flex-1 px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-sm font-medium transition-all disabled:opacity-50"
                >
                  {composing ? 'Scheduling...' : 'Schedule'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {['pending', 'approved', 'sent', 'rejected', 'all'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all capitalize ${
                filter === f
                  ? 'bg-purple-600 text-white'
                  : 'bg-white/5 text-white/50 hover:text-white hover:bg-white/10 border border-white/10'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Messages List */}
        {loading ? (
          <div className="text-center py-16 text-white/30 text-sm">Loading...</div>
        ) : messages.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">📭</div>
            <p className="text-white/30 text-sm">No {filter !== 'all' ? filter : ''} messages</p>
            {filter === 'pending' && (
              <p className="text-white/20 text-xs mt-1">
                Messages created by follow-up sequences will appear here for approval.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map(msg => {
              const isOverdue = isBefore(parseISO(msg.scheduled_at), new Date()) && msg.status === 'approved'
              return (
                <div
                  key={msg.id}
                  className={`bg-[#0a0a14] border rounded-xl p-4 md:p-5 transition-all ${
                    msg.status === 'pending'
                      ? 'border-yellow-500/30 hover:border-yellow-500/50'
                      : 'border-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-start gap-4">
                    {/* Avatar */}
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-sm font-bold shrink-0 mt-0.5">
                      {msg.match_name[0].toUpperCase()}
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* Top row */}
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-semibold text-white">{msg.match_name}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[msg.status]}`}>
                          {msg.status}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs bg-white/5 text-white/40 border border-white/10">
                          {SEQ_LABELS[msg.sequence_type]}
                        </span>
                        {isOverdue && (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-orange-500/20 text-orange-300 border border-orange-500/30">
                            ready to send
                          </span>
                        )}
                      </div>

                      {/* Message */}
                      <p className="text-white/80 text-sm mb-2 leading-relaxed">{msg.message_text}</p>

                      {/* Meta */}
                      <div className="flex items-center gap-3 text-xs text-white/40 flex-wrap">
                        <span>📱 {msg.platform}</span>
                        {msg.phone && <span>📞 {msg.phone}</span>}
                        <span>
                          🕐 {format(parseISO(msg.scheduled_at), 'MMM d, h:mm a')}
                          {' '}({formatDistanceToNow(parseISO(msg.scheduled_at), { addSuffix: true })})
                        </span>
                        {msg.god_draft_id && (
                          <span className="text-blue-400">📬 {msg.god_draft_id}</span>
                        )}
                      </div>

                      {msg.rejection_reason && (
                        <p className="mt-1 text-xs text-red-400/70">Reason: {msg.rejection_reason}</p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2 shrink-0">
                      {msg.status === 'pending' && (
                        <>
                          <button
                            onClick={() => approve(msg.id)}
                            disabled={actionLoading === msg.id + '-approve'}
                            className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-medium hover:bg-emerald-500/30 transition-all disabled:opacity-50"
                          >
                            {actionLoading === msg.id + '-approve' ? '...' : '✓ Approve'}
                          </button>
                          <button
                            onClick={() => reject(msg.id)}
                            disabled={actionLoading === msg.id + '-reject'}
                            className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 text-xs font-medium hover:bg-red-500/20 transition-all disabled:opacity-50"
                          >
                            {actionLoading === msg.id + '-reject' ? '...' : '✕ Reject'}
                          </button>
                        </>
                      )}
                      {msg.status === 'approved' && (
                        <button
                          onClick={() => sendNow(msg.id)}
                          disabled={actionLoading === msg.id + '-send'}
                          className="px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30 text-xs font-medium hover:bg-blue-500/30 transition-all disabled:opacity-50"
                        >
                          {actionLoading === msg.id + '-send' ? '...' : '↗ Send Now'}
                        </button>
                      )}
                      <button
                        onClick={() => deleteMsg(msg.id)}
                        disabled={!!actionLoading}
                        className="px-3 py-1.5 rounded-lg bg-white/5 text-white/30 border border-white/10 text-xs hover:text-white/60 hover:bg-white/10 transition-all disabled:opacity-50"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
