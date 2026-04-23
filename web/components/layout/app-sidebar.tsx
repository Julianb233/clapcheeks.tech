'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { logout } from '@/app/auth/actions'

type NavItem = {
  href: string
  label: string
  icon: React.ReactNode
  badge?: string
}

const PRIMARY: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: <HomeIcon /> },
  { href: '/ai-first-date', label: 'AI First Date', icon: <HeartIcon />, badge: 'new' },
  { href: '/dashboard/matches', label: 'Matches', icon: <HeartIcon /> },
  { href: '/leads', label: 'Leads', icon: <PipelineIcon /> },
  { href: '/matches', label: 'Match Intel', icon: <ProfileIcon />, badge: 'new' },
  { href: '/conversation', label: 'Conversations', icon: <ChatIcon /> },
  { href: '/intelligence', label: 'Intelligence', icon: <SparkIcon /> },
  { href: '/analytics', label: 'Analytics', icon: <ChartIcon /> },
  { href: '/photos', label: 'Photos', icon: <CameraIcon /> },
  { href: '/coaching', label: 'Coaching', icon: <RizzIcon /> },
]

const SECONDARY: NavItem[] = [
  { href: '/referrals', label: 'Referrals', icon: <GiftIcon />, badge: 'new' },
  { href: '/settings/ai', label: 'AI Settings', icon: <GearIcon />, badge: 'new' },
  { href: '/settings', label: 'Weekly Reports', icon: <BellIcon /> },
  { href: '/billing', label: 'Billing', icon: <CardIcon /> },
  { href: '/device', label: 'Device', icon: <LaptopIcon /> },
  { href: '/support', label: 'Support', icon: <HelpIcon /> },
]

export default function AppSidebar() {
  const pathname = usePathname() ?? '/'
  const [email, setEmail] = useState<string>('')
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? '')
    })
  }, [])

  function isActive(href: string) {
    if (href === '/') return pathname === '/'
    // Exact dashboard match only — otherwise /dashboard/matches would also
    // activate the Dashboard nav item.
    if (href === '/dashboard') return pathname === '/dashboard'
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden sticky top-0 z-30 bg-black/95 backdrop-blur-xl border-b border-white/10 px-4 h-14 flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-2">
          <Logo />
          <span className="font-display text-xl gold-text uppercase tracking-wide">Clapcheeks</span>
        </Link>
        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/5 border border-white/10"
          aria-label="Menu"
        >
          {mobileOpen ? <CloseIcon /> : <MenuIcon />}
        </button>
      </div>

      {/* Sidebar — desktop always, mobile overlay when open */}
      <aside
        className={`
          fixed top-0 left-0 z-40 h-screen w-[260px]
          bg-[#05050A]/95 backdrop-blur-xl border-r border-white/10
          flex flex-col
          transition-transform duration-200
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0
        `}
      >
        {/* Logo header */}
        <div className="px-5 pt-5 pb-4 border-b border-white/8">
          <Link href="/dashboard" className="flex items-center gap-2">
            <Logo />
            <span className="font-display text-2xl gold-text uppercase tracking-wide">
              Clapcheeks
            </span>
          </Link>
          <p className="mt-1 ml-9 text-[10px] uppercase tracking-widest text-white/30 font-mono">
            co-pilot v1
          </p>
        </div>

        {/* Scrollable nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-2">
          <SectionLabel>Workflow</SectionLabel>
          <ul className="space-y-0.5 mb-6">
            {PRIMARY.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(item.href)} onClick={() => setMobileOpen(false)} />
            ))}
          </ul>

          <SectionLabel>Configuration</SectionLabel>
          <ul className="space-y-0.5">
            {SECONDARY.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(item.href)} onClick={() => setMobileOpen(false)} />
            ))}
          </ul>
        </nav>

        {/* User / logout */}
        <div className="p-3 border-t border-white/8">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-yellow-500 to-red-600 flex items-center justify-center text-[11px] font-bold text-black">
              {(email[0] ?? 'C').toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-white/80 truncate">{email || 'Signed in'}</div>
              <div className="text-[10px] text-white/30">clapcheeks.tech</div>
            </div>
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="mt-2 w-full text-left text-xs text-white/50 hover:text-white hover:bg-white/5 px-3 py-2 rounded transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Mobile scrim */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="lg:hidden fixed inset-0 z-30 bg-black/60 backdrop-blur-sm"
        />
      )}
    </>
  )
}


// ─── Small components ─────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-white/30 font-mono">
      {children}
    </div>
  )
}

function NavLink({
  item,
  active,
  onClick,
}: {
  item: NavItem
  active: boolean
  onClick?: () => void
}) {
  return (
    <li>
      <Link
        href={item.href}
        onClick={onClick}
        className={`
          group flex items-center gap-3 px-3 py-2 rounded-lg text-sm
          transition-all duration-150
          ${active
            ? 'bg-gradient-to-r from-yellow-500/15 to-red-600/5 text-white border border-yellow-500/25'
            : 'text-white/55 hover:text-white hover:bg-white/5 border border-transparent'}
        `}
      >
        <span className={active ? 'text-yellow-400' : 'text-white/40 group-hover:text-white/80'}>
          {item.icon}
        </span>
        <span className="flex-1">{item.label}</span>
        {item.badge && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gradient-to-r from-yellow-500 to-red-600 text-black font-bold uppercase tracking-wider">
            {item.badge}
          </span>
        )}
      </Link>
    </li>
  )
}

function Logo() {
  return (
    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-yellow-500 to-red-600 flex items-center justify-center shadow-lg shadow-yellow-900/50">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M7 1L2 4.5V9.5L7 13L12 9.5V4.5L7 1Z" stroke="black" strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx="7" cy="7" r="1.5" fill="black" />
      </svg>
    </div>
  )
}

// Icons — minimal, inline SVG so no extra lib needed
const IconBase = (d: string) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)
function HomeIcon()     { return IconBase('M3 10l9-7 9 7v11a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2V10z') }
function HeartIcon()    { return IconBase('M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z') }
function PipelineIcon() { return IconBase('M3 6h6v4H3zM9 12h6v4H9zM15 18h6v-4h-6z M9 10v2 M15 16v-2') }
function ChatIcon()     { return IconBase('M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.6-.8L3 21l1.9-5.6A8.5 8.5 0 1 1 21 11.5z') }
function SparkIcon()    { return IconBase('M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83') }
function ChartIcon()    { return IconBase('M3 3v18h18M7 15l3-3 4 4 5-5') }
function CameraIcon()   { return IconBase('M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z') }
function RizzIcon()     { return IconBase('M12 2l2.39 7.36H22l-6.19 4.49L18.2 21 12 16.52 5.8 21l2.39-7.15L2 9.36h7.61L12 2z') }
function GearIcon()     { return IconBase('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z') }
function BellIcon()     { return IconBase('M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0') }
function CardIcon()     { return IconBase('M3 5h18v14H3z M3 10h18') }
function LaptopIcon()   { return IconBase('M4 4h16v12H4z M2 20h20') }
function ProfileIcon()  { return IconBase('M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM17 11l2 2 4-4') }
function GiftIcon()     { return IconBase('M20 12v10H4V12M2 7h20v5H2zM12 22V7') }
function HelpIcon()     { return IconBase('M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01') }
function MenuIcon()     { return IconBase('M3 12h18M3 6h18M3 18h18') }
function CloseIcon()    { return IconBase('M18 6L6 18M6 6l12 12') }
