import posthog from 'posthog-js';

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY || '';
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

let initialized = false;

export function initPostHog() {
  if (initialized || typeof window === 'undefined' || !POSTHOG_KEY) return;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    person_profiles: 'identified_only',
    capture_pageview: false, // we handle this in the provider
    capture_pageleave: true,
  });
  initialized = true;
}

export function identifyUser(
  userId: string,
  properties?: {
    email?: string;
    subscription_tier?: string;
    signup_date?: string;
    platforms_used?: string[];
  },
) {
  if (typeof window === 'undefined' || !POSTHOG_KEY) return;
  posthog.identify(userId, properties);
}

export function resetUser() {
  if (typeof window === 'undefined' || !POSTHOG_KEY) return;
  posthog.reset();
}

// ─── Event tracking ─────────────────────────────────────────────────────────

export const analytics = {
  signUpComplete: (method: string) =>
    posthog.capture('sign_up_complete', { method }),

  onboardingComplete: () =>
    posthog.capture('onboarding_complete'),

  firstAgentConnected: (platform: string) =>
    posthog.capture('first_agent_connected', { platform }),

  firstSwipeSession: (platform: string, count: number) =>
    posthog.capture('first_swipe_session', { platform, swipe_count: count }),

  conversationAiUsed: (platform: string) =>
    posthog.capture('conversation_ai_used', { platform }),

  photoScored: (score: number) =>
    posthog.capture('photo_scored', { score }),

  coachingViewed: (topic: string) =>
    posthog.capture('coaching_viewed', { topic }),

  checkoutStarted: (plan: string, price: number) =>
    posthog.capture('checkout_started', { plan, price }),

  checkoutCompleted: (plan: string, price: number) =>
    posthog.capture('checkout_completed', { plan, price }),

  planUpgraded: (from: string, to: string) =>
    posthog.capture('plan_upgraded', { from_plan: from, to_plan: to }),

  pageView: (path: string) =>
    posthog.capture('$pageview', { $current_url: path }),
};

export { posthog };
