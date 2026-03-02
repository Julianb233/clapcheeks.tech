interface PageOrbsProps {
  /** Use subtle mode for authenticated app pages — lower opacity */
  subtle?: boolean
}

/**
 * Floating background orb decoration for all non-landing pages.
 * Uses pure CSS animations — no JS, works as a server component.
 */
export default function PageOrbs({ subtle = false }: PageOrbsProps) {
  const baseOpacity = subtle ? 0.12 : 0.28
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
      <div
        className="orb floating w-[700px] h-[700px]"
        style={{ background: '#5b21b6', top: '-20%', right: '-15%', opacity: baseOpacity, animationDelay: '0s' }}
      />
      <div
        className="orb floating-slow w-[500px] h-[500px]"
        style={{ background: '#991b1b', top: '38%', left: '-10%', opacity: baseOpacity * 0.85, animationDelay: '3s' }}
      />
      <div
        className="orb floating w-[600px] h-[600px]"
        style={{ background: '#4c1d95', bottom: '-12%', right: '12%', opacity: baseOpacity * 0.9, animationDelay: '1.5s' }}
      />
      {!subtle && (
        <div
          className="orb floating-delayed w-[350px] h-[350px]"
          style={{ background: '#b91c1c', top: '10%', left: '35%', opacity: baseOpacity * 0.6, animationDelay: '4s' }}
        />
      )}
    </div>
  )
}
