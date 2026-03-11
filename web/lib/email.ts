// Minimal Resend email sender for Next.js API routes
// Mirrors api/email/resend.js for use within the web app

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string
  subject: string
  html: string
}) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
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
