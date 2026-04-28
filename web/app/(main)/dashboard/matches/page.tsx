import { redirect } from 'next/navigation'

// Consolidated 2026-04-27 (sidebar-audit Fix C):
// `/matches` is now the canonical match-list view. This route stays as a
// redirect so old bookmarks and stale internal links don't break.
// Detail pages live at `/matches/[id]`. The `/dashboard/matches/[id]`
// links elsewhere in the codebase are being updated to point at the
// canonical detail route as part of this consolidation.
export default function DashboardMatchesRedirect() {
  redirect('/matches')
}
