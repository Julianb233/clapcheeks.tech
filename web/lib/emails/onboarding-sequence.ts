import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

const FROM = 'Clapcheeks <hello@clapcheeks.tech>'
const UNSUBSCRIBE_URL = 'https://clapcheeks.tech/settings?unsubscribe=onboarding'

// ---------------------------------------------------------------------------
// Shared HTML helpers
// ---------------------------------------------------------------------------

interface EmailParams {
  to: string
  firstName: string
}

type SendResult = {
  data: Awaited<ReturnType<typeof resend.emails.send>>['data']
  error: Awaited<ReturnType<typeof resend.emails.send>>['error']
}

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <!-- Header -->
    <div style="text-align:center;margin-bottom:30px;">
      <h1 style="color:#C9A427;font-size:24px;margin:0;letter-spacing:1px;">CLAPCHEEKS</h1>
    </div>

    ${body}

    <!-- Footer -->
    <div style="text-align:center;margin-top:40px;padding-top:20px;border-top:1px solid #222;">
      <p style="color:#666;font-size:11px;margin:0;">
        clapcheeks.tech |
        <a href="${UNSUBSCRIBE_URL}" style="color:#666;text-decoration:underline;">Unsubscribe</a>
      </p>
    </div>
  </div>
</body>
</html>`
}

function card(content: string): string {
  return `<div style="background-color:#1a1a1a;border-radius:12px;padding:28px;margin-bottom:20px;">${content}</div>`
}

function heading(text: string): string {
  return `<h2 style="color:#fff;font-size:20px;margin:0 0 16px 0;">${text}</h2>`
}

function paragraph(text: string): string {
  return `<p style="color:#ccc;font-size:14px;line-height:1.7;margin:0 0 14px 0;">${text}</p>`
}

function goldButton(text: string, href: string): string {
  return `<div style="text-align:center;margin:24px 0;">
    <a href="${href}" style="display:inline-block;background-color:#C9A427;color:#0a0a0a;font-weight:600;font-size:14px;padding:12px 32px;border-radius:8px;text-decoration:none;">${text}</a>
  </div>`
}

function bulletList(items: string[]): string {
  return `<ul style="color:#ccc;font-size:14px;line-height:1.8;padding-left:20px;margin:12px 0;">
    ${items.map((item) => `<li>${item}</li>`).join('\n    ')}
  </ul>`
}

// ---------------------------------------------------------------------------
// Email 1: Welcome (Day 0 - immediate)
// ---------------------------------------------------------------------------

export async function sendWelcomeEmail({ to, firstName }: EmailParams): Promise<SendResult> {
  const subject = 'Welcome to Clapcheeks - let\'s get you set up'
  const html = layout(subject, `
    ${card(`
      ${heading(`Hey ${firstName}, welcome to Clapcheeks`)}
      ${paragraph('You just took the first step toward never fumbling a conversation again. Clapcheeks is your AI dating co-pilot - it learns your style, crafts replies, and helps you land more dates.')}
      ${paragraph('Here\'s what to do next:')}
      ${bulletList([
        '<strong style="color:#C9A427;">Install the Mac agent</strong> - This is how Clapcheeks connects to your dating apps',
        '<strong style="color:#C9A427;">Connect your platforms</strong> - Hinge, Bumble, Tinder, or whatever you\'re running',
        '<strong style="color:#C9A427;">Set your vibe</strong> - Tell us your style so the AI sounds like you, not a robot',
      ])}
      ${goldButton('Open Dashboard', 'https://clapcheeks.tech/dashboard')}
    `)}
    ${card(`
      ${paragraph('Need help? Reply to this email or hit the chat widget in the app. We actually respond.')}
    `)}
  `)

  return resend.emails.send({
    from: FROM,
    to: [to],
    subject,
    html,
    headers: { 'List-Unsubscribe': `<${UNSUBSCRIBE_URL}>` },
  })
}

// ---------------------------------------------------------------------------
// Email 2: Setup Guide (Day 1)
// ---------------------------------------------------------------------------

export async function sendSetupGuideEmail({ to, firstName }: EmailParams): Promise<SendResult> {
  const subject = 'Day 1: Get your agent running in 5 minutes'
  const html = layout(subject, `
    ${card(`
      ${heading(`${firstName}, time to install your agent`)}
      ${paragraph('The Clapcheeks agent runs quietly on your Mac. It watches your dating app conversations and is ready to suggest killer replies the moment you need them.')}
      ${heading('Quick Setup')}
      ${bulletList([
        '<strong style="color:#C9A427;">Step 1:</strong> Go to Settings > Agent and download the Mac installer',
        '<strong style="color:#C9A427;">Step 2:</strong> Run the installer - it takes about 60 seconds',
        '<strong style="color:#C9A427;">Step 3:</strong> Connect at least one dating app (Hinge, Bumble, or Tinder)',
        '<strong style="color:#C9A427;">Step 4:</strong> Open a conversation and hit "Suggest Reply" to see the magic',
      ])}
      ${goldButton('Download Agent', 'https://clapcheeks.tech/settings')}
    `)}
    ${card(`
      ${paragraph('<strong style="color:#fff;">Pro tip:</strong> The agent works best when it has at least 5-10 of your past conversations to learn from. The more data it has, the more it sounds like you.')}
    `)}
  `)

  return resend.emails.send({
    from: FROM,
    to: [to],
    subject,
    html,
    headers: { 'List-Unsubscribe': `<${UNSUBSCRIBE_URL}>` },
  })
}

// ---------------------------------------------------------------------------
// Email 3: First Results (Day 3)
// ---------------------------------------------------------------------------

export async function sendFirstResultsEmail({ to, firstName }: EmailParams): Promise<SendResult> {
  const subject = 'Day 3: How the AI learns your dating style'
  const html = layout(subject, `
    ${card(`
      ${heading(`${firstName}, here's what's happening behind the scenes`)}
      ${paragraph('By now, the Clapcheeks AI has been analyzing your conversations and building a profile of how you flirt, joke, and close. Here\'s what to expect:')}
      ${bulletList([
        '<strong style="color:#C9A427;">First 24 hours:</strong> Suggestions will be good but generic. The AI is still learning.',
        '<strong style="color:#C9A427;">Days 2-3:</strong> Replies start matching your tone. It picks up your humor, slang, and energy.',
        '<strong style="color:#C9A427;">Week 1+:</strong> The AI sounds like you wrote it. People can\'t tell the difference.',
      ])}
      ${paragraph('The more you use it, the sharper it gets. Every conversation you have trains the model to be more <em>you</em>.')}
    `)}
    ${card(`
      ${heading('Check your Rizz Score')}
      ${paragraph('Your dashboard now shows a Rizz Score - a real-time rating of how your conversations are performing. Response rates, engagement quality, conversation length - it\'s all tracked.')}
      ${goldButton('See Your Score', 'https://clapcheeks.tech/dashboard')}
    `)}
  `)

  return resend.emails.send({
    from: FROM,
    to: [to],
    subject,
    html,
    headers: { 'List-Unsubscribe': `<${UNSUBSCRIBE_URL}>` },
  })
}

// ---------------------------------------------------------------------------
// Email 4: Pro Tips (Day 5)
// ---------------------------------------------------------------------------

export async function sendProTipsEmail({ to, firstName }: EmailParams): Promise<SendResult> {
  const subject = 'Day 5: Unlock the features most users miss'
  const html = layout(subject, `
    ${card(`
      ${heading(`${firstName}, you're leaving features on the table`)}
      ${paragraph('Most users only scratch the surface. Here are the power moves that separate the casuals from the closers:')}
    `)}
    ${card(`
      ${heading('Conversation AI')}
      ${paragraph('Don\'t just get reply suggestions - let the AI handle entire conversation threads. Set your goal (get the number, book the date, keep it going) and watch it work.')}
    `)}
    ${card(`
      ${heading('Date Booking')}
      ${paragraph('When a match is warm, hit the "Book Date" button. Clapcheeks suggests a venue, proposes a time, and handles the logistics. You just show up.')}
    `)}
    ${card(`
      ${heading('Weekly Analytics')}
      ${paragraph('Every Sunday you\'ll get a report breaking down your best openers, response rates by platform, and which conversation styles are landing. Data-driven dating.')}
    `)}
    ${card(`
      ${heading('Photo Scoring')}
      ${paragraph('Upload your profile photos and get an AI score with specific suggestions. Lighting, angle, outfit, expression - it tells you exactly what to fix.')}
      ${goldButton('Try These Features', 'https://clapcheeks.tech/dashboard')}
    `)}
  `)

  return resend.emails.send({
    from: FROM,
    to: [to],
    subject,
    html,
    headers: { 'List-Unsubscribe': `<${UNSUBSCRIBE_URL}>` },
  })
}

