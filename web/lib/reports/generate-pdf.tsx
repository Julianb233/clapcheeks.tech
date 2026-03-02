import React from 'react'
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
  renderToBuffer,
} from '@react-pdf/renderer'

export interface ReportData {
  weekStart: string
  weekEnd: string
  rizzScore: number
  rizzScoreChange: number
  stats: {
    swipes: number
    swipesChange: number
    matches: number
    matchesChange: number
    dates: number
    datesChange: number
    messages: number
    messagesChange: number
  }
  platforms: Array<{
    name: string
    swipes: number
    matches: number
    matchRate: number
  }>
  funnel: {
    swipesToMatches: number
    matchesToConvos: number
    convosToDates: number
  }
  coachingTips: string[]
}

const colors = {
  bg: '#0a0a0a',
  card: '#1a1a1a',
  text: '#ffffff',
  textSecondary: '#999999',
  brand: '#c026d3',
  brandLight: '#e879f9',
  positive: '#4ade80',
  negative: '#f87171',
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.bg,
    padding: 40,
    fontFamily: 'Helvetica',
    color: colors.text,
  },
  header: {
    marginBottom: 30,
    borderBottomWidth: 2,
    borderBottomColor: colors.brand,
    paddingBottom: 15,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.brand,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  section: {
    marginBottom: 20,
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 10,
    color: colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 1.5,
    marginBottom: 12,
    fontWeight: 'bold',
  },
  rizzScore: {
    fontSize: 48,
    fontWeight: 'bold',
    color: colors.brandLight,
    textAlign: 'center' as const,
  },
  rizzLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center' as const,
    marginTop: 4,
  },
  statsGrid: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
  },
  statBox: {
    flex: 1,
    alignItems: 'center' as const,
    padding: 8,
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
  },
  statLabel: {
    fontSize: 9,
    color: colors.textSecondary,
    marginTop: 2,
  },
  statChange: {
    fontSize: 9,
    marginTop: 2,
  },
  platformRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#ffffff10',
  },
  platformName: {
    fontSize: 12,
    color: colors.text,
    width: '30%',
    textTransform: 'capitalize' as const,
  },
  platformStat: {
    fontSize: 11,
    color: colors.textSecondary,
    width: '23%',
    textAlign: 'right' as const,
  },
  platformRate: {
    fontSize: 11,
    color: colors.brandLight,
    width: '23%',
    textAlign: 'right' as const,
  },
  funnelRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 5,
  },
  funnelLabel: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  funnelValue: {
    fontSize: 11,
    fontWeight: 'bold',
    color: colors.brandLight,
  },
  tipText: {
    fontSize: 11,
    color: colors.text,
    marginBottom: 6,
    lineHeight: 1.5,
  },
  footer: {
    position: 'absolute' as const,
    bottom: 30,
    left: 40,
    right: 40,
    textAlign: 'center' as const,
    fontSize: 9,
    color: colors.textSecondary,
  },
})

function formatChange(val: number): { text: string; color: string } {
  if (val > 0) return { text: `+${val}%`, color: colors.positive }
  if (val < 0) return { text: `${val}%`, color: colors.negative }
  return { text: '0%', color: colors.textSecondary }
}

function WeeklyReportDocument({ data }: { data: ReportData }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>CLAP CHEEKS WEEKLY REPORT</Text>
          <Text style={styles.headerSubtitle}>
            Week of {data.weekStart} - {data.weekEnd}
          </Text>
        </View>

        {/* Rizz Score */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Rizz Score</Text>
          <Text style={styles.rizzScore}>{data.rizzScore}/100</Text>
          <Text style={styles.rizzLabel}>
            {data.rizzScoreChange > 0 ? '+' : ''}
            {data.rizzScoreChange} from last week
          </Text>
        </View>

        {/* Stats Grid */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>This Week at a Glance</Text>
          <View style={styles.statsGrid}>
            {[
              { label: 'Swipes', value: data.stats.swipes, change: data.stats.swipesChange },
              { label: 'Matches', value: data.stats.matches, change: data.stats.matchesChange },
              { label: 'Dates', value: data.stats.dates, change: data.stats.datesChange },
              { label: 'Messages', value: data.stats.messages, change: data.stats.messagesChange },
            ].map((stat) => {
              const change = formatChange(stat.change)
              return (
                <View key={stat.label} style={styles.statBox}>
                  <Text style={styles.statValue}>{stat.value}</Text>
                  <Text style={styles.statLabel}>{stat.label}</Text>
                  <Text style={[styles.statChange, { color: change.color }]}>
                    {change.text}
                  </Text>
                </View>
              )
            })}
          </View>
        </View>

        {/* Platform Breakdown */}
        {data.platforms.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Platform Breakdown</Text>
            {data.platforms.map((p) => (
              <View key={p.name} style={styles.platformRow}>
                <Text style={styles.platformName}>{p.name}</Text>
                <Text style={styles.platformStat}>{p.swipes} swipes</Text>
                <Text style={styles.platformStat}>{p.matches} matches</Text>
                <Text style={styles.platformRate}>{p.matchRate.toFixed(1)}%</Text>
              </View>
            ))}
          </View>
        )}

        {/* Conversion Funnel */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Conversion Funnel</Text>
          {[
            { label: 'Swipes -> Matches', value: data.funnel.swipesToMatches },
            { label: 'Matches -> Convos', value: data.funnel.matchesToConvos },
            { label: 'Convos -> Dates', value: data.funnel.convosToDates },
          ].map((row) => (
            <View key={row.label} style={styles.funnelRow}>
              <Text style={styles.funnelLabel}>{row.label}</Text>
              <Text style={styles.funnelValue}>{row.value.toFixed(1)}%</Text>
            </View>
          ))}
        </View>

        {/* AI Coaching Tips */}
        {data.coachingTips.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>AI Coach Says</Text>
            {data.coachingTips.map((tip, i) => (
              <Text key={i} style={styles.tipText}>
                {i + 1}. {tip}
              </Text>
            ))}
          </View>
        )}

        {/* Footer */}
        <Text style={styles.footer}>
          clapcheeks.tech | Unsubscribe in your dashboard settings
        </Text>
      </Page>
    </Document>
  )
}

export async function renderReportPdf(data: ReportData): Promise<Buffer> {
  return renderToBuffer(<WeeklyReportDocument data={data} />)
}
