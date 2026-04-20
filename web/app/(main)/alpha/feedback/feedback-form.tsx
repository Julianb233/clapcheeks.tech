"use client"
import { useState } from "react"
import { Send, Star, Bug, Lightbulb, ThumbsUp } from "lucide-react"

type FeedbackType = "bug" | "feature" | "general" | "praise"
const feedbackTypes = [
  { id: "bug" as const, label: "Bug Report", icon: Bug, color: "text-red-400" },
  { id: "feature" as const, label: "Feature Request", icon: Lightbulb, color: "text-amber-400" },
  { id: "general" as const, label: "General Feedback", icon: Star, color: "text-blue-400" },
  { id: "praise" as const, label: "Something I Love", icon: ThumbsUp, color: "text-emerald-400" },
]

export default function FeedbackForm() {
  const [type, setType] = useState<FeedbackType>("general")
  const [rating, setRating] = useState(0)
  const [message, setMessage] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!message.trim()) return
    setSubmitting(true)
    try {
      await fetch("/api/alpha-feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, rating, message }) })
      setSubmitted(true)
    } catch { alert("Failed to submit — try again or DM Julian directly.") }
    finally { setSubmitting(false) }
  }

  if (submitted) return (
    <div className="max-w-lg mx-auto px-4 py-24 text-center space-y-4">
      <div className="text-5xl">🙏</div>
      <h2 className="text-2xl font-bold">Feedback Received</h2>
      <p className="text-zinc-400">Thanks for helping make Clapcheeks better.</p>
      <button onClick={() => { setSubmitted(false); setMessage(""); setRating(0) }} className="text-sm text-zinc-500 hover:text-white transition underline">Submit more</button>
    </div>
  )

  return (
    <div className="max-w-lg mx-auto px-4 py-12 space-y-8">
      <div className="space-y-2"><h1 className="text-2xl font-bold">Alpha Feedback</h1><p className="text-zinc-400 text-sm">Your honest feedback shapes Clapcheeks.</p></div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-2 gap-3">
          {feedbackTypes.map((ft) => { const Icon = ft.icon; return (
            <button key={ft.id} type="button" onClick={() => setType(ft.id)} className={`flex items-center gap-2 p-3 rounded-lg border transition text-sm font-medium ${type === ft.id ? "border-zinc-500 bg-zinc-800" : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"}`}>
              <Icon className={`w-4 h-4 ${ft.color}`} />{ft.label}
            </button>
          )})}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300">Overall experience</label>
          <div className="flex gap-1">{[1,2,3,4,5].map((star) => (
            <button key={star} type="button" onClick={() => setRating(star)} className="p-1 transition hover:scale-110">
              <Star className={`w-6 h-6 ${star <= rating ? "text-amber-400 fill-amber-400" : "text-zinc-600"}`} />
            </button>
          ))}</div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300">{type === "bug" ? "What happened?" : type === "feature" ? "What would you like?" : "Tell us what you think"}</label>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Share your thoughts..." className="w-full h-32 bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-sm text-white placeholder:text-zinc-600 resize-none focus:outline-none focus:ring-1 focus:ring-zinc-500" required />
        </div>
        <button type="submit" disabled={submitting || !message.trim()} className="w-full flex items-center justify-center gap-2 py-3 bg-white text-black font-semibold rounded-lg hover:bg-zinc-200 transition disabled:opacity-50 disabled:cursor-not-allowed">
          <Send className="w-4 h-4" />{submitting ? "Sending..." : "Submit Feedback"}
        </button>
      </form>
    </div>
  )
}
