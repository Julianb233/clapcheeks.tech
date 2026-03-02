import { useEffect, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'

interface Match {
  id: string
  name: string
  platform: string
  stage: string
  last_message: string
  is_cold: boolean
  matched_at: string
}

const platformIcons: Record<string, string> = {
  Tinder: 'flame',
  Hinge: 'heart-circle',
  Bumble: 'happy',
}

const stageColors: Record<string, string> = {
  opener: '#8B5CF6',
  hooked: '#22c55e',
  number: '#3b82f6',
  date_set: '#D4AF37',
  cold: '#f59e0b',
  dead: '#666',
}

export default function MatchesScreen() {
  const [matches, setMatches] = useState<Match[]>([])
  const [refreshing, setRefreshing] = useState(false)

  async function fetchMatches() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data } = await supabase
      .from('matches')
      .select('*')
      .eq('user_id', user.id)
      .order('matched_at', { ascending: false })
      .limit(50)

    if (data) setMatches(data)
  }

  async function onRefresh() {
    setRefreshing(true)
    await fetchMatches()
    setRefreshing(false)
  }

  useEffect(() => {
    fetchMatches()
  }, [])

  function renderMatch({ item }: { item: Match }) {
    return (
      <View style={[styles.matchCard, item.is_cold && styles.coldMatch]}>
        <View style={styles.matchHeader}>
          <View style={styles.matchInfo}>
            <Ionicons
              name={(platformIcons[item.platform] || 'person') as any}
              size={20}
              color="#F5F5F5"
            />
            <Text style={styles.matchName}>{item.name}</Text>
          </View>
          <View style={[styles.stageBadge, { backgroundColor: (stageColors[item.stage] || '#666') + '22' }]}>
            <Text style={[styles.stageText, { color: stageColors[item.stage] || '#666' }]}>
              {item.stage.replace('_', ' ').toUpperCase()}
            </Text>
          </View>
        </View>

        {item.last_message && (
          <Text style={styles.lastMessage} numberOfLines={2}>
            {item.last_message}
          </Text>
        )}

        {item.is_cold && (
          <TouchableOpacity style={styles.reengageButton}>
            <Ionicons name="refresh" size={16} color="#D4AF37" />
            <Text style={styles.reengageText}>Re-engage</Text>
          </TouchableOpacity>
        )}
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Matches</Text>
        <Text style={styles.count}>{matches.length} total</Text>
      </View>

      <FlatList
        data={matches}
        keyExtractor={(item) => item.id}
        renderItem={renderMatch}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="heart-outline" size={48} color="#333" />
            <Text style={styles.emptyText}>No matches yet</Text>
            <Text style={styles.emptySubtext}>Start a session to begin swiping</Text>
          </View>
        }
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginTop: 16,
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#F5F5F5',
  },
  count: {
    fontSize: 14,
    color: '#888',
    fontWeight: '600',
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  matchCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  coldMatch: {
    borderWidth: 1,
    borderColor: '#f59e0b44',
  },
  matchHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  matchInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  matchName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F5F5F5',
  },
  stageBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  stageText: {
    fontSize: 10,
    fontWeight: '700',
  },
  lastMessage: {
    fontSize: 13,
    color: '#888',
    marginTop: 4,
    lineHeight: 18,
  },
  reengageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    alignSelf: 'flex-start',
    backgroundColor: '#D4AF3722',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  reengageText: {
    color: '#D4AF37',
    fontSize: 13,
    fontWeight: '700',
  },
  empty: {
    alignItems: 'center',
    marginTop: 80,
    gap: 12,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#444',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#333',
  },
})
