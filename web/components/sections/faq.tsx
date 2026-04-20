'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

const faqs = [
  {
    category: 'Safety',
    questions: [
      {
        q: 'Is Clapcheeks safe to use?',
        a: 'Yes. Clapcheeks runs entirely on your Mac — no cloud servers process your data. Your credentials are stored in macOS Keychain (the same system your banking apps use), and all AI processing happens locally on-device.',
      },
      {
        q: 'Can other people see my automated messages?',
        a: 'No. Messages are crafted in your voice using your conversation history. To your matches, it sounds exactly like you. There\'s no watermark, no "sent by AI" flag, and no detectable pattern.',
      },
      {
        q: 'What happens if something goes wrong during a conversation?',
        a: 'You stay in control at all times. You can review every message before it\'s sent, pause the agent instantly, or override any action. The AI also has built-in safety rails — it won\'t send inappropriate content or make commitments you haven\'t approved.',
      },
    ],
  },
  {
    category: 'Bans & Detection',
    questions: [
      {
        q: 'Will I get banned from Tinder / Bumble / Hinge?',
        a: 'Clapcheeks uses human-like interaction patterns with randomized timing, natural swipe speeds, and realistic session lengths. It mimics how you naturally use the apps. While no automation tool can guarantee zero risk, our approach is designed to be indistinguishable from manual usage.',
      },
      {
        q: 'How does Clapcheeks avoid detection?',
        a: 'The agent runs directly on your device through official app interfaces — not through scrapers or unofficial APIs. Swipe timing is randomized, session lengths vary naturally, and the AI respects rate limits. It behaves like a real user because it operates through the same channels you would.',
      },
      {
        q: 'What if a dating app updates their detection methods?',
        a: 'We continuously monitor platform changes and push updates to stay ahead. Our team reverse-engineers detection patterns and adjusts behavior algorithms accordingly. Updates are automatic — your agent stays current without any action from you.',
      },
    ],
  },
  {
    category: 'Privacy',
    questions: [
      {
        q: 'What data does Clapcheeks collect?',
        a: 'Only anonymized, aggregate metrics: total swipes, match counts, and feature usage statistics. We never see your messages, match names, photos, or any personally identifiable information. Everything stays on your Mac.',
      },
      {
        q: 'Can Clapcheeks read my iMessages?',
        a: 'Clapcheeks accesses iMessage locally on your Mac to learn your communication style and manage dating conversations. This data is processed entirely on-device by local LLMs — it never leaves your machine or touches our servers.',
      },
      {
        q: 'Can I delete all my data?',
        a: 'Since your data lives on your Mac, you have full control. Uninstalling Clapcheeks removes all local data, conversation logs, and preference profiles. For cloud-synced metrics (anonymous counts only), contact us and we\'ll purge everything within 24 hours.',
      },
      {
        q: 'Do you sell data to third parties?',
        a: 'Absolutely not. We don\'t have your personal data to sell. Our business model is subscriptions, not data brokering. We couldn\'t sell your data even if we wanted to — we literally don\'t have it.',
      },
    ],
  },
  {
    category: 'Product',
    questions: [
      {
        q: 'Does Clapcheeks work on Windows or Linux?',
        a: 'Currently macOS only (Ventura 13+ required). We\'re exploring iOS and Android companion apps, but the core agent requires macOS for iMessage integration and local LLM processing.',
      },
      {
        q: 'Can I try it before paying?',
        a: 'Yes — every plan includes a 7-day free trial with full access. The free tier (Tinder only, 50 swipes/day) is available indefinitely with no credit card required.',
      },
      {
        q: 'How do I cancel my subscription?',
        a: 'Cancel anytime from your dashboard settings — no hoops, no retention calls, no guilt trips. Your subscription ends at the current billing period and you keep access until then.',
      },
    ],
  },
]

function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false)

  return (
    <div
      className="border-b border-white/[0.06] last:border-b-0"
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-4 py-5 text-left group"
        aria-expanded={open}
      >
        <span className="font-body text-sm sm:text-base text-white/70 group-hover:text-white transition-colors leading-snug">
          {question}
        </span>
        <ChevronDown
          size={18}
          className={`shrink-0 text-white/30 group-hover:text-amber-400 transition-all duration-300 ${
            open ? 'rotate-180 text-amber-400' : ''
          }`}
        />
      </button>
      <div
        className={`overflow-hidden transition-all duration-300 ${
          open ? 'max-h-96 pb-5' : 'max-h-0'
        }`}
      >
        <p className="font-body text-sm text-white/40 leading-relaxed pr-8">
          {answer}
        </p>
      </div>
    </div>
  )
}

export default function FAQ() {
  return (
    <section id="faq" className="py-28 px-6 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute top-0 left-0 right-0 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(201,164,39,0.3), transparent)' }}
        />
      </div>

      <div className="max-w-4xl mx-auto relative">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="flex items-center justify-center gap-3 mb-5">
            <div className="h-px w-8 bg-amber-500" />
            <span className="text-amber-400 text-xs font-body font-bold tracking-widest uppercase">
              Common questions
            </span>
            <div className="h-px w-8 bg-amber-500" />
          </div>
          <h2 className="font-display text-5xl sm:text-6xl lg:text-7xl text-white uppercase leading-none mb-5">
            GOT
            <br />
            <span className="gold-text">QUESTIONS?</span>
          </h2>
          <p className="font-body text-white/45 text-lg max-w-lg mx-auto leading-relaxed">
            Everything you need to know about safety, privacy, and how Clapcheeks works.
          </p>
        </div>

        {/* FAQ Categories */}
        <div className="space-y-8">
          {faqs.map((category) => (
            <div key={category.category}>
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="px-3 py-1 rounded-full text-xs font-body font-bold tracking-widest uppercase"
                  style={{
                    background: 'rgba(201,164,39,0.08)',
                    border: '1px solid rgba(201,164,39,0.2)',
                    color: '#C9A427',
                  }}
                >
                  {category.category}
                </div>
              </div>
              <div
                className="rounded-2xl px-6"
                style={{
                  background: 'rgba(0,0,0,0.4)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                {category.questions.map((faq) => (
                  <FAQItem key={faq.q} question={faq.q} answer={faq.a} />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Still have questions */}
        <div className="mt-12 text-center">
          <p className="font-body text-white/30 text-sm mb-3">
            Still have questions?
          </p>
          <a
            href="mailto:hello@clapcheeks.tech"
            className="font-body inline-flex items-center gap-1.5 text-sm text-amber-400 hover:text-amber-300 transition-colors font-semibold"
          >
            Reach out — we reply fast
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 6H9.5M7 3.5L9.5 6L7 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>
      </div>
    </section>
  )
}
