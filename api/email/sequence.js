// Email onboarding sequence scheduler
// Determines which email to send based on days since signup
// Tracks sent emails to prevent duplicates, checks unsubscribe status

import { supabase } from '../server.js'
import { sendEmail } from './resend.js'
import { welcomeEmail, day3Email, day7Email, day14Email } from './templates.js'

async function isUnsubscribed(userId) {
  const { data } = await supabase
    .from('email_unsubscribes')
    .select('user_id')
    .eq('user_id', userId)
    .single()
  return !!data
}

async function alreadySent(userId, emailType) {
  const { data } = await supabase
    .from('email_sends')
    .select('id')
    .eq('user_id', userId)
    .eq('email_type', emailType)
    .single()
  return !!data
}

async function recordSend(userId, emailType) {
  await supabase
    .from('email_sends')
    .upsert({ user_id: userId, email_type: emailType })
}

export async function sendWelcomeEmail(email, userId) {
  if (userId) {
    if (await alreadySent(userId, 'welcome')) return null
    if (await isUnsubscribed(userId)) return null
  }
  const tpl = welcomeEmail(email)
  const result = await sendEmail({ to: email, subject: tpl.subject, html: tpl.html })
  if (userId) await recordSend(userId, 'welcome')
  return result
}

export async function sendDay3Email(email, userId) {
  const tpl = day3Email(email)
  const result = await sendEmail({ to: email, subject: tpl.subject, html: tpl.html })
  if (userId) await recordSend(userId, 'day3')
  return result
}

export async function sendDay7Email(email, userId) {
  const tpl = day7Email(email)
  const result = await sendEmail({ to: email, subject: tpl.subject, html: tpl.html })
  if (userId) await recordSend(userId, 'day7')
  return result
}

export async function sendDay14Email(email, userId) {
  const tpl = day14Email(email)
  const result = await sendEmail({ to: email, subject: tpl.subject, html: tpl.html })
  if (userId) await recordSend(userId, 'day14')
  return result
}

export async function processEmailSequence(userId, email, signupDate, hasAgentActivity, subscriptionTier) {
  // Skip unsubscribed users
  if (await isUnsubscribed(userId)) return null

  const daysSince = Math.floor((Date.now() - new Date(signupDate).getTime()) / 86400000)

  // Use ranges instead of exact day matching so emails aren't missed if cron skips a day
  // Each email is only sent once thanks to the email_sends dedup table

  if (daysSince >= 0 && !await alreadySent(userId, 'welcome')) {
    return sendWelcomeEmail(email, userId)
  }
  if (daysSince >= 3 && !hasAgentActivity && !await alreadySent(userId, 'day3')) {
    return sendDay3Email(email, userId)
  }
  if (daysSince >= 7 && !await alreadySent(userId, 'day7')) {
    return sendDay7Email(email, userId)
  }
  if (daysSince >= 14 && subscriptionTier === 'free' && !await alreadySent(userId, 'day14')) {
    return sendDay14Email(email, userId)
  }

  return null
}
