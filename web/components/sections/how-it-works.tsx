const steps = [
  {
    number: '01',
    title: 'Install in 30 seconds',
    description:
      'One terminal command installs Clapcheeks on your Mac. No Homebrew dependencies, no Docker, no configuration files. It unpacks, sets up the local agent, and opens your dashboard.',
    code: 'curl -fsSL https://clapcheeks.tech/install.sh | bash',
    detail: 'macOS 13 Ventura or later required. Apple Silicon and Intel both supported.',
  },
  {
    number: '02',
    title: 'Connect your apps',
    description:
      'Link Tinder, Bumble, and Hinge through secure OAuth. Grant iMessage access so Clapcheeks can read your tone. It takes 5 minutes to learn your style — then it builds your preference profile silently.',
    detail: 'Your credentials are stored in your Mac\'s Keychain, not our servers.',
  },
  {
    number: '03',
    title: 'Let Clapcheeks handle it',
    description:
      'The agent runs in the background. It swipes based on your patterns, keeps conversations moving, books dates on your calendar when you\'re ready, and delivers a weekly analytics report straight to your dashboard.',
    detail: 'You stay in control — review, override, or pause any action at any time.',
  },
]

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="py-28 px-6 relative overflow-hidden">

      <div className="max-w-7xl mx-auto relative">
        {/* Header */}
        <div className="text-center mb-20">
          <div className="inline-flex items-center gap-2 bg-brand-900/40 border border-brand-700/40 rounded-full px-4 py-1.5 mb-5">
            <span className="text-brand-300 text-xs font-medium">Simple setup</span>
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-5">
            Up and running in minutes
          </h2>
          <p className="text-white/45 text-lg max-w-lg mx-auto leading-relaxed">
            No technical knowledge required. If you can open Terminal, you can run Clapcheeks.
          </p>
        </div>

        {/* Steps */}
        <div className="max-w-4xl mx-auto">
          {steps.map((step, i) => (
            <div key={step.number} className="flex gap-8 mb-16 last:mb-0 group">
              {/* Left: number + connector */}
              <div className="flex flex-col items-center shrink-0">
                <div className="w-12 h-12 rounded-2xl bg-brand-900/60 border border-brand-700/50 flex items-center justify-center group-hover:bg-brand-800/60 group-hover:border-brand-600/60 transition-all duration-300">
                  <span className="text-brand-400 text-sm font-bold font-mono">{step.number}</span>
                </div>
                {i < steps.length - 1 && (
                  <div className="w-px flex-1 mt-4 bg-gradient-to-b from-brand-800/50 to-transparent" />
                )}
              </div>

              {/* Right: content */}
              <div className="pb-4 min-w-0">
                <h3 className="text-xl font-bold text-white mb-3 group-hover:text-brand-300 transition-colors">
                  {step.title}
                </h3>
                <p className="text-white/50 leading-relaxed mb-4">{step.description}</p>

                {/* Code block (only step 01) */}
                {step.code && (
                  <div className="code-block px-4 py-3 mb-4 inline-block max-w-full">
                    <code className="text-sm font-mono text-brand-400 break-all">{step.code}</code>
                  </div>
                )}

                {/* Detail note */}
                <p className="text-xs text-white/25 flex items-start gap-1.5">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    className="mt-0.5 shrink-0"
                  >
                    <circle cx="6" cy="6" r="5" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.2" />
                    <path d="M6 5v4M6 3.5v.5" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  {step.detail}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Bottom illustration: mini dashboard mockup */}
        <div className="mt-20 max-w-3xl mx-auto">
          <div className="bg-white/[0.02] border border-white/8 rounded-2xl p-1 shadow-2xl">
            {/* Window chrome */}
            <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/6">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/60" />
              <span className="ml-3 text-xs text-white/20 font-mono">clapcheeks — dashboard</span>
            </div>
            {/* Dashboard content mockup */}
            <div className="p-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Swipes Today', value: '847', delta: '+12%' },
                { label: 'New Matches', value: '23', delta: '+8%' },
                { label: 'Active Convos', value: '11', delta: '+2' },
                { label: 'Dates This Week', value: '3', delta: 'new' },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="bg-white/3 border border-white/6 rounded-xl p-3"
                >
                  <div className="text-xl font-bold text-white mb-0.5">{stat.value}</div>
                  <div className="text-[10px] text-white/30 mb-1">{stat.label}</div>
                  <div className="text-[10px] font-semibold text-emerald-400">{stat.delta}</div>
                </div>
              ))}
            </div>
            {/* Activity bar */}
            <div className="px-6 pb-6">
              <div className="h-12 bg-white/2 border border-white/5 rounded-xl flex items-center gap-1 px-3">
                {Array.from({ length: 24 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-sm bg-brand-600"
                    style={{
                      height: `${Math.max(20, Math.random() * 100)}%`,
                      opacity: 0.3 + Math.random() * 0.7,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
          <p className="text-center text-xs text-white/20 mt-4">
            Live dashboard updates every time the agent runs
          </p>
        </div>
      </div>
    </section>
  )
}
