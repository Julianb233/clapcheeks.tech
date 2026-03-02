import { useEffect, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Share,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'

interface PlatformToggle {
  name: string
  enabled: boolean
}

export default function SettingsScreen() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [tier, setTier] = useState('free')
  const [referralCode, setReferralCode] = useState('')
  const [platforms, setPlatforms] = useState<PlatformToggle[]>([
    { name: 'Tinder', enabled: true },
    { name: 'Hinge', enabled: true },
    { name: 'Bumble', enabled: false },
  ])
  const [notifications, setNotifications] = useState({
    matches: true,
    dates: true,
    coldAlerts: true,
  })

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setEmail(user.email || '')

        const { data: profile } = await supabase
          .from('profiles')
          .select('subscription_tier, referral_code')
          .eq('id', user.id)
          .single()

        if (profile) {
          setTier(profile.subscription_tier || 'free')
          setReferralCode(profile.referral_code || '')
        }
      }
    }
    loadProfile()
  }, [])

  async function handleSignOut() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await supabase.auth.signOut()
        },
      },
    ])
  }

  async function shareReferral() {
    await Share.share({
      message: `Join Clap Cheeks and level up your dating game! Use my referral code: ${referralCode}\n\nhttps://clapcheeks.tech/signup?ref=${referralCode}`,
    })
  }

  function togglePlatform(index: number) {
    const updated = [...platforms]
    updated[index].enabled = !updated[index].enabled
    setPlatforms(updated)
  }

  const tierColors: Record<string, string> = {
    free: '#666',
    pro: '#8B5CF6',
    elite: '#D4AF37',
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scroll}>
        <Text style={styles.title}>Settings</Text>

        {/* Account */}
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Email</Text>
            <Text style={styles.value}>{email}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.label}>Subscription</Text>
            <View style={[styles.tierBadge, { backgroundColor: (tierColors[tier] || '#666') + '22' }]}>
              <Text style={[styles.tierText, { color: tierColors[tier] || '#666' }]}>
                {tier.toUpperCase()}
              </Text>
            </View>
          </View>
        </View>

        {/* Platforms */}
        <Text style={styles.sectionTitle}>Platforms</Text>
        <View style={styles.card}>
          {platforms.map((platform, index) => (
            <View key={platform.name}>
              {index > 0 && <View style={styles.divider} />}
              <View style={styles.row}>
                <Text style={styles.label}>{platform.name}</Text>
                <Switch
                  value={platform.enabled}
                  onValueChange={() => togglePlatform(index)}
                  trackColor={{ false: '#2a2a3e', true: '#8B5CF644' }}
                  thumbColor={platform.enabled ? '#8B5CF6' : '#666'}
                />
              </View>
            </View>
          ))}
        </View>

        {/* Notifications */}
        <Text style={styles.sectionTitle}>Notifications</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>New Matches</Text>
            <Switch
              value={notifications.matches}
              onValueChange={(v) => setNotifications((n) => ({ ...n, matches: v }))}
              trackColor={{ false: '#2a2a3e', true: '#8B5CF644' }}
              thumbColor={notifications.matches ? '#8B5CF6' : '#666'}
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.label}>Date Booked</Text>
            <Switch
              value={notifications.dates}
              onValueChange={(v) => setNotifications((n) => ({ ...n, dates: v }))}
              trackColor={{ false: '#2a2a3e', true: '#8B5CF644' }}
              thumbColor={notifications.dates ? '#8B5CF6' : '#666'}
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.label}>Cold Match Alerts</Text>
            <Switch
              value={notifications.coldAlerts}
              onValueChange={(v) => setNotifications((n) => ({ ...n, coldAlerts: v }))}
              trackColor={{ false: '#2a2a3e', true: '#8B5CF644' }}
              thumbColor={notifications.coldAlerts ? '#8B5CF6' : '#666'}
            />
          </View>
        </View>

        {/* Referral */}
        {referralCode && (
          <>
            <Text style={styles.sectionTitle}>Referral</Text>
            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.label}>Your Code</Text>
                <Text style={styles.referralCode}>{referralCode}</Text>
              </View>
              <View style={styles.divider} />
              <TouchableOpacity style={styles.shareButton} onPress={shareReferral}>
                <Ionicons name="share-outline" size={18} color="#8B5CF6" />
                <Text style={styles.shareText}>Share Referral Link</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Sign Out */}
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <Ionicons name="log-out-outline" size={20} color="#ef4444" />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
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
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 8,
  },
  card: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  divider: {
    height: 1,
    backgroundColor: '#2a2a3e',
    marginHorizontal: 16,
  },
  label: {
    fontSize: 15,
    color: '#F5F5F5',
    fontWeight: '500',
  },
  value: {
    fontSize: 15,
    color: '#888',
  },
  tierBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  tierText: {
    fontSize: 12,
    fontWeight: '800',
  },
  referralCode: {
    fontSize: 16,
    fontWeight: '700',
    color: '#D4AF37',
    fontFamily: 'monospace',
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  shareText: {
    color: '#8B5CF6',
    fontSize: 15,
    fontWeight: '700',
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    paddingVertical: 16,
    marginTop: 8,
    marginBottom: 40,
  },
  signOutText: {
    color: '#ef4444',
    fontSize: 16,
    fontWeight: '700',
  },
})
