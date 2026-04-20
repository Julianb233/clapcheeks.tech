"use client"
import { useState } from "react"
import { CheckCircle2, AlertTriangle, MessageSquare, Bug, Zap, Shield } from "lucide-react"

const steps = [
  { title: "Welcome to the Alpha", icon: Zap, content: "You're one of the first people to test Clapcheeks. This is a closed alpha — your feedback directly shapes what we build next. Expect rough edges. Report everything." },
  { title: "What to Test", icon: CheckCircle2, content: "Focus on the core loop: connecting your dating profiles, letting the AI analyze your conversations, and reviewing suggested messages.", checklist: ["Connect at least one dating app profile", "Review AI-suggested openers", "Try the conversation assistant on 3+ chats", "Check your analytics dashboard", "Test on mobile (responsive)"] },
  { title: "How to Report Bugs", icon: Bug, content: "Found something broken? Use the feedback button or message Julian directly. Include: what you did, what happened, what you expected.", checklist: ["Screenshot or screen recording helps a lot", "Note which device/browser you're using", "Steps to reproduce = fastest fix"] },
  { title: "Privacy & Safety", icon: Shield, content: "Your dating data never leaves your device for training. The AI runs analysis locally where possible. Conversations are encrypted. We don't sell data — ever." },
  { title: "Known Limitations", icon: AlertTriangle, content: "This is alpha software. Here's what we know isn't perfect yet:", checklist: ["Message sync can lag 30-60 seconds", "Some profile photo analysis may be inaccurate", "Push notifications aren't hooked up yet", "Dark mode only (light mode coming later)"] },
  { title: "Feedback Survey", icon: MessageSquare, content: "At the end of the 2-week alpha, we'll send a short survey. But don't wait — drop feedback anytime via the in-app widget or DM Julian." },
]

export default function AlphaGuide() {
  const [completed, setCompleted] = useState<Set<string>>(new Set())
  const toggleItem = (stepIdx: number, itemIdx: number) => {
    const key = `${stepIdx}-${itemIdx}`
    setCompleted(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next })
  }
  return (
    <div className="max-w-2xl mx-auto px-4 py-12 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Alpha Tester Guide</h1>
        <p className="text-zinc-400">Everything you need to know for the 2-week closed alpha.</p>
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-emerald-400 text-sm">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />Alpha Active
        </div>
      </div>
      <div className="space-y-6">
        {steps.map((step, stepIdx) => {
          const Icon = step.icon
          return (
            <div key={stepIdx} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-zinc-800 rounded-lg"><Icon className="w-5 h-5 text-zinc-300" /></div>
                <h2 className="text-xl font-semibold">{step.title}</h2>
              </div>
              <p className="text-zinc-400 leading-relaxed">{step.content}</p>
              {step.checklist && (
                <ul className="space-y-2 pl-1">
                  {step.checklist.map((item, itemIdx) => {
                    const key = `${stepIdx}-${itemIdx}`
                    const isChecked = completed.has(key)
                    return (
                      <li key={itemIdx}><button onClick={() => toggleItem(stepIdx, itemIdx)} className="flex items-start gap-3 text-left w-full group">
                        <span className={`mt-0.5 w-5 h-5 rounded border flex-shrink-0 flex items-center justify-center transition ${isChecked ? "bg-emerald-500 border-emerald-500" : "border-zinc-600 group-hover:border-zinc-400"}`}>
                          {isChecked && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                        </span>
                        <span className={`text-sm ${isChecked ? "text-zinc-500 line-through" : "text-zinc-300"}`}>{item}</span>
                      </button></li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </div>
      <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-xl p-6 text-center space-y-3">
        <h3 className="text-lg font-semibold">Thank you for testing!</h3>
        <p className="text-zinc-400 text-sm">Your feedback is what makes Clapcheeks great.</p>
      </div>
    </div>
  )
}
