import { redirect } from 'next/navigation'

// Consolidated 2026-04-27 (sidebar-audit Fix D):
// All AI-settings tabs (Persona / Drip / Approval Gates) now live inside
// `/settings`, alongside Reports + Calendar. This route stays as a redirect
// so old bookmarks and deep links keep working.
export default function SettingsAIRedirect() {
  redirect('/settings')
}
