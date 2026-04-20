export type DateStatus = 'idea' | 'planned' | 'confirmed' | 'completed' | 'cancelled'
export type ExpenseCategory = 'food' | 'drinks' | 'activity' | 'transport' | 'gifts' | 'other'
export type IdeaCategory = 'adventure' | 'food' | 'creative' | 'nightlife' | 'outdoors' | 'cultural' | 'chill' | 'surprise'
export type LocationType = 'indoor' | 'outdoor' | 'both'
export type DateVibe = 'first_date' | 'casual' | 'romantic' | 'adventurous'

export interface DateRecord {
  id: string
  user_id: string
  match_id: string | null
  match_name: string | null
  title: string
  description: string | null
  venue_name: string | null
  venue_address: string | null
  venue_url: string | null
  scheduled_at: string | null
  status: DateStatus
  rating: number | null
  notes: string | null
  went_well: string[] | null
  improve: string[] | null
  estimated_cost: number | null
  actual_cost: number | null
  google_calendar_event_id: string | null
  calendar_synced: boolean
  tags: string[] | null
  created_at: string
  updated_at: string
}

export interface DateExpense {
  id: string
  date_id: string
  user_id: string
  category: ExpenseCategory
  description: string | null
  amount: number
  created_at: string
}

export interface DateIdea {
  id: string
  user_id: string
  title: string
  description: string | null
  category: IdeaCategory
  estimated_cost_range: string | null
  duration_minutes: number | null
  best_for: string[] | null
  location_type: LocationType | null
  saved: boolean
  ai_generated: boolean
  created_at: string
}

export interface BudgetSummary {
  totalSpent: number
  totalEstimated: number
  dateCount: number
  averagePerDate: number
  byCategory: Record<ExpenseCategory, number>
  monthlyTrend: { month: string; amount: number }[]
}

export interface DateFormData {
  title: string
  description?: string
  match_name?: string
  venue_name?: string
  venue_address?: string
  scheduled_at?: string
  estimated_cost?: number
  tags?: string[]
}

export interface PostDateFormData {
  rating: number
  notes?: string
  went_well?: string[]
  improve?: string[]
  actual_cost?: number
  expenses?: { category: ExpenseCategory; description?: string; amount: number }[]
}
