import { createClient } from '@supabase/supabase-js'
import { stripe, stripeLog } from '@/lib/stripe'
import { getConvexServerClient } from '@/lib/convex/server'
import { api } from '@/convex/_generated/api'

// AI-9537: dunning_events run in PARALLEL-WRITE mode to Supabase + Convex
// during the rollout window. Reads continue from Supabase until parity
// is verified. Once flipped, the supabase.insert() lines can be removed.

async function logDunningEvent(args: {
  user_id?: string | null
  stripe_customer_id?: string | null
  stripe_invoice_id?: string | null
  event_type:
    | 'payment_failed'
    | 'payment_recovered'
    | 'grace_period_expired'
    | 'manual_retry'
    | 'subscription_canceled'
  attempt_number?: number
  grace_period_end?: string | null
  metadata?: Record<string, unknown>
}): Promise<void> {
  // Convex write (new authoritative target).
  try {
    const convex = getConvexServerClient()
    await convex.mutation(api.billing.insertDunningEvent, {
      user_id: args.user_id ?? undefined,
      stripe_customer_id: args.stripe_customer_id ?? undefined,
      stripe_invoice_id: args.stripe_invoice_id ?? undefined,
      event_type: args.event_type,
      attempt_number: args.attempt_number,
      grace_period_end: args.grace_period_end
        ? new Date(args.grace_period_end).getTime()
        : undefined,
      metadata: args.metadata,
    })
  } catch (err) {
    stripeLog(
      `[AI-9537] convex dunning insert failed (continuing): ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

// ---------------------------------------------------------------------------
// Dunning / Grace Period Engine
// ---------------------------------------------------------------------------
// On first invoice.payment_failed: 3-day grace, access continues
// On second failure (or after 3 days): 7-day hard grace, banner shown
// After 7 days total: subscription canceled, tier reset to free
// ---------------------------------------------------------------------------

const GRACE_PERIOD_DAYS = 3
const HARD_GRACE_PERIOD_DAYS = 7

/** Supabase admin client (service role) */
function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export interface DunningState {
  userId: string
  email: string | null
  stripeCustomerId: string
  subscriptionStatus: string
  gracePeriodEnd: string | null
  failedPaymentCount: number
}

/**
 * Handle a failed payment — set grace period and track attempts
 */
export async function handlePaymentFailed(
  customerId: string,
  invoiceId: string,
  attemptCount: number
): Promise<DunningState | null> {
  const supabase = getAdminClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, subscription_status, access_expires_at, failed_payment_count')
    .eq('stripe_customer_id', customerId)
    .single()

  if (!profile) {
    stripeLog(`No profile found for customer ${customerId}`)
    return null
  }

  const currentFailCount = (profile.failed_payment_count || 0) + 1
  const isFirstFailure = currentFailCount === 1

  // Grace period: 3 days on first failure, 7 days total on repeat
  const graceDays = isFirstFailure ? GRACE_PERIOD_DAYS : HARD_GRACE_PERIOD_DAYS
  const graceExpiry = new Date()
  graceExpiry.setDate(graceExpiry.getDate() + graceDays)

  await supabase.from('profiles').update({
    subscription_status: 'past_due',
    access_expires_at: graceExpiry.toISOString(),
    failed_payment_count: currentFailCount,
    last_payment_failure_at: new Date().toISOString(),
  }).eq('id', profile.id)

  // Log to dunning_events for audit trail (parallel-write to Convex + Supabase).
  await Promise.all([
    supabase.from('dunning_events').insert({
      user_id: profile.id,
      stripe_customer_id: customerId,
      stripe_invoice_id: invoiceId,
      event_type: 'payment_failed',
      attempt_number: attemptCount || currentFailCount,
      grace_period_end: graceExpiry.toISOString(),
      metadata: {
        grace_days: graceDays,
        is_first_failure: isFirstFailure,
      },
    }).then(({ error }) => {
      if (error) stripeLog(`Failed to log dunning event: ${error.message}`)
    }),
    logDunningEvent({
      user_id: profile.id,
      stripe_customer_id: customerId,
      stripe_invoice_id: invoiceId,
      event_type: 'payment_failed',
      attempt_number: attemptCount || currentFailCount,
      grace_period_end: graceExpiry.toISOString(),
      metadata: {
        grace_days: graceDays,
        is_first_failure: isFirstFailure,
      },
    }),
  ])

  stripeLog(
    `Payment failed for ${profile.email} (attempt ${currentFailCount}). ` +
    `Grace period: ${graceDays} days (expires ${graceExpiry.toISOString()})`
  )

  return {
    userId: profile.id,
    email: profile.email,
    stripeCustomerId: customerId,
    subscriptionStatus: 'past_due',
    gracePeriodEnd: graceExpiry.toISOString(),
    failedPaymentCount: currentFailCount,
  }
}

/**
 * Handle a successful payment — clear dunning state
 */
export async function handlePaymentSucceeded(customerId: string): Promise<void> {
  const supabase = getAdminClient()

  await supabase.from('profiles').update({
    subscription_status: 'active',
    access_expires_at: null,
    failed_payment_count: 0,
    last_payment_failure_at: null,
  }).eq('stripe_customer_id', customerId)

  // Log recovery (parallel-write to Convex + Supabase).
  await Promise.all([
    supabase.from('dunning_events').insert({
      stripe_customer_id: customerId,
      event_type: 'payment_recovered',
      metadata: { recovered_at: new Date().toISOString() },
    }).then(({ error }) => {
      if (error) stripeLog(`Failed to log recovery event: ${error.message}`)
    }),
    logDunningEvent({
      stripe_customer_id: customerId,
      event_type: 'payment_recovered',
      metadata: { recovered_at: new Date().toISOString() },
    }),
  ])

  stripeLog(`Payment recovered for customer ${customerId}`)
}

/**
 * Check and expire grace periods — called by cron
 * Cancels subscriptions and resets access for users whose grace period has expired.
 */
export async function processExpiredGracePeriods(): Promise<{
  processed: number
  canceled: number
  errors: string[]
}> {
  const supabase = getAdminClient()
  const now = new Date().toISOString()

  const { data: expiredUsers, error } = await supabase
    .from('profiles')
    .select('id, email, stripe_customer_id, stripe_subscription_id, access_expires_at')
    .eq('subscription_status', 'past_due')
    .lt('access_expires_at', now)
    .not('access_expires_at', 'is', null)

  if (error || !expiredUsers) {
    return { processed: 0, canceled: 0, errors: [error?.message || 'Query failed'] }
  }

  const errors: string[] = []
  let canceled = 0

  for (const user of expiredUsers) {
    try {
      // Cancel Stripe subscription
      if (user.stripe_subscription_id) {
        await stripe.subscriptions.cancel(user.stripe_subscription_id, {
          prorate: false,
        })
      }

      // Reset profile
      await supabase.from('profiles').update({
        subscription_status: 'canceled',
        subscription_tier: 'free',
        access_expires_at: null,
        failed_payment_count: 0,
      }).eq('id', user.id)

      // Log cancellation
      await supabase.from('dunning_events').insert({
        user_id: user.id,
        stripe_customer_id: user.stripe_customer_id,
        event_type: 'grace_period_expired',
        metadata: {
          canceled_at: new Date().toISOString(),
          grace_expired_at: user.access_expires_at,
        },
      })

      stripeLog(`Grace period expired for ${user.email} — subscription canceled`)
      canceled++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${user.email}: ${msg}`)
      stripeLog(`Failed to cancel expired user ${user.email}: ${msg}`)
    }
  }

  return { processed: expiredUsers.length, canceled, errors }
}

