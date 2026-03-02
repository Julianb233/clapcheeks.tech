import { useEffect, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'

interface FunnelStage {
  label: string
  count: number
  color: string
}

export default function IntelligenceScreen() {
  const [openerRate, setOpenerRate] = useState(0)
  const [topOpener, setTopOpener] = useState('Loading...')
  const [funnel, setFunnel] = useState<FunnelStage[]>([
    { label: 'Matched', count: 0, color: '#8B5CF6' },
    { label: 'Opened', count: 0, color: '#a78bfa' },
    { label: 'Replied', count: 0, color: '#22c55e' },
    { label: 'Number', count: 0, color: '#3b82f6' },
    { label: 'Date Set', count: 0, color: '#D4AF37' },
  ])
  const [refreshing, setRefreshing] = useState(false)

  async function fetchIntelligence() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: analytics } = await supabase
      .from('conversation_analytics')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (analytics) {
      setOpenerRate(analytics.opener_reply_rate || 0)
      setTopOpener(analytics.top_opener || 'No data yet')
      setFunnel([
        { label: 'Matched', count: analytics.total_matches || 0, color: '#8B5CF6' },
        { label: 'Opened', count: analytics.total_opened || 0, color: '#a78bfa' },
        { label: 'Replied', count: analytics.total_replied || 0, color: '#22c55e' },
        { label: 'Number', count: analytics.total_numbers || 0, color: '#3b82f6' },
        { label: 'Date Set', count: analytics.total_dates || 0, color: '#D4AF37' },
      ])
    }
  }

  async function onRefresh() {
    setRefreshing(true)
    await fetchIntelligence()
    setRefreshing(false)
  }

  useEffect(() => {
    fetchIntelligence()
  }, [])

  const maxFunnelCount = Math.max(...funnel.map((s) => s.count), 1)

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />}
      >
        <Text style={styles.title}>Intelligence</Text>

        <View style={styles.rateCard}>
          <Text style={styles.rateLabel}>Opener Reply Rate</Text>
          <Text style={styles.rateValue}>{openerRate}%</Text>
          <View style={styles.rateBar}>
            <View style={[styles.rateBarFill, { width: `${Math.min(openerRate, 100)}%` }]} />
          </View>
        </View>

        <Text style={styles.sectionTitle}>Conversion Funnel</Text>
        <View style={styles.funnelCard}>
          {funnel.map((stage) => (
            <View key={stage.label} style={styles.funnelRow}>
              <Text style={styles.funnelLabel}>{stage.label}</Text>
              <View style={styles.funnelBarContainer}>
                <View
                  style={[
                    styles.funnelBar,
                    {
                      width: `${(stage.count / maxFunnelCount) * 100}%`,
                      backgroundColor: stage.color,
                    },
                  ]}
                />
              </View>
              <Text style={styles.funnelCount}>{stage.count}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Top Performer This Week</Text>
        <View style={styles.openerCard}>
          <Ionicons name="trophy" size={24} color="#D4AF37" />
          <Text style={styles.openerText}>{topOpener}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  scroll: {
    flex: 1,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#F5F5F5',
    marginTop: 16,
    marginBottom: 24,
  },
  rateCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 32,
  },
  rateLabel: {
    fontSize: 14,
    color: '#888',
    fontWeight: '600',
    marginBottom: 8,
  },
  rateValue: {
    fontSize: 56,
    fontWeight: '800',
    color: '#8B5CF6',
    marginBottom: 16,
  },
  rateBar: {
    width: '100%',
    height: 8,
    backgroundColor: '#2a2a3e',
    borderRadius: 4,
    overflow: 'hidden',
  },
  rateBarFill: {
    height: '100%',
    backgroundColor: '#8B5CF6',
    borderRadius: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F5F5F5',
    marginBottom: 12,
  },
  funnelCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 20,
    marginBottom: 32,
    gap: 16,
  },
  funnelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  funnelLabel: {
    width: 70,
    fontSize: 13,
    color: '#888',
    fontWeight: '600',
  },
  funnelBarContainer: {
    flex: 1,
    height: 24,
    backgroundColor: '#2a2a3e',
    borderRadius: 6,
    overflow: 'hidden',
  },
  funnelBar: {
    height: '100%',
    borderRadius: 6,
    minWidth: 4,
  },
  funnelCount: {
    width: 40,
    fontSize: 14,
    fontWeight: '700',
    color: '#F5F5F5',
    textAlign: 'right',
  },
  openerCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 32,
  },
  openerText: {
    flex: 1,
    fontSize: 15,
    color: '#F5F5F5',
    fontWeight: '600',
    fontStyle: 'italic',
    lineHeight: 22,
  },
})
