import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Lock, Shield, CheckCircle, Database, Eye, Trash2 } from "lucide-react"
import Link from "next/link"

export default async function PrivacyPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login")
  }

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
            <h1 className="text-2xl font-bold text-gray-800">Privacy & Data</h1>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="space-y-6">
          {/* Privacy Guarantee */}
          <Card className="border-0 bg-gradient-to-r from-teal-50 to-purple-50 shadow-lg">
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-full bg-teal-100 flex items-center justify-center flex-shrink-0">
                  <Lock className="w-6 h-6 text-teal-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-800 mb-2">Your data stays on your Mac</h3>
                  <p className="text-sm text-gray-700">
                    All messages, match profiles, and conversation history are processed locally by the Outward agent.
                    Only anonymized metrics (swipe counts, match rates, spending totals) are synced to the cloud.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* What stays local */}
          <Card className="border-0 bg-white/80 backdrop-blur shadow-lg">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Shield className="w-6 h-6 text-purple-600" />
                <CardTitle>What Stays on Your Mac</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { title: "iMessage conversations", desc: "All chat history read and written by the agent" },
                { title: "Match profiles", desc: "Names, photos, and bio data from Tinder, Bumble, Hinge" },
                { title: "AI reply drafts", desc: "Generated message suggestions before you approve them" },
                { title: "Date preferences", desc: "Your type, dealbreakers, and attraction signals" },
              ].map((item) => (
                <div key={item.title} className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-gray-800">{item.title}</h4>
                    <p className="text-sm text-gray-600">{item.desc}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* What syncs to cloud */}
          <Card className="border-0 bg-white/80 backdrop-blur shadow-lg">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Database className="w-6 h-6 text-teal-600" />
                <CardTitle>What Syncs to the Cloud</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-gray-600 mb-4">Only anonymized aggregate metrics — never personal data.</p>
              {[
                { title: "Swipe counts", desc: "Total swipes per platform, not who you swiped on" },
                { title: "Match rates", desc: "Percentage only, not individual match names" },
                { title: "Conversation conversion", desc: "How many matches turn into real conversations" },
                { title: "Spending totals", desc: "Subscription costs tracked for ROI reporting" },
              ].map((item) => (
                <div key={item.title} className="flex items-start gap-3">
                  <Eye className="w-5 h-5 text-teal-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-gray-800">{item.title}</h4>
                    <p className="text-sm text-gray-600">{item.desc}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Delete account */}
          <Card className="border-0 bg-white/80 backdrop-blur shadow-lg">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Trash2 className="w-6 h-6 text-red-600" />
                <CardTitle>Delete Your Data</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-gray-700">
                You can delete all cloud-stored data at any time. Local data on your Mac is always under your control.
              </p>
              <Button variant="outline" className="border-red-300 text-red-600 hover:bg-red-50">
                Delete Cloud Data
              </Button>
              <p className="text-xs text-gray-500">
                This only removes anonymized metrics from our servers. Your local agent data is unaffected.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
