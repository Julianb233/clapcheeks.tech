import type { SupabaseClient } from '@supabase/supabase-js'
import type { DateRecord, DateExpense, DateIdea, BudgetSummary, DateFormData, PostDateFormData, ExpenseCategory } from './types'

export async function getDates(supabase: SupabaseClient, userId: string, status?: string) {
  let query = supabase
    .from('clapcheeks_dates')
    .select('*')
    .eq('user_id', userId)
    .order('scheduled_at', { ascending: false, nullsFirst: false })

  if (status) {
    query = query.eq('status', status)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as DateRecord[]
}

export async function getDateById(supabase: SupabaseClient, dateId: string) {
  const { data, error } = await supabase
    .from('clapcheeks_dates')
    .select('*')
    .eq('id', dateId)
    .single()

  if (error) throw error
  return data as DateRecord
}

export async function createDate(supabase: SupabaseClient, userId: string, formData: DateFormData) {
  const { data, error } = await supabase
    .from('clapcheeks_dates')
    .insert({
      user_id: userId,
      ...formData,
      status: formData.scheduled_at ? 'planned' : 'idea',
    })
    .select()
    .single()

  if (error) throw error
  return data as DateRecord
}

export async function updateDate(supabase: SupabaseClient, dateId: string, updates: Partial<DateRecord>) {
  const { data, error } = await supabase
    .from('clapcheeks_dates')
    .update(updates)
    .eq('id', dateId)
    .select()
    .single()

  if (error) throw error
  return data as DateRecord
}

export async function completeDate(supabase: SupabaseClient, dateId: string, postData: PostDateFormData) {
  const { expenses, ...dateUpdates } = postData
  const { data, error } = await supabase
    .from('clapcheeks_dates')
    .update({ ...dateUpdates, status: 'completed' })
    .eq('id', dateId)
    .select()
    .single()

  if (error) throw error

  // Insert expenses if provided
  if (expenses && expenses.length > 0) {
    const { error: expError } = await supabase
      .from('clapcheeks_date_expenses')
      .insert(expenses.map(e => ({ ...e, date_id: dateId, user_id: data.user_id })))

    if (expError) throw expError
  }

  return data as DateRecord
}

export async function deleteDate(supabase: SupabaseClient, dateId: string) {
  const { error } = await supabase
    .from('clapcheeks_dates')
    .delete()
    .eq('id', dateId)

  if (error) throw error
}

export async function getDateExpenses(supabase: SupabaseClient, dateId: string) {
  const { data, error } = await supabase
    .from('clapcheeks_date_expenses')
    .select('*')
    .eq('date_id', dateId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as DateExpense[]
}

export async function addExpense(supabase: SupabaseClient, userId: string, dateId: string, expense: { category: ExpenseCategory; description?: string; amount: number }) {
  const { data, error } = await supabase
    .from('clapcheeks_date_expenses')
    .insert({ ...expense, date_id: dateId, user_id: userId })
    .select()
    .single()

  if (error) throw error
  return data as DateExpense
}

export async function getSavedIdeas(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from('clapcheeks_date_ideas')
    .select('*')
    .eq('user_id', userId)
    .eq('saved', true)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as DateIdea[]
}

export async function saveIdea(supabase: SupabaseClient, userId: string, idea: Omit<DateIdea, 'id' | 'user_id' | 'saved' | 'created_at'>) {
  const { data, error } = await supabase
    .from('clapcheeks_date_ideas')
    .insert({ ...idea, user_id: userId, saved: true })
    .select()
    .single()

  if (error) throw error
  return data as DateIdea
}

export async function removeSavedIdea(supabase: SupabaseClient, ideaId: string) {
  const { error } = await supabase
    .from('clapcheeks_date_ideas')
    .delete()
    .eq('id', ideaId)

  if (error) throw error
}

export async function getBudgetSummary(supabase: SupabaseClient, userId: string): Promise<BudgetSummary> {
  const { data: dates } = await supabase
    .from('clapcheeks_dates')
    .select('actual_cost, estimated_cost, scheduled_at')
    .eq('user_id', userId)
    .eq('status', 'completed')

  const { data: expenses } = await supabase
    .from('clapcheeks_date_expenses')
    .select('category, amount, created_at')
    .eq('user_id', userId)

  const completedDates = dates ?? []
  const allExpenses = expenses ?? []

  const totalSpent = allExpenses.reduce((sum, e) => sum + Number(e.amount), 0)
    + completedDates.reduce((sum, d) => sum + (Number(d.actual_cost) || 0), 0)
  const totalEstimated = completedDates.reduce((sum, d) => sum + (Number(d.estimated_cost) || 0), 0)
  const dateCount = completedDates.length

  const byCategory: Record<ExpenseCategory, number> = {
    food: 0, drinks: 0, activity: 0, transport: 0, gifts: 0, other: 0,
  }
  for (const e of allExpenses) {
    byCategory[e.category as ExpenseCategory] = (byCategory[e.category as ExpenseCategory] || 0) + Number(e.amount)
  }

  // Monthly trend (last 6 months)
  const monthlyMap: Record<string, number> = {}
  for (const e of allExpenses) {
    const month = e.created_at.slice(0, 7)
    monthlyMap[month] = (monthlyMap[month] || 0) + Number(e.amount)
  }
  for (const d of completedDates) {
    if (d.scheduled_at) {
      const month = d.scheduled_at.slice(0, 7)
      monthlyMap[month] = (monthlyMap[month] || 0) + (Number(d.actual_cost) || 0)
    }
  }
  const monthlyTrend = Object.entries(monthlyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([month, amount]) => ({ month, amount }))

  return {
    totalSpent,
    totalEstimated,
    dateCount,
    averagePerDate: dateCount > 0 ? totalSpent / dateCount : 0,
    byCategory,
    monthlyTrend,
  }
}