// ---------------------------------------------------------------------------
// Email 5: Upgrade Nudge (Day 7)
// ---------------------------------------------------------------------------

export async function sendUpgradeNudgeEmail({ to, firstName }: EmailParams): Promise<SendResult> {
  const subject = 'Your free trial is ending - keep the momentum going'
  const html = layout(subject, `
    ${card(`
      ${heading(`${firstName}, your trial wraps up soon`)}
      ${paragraph('Over the past week, Clapcheeks has been learning your style and helping you level up your conversations. Here\'s what you\'ll lose on the free tier:')}
      ${bulletList([
        'Unlimited AI reply suggestions (free tier: 10/day)',
        'Conversation autopilot mode',
        'Date booking assistant',
        'Weekly analytics reports',
        'Photo scoring and optimization',
        'Priority response speed',
      ])}
    `)}
    ${card(`
      ${heading('Upgrade to Pro')}
      ${paragraph('Keep everything unlocked. The AI keeps getting smarter the longer you use it - resetting now means starting the learning curve over.')}
      ${goldButton('Upgrade Now', 'https://clapcheeks.tech/pricing')}
      ${paragraph('<span style="color:#999;font-size:12px;">Cancel anytime. No contracts. No BS.</span>')}
    `)}
    ${card(`
      ${paragraph('Not ready? No worries. You\'ll keep access to the free tier with basic suggestions. But if you\'re serious about your dating game, Pro is where it\'s at.')}
    `)}
  `)

  return resend.emails.send({
    from: FROM,
    to: [to],
    subject,
    html,
    headers: { 'List-Unsubscribe': `<${UNSUBSCRIBE_URL}>` },
  })
}

// ---------------------------------------------------------------------------
// Sequence definition
// ---------------------------------------------------------------------------

export interface SequenceStep {
  day: number
  fn: (params: EmailParams) => Promise<SendResult>
  subject: string
}

export const SEQUENCE: SequenceStep[] = [
  { day: 0, fn: sendWelcomeEmail, subject: 'Welcome to Clapcheeks - let\'s get you set up' },
  { day: 1, fn: sendSetupGuideEmail, subject: 'Day 1: Get your agent running in 5 minutes' },
  { day: 3, fn: sendFirstResultsEmail, subject: 'Day 3: How the AI learns your dating style' },
  { day: 5, fn: sendProTipsEmail, subject: 'Day 5: Unlock the features most users miss' },
  { day: 7, fn: sendUpgradeNudgeEmail, subject: 'Your free trial is ending - keep the momentum going' },
]
