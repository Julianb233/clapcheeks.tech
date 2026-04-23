import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { SEQUENCE } from '@/lib/emails/onboarding-sequence'

export const maxDuration = 120

/**
 * POST /api/onboarding/email
 *
 * Cron-triggered route that sends the next onboarding email to each user
 * based on days since signup and their current onboarding_email_step.
 *
 * Auth: Bearer token matching CRON_SECRET env var.
 *
 * Reads from the `profiles` table:
 *   - onboarding_email_step (integer, default 0) — index into SEQUENCE already sent
 *   - created_at — signup timestamp used to calculate day offsets
 *   - email, full_name — for addressing the email
 */
export async function POST(request: NextRequest) {
  // ---- Auth check ----
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const now = new Date()

  // ---- Fetch users who haven't finished the sequence ----
  // onboarding_email_step tracks how many emails have been sent (0 = none yet).
  // Users who have completed all 5 steps have step === SEQUENCE.length and are excluded.
  const { data: users, error: fetchError } = await supabase
    .from('profiles')
    .select('id, email, full_name, created_at, onboarding_email_step')
    .lt('onboarding_email_step', SEQUENCE.length)

  if (fetchError) {
    console.error('Failed to fetch onboarding users:', fetchError)
    return NextResponse.json({ error: 'Database query failed' }, { status: 500 })
  }

  if (!users || users.length === 0) {
    return NextResponse.json({ sent: 0, message: 'No users need onboarding emails' })
  }

  let sent = 0
  let skipped = 0
  let errors = 0

  for (const user of users) {
    try {
      if (!user.email) {
        skipped++
        continue
      }

      const step: number = user.onboarding_email_step ?? 0
      const createdAt = new Date(user.created_at)
      const daysSinceSignup = Math.floor(
        (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)
      )

      // Find the next email this user should receive
      const nextStep = SEQUENCE[step]
      if (!nextStep) {
        skipped++
        continue
      }

      // Only send if enough days have passed since signup
      if (daysSinceSignup < nextStep.day) {
        skipped++
        continue
      }

      // Derive first name from full_name, fall back to "there"
      const firstName = user.full_name?.split(' ')[0] || 'there'

      const { error: sendError } = await nextStep.fn({
        to: user.email,
        firstName,
      })

      if (sendError) {
        console.error(
          `Onboarding email failed for user ${user.id} (step ${step}):`,
          sendError
        )
        errors++
        continue
      }

      // Advance the user's step
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ onboarding_email_step: step + 1 })
        .eq('id', user.id)

      if (updateError) {
        console.error(
          `Failed to update onboarding_email_step for user ${user.id}:`,
          updateError
        )
        errors++
        continue
      }

      sent++
    } catch (err) {
      console.error(`Unexpected error for user ${user.id}:`, err)
      errors++
    }
  }

  return NextResponse.json({
    sent,
    skipped,
    errors,
    total: users.length,
  })
}
