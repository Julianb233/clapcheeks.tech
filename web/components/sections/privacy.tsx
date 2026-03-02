const privacyPoints = [
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path
          d="M9 2L3 5V9.5C3 12.8 5.7 15.9 9 16.5C12.3 15.9 15 12.8 15 9.5V5L9 2Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M6 9L8 11L12 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    title: 'Messages never leave your device',
    description:
      'Every iMessage, Tinder DM, Bumble conversation, and Hinge exchange is processed locally. Clapcheeks uses on-device LLMs — your words never touch our servers.',
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.5" />
        <path d="M9 5.5V9.5L11.5 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    title: 'Anonymized metrics only',
    description:
      'The only data we ever receive is aggregate counts: how many swipes, how many matches. Never who you swiped on, what you said, or who you matched with.',
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="3" y="8" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 8V5.5C6 3.57 7.34 2 9 2C10.66 2 12 3.57 12 5.5V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="9" cy="12" r="1" fill="currentColor" />
      </svg>
    ),
    title: 'Credentials in your Keychain',
    description:
      'Dating app credentials are stored in macOS Keychain — the same system used by your banking apps. We never see your passwords, OAuth tokens, or account details.',
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M3 9H15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M7 5L3 9L7 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M11 5L15 9L11 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    title: 'Open audit log',
    description:
      'Every action Clapcheeks takes is logged locally. Review exactly what was sent, what was swiped, and what was scheduled — in plain text, any time you want.',
  },
]

export default function Privacy() {
  return (
    <section id="privacy" className="py-28 px-6 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="orb w-[400px] h-[400px] bg-brand-900"
          style={{ top: '50%', right: '-5%', transform: 'translateY(-50%)' }}
        />
      </div>

      <div className="max-w-7xl mx-auto relative">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left: copy */}
          <div>
            <div className="inline-flex items-center gap-2 bg-emerald-900/30 border border-emerald-700/40 rounded-full px-4 py-1.5 mb-6">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-emerald-300 text-xs font-medium">Privacy-first design</span>
            </div>

            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-6 leading-tight">
              Your private life{' '}
              <span className="gradient-text">stays private</span>
            </h2>

            <p className="text-white/50 text-lg leading-relaxed mb-8">
              Dating is intimate. We built Clapcheeks from day one assuming we should never see your
              data. Not because of regulation — because it&apos;s the right thing to do.
            </p>

            {/* Big privacy statement */}
            <div className="bg-white/[0.025] border border-white/8 rounded-2xl p-6 mb-8">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-emerald-900/50 border border-emerald-700/40 flex items-center justify-center shrink-0 mt-0.5">
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path
                      d="M9 2L3 5V9.5C3 12.8 5.7 15.9 9 16.5C12.3 15.9 15 12.8 15 9.5V5L9 2Z"
                      stroke="#34d399"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                    />
                    <path d="M6 9L8 11L12 7" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div>
                  <p className="text-white/80 text-sm leading-relaxed italic">
                    &ldquo;Your messages, matches, and conversations never leave your device. Clapcheeks runs
                    entirely on your Mac. The only data synced to our servers is anonymized metrics
                    (swipe counts, conversion rates) to power your dashboard. We will never read
                    your messages.&rdquo;
                  </p>
                  <p className="text-white/30 text-xs mt-2">— Clapcheeks Privacy Commitment</p>
                </div>
              </div>
            </div>

            <a
              href="/privacy"
              className="inline-flex items-center gap-1.5 text-sm text-brand-400 hover:text-brand-300 transition-colors"
            >
              Read our full privacy policy
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 6H9.5M7 3.5L9.5 6L7 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </div>

          {/* Right: privacy points */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {privacyPoints.map((point) => (
              <div
                key={point.title}
                className="feature-card bg-white/[0.02] border border-white/8 rounded-2xl p-5 group"
              >
                <div className="w-9 h-9 rounded-xl bg-brand-900/50 border border-brand-800/50 flex items-center justify-center text-brand-400 mb-4 group-hover:bg-brand-800/50 transition-colors">
                  {point.icon}
                </div>
                <h4 className="text-sm font-semibold text-white mb-2">{point.title}</h4>
                <p className="text-xs text-white/40 leading-relaxed">{point.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
