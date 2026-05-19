import { convexConfigured, convexMutation, convexQuery } from "./http"
import { normalizeMatchPhotos } from "@/lib/matches/photos"

export type ConvexCompatClient = ConvexFacadeClient

type QueryResult<T = any> = Promise<{ data: T; error: null | { message: string; code?: string }; count?: number | null }>
type MaybeUser = {
  id: string
  email: string
  email_confirmed_at: string
  user_metadata: Record<string, unknown>
}

const DEFAULT_USER: MaybeUser = {
  id: process.env.CONVEX_FLEET_USER_ID || "fleet-julian",
  email: process.env.CLAPCHEEKS_OPERATOR_EMAIL || "julianb233@gmail.com",
  email_confirmed_at: new Date(0).toISOString(),
  user_metadata: { full_name: "Julian" },
}

function errorResult(message: string, code = "CONVEX_COMPAT_ERROR") {
  return { data: null, error: { message, code }, count: null }
}

function normalizeReadRow(row: any) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row
  const next = { ...row }
  if (next.id == null && row._id != null) next.id = row._id
  if (next.created_at == null && row._creationTime != null) next.created_at = row._creationTime
  if (next.external_id == null) {
    const external = row.external_match_id ?? row.match_id
    if (external != null) next.external_id = external
  }
  return next
}

function normalizePayload(data: any) {
  return Array.isArray(data) ? data.map(normalizeReadRow) : normalizeReadRow(data)
}

function okResult(data: any, count: number | null = Array.isArray(data) ? data.length : null) {
  return { data: normalizePayload(data), error: null, count }
}

const tableToConvexList: Record<string, string> = {
  conversations: "conversations:listForUser",
  clapcheeks_conversations: "conversations:listForUser",
  agent_jobs: "agent_jobs:listForUser",
  clapcheeks_agent_jobs: "agent_jobs:listForUser",
  calendar_slots: "calendar:listFreeSlots",
  clapcheeks_matches: "matches:listForUser",
  devices: "devices:listForUser",
  approval_queue: "queues:listApprovalsForUser",
  clapcheeks_queued_replies: "queues:listRepliesForUser",
  outbound_scheduled_messages: "outbound:listForUser",
}

