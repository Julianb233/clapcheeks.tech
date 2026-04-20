import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'Clapcheeks — AI Dating Co-Pilot'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #000000 0%, #0a0a0a 50%, #111111 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          position: 'relative',
        }}
      >
        {/* Gold gradient accent line at top */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '4px',
            background: 'linear-gradient(90deg, transparent, #C9A427, #E8C547, #C9A427, transparent)',
          }}
        />

        {/* Subtle gold glow */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '600px',
            height: '600px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(201,164,39,0.08) 0%, transparent 70%)',
          }}
        />

        {/* Logo icon */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '64px',
            height: '64px',
            borderRadius: '16px',
            background: 'linear-gradient(135deg, #C9A427, #E8C547)',
            marginBottom: '32px',
            boxShadow: '0 8px 32px rgba(201,164,39,0.4)',
          }}
        >
          <div style={{ color: '#000', fontSize: '32px', fontWeight: 900 }}>C</div>
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: '72px',
            fontWeight: 900,
            color: '#ffffff',
            letterSpacing: '0.05em',
            textTransform: 'uppercase' as const,
            lineHeight: 1,
            textAlign: 'center' as const,
            marginBottom: '8px',
          }}
        >
          CLAPCHEEKS
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: '28px',
            fontWeight: 700,
            background: 'linear-gradient(135deg, #C9A427, #E8C547)',
            backgroundClip: 'text',
            color: '#C9A427',
            letterSpacing: '0.15em',
            textTransform: 'uppercase' as const,
            marginBottom: '24px',
          }}
        >
          AI DATING CO-PILOT
        </div>

        {/* Description */}
        <div
          style={{
            fontSize: '20px',
            color: 'rgba(255,255,255,0.5)',
            maxWidth: '600px',
            textAlign: 'center' as const,
            lineHeight: 1.5,
          }}
        >
          Swipes, messages, and dates — all on autopilot.
          Privacy-first, runs locally on your Mac.
        </div>

        {/* Bottom stats */}
        <div
          style={{
            position: 'absolute',
            bottom: '40px',
            display: 'flex',
            gap: '48px',
          }}
        >
          {[
            { value: '2,400+', label: 'Users' },
            { value: '180k+', label: 'Dates Booked' },
            { value: '4.8/5', label: 'Rating' },
          ].map((stat) => (
            <div key={stat.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#C9A427' }}>{stat.value}</div>
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' as const, letterSpacing: '0.1em' }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Gold bottom accent */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '2px',
            background: 'linear-gradient(90deg, transparent, #C9A427, transparent)',
          }}
        />
      </div>
    ),
    { ...size }
  )
}
