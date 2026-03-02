const features = [
  {
    icon: '💬',
    title: 'iMessage AI',
    description:
      'Clapcheeks reads your existing conversations and learns your texting style. Then it replies in your voice using local LLMs — your matches never know the difference.',
    tag: 'Conversations',
  },
  {
    icon: '👆',
    title: 'Smart Swiping',
    description:
      'Set your preferences once. Clapcheeks auto-swipes Tinder, Bumble, and Hinge based on your attraction patterns, running in the background while you live your life.',
    tag: 'Automation',
  },
  {
    icon: '📅',
    title: 'Date Booking',
    description:
      'When a conversation reaches the right moment, Clapcheeks checks your calendar and proposes a time. Dates get scheduled, reminders get set, and confirmations get sent — automatically.',
    tag: 'Scheduling',
  },
  {
    icon: '📊',
    title: 'Analytics Dashboard',
    description:
      'Track your swipe-to-match rate, match-to-date conversion, cost-per-date, and response time patterns. Know exactly what\'s working and what to optimize.',
    tag: 'Intelligence',
  },
  {
    icon: '🧠',
    title: 'AI Coaching',
    description:
      'Get personalized weekly reports with actionable suggestions. Clapcheeks analyzes what openers, photos, and conversation styles drive the highest response rates for you specifically.',
    tag: 'Coaching',
  },
  {
    icon: '🔒',
    title: '100% Private',
    description:
      'Every message, match, and conversation stays on your Mac. We never see your data. The only thing synced to our servers is anonymized metrics — swipe counts, not content.',
    tag: 'Privacy',
  },
]

export default function Features() {
  return (
    <section id="features" className="py-28 px-6 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="orb w-[500px] h-[500px] bg-brand-900"
          style={{ bottom: '-10%', right: '-5%' }}
        />
      </div>

      <div className="max-w-7xl mx-auto relative">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-brand-900/40 border border-brand-700/40 rounded-full px-4 py-1.5 mb-5">
            <span className="text-brand-300 text-xs font-medium">Everything you need</span>
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-5">
            One app. Every edge.
          </h2>
          <p className="text-white/45 text-lg max-w-xl mx-auto leading-relaxed">
            Clapcheeks combines AI conversation management, intelligent automation, and deep analytics
            into a single agent that runs silently on your Mac.
          </p>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((feature, i) => (
            <div
              key={feature.title}
              className="feature-card relative bg-white/[0.02] border border-white/8 rounded-2xl p-6 hover:bg-white/[0.04] group"
            >
              {/* Tag */}
              <div className="absolute top-4 right-4">
                <span className="text-[10px] font-mono text-white/20 bg-white/4 px-2 py-0.5 rounded-full">
                  {feature.tag}
                </span>
              </div>

              {/* Icon */}
              <div className="text-3xl mb-4 leading-none">{feature.icon}</div>

              {/* Content */}
              <h3 className="text-base font-semibold text-white mb-2 group-hover:text-brand-300 transition-colors">
                {feature.title}
              </h3>
              <p className="text-sm text-white/45 leading-relaxed">{feature.description}</p>

              {/* Hover glow line */}
              <div className="absolute bottom-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-brand-600 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          ))}
        </div>

        {/* Bottom callout */}
        <div className="mt-12 text-center">
          <p className="text-sm text-white/30">
            All features work offline &mdash;{' '}
            <span className="text-white/50">no cloud required, no subscription to pause guilt.</span>
          </p>
        </div>
      </div>
    </section>
  )
}
