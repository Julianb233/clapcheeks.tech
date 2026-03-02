'use client'

import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

export default function ParallaxOrbs() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const orbs = containerRef.current?.querySelectorAll('[data-speed]')
    if (!orbs) return

    const ctx = gsap.context(() => {
      orbs.forEach((orb) => {
        const speed = parseFloat((orb as HTMLElement).dataset.speed || '0.3')
        gsap.to(orb, {
          yPercent: -100 * speed,
          ease: 'none',
          scrollTrigger: {
            trigger: 'body',
            start: 'top top',
            end: 'bottom bottom',
            scrub: true,
          },
        })
      })
    }, containerRef)

    return () => ctx.revert()
  }, [])

  return (
    <div ref={containerRef} className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
      {/* Top-center — large purple (hero) */}
      <div
        data-speed="0.15"
        className="orb w-[900px] h-[900px]"
        style={{ background: '#5b21b6', top: '-20%', left: '50%', transform: 'translateX(-50%)' }}
      />

      {/* Left — deep red */}
      <div
        data-speed="0.3"
        className="orb w-[600px] h-[600px]"
        style={{ background: '#991b1b', top: '15%', left: '-8%' }}
      />

      {/* Right — crimson red */}
      <div
        data-speed="0.2"
        className="orb w-[500px] h-[500px]"
        style={{ background: '#b91c1c', top: '35%', right: '-6%' }}
      />

      {/* Mid-page — dark magenta */}
      <div
        data-speed="0.4"
        className="orb w-[700px] h-[700px]"
        style={{ background: '#831843', top: '55%', left: '20%' }}
      />

      {/* Bottom-right — bright red */}
      <div
        data-speed="0.25"
        className="orb w-[450px] h-[450px]"
        style={{ background: '#dc2626', top: '75%', right: '10%' }}
      />

      {/* Bottom-center — purple accent */}
      <div
        data-speed="0.35"
        className="orb w-[600px] h-[600px]"
        style={{ background: '#4c1d95', top: '90%', left: '40%' }}
      />
    </div>
  )
}
