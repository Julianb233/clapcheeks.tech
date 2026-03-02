import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Shield, CheckCircle, ArrowLeft } from "lucide-react"
import Link from "next/link"

export default async function VerifyProfilePage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login")
  }

  // Get user profile
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single()

  if (profile?.is_verified) {
    redirect("/profile")
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-teal-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur border-b border-purple-100 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/profile">
                <ArrowLeft className="w-5 h-5" />
                <span className="sr-only">Back</span>
              </Link>
            </Button>
            <h1 className="text-2xl font-bold text-gray-800">Identity Verification</h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="space-y-6">
          {/* Info Card */}
          <Card className="border-0 bg-white/80 backdrop-blur shadow-lg">
            <CardHeader className="text-center">
              <div className="mx-auto w-16 h-16 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center mb-4">
                <Shield className="w-8 h-8 text-white" />
              </div>
              <CardTitle className="text-2xl">Get Verified</CardTitle>
              <CardDescription className="text-base">
                Build trust with the SafeMove community by verifying your identity
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <h3 className="font-semibold text-gray-800">Why verify your identity?</h3>
                <ul className="space-y-3">
                  <li className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                    <span className="text-gray-700">Build trust with other members of the community</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                    <span className="text-gray-700">Get a verified badge on your profile</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                    <span className="text-gray-700">Increase your reputation score</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                    <span className="text-gray-700">Access exclusive verified-only events</span>
                  </li>
                </ul>
              </div>

              <div className="pt-4 border-t border-gray-100">
                <h3 className="font-semibold text-gray-800 mb-3">Verification Methods</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Choose one of the following methods to verify your identity:
                </p>
                <div className="space-y-3">
                  <Card className="bg-gray-50 border-gray-200">
                    <CardContent className="p-4">
                      <h4 className="font-medium text-gray-800 mb-1">Government ID</h4>
                      <p className="text-sm text-gray-600 mb-3">
                        Upload a photo of your government-issued ID (passport, driver's license, or national ID)
                      </p>
                      <Button variant="outline" className="w-full bg-transparent" disabled>
                        Coming Soon
                      </Button>
                    </CardContent>
                  </Card>

                  <Card className="bg-gray-50 border-gray-200">
                    <CardContent className="p-4">
                      <h4 className="font-medium text-gray-800 mb-1">Social Media Verification</h4>
                      <p className="text-sm text-gray-600 mb-3">
                        Connect your verified social media account (Instagram, Facebook, or LinkedIn)
                      </p>
                      <Button variant="outline" className="w-full bg-transparent" disabled>
                        Coming Soon
                      </Button>
                    </CardContent>
                  </Card>

                  <Card className="bg-gray-50 border-gray-200">
                    <CardContent className="p-4">
                      <h4 className="font-medium text-gray-800 mb-1">Video Verification</h4>
                      <p className="text-sm text-gray-600 mb-3">
                        Complete a quick video verification call with our team
                      </p>
                      <Button variant="outline" className="w-full bg-transparent" disabled>
                        Coming Soon
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-500 text-center">
                  Your personal information is encrypted and stored securely. We never share your verification details
                  with other users.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
