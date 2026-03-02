import { Button } from "@/components/ui/button"
import Link from "next/link"
import { Bot, BarChart3, MessageSquare, Lock, Calendar, Zap } from "lucide-react"

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-teal-50">
      {/* Hero Section */}
      <div className="container mx-auto px-4 py-16">
        <div className="flex flex-col items-center text-center space-y-8 max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-white/80 backdrop-blur border border-purple-100 rounded-full px-4 py-1.5 text-sm text-purple-700 font-medium shadow-sm">
            <Zap className="w-3.5 h-3.5" />
            Runs privately on your Mac
          </div>
          <h1 className="text-5xl md:text-6xl font-bold bg-gradient-to-r from-pink-500 via-purple-600 to-teal-500 bg-clip-text text-transparent leading-tight">
            Outward
          </h1>
          <p className="text-xl md:text-2xl text-gray-700 max-w-2xl leading-relaxed">
            Your AI dating co-pilot. Automate swipes, reply in your voice, book real dates, and track everything — privately.
          </p>
          <p className="text-lg text-gray-600 max-w-xl">
            Works with Tinder, Bumble, and Hinge. Your messages never leave your Mac.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 pt-4">
            <Button
              asChild
              size="lg"
              className="h-12 px-8 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-lg"
            >
              <Link href="/auth/sign-up">Get Started Free</Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-12 px-8 text-lg border-2 border-purple-300 hover:bg-purple-50 bg-transparent"
            >
              <Link href="/auth/login">Sign In</Link>
            </Button>
          </div>
          <p className="text-sm text-gray-500">
            Install in 30 seconds ·{" "}
            <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono">
              curl -fsSL https://clapcheeks.tech/install.sh | bash
            </code>
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mt-20 max-w-5xl mx-auto">
          <div className="bg-white/80 backdrop-blur rounded-2xl p-6 shadow-lg hover:shadow-xl transition-shadow">
            <div className="w-12 h-12 bg-gradient-to-r from-pink-500 to-purple-600 rounded-xl flex items-center justify-center mb-4">
              <Bot className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Auto-Swipe</h3>
            <p className="text-sm text-gray-600">
              Learns your type and swipes for you on Tinder, Bumble, and Hinge while you sleep.
            </p>
          </div>

          <div className="bg-white/80 backdrop-blur rounded-2xl p-6 shadow-lg hover:shadow-xl transition-shadow">
            <div className="w-12 h-12 bg-gradient-to-r from-purple-500 to-teal-500 rounded-xl flex items-center justify-center mb-4">
              <MessageSquare className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Replies in Your Voice</h3>
            <p className="text-sm text-gray-600">
              AI reads your iMessages and keeps conversations going — sounds exactly like you.
            </p>
          </div>

          <div className="bg-white/80 backdrop-blur rounded-2xl p-6 shadow-lg hover:shadow-xl transition-shadow">
            <div className="w-12 h-12 bg-gradient-to-r from-teal-500 to-pink-500 rounded-xl flex items-center justify-center mb-4">
              <Calendar className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Books Dates</h3>
            <p className="text-sm text-gray-600">
              Automatically suggests and books dates on your calendar when conversations heat up.
            </p>
          </div>

          <div className="bg-white/80 backdrop-blur rounded-2xl p-6 shadow-lg hover:shadow-xl transition-shadow">
            <div className="w-12 h-12 bg-gradient-to-r from-pink-500 to-teal-500 rounded-xl flex items-center justify-center mb-4">
              <BarChart3 className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Dating Analytics</h3>
            <p className="text-sm text-gray-600">
              Track swipe rates, match rates, conversion to dates, and spending across all apps.
            </p>
          </div>

          <div className="bg-white/80 backdrop-blur rounded-2xl p-6 shadow-lg hover:shadow-xl transition-shadow">
            <div className="w-12 h-12 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl flex items-center justify-center mb-4">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-lg font-semibold mb-2">AI Coaching</h3>
            <p className="text-sm text-gray-600">
              Get personalized tips to improve your profile, openers, and date conversion rate.
            </p>
          </div>

          <div className="bg-white/80 backdrop-blur rounded-2xl p-6 shadow-lg hover:shadow-xl transition-shadow">
            <div className="w-12 h-12 bg-gradient-to-r from-teal-500 to-purple-500 rounded-xl flex items-center justify-center mb-4">
              <Lock className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-lg font-semibold mb-2">100% Private</h3>
            <p className="text-sm text-gray-600">
              All messages and match data stay on your Mac. Only anonymized metrics sync to the cloud.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
