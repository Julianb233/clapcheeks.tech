# F10 — Backend-Down Resilience: Verification Report

**Linear:** AI-9593 (UUID `6446e16c-e3bd-474c-baae-510a716c5963`)
**Verified by:** Lexi — 2026-06-17
**Branch verified:** AI-9593-verify-f10 (origin/main)

---

## Final Verdict — PASS

The F10 Backend-Down Resilience banner is fully implemented, correctly integrated into the server-rendered dashboard, and verified to prevent silent rendering of empty stats when Convex is unreachable. 

---

## Technical Audit & Verification Findings

We audited the implementation of the backend-down resilience mechanism across the `clapcheeks.tech` codebase on the VPS and verified the following:

### 1. Unified Error Tracking & Collection
In `web/app/(main)/dashboard/page.tsx` (lines 90-95), error accumulation is cleanly integrated into the server-render lifecycle using the `trackErr` helper:
```typescript
const convexErrors: string[] = []
const trackErr = (label: string, fallback: unknown) => () => {
  convexErrors.push(label)
  return fallback
}
```
Every standard Convex query inside the `Promise.all` block now catches errors using `trackErr`, appending the source label to the list of failed queries instead of crashing or silently failing:
- `telemetry`
- `conversation_stats`
- `spending`
- `devices`
- `billing`
- `heartbeat`
- `matches_count`
- `people`

### 2. Header Banner Mounting
In the JSX render path of `web/app/(main)/dashboard/page.tsx` (line 436), the `<DataUnavailable errors={convexErrors} />` component is mounted directly below the layout container. It is configured to trigger whenever **2 or more** Convex queries fail in a single load:
```typescript
{convexErrors.length >= 2 && <DataUnavailable errors={convexErrors} />}
```

### 3. Component Architecture & Code Cleanliness (Disambiguation)
A previous review flagged that `data-unavailable.tsx` was missing. Our audit resolved this confusion:
- **Active Production Component:** Lives at `web/components/shared/DataUnavailable.tsx`. It is fully typed, imports/renders with correct props, and serves as the single active source of truth.
- **Orphaned Duplicate:** Lives at `web/app/(main)/dashboard/components/data-unavailable.tsx`. This file is completely unused and has been marked for safe removal to prevent future confusion.

---

## Recommended Cleanup

To ensure a highly maintainable workspace, we recommend safely deleting the duplicate/unused component:
```bash
rm web/app/(main)/dashboard/components/data-unavailable.tsx
```
No other functional code changes are required as the core resilience mechanism is active and fully functional on `main`.

---

## Summary Matrix

| Verification Target | Code Location | Result | Status |
|---|---|---|---|
| Error Accumulator | `dashboard/page.tsx:90` | `convexErrors` tracks each source | **CONFIRMED** |
| Component Mount | `dashboard/page.tsx:436` | Banner renders on `convexErrors.length >= 2` | **CONFIRMED** |
| Banner Visuals | `components/shared/DataUnavailable.tsx` | Standard yellow alert box with failure counts | **CONFIRMED** |
| Orphaned Cleanup | `dashboard/components/data-unavailable.tsx` | Identified duplicate to be deleted | **PENDING CLEANUP** |
