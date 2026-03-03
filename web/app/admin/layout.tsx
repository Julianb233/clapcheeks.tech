import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import Link from "next/link"
import { LayoutDashboard, Users, DollarSign, Radio, Shield } from "lucide-react"

const ADMIN_EMAILS = [
  "julian@clapcheeks.tech",
  "admin@clapcheeks.tech",
]

export const metadata: Metadata = {
  title: 'Admin | Clapcheeks',
  description: 'Clapcheeks admin dashboard.',
}

function isAdmin(email: string | undefined): boolean {
  if (!email) return false
  return email.endsWith("@clapcheeks.tech") || ADMIN_EMAILS.includes(email)
}

const navItems = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/revenue", label: "Revenue", icon: DollarSign },
  { href: "/admin/events", label: "Agent Events", icon: Radio },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user || !isAdmin(user.email)) {
    redirect("/home")
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      {/* Sidebar */}
      <aside className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-purple-400" />
            <span className="font-bold text-lg text-white">Admin</span>
          </div>
          <p className="text-xs text-gray-500 mt-1">clapcheeks.tech</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-gray-800">
          <Link
            href="/home"
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            Back to Dashboard
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
