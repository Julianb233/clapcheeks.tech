import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

type SupabaseSettingsRow = Record<string, any>

const DEFAULT_OPERATOR_EMAIL = "julianb233@gmail.com"
const SAFE_SETTINGS_COLUMNS = [
  "user_id",
  "persona",
  "drip_rules_yaml",
  "style_text",
  "quiet_hours",
  "date_calendar_email",
  "date_slots",
  "date_slot_days_ahead",
  "date_slot_duration_hours",
  "date_timezone",
  "approve_openers",
  "approve_replies",
  "approve_date_asks",
  "approve_bookings",
  "ai_active",
  "ai_paused_until",
  "ai_paused_reason",
  "updated_at",
].join(",")

let runtimeEnvLoaded = false

function loadRuntimeEnvFallback() {
  if (runtimeEnvLoaded) return
  runtimeEnvLoaded = true
  for (const file of [
    join(homedir(), ".clapcheeks-local", ".env"),
    join(homedir(), ".clapcheeks", ".env"),
  ]) {
    if (!existsSync(file)) continue
    const text = readFileSync(file, "utf8")
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue
      const idx = trimmed.indexOf("=")
      const key = trimmed.slice(0, idx).trim()
      let value = trimmed.slice(idx + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (key && process.env[key] === undefined) {
        process.env[key] = value
      }
    }
  }
}

function env() {
  loadRuntimeEnvFallback()
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "")
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required for ClapCheeks settings")
  }
  return { url, key }
}

function operatorEmail() {
  return (process.env.CLAPCHEEKS_OPERATOR_EMAIL || DEFAULT_OPERATOR_EMAIL).trim().toLowerCase()
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

async function supabaseRest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url, key } = env()
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  })
  const text = await res.text()
  const body = text ? JSON.parse(text) : null
  if (!res.ok) {
    const message = body?.message || body?.error || text || `Supabase request failed with ${res.status}`
    throw new Error(String(message))
  }
  return body as T
}

export async function resolveClapCheeksUserId() {
  const explicit = (process.env.CLAPCHEEKS_USER_ID || "").trim()
  if (isUuid(explicit)) return explicit

  const email = operatorEmail()
  const rows = await supabaseRest<Array<{ id: string; email: string }>>(
    `profiles?select=id,email&email=eq.${encodeURIComponent(email)}&limit=1`,
  )
  const user = rows[0]
  if (!user?.id) {
    throw new Error(`No Supabase profile found for ${email}`)
  }
  return user.id
}

export async function getClapCheeksUserSettings() {
  const userId = await resolveClapCheeksUserId()
  const rows = await supabaseRest<SupabaseSettingsRow[]>(
    `clapcheeks_user_settings?select=${SAFE_SETTINGS_COLUMNS}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
  )
  return { userId, row: rows[0] || null }
}

function copyIfPresent(input: Record<string, unknown>, output: Record<string, unknown>, key: string) {
  if (input[key] !== undefined) output[key] = input[key]
}

export async function upsertClapCheeksUserSettings(input: Record<string, unknown>) {
  const userId = await resolveClapCheeksUserId()
  const payload: Record<string, unknown> = { user_id: userId }

  for (const key of [
    "persona",
    "drip_rules_yaml",
    "style_text",
    "date_calendar_email",
    "date_slots",
    "date_slot_days_ahead",
    "date_slot_duration_hours",
    "date_timezone",
    "approve_openers",
    "approve_replies",
    "approve_date_asks",
    "approve_bookings",
    "ai_active",
    "ai_paused_until",
    "ai_paused_reason",
  ]) {
    copyIfPresent(input, payload, key)
  }

  const rows = await supabaseRest<SupabaseSettingsRow[]>(
    `clapcheeks_user_settings?on_conflict=user_id&select=${SAFE_SETTINGS_COLUMNS}`,
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(payload),
    },
  )
  return rows[0] || null
}
