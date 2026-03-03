'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { Menu, X } from 'lucide-react'

const navLinks = [
  { label: 'Features', href: '/features' },
  { label: 'How It Works', href: '/how-it-works' },
  { label: 'Platforms', href: '/platforms' },
  { label: 'Pricing', href: '/#pricing' },
  { label: 'Download', href: '/download' },
]

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 16)
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <nav
      className={`fixed top-0 w-full z-50 transition-all duration-300 ${
        scrolled
          ? 'border-b border-white/8 bg-black/90 backdrop-blur-xl shadow-xl shadow-black/20'
          : 'border-b border-transparent bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-lg shadow-brand-900/50">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M7 1L2 4.5V9.5L7 13L12 9.5V4.5L7 1Z"
                stroke="white"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <circle cx="7" cy="7" r="1.5" fill="white" />
            </svg>
          </div>
          <span className="text-lg font-bold gradient-text">Clapcheeks</span>
          <span className="text-[10px] text-white/25 font-mono bg-white/5 px-1.5 py-0.5 rounded">
            beta
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-8">
          {navLinks.map(({ label, href }) => (
            <Link
              key={href}
              href={href}
              className="text-sm text-white/55 hover:text-white transition-colors duration-200"
            >
              {label}
            </Link>
          ))}
        </div>

        {/* Desktop CTA */}
        <div className="hidden md:flex items-center gap-3">
          <Link
            href="/dashboard"
            className="text-sm text-white/50 hover:text-white transition-colors duration-200"
          >
            Sign in
          </Link>
          <Link
            href="/#pricing"
            className="bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-all duration-200 shadow-lg shadow-brand-900/40 hover:shadow-brand-800/50 active:scale-[0.98]"
          >
            Get Started Free
          </Link>
        </div>

        {/* Mobile toggle */}
        <button
          className="md:hidden text-white/60 hover:text-white transition-colors p-1"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-black/95 backdrop-blur-xl border-b border-white/8">
          <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col gap-4">
            {navLinks.map(({ label, href }) => (
              <Link
                key={href}
                href={href}
                className="text-sm text-white/60 hover:text-white transition-colors py-1"
                onClick={() => setMobileOpen(false)}
              >
                {label}
              </Link>
            ))}
            <div className="border-t border-white/8 pt-4 flex flex-col gap-3">
              <Link
                href="/dashboard"
                className="text-sm text-white/50 hover:text-white transition-colors"
                onClick={() => setMobileOpen(false)}
              >
                Sign in
              </Link>
              <Link
                href="/#pricing"
                className="bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors text-center"
                onClick={() => setMobileOpen(false)}
              >
                Get Started Free
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}
