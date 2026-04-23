'use client'
import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { MessageSquare, Mail, FileText, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { VoiceInput, VoiceTextarea } from '@/components/voice'

export default function SupportPage() {
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSending(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('support_tickets').insert({ user_id: user.id, email: user.email, subject, message, status: 'open' })
    setSent(true)
    setSending(false)
  }

  if (sent) return (
    <div className="pt-16 pb-20 px-6"><div className="max-w-lg mx-auto text-center">
      <div className="w-14 h-14 bg-green-900/30 border border-green-700/30 rounded-2xl flex items-center justify-center mx-auto mb-6"><MessageSquare className="w-6 h-6 text-green-400" /></div>
      <h1 className="text-2xl font-bold text-white mb-3">Message sent</h1>
      <p className="text-white/40 text-sm mb-6">We typically respond within 24 hours.</p>
      <Button onClick={() => { setSent(false); setSubject(''); setMessage('') }} variant="outline" className="border-white/10 bg-white/5 hover:bg-white/10 text-white">Send another</Button>
    </div></div>
  )

  return (
    <div className="pt-16 pb-20 px-6"><div className="max-w-2xl mx-auto">
      <div className="mb-10"><h1 className="text-3xl font-bold text-white mb-2">Support</h1><p className="text-white/45">Get help with your Clapcheeks account.</p></div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-10">
        <a href="mailto:support@clapcheeks.tech" className="bg-white/[0.03] border border-white/8 rounded-xl p-4 flex items-center gap-3 hover:bg-white/[0.06] transition-colors"><Mail className="w-5 h-5 text-brand-400 shrink-0" /><div><div className="text-white text-sm font-medium">Email</div><div className="text-white/30 text-xs">support@clapcheeks.tech</div></div></a>
        <a href="https://discord.gg/clapcheeks" target="_blank" rel="noopener noreferrer" className="bg-white/[0.03] border border-white/8 rounded-xl p-4 flex items-center gap-3 hover:bg-white/[0.06] transition-colors"><MessageSquare className="w-5 h-5 text-indigo-400 shrink-0" /><div><div className="text-white text-sm font-medium">Discord</div><div className="text-white/30 text-xs">Community</div></div></a>
        <a href="/privacy" className="bg-white/[0.03] border border-white/8 rounded-xl p-4 flex items-center gap-3 hover:bg-white/[0.06] transition-colors"><FileText className="w-5 h-5 text-white/40 shrink-0" /><div><div className="text-white text-sm font-medium">Docs</div><div className="text-white/30 text-xs">Privacy & terms</div></div></a>
      </div>
      <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-6">
        <h2 className="text-white font-semibold mb-1">Send us a message</h2>
        <p className="text-white/30 text-sm mb-6">We reply within 24 hours.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div><label htmlFor="subject" className="block text-sm text-white/60 mb-1.5">Subject</label><VoiceInput id="subject" type="text" required value={subject} onChange={setSubject} placeholder="What do you need help with?" className="w-full h-auto bg-white/5 border border-white/10 hover:border-white/20 focus:border-brand-500 rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm outline-none focus:ring-1 focus:ring-brand-500/50" /></div>
          <div><label htmlFor="message" className="block text-sm text-white/60 mb-1.5">Message</label><VoiceTextarea id="message" required rows={5} value={message} onChange={setMessage} placeholder="Describe your issue..." className="w-full bg-white/5 border border-white/10 hover:border-white/20 focus:border-brand-500 rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm outline-none focus:ring-1 focus:ring-brand-500/50 resize-none" /></div>
          <Button type="submit" disabled={sending} className="w-full bg-brand-600 hover:bg-brand-500 text-white py-3 rounded-xl">{sending ? 'Sending...' : 'Send message'}</Button>
        </form>
      </div>
      <div className="mt-10"><h2 className="text-white font-semibold mb-4">FAQ</h2><div className="space-y-3">
        <FaqItem q="How do I connect my dating apps?" a="Go to Settings > Device and follow the Chrome extension guide." />
        <FaqItem q="How does the referral program work?" a="Share your link from the Referrals page. When a friend subscribes, you get 1 free month." />
        <FaqItem q="Can I cancel?" a="Yes, go to Billing > Manage Subscription. Cancel anytime." />
        <FaqItem q="Is my data private?" a="We never share your data. See our Privacy Policy." />
      </div></div>
    </div></div>
  )
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-white/[0.03] border border-white/8 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full px-5 py-4 text-left flex items-center justify-between"><span className="text-white text-sm font-medium">{q}</span><ChevronDown className={`w-4 h-4 text-white/30 transition-transform ${open ? 'rotate-180' : ''}`} /></button>
      {open && <div className="px-5 pb-4"><p className="text-white/40 text-sm leading-relaxed">{a}</p></div>}
    </div>
  )
}
