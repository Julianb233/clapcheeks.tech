import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { ArrowLeft, Bell, Calendar, Users, AlertTriangle, X } from "lucide-react"
import Link from "next/link"
import { getConvexServerClient } from "@/lib/convex/server"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"

export const metadata: Metadata = { title: 'Notifications | Clapcheeks' }

// AI-9537: notifications now live on Convex (read instead of is_read).

async function markAllRead() {
  "use server"
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  const convex = getConvexServerClient()
  await convex.mutation(api.notifications.markAllReadForUser, { user_id: user.id })
  revalidatePath("/notifications")
}

async function clearRead() {
  "use server"
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  const convex = getConvexServerClient()
  await convex.mutation(api.notifications.deleteAllReadForUser, { user_id: user.id })
  revalidatePath("/notifications")
}

async function dismissNotification(id: string) {
  "use server"
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  const convex = getConvexServerClient()
  await convex.mutation(api.notifications.deleteNotification, {
    id: id as Id<"notifications">,
    user_id: user.id,
  })
  revalidatePath("/notifications")
}

interface DisplayNotification {
  id: string
  type: string
  title: string
  message: string
  is_read: boolean
  created_at: string
}

export default async function NotificationsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login")
  }

  // Fetch notifications from Convex
  const convex = getConvexServerClient()
  const rows = await convex.query(api.notifications.listForUser, {
    user_id: user.id,
    limit: 200,
  })

  const notifications: DisplayNotification[] = (rows ?? []).map((n) => ({
    id: n._id as unknown as string,
    type: n.type ?? '',
    title: n.title,
    message: n.message ?? '',
    is_read: n.read,
    created_at: new Date(n.created_at).toISOString(),
  }))

  const hasUnread = notifications.some((n) => !n.is_read)
  const hasRead = notifications.some((n) => n.is_read)

  const getIcon = (type: string) => {
    switch (type) {
      case "new_match":
        return <Calendar className="w-5 h-5 text-purple-400" />
      case "coaching_tip":
        return <Bell className="w-5 h-5 text-pink-400" />
      case "date_booked":
        return <Users className="w-5 h-5 text-teal-400" />
      case "agent_alert":
        return <AlertTriangle className="w-5 h-5 text-orange-400" />
      default:
        return <Bell className="w-5 h-5 text-white/40" />
    }
  }

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <header className="bg-black/90 backdrop-blur border-b border-white/8 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <Link
              href="/home"
              className="text-white/40 hover:text-white/70 p-1.5 rounded-lg hover:bg-white/5 transition-all"
              aria-label="Back to home"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-2xl font-bold text-white flex-1">Notifications</h1>
            {hasUnread && (
              <form action={markAllRead}>
                <button
                  type="submit"
                  className="text-xs font-medium text-white/60 hover:text-white/90 px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 transition-colors"
                >
                  Mark all read
                </button>
              </form>
            )}
            {hasRead && (
              <form action={clearRead}>
                <button
                  type="submit"
                  className="text-xs font-medium text-white/60 hover:text-white/90 px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 transition-colors"
                >
                  Clear read
                </button>
              </form>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 max-w-3xl">
        {!notifications || notifications.length === 0 ? (
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-12 text-center">
            <Bell className="w-12 h-12 text-white/20 mx-auto mb-4" />
            <p className="text-lg text-white/60">No notifications yet</p>
            <p className="text-sm text-white/30 mt-2">
              AI coaching tips, new matches, and agent alerts will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={`rounded-xl p-4 transition-all ${
                  notification.is_read
                    ? "bg-white/[0.02] border border-white/[0.06]"
                    : "bg-white/[0.04] border border-white/[0.10]"
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 mt-0.5">{getIcon(notification.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h3 className="font-semibold text-white">{notification.title}</h3>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {!notification.is_read && (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-brand-500/20 text-brand-300 border border-brand-500/30">
                            New
                          </span>
                        )}
                        <form action={dismissNotification.bind(null, notification.id)}>
                          <button
                            type="submit"
                            aria-label="Dismiss notification"
                            className="text-white/30 hover:text-white/70 p-1 rounded transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </form>
                      </div>
                    </div>
                    <p className="text-sm text-white/50 mb-2">{notification.message}</p>
                    <p className="text-xs text-white/25">
                      {new Date(notification.created_at).toLocaleDateString()} at{" "}
                      {new Date(notification.created_at).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
