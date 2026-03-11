// Dunning email templates for failed payment recovery flow
// Styled to match existing onboarding email templates (dark theme, violet accent)

const VIOLET = '#8b5cf6'
const DARK_BG = '#0f0f14'
const CARD_BG = '#1a1a24'
const TEXT_COLOR = '#e4e4e7'
const MUTED = '#a1a1aa'
const RED = '#ef4444'
const BILLING_URL = 'https://clapcheeks.tech/billing'
const PRICING_URL = 'https://clapcheeks.tech/pricing'

function layout(content: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${DARK_BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${DARK_BG};padding:40px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
  <tr><td style="padding:24px 0;text-align:center;">
    <span style="font-size:28px;font-weight:800;color:${VIOLET};letter-spacing:-0.5px;">Clap Cheeks</span>
  </td></tr>
  <tr><td style="background:${CARD_BG};border-radius:12px;padding:32px;color:${TEXT_COLOR};font-size:15px;line-height:1.7;">
    ${content}
  </td></tr>
  <tr><td style="padding:24px 0;text-align:center;color:${MUTED};font-size:12px;">
    Clap Cheeks &mdash; AI Dating Co-Pilot<br>
    <a href="https://clapcheeks.tech" style="color:${MUTED};text-decoration:underline;">clapcheeks.tech</a>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`
}

function button(text: string, href: string, color = VIOLET) {
  return `<table cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td>
    <a href="${href}" style="display:inline-block;background:${color};color:#fff;font-weight:600;font-size:15px;padding:12px 28px;border-radius:8px;text-decoration:none;">${text}</a>
  </td></tr></table>`
}

/**
 * Email sent on each failed payment attempt.
 * attempt: 1-based attempt number from Stripe invoice.attempt_count
 */
export function paymentFailedEmail(attempt: number) {
  const isFirst = attempt <= 1
  const isLast = attempt >= 3

  const urgency = isFirst
    ? 'We had trouble processing your payment.'
    : isLast
      ? 'This is the final attempt to process your payment.'
      : `We tried to charge your card again, but it didn't go through (attempt ${attempt} of 3).`

  const consequence = isLast
    ? `<p style="color:${RED};font-weight:600;">If we can't collect payment, your subscription will be canceled and your agent will stop running.</p>`
    : `<p style="color:${MUTED};">Your agent is still running, but if the issue isn't resolved your subscription will be canceled.</p>`

  return {
    subject: isFirst
      ? 'Your Clap Cheeks payment failed'
      : isLast
        ? 'Final notice: update your payment to keep your agent running'
        : 'Reminder: your Clap Cheeks payment is past due',
    html: layout(`
      <h2 style="margin:0 0 16px;color:#fff;font-size:22px;">Payment failed</h2>
      <p style="color:${TEXT_COLOR};">${urgency}</p>
      ${consequence}
      <p style="color:${TEXT_COLOR};">The most common fix is to update your card on file:</p>
      ${button('Update Payment Method', BILLING_URL)}
      <p style="color:${MUTED};font-size:13px;">If your card details are correct, contact your bank to authorize the charge. You can also retry the payment from your <a href="${BILLING_URL}" style="color:${VIOLET};">billing page</a>.</p>
    `),
  }
}

/**
 * Email sent when subscription is canceled after all retries failed.
 */
export function subscriptionCanceledEmail() {
  return {
    subject: 'Your Clap Cheeks subscription has been canceled',
    html: layout(`
      <h2 style="margin:0 0 16px;color:#fff;font-size:22px;">Your subscription has been canceled</h2>
      <p style="color:${TEXT_COLOR};">After multiple payment attempts, we weren't able to process your payment. Your subscription has been canceled and your agent has been paused.</p>
      <p style="color:${TEXT_COLOR};">Your data is safe &mdash; you can re-subscribe at any time to pick up where you left off.</p>
      ${button('Re-subscribe', PRICING_URL)}
      <p style="color:${MUTED};font-size:13px;">If this was a mistake or you need help, just reply to this email.</p>
    `),
  }
}
