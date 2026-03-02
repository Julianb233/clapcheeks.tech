// HTML email templates for onboarding sequence
// Dark theme, responsive, inline styles for email client compatibility

const VIOLET = '#8b5cf6'
const DARK_BG = '#0f0f14'
const CARD_BG = '#1a1a24'
const TEXT_COLOR = '#e4e4e7'
const MUTED = '#a1a1aa'
const DASHBOARD_URL = 'https://clapcheeks.tech/dashboard'
const PRICING_URL = 'https://clapcheeks.tech/pricing'
const DOCS_URL = 'https://clapcheeks.tech/docs'

function layout(content) {
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

function button(text, href) {
  return `<table cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td>
    <a href="${href}" style="display:inline-block;background:${VIOLET};color:#fff;font-weight:600;font-size:15px;padding:12px 28px;border-radius:8px;text-decoration:none;">${text}</a>
  </td></tr></table>`
}

function code(text) {
  return `<code style="background:#27272a;color:#a78bfa;padding:3px 8px;border-radius:4px;font-size:13px;">${text}</code>`
}

// ── Email 1: Welcome (sent immediately on signup) ────────────────────────────

export function welcomeEmail() {
  return {
    subject: "Welcome to Clap Cheeks — let's get you set up",
    html: layout(`
      <h2 style="margin:0 0 16px;color:#fff;font-size:22px;">Your AI dating co-pilot is ready.</h2>
      <p style="color:${TEXT_COLOR};">Here's how to get started in 3 steps:</p>
      <table cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;">
        <tr><td style="padding:12px 0;border-bottom:1px solid #27272a;">
          <span style="color:${VIOLET};font-weight:700;margin-right:8px;">1.</span>
          Install the agent: ${code('pip install clapcheeks[all]')}
        </td></tr>
        <tr><td style="padding:12px 0;border-bottom:1px solid #27272a;">
          <span style="color:${VIOLET};font-weight:700;margin-right:8px;">2.</span>
          Run setup: ${code('clapcheeks setup')}
        </td></tr>
        <tr><td style="padding:12px 0;">
          <span style="color:${VIOLET};font-weight:700;margin-right:8px;">3.</span>
          Start swiping: ${code('clapcheeks swipe')}
        </td></tr>
      </table>
      ${button('Go to Dashboard', DASHBOARD_URL)}
      <p style="color:${MUTED};font-size:13px;margin:16px 0 0;">PS: Questions? Reply to this email &mdash; a human will respond.</p>
    `),
  }
}

// ── Email 2: Day 3 Check-in (if no agent activity) ──────────────────────────

export function day3Email() {
  return {
    subject: "Did you get Clap Cheeks set up? Here's help",
    html: layout(`
      <h2 style="margin:0 0 16px;color:#fff;font-size:22px;">Need a hand getting started?</h2>
      <p style="color:${TEXT_COLOR};">We noticed you haven't connected your agent yet. Here are the top 3 setup issues and how to fix them:</p>
      <table cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;">
        <tr><td style="padding:12px 0;border-bottom:1px solid #27272a;">
          <strong style="color:#fff;">Kimi API Key not set</strong><br>
          <span style="color:${MUTED};">Run ${code('clapcheeks setup')} and paste your key from <a href="https://platform.moonshot.cn" style="color:${VIOLET};">platform.moonshot.cn</a></span>
        </td></tr>
        <tr><td style="padding:12px 0;border-bottom:1px solid #27272a;">
          <strong style="color:#fff;">Python version too old</strong><br>
          <span style="color:${MUTED};">Clap Cheeks requires Python 3.10+. Check with ${code('python3 --version')}</span>
        </td></tr>
        <tr><td style="padding:12px 0;">
          <strong style="color:#fff;">Browserbase connection failed</strong><br>
          <span style="color:${MUTED};">Make sure your Browserbase project ID and API key are set in ${code('~/.clapcheeks/config.yaml')}</span>
        </td></tr>
      </table>
      ${button('Resume Setup', DOCS_URL)}
      <p style="color:${MUTED};font-size:13px;">Still stuck? Reply to this email and we'll help you out.</p>
    `),
  }
}

// ── Email 3: Day 7 Tips ─────────────────────────────────────────────────────

export function day7Email() {
  return {
    subject: '5 tips to get more matches with Clap Cheeks',
    html: layout(`
      <h2 style="margin:0 0 16px;color:#fff;font-size:22px;">Level up your match game</h2>
      <p style="color:${TEXT_COLOR};">You've been using Clap Cheeks for a week. Here are 5 tips from our top users:</p>
      <table cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;">
        <tr><td style="padding:12px 0;border-bottom:1px solid #27272a;">
          <strong style="color:${VIOLET};">1. Optimize your like ratio</strong><br>
          <span style="color:${MUTED};">Don't right-swipe everyone. A 30-40% like ratio signals quality to the algorithm.</span>
        </td></tr>
        <tr><td style="padding:12px 0;border-bottom:1px solid #27272a;">
          <strong style="color:${VIOLET};">2. Swipe during peak hours</strong><br>
          <span style="color:${MUTED};">Run ${code('clapcheeks swipe')} between 7-10 PM local time for 2x more profile visibility.</span>
        </td></tr>
        <tr><td style="padding:12px 0;border-bottom:1px solid #27272a;">
          <strong style="color:${VIOLET};">3. NLP mirroring in messages</strong><br>
          <span style="color:${MUTED};">The AI mirrors your match's writing style &mdash; short texts get short replies, detailed bios get thoughtful openers.</span>
        </td></tr>
        <tr><td style="padding:12px 0;border-bottom:1px solid #27272a;">
          <strong style="color:${VIOLET};">4. Re-engage stale matches</strong><br>
          <span style="color:${MUTED};">Use ${code('clapcheeks converse --re-engage')} to revive conversations that went cold.</span>
        </td></tr>
        <tr><td style="padding:12px 0;">
          <strong style="color:${VIOLET};">5. Use a residential proxy</strong><br>
          <span style="color:${MUTED};">Browserbase's built-in proxies prevent rate limits. Enable in setup for higher daily caps.</span>
        </td></tr>
      </table>
      ${button('Read the Full Guide', DOCS_URL)}
    `),
  }
}

// ── Email 4: Day 14 Upgrade Nudge (free tier only) ──────────────────────────

export function day14Email() {
  return {
    subject: "You've been on Free for 2 weeks — here's what Pro unlocks",
    html: layout(`
      <h2 style="margin:0 0 16px;color:#fff;font-size:22px;">Ready for more?</h2>
      <p style="color:${TEXT_COLOR};">You've been running Clap Cheeks on the Free tier for 2 weeks. Here's what you're missing:</p>
      <table cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;border-collapse:collapse;">
        <tr>
          <td style="padding:10px 16px;color:${MUTED};font-size:13px;font-weight:600;border-bottom:1px solid #27272a;">Feature</td>
          <td style="padding:10px 16px;color:${MUTED};font-size:13px;font-weight:600;border-bottom:1px solid #27272a;text-align:center;">Free</td>
          <td style="padding:10px 16px;color:${VIOLET};font-size:13px;font-weight:600;border-bottom:1px solid #27272a;text-align:center;">Pro</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;color:${TEXT_COLOR};border-bottom:1px solid #27272a;">Platforms</td>
          <td style="padding:10px 16px;color:${MUTED};text-align:center;border-bottom:1px solid #27272a;">Tinder only</td>
          <td style="padding:10px 16px;color:#fff;text-align:center;border-bottom:1px solid #27272a;">All platforms</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;color:${TEXT_COLOR};border-bottom:1px solid #27272a;">Daily swipes</td>
          <td style="padding:10px 16px;color:${MUTED};text-align:center;border-bottom:1px solid #27272a;">100</td>
          <td style="padding:10px 16px;color:#fff;text-align:center;border-bottom:1px solid #27272a;">600</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;color:${TEXT_COLOR};border-bottom:1px solid #27272a;">AI conversations</td>
          <td style="padding:10px 16px;color:${MUTED};text-align:center;border-bottom:1px solid #27272a;">5 / day</td>
          <td style="padding:10px 16px;color:#fff;text-align:center;border-bottom:1px solid #27272a;">Unlimited</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;color:${TEXT_COLOR};">Date suggestions</td>
          <td style="padding:10px 16px;color:${MUTED};text-align:center;">&mdash;</td>
          <td style="padding:10px 16px;color:#fff;text-align:center;">Calendar-aware</td>
        </tr>
      </table>
      <p style="color:${TEXT_COLOR};font-size:14px;margin:16px 0;"><strong style="color:#fff;">Pro users get 3.4x more matches</strong> on average compared to Free.</p>
      ${button('Upgrade to Pro', PRICING_URL)}
    `),
  }
}
