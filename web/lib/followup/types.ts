export type FollowupConfig = {
  id: string
  user_id: string
  enabled: boolean
  delays_hours: number[]
  max_followups: number
  app_to_text_enabled: boolean
  warmth_threshold: number
  min_messages_before_transition: number
  optimal_send_start_hour: number
  optimal_send_end_hour: number
  quiet_hours_start: number
  quiet_hours_end: number
  timezone: string
  created_at: string
  updated_at: string
}

export type ScheduledMessageRow = {
  id: string
  user_id: string
  match_id: string | null
  match_name: string
  platform: string
  phone: string | null
  message_text: string
  scheduled_at: string
  status: 'pending' | 'approved' | 'rejected' | 'sent' | 'failed'
  sequence_type: 'follow_up' | 'manual' | 'app_to_text'
  sequence_step: number | null
  delay_hours: number | null
  rejection_reason: string | null
  sent_at: string | null
  god_draft_id: string | null
  created_at: string
  updated_at: string
}

export const DEFAULT_FOLLOWUP_CONFIG: Omit<
  FollowupConfig,
  'id' | 'user_id' | 'created_at' | 'updated_at'
> = {
  enabled: true,
  delays_hours: [24, 72, 168],
  max_followups: 3,
  app_to_text_enabled: true,
  warmth_threshold: 0.7,
  min_messages_before_transition: 12,
  optimal_send_start_hour: 18,
  optimal_send_end_hour: 21,
  quiet_hours_start: 23,
  quiet_hours_end: 8,
  timezone: 'America/Los_Angeles',
}
