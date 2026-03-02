import { useEffect, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'

interface PlatformStatus {
  name: string
  status: 'active' | 'idle' | 'paused'
  icon: string
}

interface DayStats {
  swipes: number
  matches: number
  conversations: number
  dates: number
}

export default function DashboardScreen() {
  const [stats, setStats] = useState<DayStats>({ swipes: 0, matches: 0, conversations: 0, dates: 0 })
  const [platforms, setPlatforms] = useState<PlatformStatus[]>([
    { name: 'Tinder', status: 'idle', icon: 'flame' },
    { name: 'Hinge', status: 'idle', icon: 'heart-circle' },
    { name: 'Bumble', status: 'idle', icon: 'bee' },
  ])
  const [agentOnline, setAgentOnline] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  async function fetchStats() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase
      .from('daily_stats')
      .select('*')
      .eq('user_id', user.id)
      .eq('date', today)
      .single()

    if (data) {
      setStats({
        swipes: data.swipes || 0,
        matches: data.matches || 0,
        conversations: data.conversations || 0,
        dates: data.dates || 0,
      })
    }

    const { data: platformData } = await supabase
      .from('platform_connections')
      .select('platform, status')
      .eq('user_id', user.id)

    if (platformData) {
      setPlatforms(platformData.map((p: any) => ({
        name: p.platform,
        status: p.status,
        icon: p.platform === 'Tinder' ? 'flame' : p.platform === 'Hinge' ? 'heart-circle' : 'happy',
      })))
    }
  }

  async function onRefresh() {
    setRefreshing(true)
    await fetchStats()
    setRefreshing(false)
  }

  useEffect(() => {
    fetchStats()
  }, [])

  const statusColors: Record<string, string> = {
    active: '#22c55e',
    idle: '#D4AF37',
    paused: '#666',
  }

  const statCards: { label: string; value: number; icon: keyof typeof Ionicons.glyphMap }[] = [
    { label: 'Swipes', value: stats.swipes, icon: 'swap-horizontal' },
    { label: 'Matches', value: stats.matches, icon: 'heart' },
    { label: 'Convos', value: stats.conversations, icon: 'chatbubbles' },
    { label: 'Dates', value: stats.dates, icon: 'calendar' },
  ]

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Dashboard</Text>
          <View style={[styles.agentBadge, agentOnline && styles.agentOnline]}>
            <View style={[styles.agentDot, { backgroundColor: agentOnline ? '#22c55e' : '#666' }]} />
            <Text style={styles.agentText}>{agentOnline ? 'Agent Online' : 'Agent Offline'}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Today's Stats</Text>
        <View style={styles.statsGrid}>
          {statCards.map((card) => (
            <View key={card.label} style={styles.statCard}>
              <Ionicons name={card.icon} size={24} color="#8B5CF6" />
              <Text style={styles.statValue}>{card.value}</Text>
              <Text style={styles.statLabel}>{card.label}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Platforms</Text>
        {platforms.map((platform) => (
          <View key={platform.name} style={styles.platformRow}>
            <View style={styles.platformInfo}>
              <Ionicons name={platform.icon as any} size={24} color="#F5F5F5" />
              <Text style={styles.platformName}>{platform.name}</Text>
              <View style={[styles.statusBadge, { backgroundColor: statusColors[platform.status] + '22' }]}>
                <Text style={[styles.statusText, { color: statusColors[platform.status] }]}>
                  {platform.status.toUpperCase()}
                </Text>
              </View>
            </View>
            <TouchableOpacity style={styles.runButton}>
              <Text style={styles.runButtonText}>Run Session</Text>
            </TouchableOpacity>
          </View>
        ))}
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#F5F5F5',
  },
  agentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  agentOnline: {
    backgroundColor: '#22c55e11',
  },
  agentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  agentText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F5F5F5',
    marginBottom: 12,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 32,
  },
  statCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 16,
    width: '47%',
    alignItems: 'center',
    gap: 8,
  },
  statValue: {
    fontSize: 32,
    fontWeight: '800',
    color: '#F5F5F5',
  },
  statLabel: {
    fontSize: 13,
    color: '#888',
    fontWeight: '600',
  },
  platformRow: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  platformInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  platformName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F5F5F5',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
  },
  runButton: {
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  runButtonText: {
    color: '#F5F5F5',
    fontSize: 13,
    fontWeight: '700',
  },
})
