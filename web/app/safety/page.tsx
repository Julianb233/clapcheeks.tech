import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { ArrowLeft, Lock, Shield, CheckCircle, Database, Eye, Trash2 } from "lucide-react"
import Link from "next/link"

export const metadata: Metadata = {
  title: 'Safety | Clapcheeks',
  description: 'Safety guidelines and privacy settings.',
}

export default async function PrivacyPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login")
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
            <h1 className="text-2xl font-bold text-white">Privacy & Data</h1>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="space-y-6">
          {/* Privacy Guarantee */}
          <div className="bg-teal-900/20 border border-teal-500/30 rounded-xl p-5">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full bg-teal-500/20 flex items-center justify-center flex-shrink-0">
                <Lock className="w-6 h-6 text-teal-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-white mb-2">Your data stays on your Mac</h3>
                <p className="text-sm text-white/60">
                  All messages, match profiles, and conversation history are processed locally by the Clapcheeks agent.
                  Only anonymized metrics (swipe counts, match rates, spending totals) are synced to the cloud.
                </p>
              </div>
            </div>
          </div>

          {/* What stays local */}
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-2">
              <Shield className="w-5 h-5 text-purple-400" />
              <h2 className="text-white font-semibold">What Stays on Your Mac</h2>
            </div>
            <div className="p-5 space-y-3">
              {[
                { title: "iMessage conversations", desc: "All chat history read and written by the agent" },
                { title: "Match profiles", desc: "Names, photos, and bio data from Tinder, Bumble, Hinge" },
                { title: "AI reply drafts", desc: "Generated message suggestions before you approve them" },
                { title: "Date preferences", desc: "Your type, dealbreakers, and attraction signals" },
              ].map((item) => (
                <div key={item.title} className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-white">{item.title}</h4>
                    <p className="text-sm text-white/50">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* What syncs to cloud */}
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-2">
              <Database className="w-5 h-5 text-teal-400" />
              <h2 className="text-white font-semibold">What Syncs to the Cloud</h2>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-white/50 mb-4">Only anonymized aggregate metrics — never personal data.</p>
              {[
                { title: "Swipe counts", desc: "Total swipes per platform, not who you swiped on" },
                { title: "Match rates", desc: "Percentage only, not individual match names" },
                { title: "Conversation conversion", desc: "How many matches turn into real conversations" },
                { title: "Spending totals", desc: "Subscription costs tracked for ROI reporting" },
              ].map((item) => (
                <div key={item.title} className="flex items-start gap-3">
                  <Eye className="w-5 h-5 text-teal-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-white">{item.title}</h4>
                    <p className="text-sm text-white/50">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Delete account */}
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-400" />
              <h2 className="text-white font-semibold">Delete Your Data</h2>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-white/60">
                You can delete all cloud-stored data at any time. Local data on your Mac is always under your control.
              </p>
              <button className="px-4 py-2 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-900/20 transition-colors text-sm font-medium">
                Delete Cloud Data
              </button>
              <p className="text-xs text-white/30">
                This only removes anonymized metrics from our servers. Your local agent data is unaffected.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
