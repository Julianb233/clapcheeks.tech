import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { supabase } from './supabase'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
})

export async function registerForPushNotifications(): Promise<string | null> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync()
  let finalStatus = existingStatus

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }

  if (finalStatus !== 'granted') {
    return null
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    })
  }

  const token = (await Notifications.getExpoPushTokenAsync()).data

  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    await supabase
      .from('user_devices')
      .upsert({ user_id: user.id, push_token: token, platform: Platform.OS })
  }

  return token
}

export async function handleMatchNotification(platform: string, matchName: string) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'New Match!',
      body: `New match on ${platform}: ${matchName}!`,
      sound: true,
    },
    trigger: null,
  })
}

export async function handleDateBookedNotification(matchName: string, dateTime: string) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Date Booked!',
      body: `Date booked with ${matchName} on ${dateTime}`,
      sound: true,
    },
    trigger: null,
  })
}
