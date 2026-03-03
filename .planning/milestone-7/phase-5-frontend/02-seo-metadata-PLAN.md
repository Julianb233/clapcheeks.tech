---
plan: "SEO Metadata for All Pages"
phase: "Phase 5: Frontend Polish"
wave: 2
autonomous: true
requirements: [FE-03]
goal: "Add export const metadata with title and description to all 20+ pages missing it"
---

# Plan 02: SEO Metadata for All Pages

**Phase:** Phase 5 — Frontend Polish
**Requirements:** FE-03
**Priority:** P1
**Wave:** 2

## Context

Many pages are missing `export const metadata`. Pages without metadata get no title or description in search results, social shares, and browser tabs.

Pages known to be missing metadata (from audit):
`activate`, `admin/*`, `complete-profile`, `diagnostics`, `events`, `groups`, `home`, `login`, `notifications`, `profile`, `safety`, `signup`, `(main)/layout.tsx`

Also needs checking: new subpages (`/features`, `/how-it-works`, `/platforms`, `/download`)

## Tasks

### Task 1: Audit all pages missing metadata

Run a search to find all page.tsx files without metadata:
```bash
# Find all page.tsx files
find web/app -name "page.tsx" | sort

# For each, check if it has metadata export
grep -rL "export const metadata" web/app --include="page.tsx"
```

Also check layout files:
```bash
grep -rL "export const metadata" web/app --include="layout.tsx"
```

### Task 2: Define metadata helper for brand consistency

Create `web/lib/metadata.ts`:
```typescript
import type { Metadata } from 'next'

const SITE_NAME = 'Clapcheeks'
const SITE_URL = 'https://clapcheeks.tech'
const DEFAULT_DESCRIPTION = 'Your AI dating co-pilot. Automate smarter, not harder. Runs on your Mac.'
const OG_IMAGE = `${SITE_URL}/og-image.png`

export function createMetadata(overrides: Partial<Metadata> = {}): Metadata {
  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: SITE_NAME,
      template: `%s | ${SITE_NAME}`,
    },
    description: DEFAULT_DESCRIPTION,
    openGraph: {
      siteName: SITE_NAME,
      type: 'website',
      images: [{ url: OG_IMAGE }],
    },
    twitter: {
      card: 'summary_large_image',
    },
    ...overrides,
  }
}
```

### Task 3: Add metadata to each page

For each page file, add the appropriate metadata. Examples:

**Public pages:**
```typescript
// web/app/(auth)/login/page.tsx
export const metadata = createMetadata({
  title: 'Sign In',
  description: 'Sign in to your Clapcheeks account.',
})

// web/app/(auth)/signup/page.tsx
export const metadata = createMetadata({
  title: 'Get Started',
  description: 'Create your Clapcheeks account and start automating your dating life.',
})

// web/app/activate/page.tsx
export const metadata = createMetadata({
  title: 'Activate Your Account',
  description: 'Activate your Clapcheeks account to get started.',
})

// web/app/complete-profile/page.tsx
export const metadata = createMetadata({
  title: 'Complete Your Profile',
  description: 'Set up your preferences to personalize your Clapcheeks experience.',
})
```

**App pages (authenticated):**
```typescript
// web/app/(main)/home/page.tsx
export const metadata = createMetadata({ title: 'Home' })

// web/app/(main)/events/page.tsx
export const metadata = createMetadata({
  title: 'Events',
  description: 'Track your dates and events.',
})

// web/app/(main)/groups/page.tsx
export const metadata = createMetadata({ title: 'Groups' })

// web/app/(main)/notifications/page.tsx
export const metadata = createMetadata({ title: 'Notifications' })

// web/app/(main)/profile/page.tsx
export const metadata = createMetadata({
  title: 'Your Profile',
  description: 'Manage your dating preferences and profile settings.',
})

// web/app/(main)/safety/page.tsx
export const metadata = createMetadata({
  title: 'Safety',
  description: 'Safety guidelines and content moderation settings.',
})

// web/app/(main)/diagnostics/page.tsx
export const metadata = createMetadata({ title: 'Diagnostics' })
```

**Admin pages:**
```typescript
// web/app/admin/layout.tsx
export const metadata = createMetadata({ title: 'Admin' })

// Individual admin pages: similar pattern
```

**Subpages (check if already have metadata):**
```typescript
// web/app/features/page.tsx
export const metadata = createMetadata({
  title: 'Features',
  description: 'Everything Clapcheeks can do — AI openers, automated swiping, conversation management and more.',
})

// web/app/how-it-works/page.tsx
export const metadata = createMetadata({
  title: 'How It Works',
  description: 'Learn how to set up and use Clapcheeks in minutes.',
})

// web/app/platforms/page.tsx
export const metadata = createMetadata({
  title: 'Supported Platforms',
  description: 'Clapcheeks works with Tinder, Hinge, Bumble and 7 more dating apps.',
})

// web/app/download/page.tsx
export const metadata = createMetadata({
  title: 'Download',
  description: 'Install the Clapcheeks Mac agent with one command.',
})
```

### Task 4: Update root layout with base metadata

Check `web/app/layout.tsx` — ensure it has good base metadata that subpages inherit from.

## Acceptance Criteria

- [ ] `web/lib/metadata.ts` helper created
- [ ] All `page.tsx` files have `export const metadata`
- [ ] All `layout.tsx` files have `export const metadata`
- [ ] Titles follow `Page Name | Clapcheeks` pattern
- [ ] Descriptions are descriptive and under 160 characters
- [ ] `grep -rL "export const metadata" web/app --include="page.tsx"` returns empty

## Files to Modify

- `web/lib/metadata.ts` — NEW file
- Every `page.tsx` and `layout.tsx` without metadata (20+ files)
