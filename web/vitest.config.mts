import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    // Only run the new vitest TS tests; the legacy *.test.mjs files are
    // exercised by node:test (see web/__tests__/README or run them
    // directly: `node --test web/__tests__/*.test.mjs`).
    include: ['__tests__/**/*.test.ts'],
    globals: false,
    // Force-isolated test envs so process.env mutations in one test don't
    // bleed across files.
    pool: 'forks',
    isolate: true,
    // Hard-pin env vars used by the routes under test so .env.local doesn't
    // leak real secrets into the test process. .env.local is unrelated to
    // unit-test correctness and should not affect outcomes.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
      STRIPE_SECRET_KEY: 'sk_test_clapcheeks',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_clapcheeks_8768',
      STRIPE_PRICE_STARTER: '',
      STRIPE_PRICE_PRO: '',
      STRIPE_PRICE_ELITE: '',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