/**
 * Check if a user's access should be restricted due to dunning
 */
export async function checkAccessStatus(userId: string): Promise<{
  hasAccess: boolean
  status: 'active' | 'past_due' | 'grace_period' | 'expired' | 'free'
  gracePeriodEnd: string | null
  daysRemaining: number | null
}> {
  const supabase = getAdminClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_status, subscription_tier, access_expires_at')
    .eq('id', userId)
    .single()

  if (!profile || profile.subscription_tier === 'free') {
    return { hasAccess: true, status: 'free', gracePeriodEnd: null, daysRemaining: null }
  }

  if (profile.subscription_status === 'active') {
    return { hasAccess: true, status: 'active', gracePeriodEnd: null, daysRemaining: null }
  }

  if (profile.subscription_status === 'past_due' && profile.access_expires_at) {
    const expiresAt = new Date(profile.access_expires_at)
    const now = new Date()
    const daysRemaining = Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))

    if (daysRemaining > 0) {
      return {
        hasAccess: true,
        status: 'grace_period',
        gracePeriodEnd: profile.access_expires_at,
        daysRemaining,
      }
    }

    return { hasAccess: false, status: 'expired', gracePeriodEnd: profile.access_expires_at, daysRemaining: 0 }
  }

  return { hasAccess: false, status: 'expired', gracePeriodEnd: null, daysRemaining: null }
}
