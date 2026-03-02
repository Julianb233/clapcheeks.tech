import Link from 'next/link'

const footerLinks = {
  Product: [
    { label: 'Features', href: '/#features' },
    { label: 'How It Works', href: '/#how-it-works' },
    { label: 'Pricing', href: '/#pricing' },
    { label: 'Device', href: '/device' },
  ],
  Company: [
    { label: 'Affiliates', href: '/affiliate/apply' },
    { label: 'Press', href: '/press' },
    { label: 'Contact', href: 'mailto:hello@clapcheeks.tech' },
  ],
  Legal: [
    { label: 'Privacy Policy', href: '/privacy' },
    { label: 'Terms of Service', href: '/terms' },
  ],
}

export default function Footer() {
  return (
    <footer className="border-t border-white/6 bg-black">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-8 md:gap-12 mb-12">
          {/* Brand column */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
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
            </div>
            <p className="text-white/40 text-sm leading-relaxed max-w-xs mb-6">
              Your AI dating co-pilot. Automate smarter, not harder. All data stays on your Mac.
            </p>

            {/* Install snippet */}
            <div className="code-block px-4 py-3 mb-6">
              <p className="text-[10px] text-white/25 font-mono mb-1">Quick install</p>
              <p className="text-xs font-mono text-brand-400 break-all">
                curl -fsSL https://clapcheeks.tech/install.sh | bash
              </p>
            </div>

            {/* Social links */}
            <div className="flex items-center gap-4">
              <a
                href="https://github.com/clapcheeks"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/30 hover:text-white transition-colors"
                aria-label="GitHub"
              >
                <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
                </svg>
              </a>
              <a
                href="https://twitter.com/clapcheeksai"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/30 hover:text-white transition-colors"
                aria-label="Twitter / X"
              >
                <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
            </div>
          </div>

          {/* Link columns */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h4 className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-4">
                {category}
              </h4>
              <ul className="space-y-3">
                {links.map(({ label, href }) => (
                  <li key={label}>
                    <Link
                      href={href}
                      className="text-sm text-white/45 hover:text-white transition-colors duration-200"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="border-t border-white/6 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-white/25">
            &copy; {new Date().getFullYear()} Clapcheeks. All rights reserved.
          </p>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="text-xs text-white/25">All systems operational</span>
          </div>
        </div>
      </div>
    </footer>
  )
}
