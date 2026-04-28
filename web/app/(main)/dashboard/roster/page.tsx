import { redirect } from 'next/navigation'

// Consolidated 2026-04-27 (sidebar-audit Fix C):
// `/leads` is now the canonical Pipeline surface. The Roster's stat tiles
// (Active / New this week / Dates this week / Closes this month / Funnel)
// and Daily Top 3 intelligence layer have been promoted into `/leads`
// as a header strip. This route stays as a redirect so old bookmarks
// and the in-app "Roster" links don't 404.
export default function DashboardRosterRedirect() {
  redirect('/leads')
}
