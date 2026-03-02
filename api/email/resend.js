// Simple wrapper around Resend REST API for transactional email
// Requires RESEND_API_KEY in environment

export async function sendEmail({ to, subject, html }) {
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
    }),
  })
  return res.json()
}