function coerceMs(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function dayKey(value: unknown): string {
  const ms = coerceMs(value) || Date.now()
  return new Date(ms).toISOString().split("T")[0]
}

function toUnixMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function arrayify(value: any): any[] {
  return Array.isArray(value) ? value : [value]
}

async function liveConversationRows() {
  if (!convexConfigured()) return []
  const rows = await convexQuery<any[]>("conversations:listForUser", { user_id: DEFAULT_USER.id })
  return Array.isArray(rows) ? rows : []
}

async function liveMatchRows(limit?: number | null) {
  if (!convexConfigured()) return []
  const rows = await convexQuery<any[]>("matches:listForUser", { user_id: DEFAULT_USER.id, limit: limit || 500 })
  return Array.isArray(rows) ? rows : []
}

async function deriveAnalyticsDaily(limit?: number | null) {
  const [conversations, matches] = await Promise.all([liveConversationRows(), liveMatchRows(limit)])
  const byDatePlatform = new Map<string, any>()
  const ensure = (date: string, app: string) => {
    const key = `${date}:${app}`
    if (!byDatePlatform.has(key)) {
      byDatePlatform.set(key, {
        user_id: DEFAULT_USER.id,
        date,
        app,
        swipes_right: 0,
        swipes_left: 0,
        matches: 0,
        conversations_started: 0,
        dates_booked: 0,
        money_spent: 0,
      })
    }
    return byDatePlatform.get(key)
  }

  for (const row of matches) {
    const date = dayKey(row.created_at ?? row._creationTime)
    const app = String(row.platform || "unknown")
    ensure(date, app).matches += 1
  }
  for (const row of conversations) {
    const date = dayKey(row.created_at ?? row.last_message_at ?? row._creationTime)
    const app = String(row.platform || "unknown")
    ensure(date, app).conversations_started += 1
  }

  return Array.from(byDatePlatform.values())
}

async function deriveConversationStats(limit?: number | null) {
  const conversations = await liveConversationRows()
  const byDatePlatform = new Map<string, any>()
  const ensure = (date: string, platform: string) => {
    const key = `${date}:${platform}`
    if (!byDatePlatform.has(key)) {
      byDatePlatform.set(key, {
        user_id: DEFAULT_USER.id,
        date,
        platform,
        messages_sent: 0,
        conversations_started: 0,
        conversations_replied: 0,
      })
    }
    return byDatePlatform.get(key)
  }
  for (const row of conversations) {
    const date = dayKey(row.created_at ?? row.last_message_at ?? row._creationTime)
    const platform = String(row.platform || "unknown")
    const bucket = ensure(date, platform)
    bucket.conversations_started += 1
    if (row.last_outbound_at) bucket.messages_sent += 1
    if (row.last_message_at) bucket.conversations_replied += 1
  }
  return Array.from(byDatePlatform.values()).slice(0, limit || undefined)
}

function emptyForTable(table: string) {
  if (table === "profiles") {
    return [{
      id: DEFAULT_USER.id,
      email: DEFAULT_USER.email,
      role: "admin",
      subscription_tier: "elite",
      subscription_status: "active",
      profile_completed: true,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    }]
  }
  if (table === "clapcheeks_subscriptions") return [{ status: "active" }]
  return []
}

function mapLegacyTable(table: string) {
  if (table === "clapcheeks_scheduled_messages") return "outbound_scheduled_messages"
  if (table === "clapcheeks_approval_queue") return "approval_queue"
  return table
}

function fieldValue(row: any, column: string) {
  if (column === "id") return row?.id ?? row?._id
  if (column === "created_at") return row?.created_at ?? row?._creationTime
  return row?.[column]
}

function normalizePlatform(value: unknown) {
  const platform = String(value || "offline").toLowerCase()
  if (["hinge", "tinder", "bumble", "imessage", "offline"].includes(platform)) return platform
  return "offline"
}

function toMatchUpsertArgs(row: Record<string, any>) {
  const external = row.external_match_id || row.external_id || row.match_id || row.id
  if (!external) throw new Error("clapcheeks_matches write requires external_id, external_match_id, match_id, or id")
  const sourcePhotos =
    Array.isArray(row.photos) && row.photos.length > 0
      ? row.photos
      : Array.isArray(row.photos_jsonb)
        ? row.photos_jsonb
        : []
  const args: Record<string, any> = {
    user_id: row.user_id || DEFAULT_USER.id,
    platform: normalizePlatform(row.platform),
    external_match_id: String(external),
    photos: normalizeMatchPhotos(sourcePhotos).map((photo, idx) => ({
      ...photo,
      idx,
    })),
  }
  const scalarKeys = [
    "match_name", "name", "age", "bio", "job", "school", "instagram_handle", "zodiac",
    "match_intel", "status", "stage", "source", "primary_channel", "first_impression",
    "her_phone", "met_at", "julian_rank", "health_score", "final_score", "outcome",
  ]
  for (const key of scalarKeys) {
    const value = row[key]
    if (value !== undefined && value !== null && value !== "") args[key] = value
  }
  const lastActivity = toUnixMs(row.last_activity_at || row.updated_at || row.created_at)
  if (lastActivity !== undefined) args.last_activity_at = lastActivity
  return args
}

function toQueuedReplyArgs(row: Record<string, any>) {
  const text = row.text || row.body || row.message
  if (!text) throw new Error("clapcheeks_queued_replies insert requires text or body")
  return {
    user_id: row.user_id || DEFAULT_USER.id,
    match_id: row.match_id ? String(row.match_id) : undefined,
    match_name: row.match_name || row.recipient_handle || row.handle || "iMessage",
    recipient_handle: row.recipient_handle || row.handle || row.phone,
    platform: row.platform || "imessage",
    text,
    body: text,
    status: row.status || "queued",
    source: row.source,
  }
}

function toAgentJobArgs(row: Record<string, any>) {
  const jobType = row.job_type || row.type || row.task
  if (!jobType) throw new Error("clapcheeks_agent_jobs insert requires job_type")
  return {
    user_id: row.user_id || DEFAULT_USER.id,
    job_type: String(jobType),
    payload: row.payload || row.job_params || {},
    priority: typeof row.priority === "number" ? row.priority : 0,
    max_attempts: typeof row.max_attempts === "number" ? row.max_attempts : 3,
  }
}

function toScheduledMessageArgs(row: Record<string, any>) {
  const scheduledAt = toUnixMs(row.scheduled_at || row.send_at || row.created_at) || Date.now()
  const text = row.message_text || row.body || row.text
  if (!text) throw new Error("clapcheeks_scheduled_messages insert requires message_text, body, or text")
  const sequenceType = ["follow_up", "manual", "app_to_text"].includes(String(row.sequence_type))
    ? row.sequence_type
    : "manual"
  return {
    user_id: row.user_id || DEFAULT_USER.id,
    match_name: row.match_name || row.recipient_name || row.phone || "scheduled message",
    platform: row.platform || "iMessage",
    phone: row.phone || row.recipient_handle || row.handle,
    message_text: text,
    scheduled_at: scheduledAt,
    sequence_type: sequenceType,
    immediate_approved: Boolean(row.immediate_approved),
  }
}

function convexReturnedError(result: any) {
  if (result && typeof result === "object" && result.status === "error") {
    return String(result.errorMessage || result.error || "Convex mutation returned status=error")
  }
  return null
}

class ConvexQueryBuilder {
  private filters: Array<{ op: string; column: string; value: any }> = []
  private orderSpec: { column: string; ascending?: boolean } | null = null
  private limitValue: number | null = null
  private headOnly = false
  private requestedCount = false
  private writeKind: null | "insert" | "upsert" | "update" | "delete" = null
  private writeValues: any = null
  private writeOptions: any = null

  constructor(private table: string) {}

  select(_columns = "*", options?: { count?: string; head?: boolean }) {
    this.headOnly = Boolean(options?.head)
    this.requestedCount = Boolean(options?.count)
    return this
  }

  insert(values: any) { this.writeKind = "insert"; this.writeValues = values; return this }
  upsert(values: any, options?: any) { this.writeKind = "upsert"; this.writeValues = values; this.writeOptions = options; return this }
  update(values: any) { this.writeKind = "update"; this.writeValues = values; return this }
  delete() { this.writeKind = "delete"; return this }

  eq(column: string, value: any) { this.filters.push({ op: "eq", column, value }); return this }
  neq(column: string, value: any) { this.filters.push({ op: "neq", column, value }); return this }
  gt(column: string, value: any) { this.filters.push({ op: "gt", column, value }); return this }
  gte(column: string, value: any) { this.filters.push({ op: "gte", column, value }); return this }
  lt(column: string, value: any) { this.filters.push({ op: "lt", column, value }); return this }
  lte(column: string, value: any) { this.filters.push({ op: "lte", column, value }); return this }
  is(column: string, value: any) { this.filters.push({ op: "is", column, value }); return this }
  ilike(column: string, value: string) { this.filters.push({ op: "ilike", column, value }); return this }
  like(column: string, value: string) { this.filters.push({ op: "like", column, value }); return this }
  in(column: string, value: any[]) { this.filters.push({ op: "in", column, value }); return this }
  not(column: string, op: string, value: any) { this.filters.push({ op: `not.${op}`, column, value }); return this }
  or(_expr: string) { return this }
  contains(column: string, value: any) { this.filters.push({ op: "contains", column, value }); return this }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.orderSpec = { column, ascending: options?.ascending }
    return this
  }

  limit(n: number) { this.limitValue = n; return this }
  range(from: number, to: number) { this.limitValue = Math.max(0, to - from + 1); return this }
  single() { return this.thenResult(true, false) }
  maybeSingle() { return this.thenResult(true, true) }

  private filterValue(column: string) {
    const found = this.filters.find((f) => f.op === "eq" && f.column === column)
    return found?.value
  }

  private async write(): QueryResult<any> {
    if (!convexConfigured()) return errorResult("Convex URL is not configured", "CONVEX_UNCONFIGURED")
    const mapped = mapLegacyTable(this.table)
    const kind = this.writeKind
    const values = this.writeValues || {}

    try {
      if ((kind === "insert" || kind === "upsert") && mapped === "clapcheeks_queued_replies") {
        const inserted = []
        for (const row of arrayify(values)) {
          const result = await convexMutation<any>("queues:enqueueReply", toQueuedReplyArgs(row))
          inserted.push(typeof result === "object" && result ? result : { id: result, ...row })
        }
        return okResult(Array.isArray(values) ? inserted : inserted[0])
      }

      if ((kind === "insert" || kind === "upsert") && mapped === "clapcheeks_agent_jobs") {
        const inserted = []
        for (const row of arrayify(values)) {
          const args = toAgentJobArgs(row)
          const result = await convexMutation<any>("agent_jobs:enqueue", args)
          inserted.push({ id: result, _id: result, ...args })
        }
        return okResult(Array.isArray(values) ? inserted : inserted[0])
      }

      if ((kind === "insert" || kind === "upsert") && mapped === "clapcheeks_matches") {
        const inserted = []
        for (const row of arrayify(values)) {
          const args = toMatchUpsertArgs(row)
          const result = await convexMutation<any>("matches:upsertByExternal", args)
          inserted.push(typeof result === "object" && result ? result : { id: result || args.external_match_id, ...row, external_id: args.external_match_id })
        }
        return okResult(Array.isArray(values) ? inserted : inserted[0])
      }

      if (kind === "update" && mapped === "clapcheeks_matches") {
        const id = this.filterValue("id") || this.filterValue("_id")
        if (!id) return errorResult("clapcheeks_matches update requires eq('id', value)")
        const result = await convexMutation<any>("matches:patch", { id, ...values })
        return okResult(result || { id, ...values })
      }

      if (kind === "update" && mapped === "approval_queue") {
        const id = this.filterValue("id") || this.filterValue("_id")
        if (!id) return errorResult("approval_queue update requires eq('id', value)")
        if (!["approved", "rejected"].includes(String(values.status))) {
          return errorResult("approval_queue update requires status approved or rejected")
        }
        const result = await convexMutation<any>("queues:decideApproval", {
          id,
          user_id: values.user_id || DEFAULT_USER.id,
          status: values.status,
          edited_text: values.edited_text || values.proposed_text,
        })
        return okResult(result || { id, ...values })
      }

      if (kind === "update" && mapped === "clapcheeks_queued_replies") {
        const id = this.filterValue("id") || this.filterValue("_id")
        if (!id) return errorResult("queued reply update requires eq('id', value)")
        const result = await convexMutation<any>("queues:updateReplyStatus", {
          id,
          user_id: values.user_id || DEFAULT_USER.id,
          status: values.status,
          error: values.error || values.error_message,
        })
        return okResult(result || { id, ...values })
      }

      if ((kind === "insert" || kind === "upsert") && mapped === "outbound_scheduled_messages") {
        const inserted = []
        for (const row of arrayify(values)) {
          const result = await convexMutation<any>("outbound:enqueueScheduledMessage", toScheduledMessageArgs(row))
          const resultError = convexReturnedError(result)
          if (resultError) return errorResult(resultError)
          inserted.push(result)
        }
        return okResult(Array.isArray(values) ? inserted : inserted[0])
      }

      if (kind === "update" && mapped === "outbound_scheduled_messages") {
        const id = this.filterValue("id") || this.filterValue("_id")
        if (!id) return errorResult("scheduled message update requires eq('id', value)")
        const user_id = values.user_id || this.filterValue("user_id") || DEFAULT_USER.id
        if (values.status === "sent") {
          const result = await convexMutation<any>("outbound:markSent", {
            id,
            user_id,
            sent_at: toUnixMs(values.sent_at) || Date.now(),
            god_draft_id: values.god_draft_id,
          })
          const resultError = convexReturnedError(result)
          if (resultError) return errorResult(resultError)
          return okResult(result || { id, ...values })
        }
        if (values.status === "failed") {
          const result = await convexMutation<any>("outbound:markFailed", {
            id,
            user_id,
            rejection_reason: values.rejection_reason || values.error_message || values.error || "failed",
          })
          const resultError = convexReturnedError(result)
          if (resultError) return errorResult(resultError)
          return okResult(result || { id, ...values })
        }
        if (["pending", "approved", "rejected"].includes(String(values.status))) {
          const args: Record<string, any> = { id, user_id, status: values.status }
          if (values.message_text) args.message_text = values.message_text
          if (values.rejection_reason) args.rejection_reason = values.rejection_reason
          const scheduledAt = toUnixMs(values.scheduled_at)
          if (scheduledAt !== undefined) args.scheduled_at = scheduledAt
          const result = await convexMutation<any>("outbound:updateScheduled", args)
          const resultError = convexReturnedError(result)
          if (resultError) return errorResult(resultError)
          return okResult(result || { id, user_id, ...values })
        }
      }

      if (kind === "delete" && mapped === "outbound_scheduled_messages") {
        const id = this.filterValue("id") || this.filterValue("_id")
        if (!id) return errorResult("scheduled message delete requires eq('id', value)")
        const user_id = this.filterValue("user_id") || DEFAULT_USER.id
        const result = await convexMutation<any>("outbound:markFailed", {
          id,
          user_id,
          rejection_reason: "deleted_from_dashboard",
        })
        const resultError = convexReturnedError(result)
        if (resultError) return errorResult(resultError)
        return okResult(result || { id, user_id, status: "failed", rejection_reason: "deleted_from_dashboard" })
      }

      if (mapped === "api_health_checks" || mapped === "clapcheeks_auto_actions") {
        return okResult({ skipped: true, reason: "no Convex mutation mapping required for best-effort log table" })
      }

      return errorResult(`No Convex mutation mapping for ${this.table}.${kind}; refusing fake write`, "UNMAPPED_CONVEX_WRITE")
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error))
    }
  }

  private async writeResult(single = false, maybe = false): QueryResult<any> {
    const result = await this.write()
    if (result.error) return result
    if (single || maybe) {
      const row = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data
      return okResult(row, result.count ?? null)
    }
    return result
  }

  async thenResult(single = false, maybe = false): QueryResult<any> {
    if (this.writeKind) return this.writeResult(single, maybe)
    try {
      let data: any[] = []
      const mapped = mapLegacyTable(this.table)
      const convexPath = tableToConvexList[mapped]
      if (mapped === "clapcheeks_analytics_daily") {
        data = await deriveAnalyticsDaily(this.limitValue)
      } else if (mapped === "clapcheeks_conversation_stats") {
        data = await deriveConversationStats(this.limitValue)
      } else if (convexPath && convexConfigured()) {
        const args: Record<string, unknown> = { user_id: DEFAULT_USER.id, limit: this.limitValue || 500 }
        if (mapped === "calendar_slots") {
          args.horizon_days = 14
          args.limit = this.limitValue || 50
        } else if (mapped === "devices") {
          args.only_active = true
        } else if (mapped === "outbound_scheduled_messages") {
          args.status = "all"
        }
        const rows = await convexQuery<any[]>(convexPath, args)
        data = Array.isArray(rows) ? rows.map(normalizeReadRow) : []
      } else {
        data = emptyForTable(this.table)
      }

      for (const f of this.filters) {
        if (f.op === "eq") data = data.filter((row) => {
          const value = fieldValue(row, f.column)
          if (f.column === "status" && f.value === "pending" && value === "queued") return true
          return value === f.value
        })
        if (f.op === "neq") data = data.filter((row) => fieldValue(row, f.column) !== f.value)
        if (f.op === "gt") data = data.filter((row) => fieldValue(row, f.column) > f.value)
        if (f.op === "gte") data = data.filter((row) => fieldValue(row, f.column) >= f.value)
        if (f.op === "lt") data = data.filter((row) => fieldValue(row, f.column) < f.value)
        if (f.op === "lte") data = data.filter((row) => fieldValue(row, f.column) <= f.value)
        if (f.op === "is") data = data.filter((row) => fieldValue(row, f.column) === f.value)
        if (f.op === "in") data = data.filter((row) => Array.isArray(f.value) && f.value.includes(fieldValue(row, f.column)))
        if (f.op === "ilike" || f.op === "like") {
          const needle = String(f.value ?? "").replace(/%/g, "").toLowerCase()
          data = data.filter((row) => String(fieldValue(row, f.column) ?? "").toLowerCase().includes(needle))
        }
      }
      if (this.orderSpec) {
        const { column, ascending = true } = this.orderSpec
        data = [...data].sort((a, b) => String(fieldValue(a, column) ?? "").localeCompare(String(fieldValue(b, column) ?? "")) * (ascending ? 1 : -1))
      }
      if (this.limitValue !== null) data = data.slice(0, this.limitValue)
      const count = this.requestedCount || this.headOnly ? data.length : null
      if (this.headOnly) return okResult(null, count)
      if (single || maybe) return okResult(data[0] ?? null, count)
      return okResult(data, count)
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error))
    }
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: Awaited<QueryResult<any>>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.thenResult(false, false).then(onfulfilled as any, onrejected as any)
  }
  catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null): Promise<any | TResult> {
    return this.thenResult(false, false).catch(onrejected as any)
  }
  finally(onfinally?: (() => void) | null): Promise<any> { return this.thenResult(false, false).finally(onfinally as any) }
}

