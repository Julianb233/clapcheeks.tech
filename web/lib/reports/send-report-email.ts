import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

interface SendReportEmailParams {
  to: string
  pdfBuffer: Buffer
  weekStart: string
  weekEnd: string
  rizzScore: number
}

export async function sendReportEmail({
  to,
  pdfBuffer,
  weekStart,
  weekEnd,
  rizzScore,
}: SendReportEmailParams) {
  const { data, error } = await resend.emails.send({
    from: 'Clap Cheeks <hello@clapcheeks.tech>',
    to: [to],
    subject: `Your Week in Review - Clapcheeks (${weekStart} to ${weekEnd})`,
    html: buildEmailHtml(weekStart, weekEnd, rizzScore),
    attachments: [
      {
        filename: `clapcheeks-report-${weekStart}.pdf`,
        content: pdfBuffer,
      },
    ],
    headers: {
      'List-Unsubscribe': '<https://clapcheeks.tech/reports?unsubscribe=1>',
    },
  })

  if (error) {
    console.error('Resend email error:', error)
    throw new Error(`Failed to send email: ${error.message}`)
  }

  return data
}

function buildEmailHtml(weekStart: string, weekEnd: string, rizzScore: number): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="text-align: center; margin-bottom: 30px;">
      <h1 style="color: #c026d3; font-size: 24px; margin: 0;">CLAP CHEEKS</h1>
      <p style="color: #999; font-size: 14px; margin-top: 8px;">Weekly Performance Report</p>
    </div>

    <div style="background-color: #1a1a1a; border-radius: 12px; padding: 30px; text-align: center; margin-bottom: 20px;">
      <p style="color: #999; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 10px 0;">Your Rizz Score</p>
      <h2 style="color: #e879f9; font-size: 48px; margin: 0;">${rizzScore}/100</h2>
      <p style="color: #999; font-size: 13px; margin-top: 10px;">Week of ${weekStart} to ${weekEnd}</p>
    </div>

    <div style="background-color: #1a1a1a; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 20px;">
      <p style="color: #fff; font-size: 14px; margin: 0;">Your full report is attached as a PDF.</p>
      <p style="color: #999; font-size: 13px; margin-top: 8px;">You can also view past reports on your <a href="https://clapcheeks.tech/reports" style="color: #c026d3;">dashboard</a>.</p>
    </div>

    <div style="text-align: center; margin-top: 30px;">
      <p style="color: #666; font-size: 11px;">
        clapcheeks.tech |
        <a href="https://clapcheeks.tech/reports?unsubscribe=1" style="color: #666;">Unsubscribe</a>
      </p>
    </div>
  </div>
</body>
</html>`
}
