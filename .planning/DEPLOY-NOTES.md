# Vercel Deployment Notes

## Status

Vercel CLI deployed successfully but **build fails** due to missing environment variables.

- Vercel project: `ai-acrobatics/web`
- Preview URL attempted: `https://web-2c44ept5r-ai-acrobatics.vercel.app`
- Build error: `supabaseUrl is required` (from `/api/stripe/webhook` route)

## Required Environment Variables

The following must be set in Vercel project settings (Settings > Environment Variables):

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (used in webhook) |
| `STRIPE_SECRET_KEY` | Stripe secret API key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `NEXT_PUBLIC_SITE_URL` | Production site URL (e.g. `https://clapcheeks.tech`) |

## Steps to Complete Deployment

1. Go to Vercel dashboard > `web` project > Settings > Environment Variables
2. Add all variables listed above for Production + Preview environments
3. Trigger a new deployment: `vercel --cwd web --yes` or push to git
4. Configure custom domain `clapcheeks.tech` in Vercel project settings
5. Set up Stripe webhook endpoint: `https://clapcheeks.tech/api/stripe/webhook`

## Local Build

Local build passes with `.env.local` containing the required variables.
