import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { ArrowLeft, Activity, Wifi, WifiOff, CheckCircle, XCircle } from "lucide-react"
import Link from "next/link"

export default async function DiagnosticsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login")
  }

  let dbStatus = "Unknown"
  let dbError = ""
  const envStatus = {
    supabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  }

  try {
    const { error } = await supabase.from("profiles").select("count").limit(1)
    if (error) {
      dbStatus = "Error"
      dbError = error.message
    } else {
      dbStatus = "Connected"
    }
  } catch (err) {
    dbStatus = "Failed"
    dbError = err instanceof Error ? err.message : "Unknown error"
  }

  const platforms = [
    { name: "Tinder", color: "from-red-400 to-orange-500" },
    { name: "Bumble", color: "from-yellow-400 to-amber-500" },
    { name: "Hinge", color: "from-pink-400 to-rose-600" },
  ]

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
            <h1 className="text-2xl font-bold text-white">Agent Status</h1>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-3xl space-y-6">
        {/* Cloud Connection */}
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-2">
            <Activity className="w-5 h-5 text-purple-400" />
            <h2 className="text-white font-semibold">Cloud Connection</h2>
          </div>
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-white/60">Database</span>
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${dbStatus === "Connected" ? "bg-green-400" : "bg-red-400"}`} />
                <span className={`font-medium text-sm ${dbStatus === "Connected" ? "text-green-400" : "text-red-400"}`}>
                  {dbStatus}
                </span>
              </div>
            </div>
            {dbError && <p className="text-sm text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2">{dbError}</p>}
            <div className="flex items-center justify-between">
              <span className="text-white/60">Supabase URL</span>
              <span className={`font-medium text-sm ${envStatus.supabaseUrl ? "text-green-400" : "text-red-400"}`}>
                {envStatus.supabaseUrl ? "Set" : "Missing"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/60">Supabase Key</span>
              <span className={`font-medium text-sm ${envStatus.supabaseKey ? "text-green-400" : "text-red-400"}`}>
                {envStatus.supabaseKey ? "Set" : "Missing"}
              </span>
            </div>
          </div>
        </div>

        {/* Local Agent */}
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-2">
            <Wifi className="w-5 h-5 text-teal-400" />
            <h2 className="text-white font-semibold">Local Agent (Mac)</h2>
          </div>
          <div className="p-5 space-y-4">
            <div className="bg-amber-900/20 border border-amber-500/30 rounded-lg p-4">
              <p className="text-sm text-amber-300">
                <strong>Agent not detected.</strong> Make sure the Clapcheeks agent is running on your Mac.
              </p>
              <code className="mt-2 block text-xs font-mono text-amber-400/70">clapcheeks status</code>
            </div>
            <div className="space-y-3">
              {platforms.map((p) => (
                <div key={p.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg bg-gradient-to-r ${p.color} flex items-center justify-center`}>
                      <span className="text-white text-xs font-bold">{p.name[0]}</span>
                    </div>
                    <span className="text-white/70 font-medium">{p.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <WifiOff className="w-4 h-4 text-white/25" />
                    <span className="text-sm text-white/30">Not connected</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* iMessage Bridge */}
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-pink-400" />
            <h2 className="text-white font-semibold">iMessage Bridge</h2>
          </div>
          <div className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-white/60">Bridge status</span>
              <div className="flex items-center gap-2">
                <XCircle className="w-4 h-4 text-white/25" />
                <span className="text-sm text-white/30">Offline</span>
              </div>
            </div>
            <p className="text-sm text-white/30 mt-3">
              The iMessage bridge reads your conversations locally and never sends them to the cloud.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
