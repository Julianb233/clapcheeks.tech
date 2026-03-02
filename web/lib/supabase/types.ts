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
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email?: string | null
          full_name?: string | null
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string | null
          full_name?: string | null
          avatar_url?: string | null
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
      subscriptions: {
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
            foreignKeyName: "subscriptions_user_id_fkey"
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
      [_ in never]: never
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
export type Subscription = Database["public"]["Tables"]["subscriptions"]["Row"]

export type AppName = "tinder" | "bumble" | "hinge"
export type PlanTier = "starter" | "pro" | "elite"
