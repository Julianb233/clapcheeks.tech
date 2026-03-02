import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Terms of Service — Outward',
  description: 'Terms of service for using Outward.',
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-black">
      <div className="border-b border-white/6 px-6 py-4">
        <div className="max-w-3xl mx-auto">
          <Link href="/" className="flex items-center gap-2 text-white/40 hover:text-white/70 text-sm transition-colors w-fit">
            <ArrowLeft className="w-4 h-4" />
            Back to Outward
          </Link>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold text-white mb-2">Terms of Service</h1>
        <p className="text-white/30 text-sm mb-12">Last updated: March 2026</p>

        <div className="space-y-8 text-white/60 text-sm leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">1. Acceptance of Terms</h2>
            <p>
              By using Outward ("the Service"), you agree to these Terms of Service. If you do not agree, do not use the Service. We may update these terms from time to time, and continued use constitutes acceptance of any changes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">2. Description of Service</h2>
            <p>
              Outward provides an AI-powered dating automation tool that runs locally on your macOS device. The Service includes a local agent application, a web dashboard, and cloud-based analytics. The local agent interacts with third-party dating platforms on your behalf.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">3. Eligibility</h2>
            <p>
              You must be at least 18 years old to use the Service. By using Outward, you represent that you are of legal age and have the legal capacity to enter into this agreement.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">4. Your Account</h2>
            <p>
              You are responsible for maintaining the security of your account credentials and for all activity under your account. You must not share your account or use another person's account without permission.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">5. Acceptable Use</h2>
            <p className="mb-2">You agree not to:</p>
            <ul className="list-disc list-inside space-y-2">
              <li>Use the Service to harass, spam, or deceive other people</li>
              <li>Impersonate another person or create fake identities</li>
              <li>Use the Service in violation of any dating platform's terms of service</li>
              <li>Reverse engineer, decompile, or attempt to extract the source code</li>
              <li>Use the Service for any illegal purpose</li>
              <li>Resell or redistribute the Service without authorization</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">6. Privacy</h2>
            <p>
              Your privacy is important to us. Please review our{' '}
              <Link href="/privacy" className="text-brand-400 hover:text-brand-300 transition-colors">
                Privacy Policy
              </Link>{' '}
              to understand how we collect, use, and protect your data. The local agent processes data on your device — we do not have access to your dating app messages or personal conversations.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">7. Subscription and Billing</h2>
            <ul className="list-disc list-inside space-y-2">
              <li>Subscriptions are billed monthly via Stripe</li>
              <li>You may cancel your subscription at any time from your billing dashboard</li>
              <li>Cancellation takes effect at the end of the current billing period</li>
              <li>No refunds for partial months of service</li>
              <li>We reserve the right to change pricing with 30 days notice</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">8. Third-Party Platforms</h2>
            <p>
              Outward interacts with third-party dating platforms (Tinder, Bumble, Hinge, etc.). We are not affiliated with, endorsed by, or sponsored by these platforms. Use of the Service with these platforms is at your own risk. You are responsible for complying with each platform's terms of service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">9. Disclaimer of Warranties</h2>
            <p>
              The Service is provided "as is" without warranties of any kind, express or implied. We do not guarantee that the Service will be uninterrupted, error-free, or that it will produce any particular results in your dating life.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">10. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, Outward shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Service, including but not limited to account suspensions on third-party platforms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">11. Termination</h2>
            <p>
              We may terminate or suspend your account if you violate these terms. You may terminate your account at any time by canceling your subscription and contacting us to request account deletion.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">12. Contact</h2>
            <p>
              Questions about these terms? Email us at{' '}
              <a href="mailto:legal@clapcheeks.tech" className="text-brand-400 hover:text-brand-300 transition-colors">
                legal@clapcheeks.tech
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