export class ConvexFacadeClient {
  auth = {
    getUser: async () => ({ data: { user: DEFAULT_USER }, error: null }),
    getSession: async () => ({ data: { session: { user: DEFAULT_USER } }, error: null }),
    exchangeCodeForSession: async (_code: string) => ({ data: { session: { user: DEFAULT_USER } }, error: null }),
    signInWithPassword: async (_data: any) => ({ data: { user: DEFAULT_USER }, error: null }),
    signUp: async (_data: any) => ({ data: { user: DEFAULT_USER }, error: null }),
    signInWithOAuth: async (_data: any) => ({ data: { url: "/dashboard" }, error: null }),
    signOut: async () => ({ error: null }),
  }

  from(table: string) { return new ConvexQueryBuilder(table) }
  channel(_name: string) { return { on: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }), subscribe: () => ({ unsubscribe: () => undefined }) } as any }
  removeChannel(_channel: any) { return undefined }
  rpc(_name: string, _args?: any) { return Promise.resolve({ data: null, error: { message: `RPC ${_name} is not mapped to Convex`, code: "UNMAPPED_RPC" } }) }
  storage = { from: (_bucket: string) => ({
    createSignedUrl: async (_path: string, _ttl: number) => ({ data: null, error: { message: "Convex file storage signed URLs are not mapped here" } }),
    upload: async (_path: string, _body: any, _options?: any) => ({ data: null, error: { message: "Convex file upload is not mapped here" } }),
    remove: async (_paths: string[]) => ({ data: null, error: { message: "Convex file remove is not mapped here" } }),
    getPublicUrl: (_path: string) => ({ data: { publicUrl: _path } }),
  }) }
}

export function createClient(..._args: any[]) { return new ConvexFacadeClient() }
export function createBrowserClient(..._args: any[]) { return new ConvexFacadeClient() }
export function createServerClient(..._args: any[]) { return new ConvexFacadeClient() }
export function createAdminClient() { return new ConvexFacadeClient() }
