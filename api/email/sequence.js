// Email onboarding sequence scheduler
// Determines which email to send based on days since signup

import { sendEmail } from './resend.js'
import { welcomeEmail, day3Email, day7Email, day14Email } from './templates.js'

export async function sendWelcomeEmail(email) {
  const tpl = welcomeEmail()
  return sendEmail({ to: email, subject: tpl.subject, html: tpl.html })
}

export async function sendDay3Email(email) {
  const tpl = day3Email()
  return sendEmail({ to: email, subject: tpl.subject, html: tpl.html })
}

export async function sendDay7Email(email) {
  const tpl = day7Email()
  return sendEmail({ to: email, subject: tpl.subject, html: tpl.html })
}

export async function sendDay14Email(email) {
  const tpl = day14Email()
  return sendEmail({ to: email, subject: tpl.subject, html: tpl.html })
}

export async function processEmailSequence(userId, email, signupDate, hasAgentActivity, subscriptionTier) {
  const daysSince = Math.floor((Date.now() - new Date(signupDate).getTime()) / 86400000)

  if (daysSince === 0) return sendWelcomeEmail(email)
  if (daysSince === 3 && !hasAgentActivity) return sendDay3Email(email)
  if (daysSince === 7) return sendDay7Email(email)
  if (daysSince === 14 && subscriptionTier === 'free') return sendDay14Email(email)

  return null
}
