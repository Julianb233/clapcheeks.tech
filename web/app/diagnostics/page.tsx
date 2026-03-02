import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
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
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-teal-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur border-b border-purple-100 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/home">
                <ArrowLeft className="w-5 h-5" />
                <span className="sr-only">Back</span>
              </Link>
            </Button>
            <h1 className="text-2xl font-bold text-gray-800">Agent Status</h1>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-3xl space-y-6">
        {/* Cloud Connection */}
        <Card className="border-0 bg-white/80 backdrop-blur shadow-lg">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-purple-600" />
              <CardTitle>Cloud Connection</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-gray-700">Database</span>
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${dbStatus === "Connected" ? "bg-green-500" : "bg-red-500"}`} />
                <span className={`font-medium text-sm ${dbStatus === "Connected" ? "text-green-700" : "text-red-700"}`}>
                  {dbStatus}
                </span>
              </div>
            </div>
            {dbError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{dbError}</p>}
            <div className="flex items-center justify-between">
              <span className="text-gray-700">Supabase URL</span>
              <span className={`font-medium text-sm ${envStatus.supabaseUrl ? "text-green-700" : "text-red-700"}`}>
                {envStatus.supabaseUrl ? "✓ Set" : "✗ Missing"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-700">Supabase Key</span>
              <span className={`font-medium text-sm ${envStatus.supabaseKey ? "text-green-700" : "text-red-700"}`}>
                {envStatus.supabaseKey ? "✓ Set" : "✗ Missing"}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Local Agent */}
        <Card className="border-0 bg-white/80 backdrop-blur shadow-lg">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Wifi className="w-5 h-5 text-teal-600" />
              <CardTitle>Local Agent (Mac)</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-sm text-yellow-800">
                <strong>Agent not detected.</strong> Make sure the Outward agent is running on your Mac.
              </p>
              <code className="mt-2 block text-xs font-mono text-yellow-700">outward status</code>
            </div>
            <div className="space-y-3">
              {platforms.map((p) => (
                <div key={p.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg bg-gradient-to-r ${p.color} flex items-center justify-center`}>
                      <span className="text-white text-xs font-bold">{p.name[0]}</span>
                    </div>
                    <span className="text-gray-700 font-medium">{p.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <WifiOff className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-500">Not connected</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* iMessage Bridge */}
        <Card className="border-0 bg-white/80 backdrop-blur shadow-lg">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-pink-600" />
              <CardTitle>iMessage Bridge</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-gray-700">Bridge status</span>
              <div className="flex items-center gap-2">
                <XCircle className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-500">Offline</span>
              </div>
            </div>
            <p className="text-sm text-gray-500 mt-3">
              The iMessage bridge reads your conversations locally and never sends them to the cloud.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
