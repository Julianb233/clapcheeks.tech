const testimonials = [
  {
    quote: 'I went from 2 matches a week to 15+. The AI messages sound exactly like me — my dates have no idea.',
    name: 'Marcus T.',
    detail: 'Pro user · 3 months',
    metric: '7x more matches',
  },
  {
    quote: 'I was spending 2 hours a day on Tinder. Now I spend 10 minutes reviewing what the AI did overnight. Game changer.',
    name: 'Jake R.',
    detail: 'Elite user · 2 months',
    metric: '12 hrs/week saved',
  },
  {
    quote: 'The date booking feature is insane. AI checks my calendar, suggests a spot near both of us, and sends the invite. I just show up.',
    name: 'Derek L.',
    detail: 'Pro user · 4 months',
    metric: '3 dates/week avg',
  },
  {
    quote: 'Was skeptical about getting banned. 4 months in, zero issues on Tinder, Bumble, and Hinge. The timing randomization is legit.',
    name: 'Chris A.',
    detail: 'Starter user · 4 months',
    metric: 'Zero bans',
  },
]

const stats = [
  { value: '2,400+', label: 'Alpha testers' },
  { value: '180k+', label: 'Dates booked' },
  { value: '4.8/5', label: 'User rating' },
  { value: '0', label: 'Data breaches' },
]

export default function SocialProof() {
  return (
    <section id="testimonials" className="py-28 px-6 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute"
          style={{
            top: '30%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '800px',
            height: '400px',
            background: 'radial-gradient(ellipse, rgba(201,164,39,0.04) 0%, transparent 70%)',
            filter: 'blur(60px)',
          }}
        />
      </div>

      <div className="max-w-7xl mx-auto relative">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="flex items-center justify-center gap-3 mb-5">
            <div className="h-px w-8 bg-amber-500" />
            <span className="text-amber-400 text-xs font-body font-bold tracking-widest uppercase">
              Real results
            </span>
            <div className="h-px w-8 bg-amber-500" />
          </div>
          <h2 className="font-display text-5xl sm:text-6xl lg:text-7xl text-white uppercase leading-none mb-5">
            DON&apos;T TAKE
            <br />
            <span className="gold-text">OUR WORD.</span>
          </h2>
          <p className="font-body text-white/45 text-lg max-w-lg mx-auto leading-relaxed">
            Hear from guys who stopped swiping manually and started winning.
          </p>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-16">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="text-center py-5 rounded-2xl"
              style={{
                background: 'rgba(0,0,0,0.4)',
                border: '1px solid rgba(201,164,39,0.15)',
              }}
            >
              <div className="font-display text-3xl sm:text-4xl gold-text mb-1">{stat.value}</div>
              <div className="font-body text-xs text-white/35 uppercase tracking-wider">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Testimonial cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {testimonials.map((t) => (
            <div
              key={t.name}
              className="rounded-2xl p-6 sm:p-8 relative group transition-all duration-300 hover:border-amber-500/30"
              style={{
                background: 'rgba(0,0,0,0.5)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              {/* Metric badge */}
              <div className="inline-flex items-center gap-1.5 mb-5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span className="text-emerald-400 text-xs font-body font-bold tracking-wider uppercase">
                  {t.metric}
                </span>
              </div>

              {/* Quote */}
              <p className="font-body text-white/60 text-sm sm:text-base leading-relaxed mb-6">
                &ldquo;{t.quote}&rdquo;
              </p>

              {/* Author */}
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center font-display text-sm"
                  style={{
                    background: 'rgba(201,164,39,0.1)',
                    border: '1px solid rgba(201,164,39,0.25)',
                    color: '#C9A427',
                  }}
                >
                  {t.name.charAt(0)}
                </div>
                <div>
                  <div className="font-body text-sm text-white/70 font-semibold">{t.name}</div>
                  <div className="font-body text-xs text-white/30">{t.detail}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Bottom note */}
        <div className="mt-10 text-center">
          <p className="font-body text-xs text-white/20">
            Names shortened for privacy &middot; Results vary by location and profile quality
          </p>
        </div>
      </div>
    </section>
  )
}
