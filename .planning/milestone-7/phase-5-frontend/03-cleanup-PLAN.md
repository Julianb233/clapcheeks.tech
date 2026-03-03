---
plan: "Console Cleanup & Press Kit"
phase: "Phase 5: Frontend Polish"
wave: 3
autonomous: true
requirements: [FE-04, FE-05]
goal: "Remove production console.error calls, fix or remove press kit screenshot stubs"
---

# Plan 03: Console Cleanup & Press Kit

**Phase:** Phase 5 — Frontend Polish
**Requirements:** FE-04, FE-05
**Priority:** P2
**Wave:** 3

## Context

- `console.error('Analytics fetch error')` left in production code — clutters browser console for all users
- Press page shows 4 "Coming soon" screenshot placeholders — looks unfinished to press/journalists

## Tasks

### Task 1: Remove console.error from analytics page (FE-04)

Note: This may already be done if FE-02 plan was executed with the bonus cleanup.

1. Check current state of analytics page:
   ```bash
   grep -r "console.error\|console.log\|console.warn" web/app --include="*.tsx" --include="*.ts"
   ```

2. For any `console.error` that's a debug leftover (not a critical failure log):
   ```typescript
   // Before:
   } catch (err) {
     console.error('Analytics fetch error', err)
   }

   // After (option A - silent):
   } catch {
     // failed silently
   }

   // After (option B - dev only):
   } catch (err) {
     if (process.env.NODE_ENV === 'development') {
       console.error('Analytics fetch error', err)
     }
   }
   ```

3. Use option B (dev-only) so errors are still visible during development.

4. Audit all other `console.log` / `console.error` in production client components:
   - Remove debug logs
   - Gate behind `process.env.NODE_ENV === 'development'` for non-critical ones
   - Keep error logs for genuine unexpected failures

### Task 2: Fix press kit screenshot stubs (FE-05)

File: `web/app/press/page.tsx` (or similar)

1. Check current press page implementation:
   ```bash
   cat "web/app/press/page.tsx"
   ```

2. Option A (preferred): Remove the screenshot section entirely and add a note:
   ```tsx
   {/* Remove the 4 screenshot placeholder grid */}
   {/* Add instead: */}
   <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-8 text-center">
     <p className="text-white/50 text-sm mb-2">Screenshots & media kit coming soon.</p>
     <p className="text-white/30 text-xs">
       For press inquiries and media assets, contact{' '}
       <a href="mailto:press@clapcheeks.tech" className="text-brand-400 hover:underline">
         press@clapcheeks.tech
       </a>
     </p>
   </div>
   ```

3. Option B: Add real screenshots if available in `public/` directory:
   - Check `web/public/` for any existing screenshots
   - If found, use them in the press grid
   - If not, use Option A

4. Check if placeholder images reference non-existent files:
   ```bash
   grep -r "screenshot\|press.*img\|media.*img" web/app/press/
   ```
   Remove any `<img>` tags pointing to missing files to eliminate 404s.

## Acceptance Criteria

- [ ] No `console.error` calls in production analytics page client code
- [ ] All remaining console statements are gated behind `NODE_ENV === 'development'`
- [ ] Press page has no broken "Coming soon" image placeholders
- [ ] Press page either has real screenshots OR a clean "contact us" message
- [ ] No 404 errors in browser network tab from press page image requests

## Files to Modify

- `web/app/(main)/analytics/analytics-client.tsx` — remove console.error (if not already done)
- Other client components with debug console calls
- `web/app/press/page.tsx` — remove screenshot stubs, add clean placeholder or real content
