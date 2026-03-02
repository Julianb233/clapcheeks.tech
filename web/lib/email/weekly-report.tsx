import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Button,
  Hr,
  Preview,
  render as reactEmailRender,
} from '@react-email/components'

interface WeeklyReportEmailProps {
  stats: {
    swipes: number
    swipesChange: number
    matches: number
    matchesChange: number
    messages: number
    messagesChange: number
    dates: number
    datesChange: number
  }
  aiTip: string
  dashboardUrl: string
  unsubscribeUrl: string
}

function trendArrow(change: number): string {
  if (change > 0) return `&#9650; +${change}%`
  if (change < 0) return `&#9660; ${change}%`
  return '&#8212; 0%'
}

function trendColor(change: number): string {
  if (change > 0) return '#4ade80'
  if (change < 0) return '#f87171'
  return '#999999'
}

export function WeeklyReportEmail({
  stats,
  aiTip,
  dashboardUrl,
  unsubscribeUrl,
}: WeeklyReportEmailProps) {
  const statItems = [
    { label: 'Swipes', value: stats.swipes, change: stats.swipesChange },
    { label: 'Matches', value: stats.matches, change: stats.matchesChange },
    { label: 'Conversations', value: stats.messages, change: stats.messagesChange },
    { label: 'Dates', value: stats.dates, change: stats.datesChange },
  ]

  return (
    <Html>
      <Head />
      <Preview>Swipes, matches, and your top tip this week</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          {/* Header */}
          <Section style={headerStyle}>
            <Text style={brandStyle}>CLAP CHEEKS</Text>
            <Text style={subtitleStyle}>Week in Review</Text>
          </Section>

          {/* Stats Grid - table for max email client compat */}
          <Section style={cardStyle}>
            <table
              width="100%"
              cellPadding="0"
              cellSpacing="0"
              role="presentation"
              style={{ borderCollapse: 'collapse' as const }}
            >
              <tbody>
                <tr>
                  {statItems.slice(0, 2).map((item) => (
                    <td key={item.label} style={statCellStyle}>
                      <Text style={statLabelStyle}>{item.label}</Text>
                      <Text style={statValueStyle}>{item.value.toLocaleString()}</Text>
                      <Text
                        style={{
                          ...trendStyle,
                          color: trendColor(item.change),
                        }}
                        dangerouslySetInnerHTML={{ __html: trendArrow(item.change) }}
                      />
                    </td>
                  ))}
                </tr>
                <tr>
                  {statItems.slice(2, 4).map((item) => (
                    <td key={item.label} style={statCellStyle}>
                      <Text style={statLabelStyle}>{item.label}</Text>
                      <Text style={statValueStyle}>{item.value.toLocaleString()}</Text>
                      <Text
                        style={{
                          ...trendStyle,
                          color: trendColor(item.change),
                        }}
                        dangerouslySetInnerHTML={{ __html: trendArrow(item.change) }}
                      />
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </Section>

          {/* AI Tip */}
          <Section style={tipCardStyle}>
            <Text style={tipLabelStyle}>Top Tip of the Week</Text>
            <Text style={tipTextStyle}>{aiTip}</Text>
          </Section>

          {/* CTA */}
          <Section style={{ textAlign: 'center' as const, padding: '20px 0' }}>
            <Button style={ctaButtonStyle} href={dashboardUrl}>
              View Full Analytics
            </Button>
          </Section>

          <Hr style={hrStyle} />

          {/* Footer */}
          <Section style={{ textAlign: 'center' as const, padding: '20px 0' }}>
            <Text style={footerTextStyle}>clapcheeks.tech</Text>
            <Text style={footerTextStyle}>
              <a href={unsubscribeUrl} style={unsubLinkStyle}>
                Unsubscribe
              </a>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default WeeklyReportEmail

export async function renderWeeklyReportEmail(
  props: WeeklyReportEmailProps
): Promise<string> {
  return reactEmailRender(<WeeklyReportEmail {...props} />)
}

/* ---------- Styles ---------- */

const bodyStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  backgroundColor: '#ffffff',
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
}

const containerStyle: React.CSSProperties = {
  maxWidth: '600px',
  margin: '0 auto',
  padding: '40px 20px',
  backgroundColor: '#ffffff',
}

const headerStyle: React.CSSProperties = {
  textAlign: 'center' as const,
  marginBottom: '24px',
}

const brandStyle: React.CSSProperties = {
  color: '#c026d3',
  fontSize: '24px',
  fontWeight: 700,
  margin: '0 0 4px 0',
  letterSpacing: '2px',
}

const subtitleStyle: React.CSSProperties = {
  color: '#666666',
  fontSize: '14px',
  margin: '0',
}

const cardStyle: React.CSSProperties = {
  backgroundColor: '#f9fafb',
  borderRadius: '12px',
  padding: '24px',
  marginBottom: '16px',
  border: '1px solid #e5e7eb',
}

const statCellStyle: React.CSSProperties = {
  width: '50%',
  textAlign: 'center' as const,
  padding: '12px 8px',
  verticalAlign: 'top' as const,
}

const statLabelStyle: React.CSSProperties = {
  color: '#6b7280',
  fontSize: '11px',
  textTransform: 'uppercase' as const,
  letterSpacing: '1px',
  margin: '0 0 4px 0',
}

const statValueStyle: React.CSSProperties = {
  color: '#111827',
  fontSize: '28px',
  fontWeight: 700,
  margin: '0 0 4px 0',
}

const trendStyle: React.CSSProperties = {
  fontSize: '12px',
  margin: '0',
}

const tipCardStyle: React.CSSProperties = {
  backgroundColor: '#fdf4ff',
  border: '1px solid #e879f9',
  borderRadius: '12px',
  padding: '20px 24px',
  marginBottom: '16px',
}

const tipLabelStyle: React.CSSProperties = {
  color: '#c026d3',
  fontSize: '12px',
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  letterSpacing: '1px',
  margin: '0 0 8px 0',
}

const tipTextStyle: React.CSSProperties = {
  color: '#374151',
  fontSize: '14px',
  lineHeight: '1.6',
  margin: '0',
}

const ctaButtonStyle: React.CSSProperties = {
  backgroundColor: '#c026d3',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: 600,
  padding: '12px 28px',
  borderRadius: '8px',
  textDecoration: 'none',
  display: 'inline-block',
}

const hrStyle: React.CSSProperties = {
  borderTop: '1px solid #e5e7eb',
  margin: '0',
}

const footerTextStyle: React.CSSProperties = {
  color: '#9ca3af',
  fontSize: '11px',
  margin: '4px 0',
}

const unsubLinkStyle: React.CSSProperties = {
  color: '#9ca3af',
  textDecoration: 'underline',
}
