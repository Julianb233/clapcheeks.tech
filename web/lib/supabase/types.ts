export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string | null
          full_name: string | null
          avatar_url: string | null
          // Subscription fields
          subscription_tier: string | null
          subscription_status: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          plan: string | null
          // Onboarding fields
          onboarding_completed: boolean | null
          profile_completed: boolean | null
          selected_mode: string | null
          selected_platforms: string[] | null
          // Stats
          rizz_score: number | null
          total_matches: number | null
          dates_booked: number | null
          total_spend: number | null
          // Referral fields
          referral_code: string | null
          ref_code: string | null
          referred_by: string | null
          free_months_earned: number | null
          referral_credits: number | null
          // Timestamps
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email?: string | null
          full_name?: string | null
          avatar_url?: string | null
          subscription_tier?: string | null
          subscription_status?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          plan?: string | null
          onboarding_completed?: boolean | null
          profile_completed?: boolean | null
          selected_mode?: string | null
          selected_platforms?: string[] | null
          rizz_score?: number | null
          total_matches?: number | null
          dates_booked?: number | null
          total_spend?: number | null
          referral_code?: string | null
          ref_code?: string | null
          referred_by?: string | null
          free_months_earned?: number | null
          referral_credits?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string | null
          full_name?: string | null
          avatar_url?: string | null
          subscription_tier?: string | null
          subscription_status?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          plan?: string | null
          onboarding_completed?: boolean | null
          profile_completed?: boolean | null
          selected_mode?: string | null
          selected_platforms?: string[] | null
          rizz_score?: number | null
          total_matches?: number | null
          dates_booked?: number | null
          total_spend?: number | null
          referral_code?: string | null
          ref_code?: string | null
          referred_by?: string | null
          free_months_earned?: number | null
          referral_credits?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          id: string
          user_id: string
          device_name: string
          platform: string
          agent_version: string | null
          last_seen_at: string
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          device_name: string
          platform: string
          agent_version?: string | null
          last_seen_at?: string
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          device_name?: string
          platform?: string
          agent_version?: string | null
          last_seen_at?: string
          is_active?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "devices_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_daily: {
        Row: {
          id: string
          user_id: string
          date: string
          swipes_right: number
          swipes_left: number
          matches: number
          conversations_started: number
          dates_booked: number
          money_spent: number
          app: "tinder" | "bumble" | "hinge"
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          date: string
          swipes_right?: number
          swipes_left?: number
          matches?: number
          conversations_started?: number
          dates_booked?: number
          money_spent?: number
          app: "tinder" | "bumble" | "hinge"
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          date?: string
          swipes_right?: number
          swipes_left?: number
          matches?: number
          conversations_started?: number
          dates_booked?: number
          money_spent?: number
          app?: "tinder" | "bumble" | "hinge"
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_daily_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_suggestions: {
        Row: {
          id: string
          user_id: string
          suggestion_text: string
          category: string
          was_helpful: boolean | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          suggestion_text: string
          category: string
          was_helpful?: boolean | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          suggestion_text?: string
          category?: string
          was_helpful?: boolean | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_suggestions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clapcheeks_subscriptions: {
        Row: {
          id: string
          user_id: string
          stripe_subscription_id: string | null
          plan: "starter" | "pro" | "elite"
          status: string
          current_period_start: string | null
          current_period_end: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          stripe_subscription_id?: string | null
          plan: "starter" | "pro" | "elite"
          status?: string
          current_period_start?: string | null
          current_period_end?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          stripe_subscription_id?: string | null
          plan?: "starter" | "pro" | "elite"
          status?: string
          current_period_start?: string | null
          current_period_end?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clapcheeks_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clapcheeks_usage_daily: {
        Row: {
          id: string
          user_id: string
          date: string
          swipes_used: number
          coaching_calls_used: number
          ai_replies_used: number
        }
        Insert: {
          id?: string
          user_id: string
          date?: string
          swipes_used?: number
          coaching_calls_used?: number
          ai_replies_used?: number
        }
        Update: {
          id?: string
          user_id?: string
          date?: string
          swipes_used?: number
          coaching_calls_used?: number
          ai_replies_used?: number
        }
        Relationships: [
          {
            foreignKeyName: "clapcheeks_usage_daily_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clapcheeks_coaching_sessions: {
        Row: {
          id: string
          user_id: string
          generated_at: string
          week_start: string
          tips: Json
          stats_snapshot: Json | null
          feedback_score: number | null
          model_used: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          generated_at?: string
          week_start: string
          tips: Json
          stats_snapshot?: Json | null
          feedback_score?: number | null
          model_used?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          generated_at?: string
          week_start?: string
          tips?: Json
          stats_snapshot?: Json | null
          feedback_score?: number | null
          model_used?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clapcheeks_coaching_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clapcheeks_tip_feedback: {
        Row: {
          id: string
          user_id: string
          coaching_session_id: string
          tip_index: number
          helpful: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          coaching_session_id: string
          tip_index: number
          helpful: boolean
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          coaching_session_id?: string
          tip_index?: number
          helpful?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clapcheeks_tip_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clapcheeks_tip_feedback_coaching_session_id_fkey"
            columns: ["coaching_session_id"]
            isOneToOne: false
            referencedRelation: "clapcheeks_coaching_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      clapcheeks_conversation_stats: {
        Row: {
          id: string
          user_id: string
          date: string
          platform: string
          messages_sent: number
          messages_received: number
          conversations_started: number
          conversations_replied: number
          conversations_ghosted: number
          avg_response_time_mins: number | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          date: string
          platform: string
          messages_sent?: number
          messages_received?: number
          conversations_started?: number
          conversations_replied?: number
          conversations_ghosted?: number
          avg_response_time_mins?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          date?: string
          platform?: string
          messages_sent?: number
          messages_received?: number
          conversations_started?: number
          conversations_replied?: number
          conversations_ghosted?: number
          avg_response_time_mins?: number | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clapcheeks_conversation_stats_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clapcheeks_spending: {
        Row: {
          id: string
          user_id: string
          date: string
          platform: string | null
          category: string
          amount: number
          description: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          date: string
          platform?: string | null
          category: string
          amount: number
          description?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          date?: string
          platform?: string | null
          category?: string
          amount?: number
          description?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clapcheeks_spending_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clapcheeks_voice_profiles: {
        Row: {
          id: string
          user_id: string
          style_summary: string | null
          sample_phrases: Json
          tone: string
          profile_data: Json
          messages_analyzed: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          style_summary?: string | null
          sample_phrases?: Json
          tone?: string
          profile_data?: Json
          messages_analyzed?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          style_summary?: string | null
          sample_phrases?: Json
          tone?: string
          profile_data?: Json
          messages_analyzed?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clapcheeks_voice_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clapcheeks_reply_suggestions: {
        Row: {
          id: string
          user_id: string
          conversation_context: string
          suggestions: Json
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          conversation_context: string
          suggestions: Json
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          conversation_context?: string
          suggestions?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clapcheeks_reply_suggestions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clapcheeks_weekly_reports: {
        Row: {
          id: string
          user_id: string
          week_start: string
          week_end: string
          metrics_snapshot: Json
          pdf_url: string | null
          sent_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          week_start: string
          week_end: string
          metrics_snapshot?: Json
          pdf_url?: string | null
          sent_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          week_start?: string
          week_end?: string
          metrics_snapshot?: Json
          pdf_url?: string | null
          sent_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clapcheeks_weekly_reports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clapcheeks_report_preferences: {
        Row: {
          id: string
          user_id: string
          email_enabled: boolean
          send_day: string
          send_hour: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          email_enabled?: boolean
          send_day?: string
          send_hour?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          email_enabled?: boolean
          send_day?: string
          send_hour?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clapcheeks_report_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clapcheeks_referrals: {
        Row: {
          id: string
          referrer_id: string
          referred_id: string | null
          referral_code: string | null
          status: string
          converted_at: string | null
          credited_at: string | null
          rewarded_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          referrer_id: string
          referred_id?: string | null
          referral_code?: string | null
          status?: string
          converted_at?: string | null
          credited_at?: string | null
          rewarded_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          referrer_id?: string
          referred_id?: string | null
          referral_code?: string | null
          status?: string
          converted_at?: string | null
          credited_at?: string | null
          rewarded_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clapcheeks_referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clapcheeks_queued_replies: {
        Row: {
          id: string
          user_id: string
          match_name: string | null
          platform: string | null
          text: string
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          match_name?: string | null
          platform?: string | null
          text: string
          status?: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          match_name?: string | null
          platform?: string | null
          text?: string
          status?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clapcheeks_queued_replies_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clapcheeks_affiliate_applications: {
        Row: {
          id: string
          name: string
          email: string
          platform: string
          audience_size: string | null
          message: string | null
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          email: string
          platform: string
          audience_size?: string | null
          message?: string | null
          status?: string
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          email?: string
          platform?: string
          audience_size?: string | null
          message?: string | null
          status?: string
          created_at?: string
        }
        Relationships: []
      }
      stripe_events: {
        Row: {
          event_id: string
          event_type: string
          processed_at: string
        }
        Insert: {
          event_id: string
          event_type: string
          processed_at?: string
        }
        Update: {
          event_id?: string
          event_type?: string
          processed_at?: string
        }
        Relationships: []
      }
      clapcheeks_agent_tokens: {
        Row: {
          id: string
          user_id: string | null
          token: string
          device_name: string | null
          created_at: string | null
          last_seen_at: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          token: string
          device_name?: string | null
          created_at?: string | null
          last_seen_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          token?: string
          device_name?: string | null
          created_at?: string | null
          last_seen_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clapcheeks_agent_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clapcheeks_analytics_daily: {
        Row: {
          id: string
          user_id: string | null
          date: string
          platform: string
          swipes_right: number
          swipes_left: number
          matches: number
          messages_sent: number
          dates_booked: number
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          date: string
          platform: string
          swipes_right?: number
          swipes_left?: number
          matches?: number
          messages_sent?: number
          dates_booked?: number
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          date?: string
          platform?: string
          swipes_right?: number
          swipes_left?: number
          matches?: number
          messages_sent?: number
          dates_booked?: number
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clapcheeks_analytics_daily_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clapcheeks_agent_events: {
        Row: {
          id: string
          user_id: string
          event_type: string
          data: Json | null
          occurred_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          event_type: string
          data?: Json | null
          occurred_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          event_type?: string
          data?: Json | null
          occurred_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clapcheeks_agent_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clapcheeks_photo_scores: {
        Row: {
          id: string
          user_id: string
          filename: string
          score: number
          face_score: number | null
          smile_score: number | null
          background_score: number | null
          lighting_score: number | null
          solo_score: number | null
          tips: Json | null
          scored_at: string
        }
        Insert: {
          id?: string
          user_id: string
          filename: string
          score: number
          face_score?: number | null
          smile_score?: number | null
          background_score?: number | null
          lighting_score?: number | null
          solo_score?: number | null
          tips?: Json | null
          scored_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          filename?: string
          score?: number
          face_score?: number | null
          smile_score?: number | null
          background_score?: number | null
          lighting_score?: number | null
          solo_score?: number | null
          tips?: Json | null
          scored_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clapcheeks_photo_scores_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clapcheeks_dates: {
        Row: {
          id: string
          user_id: string
          match_name: string | null
          platform: string | null
          location: string | null
          scheduled_at: string | null
          status: string
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          match_name?: string | null
          platform?: string | null
          location?: string | null
          scheduled_at?: string | null
          status?: string
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          match_name?: string | null
          platform?: string | null
          location?: string | null
          scheduled_at?: string | null
          status?: string
          notes?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clapcheeks_dates_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clapcheeks_conversations: {
        Row: {
          id: string
          user_id: string
          platform: string
          match_id: string
          match_name: string | null
          messages: Json
          stage: string
          last_message: string | null
          last_message_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          platform: string
          match_id: string
          match_name?: string | null
          messages?: Json
          stage?: string
          last_message?: string | null
          last_message_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          platform?: string
          match_id?: string
          match_name?: string | null
          messages?: Json
          stage?: string
          last_message?: string | null
          last_message_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clapcheeks_conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clapcheeks_device_codes: {
        Row: {
          code: string
          user_id: string | null
          created_at: string
          expires_at: string
          used: boolean
        }
        Insert: {
          code: string
          user_id?: string | null
          created_at?: string
          expires_at: string
          used?: boolean
        }
        Update: {
          code?: string
          user_id?: string | null
          created_at?: string
          expires_at?: string
          used?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "clapcheeks_device_codes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      increment_usage: {
        Args: {
          p_user_id: string
          p_field: string
          p_amount?: number
        }
        Returns: {
          swipes_used: number
          coaching_calls_used: number
          ai_replies_used: number
        }[]
      }
      increment_referral_credits: {
        Args: {
          p_user_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
  }
}

// Convenience type aliases
export type Profile = Database["public"]["Tables"]["profiles"]["Row"]
export type Device = Database["public"]["Tables"]["devices"]["Row"]
export type AnalyticsDaily = Database["public"]["Tables"]["analytics_daily"]["Row"]
export type AiSuggestion = Database["public"]["Tables"]["ai_suggestions"]["Row"]
export type Subscription = Database["public"]["Tables"]["clapcheeks_subscriptions"]["Row"]
export type UsageDaily = Database["public"]["Tables"]["clapcheeks_usage_daily"]["Row"]
export type CoachingSession = Database["public"]["Tables"]["clapcheeks_coaching_sessions"]["Row"]
export type ConversationStats = Database["public"]["Tables"]["clapcheeks_conversation_stats"]["Row"]
export type Spending = Database["public"]["Tables"]["clapcheeks_spending"]["Row"]
export type VoiceProfile = Database["public"]["Tables"]["clapcheeks_voice_profiles"]["Row"]
export type WeeklyReport = Database["public"]["Tables"]["clapcheeks_weekly_reports"]["Row"]
export type Referral = Database["public"]["Tables"]["clapcheeks_referrals"]["Row"]
export type QueuedReply = Database["public"]["Tables"]["clapcheeks_queued_replies"]["Row"]
export type ClapcheeksDate = Database["public"]["Tables"]["clapcheeks_dates"]["Row"]
export type Conversation = Database["public"]["Tables"]["clapcheeks_conversations"]["Row"]

export type AppName = "tinder" | "bumble" | "hinge"
export type PlanTier = "starter" | "pro" | "elite"
