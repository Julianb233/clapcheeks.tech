export type ConvexArgs = Record<string, unknown>

function convexBaseUrl() {
  return (
    process.env.CONVEX_URL ||
    process.env.NEXT_PUBLIC_CONVEX_URL ||
    process.env.CLAPCHEEKS_CONVEX_URL ||
    ""
  ).replace(/\/+$/, "")
}

function convexDeployKey() {
  return process.env.CONVEX_DEPLOY_KEY || process.env.CLAPCHEEKS_CONVEX_DEPLOY_KEY || ""
}

export function convexConfigured() {
  return Boolean(convexBaseUrl())
}

async function callConvex(kind: "query" | "mutation" | "action", path: string, args: ConvexArgs = {}) {
  const base = convexBaseUrl()
  if (!base) {
    throw new Error("Convex URL is not configured")
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" }
  const key = convexDeployKey()
  if (key) headers.Authorization = `Convex ${key}`

  const res = await fetch(`${base}/api/${kind}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ path, args, format: "json" }),
    cache: "no-store",
  })

  const text = await res.text()
  let payload: any = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = { raw: text } }

  if (!res.ok) {
    const message = payload?.error?.message || payload?.error || text || `Convex ${kind} failed`
    throw new Error(String(message))
  }

  return payload && typeof payload === "object" && "value" in payload ? payload.value : payload
}

export async function convexQuery<T = unknown>(path: string, args: ConvexArgs = {}): Promise<T> {
  return callConvex("query", path, args) as Promise<T>
}

export async function convexMutation<T = unknown>(path: string, args: ConvexArgs = {}): Promise<T> {
  return callConvex("mutation", path, args) as Promise<T>
}

export async function convexAction<T = unknown>(path: string, args: ConvexArgs = {}): Promise<T> {
  return callConvex("action", path, args) as Promise<T>
}

export async function convexHealth() {
  try {
    const rows = await convexQuery<unknown[]>("conversations:listForUser", { user_id: process.env.CONVEX_FLEET_USER_ID || "fleet-julian" })
    return { ok: Array.isArray(rows), error: "" }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
