// Simple wrapper around Resend REST API for transactional email
// Requires RESEND_API_KEY in environment

const API_URL = process.env.API_URL || 'https://api.clapcheeks.tech'

export async function sendEmail({ to, subject, html }) {
  const unsubscribeUrl = `${API_URL}/email/unsubscribe?email=${encodeURIComponent(to)}`
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Clap Cheeks <hello@clapcheeks.tech>',
      to,
      subject,
      html,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }),
  })
  return res.json()
}
