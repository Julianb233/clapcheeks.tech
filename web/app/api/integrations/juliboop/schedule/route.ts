import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { api } from "@/convex/_generated/api";
import { getConvexServerClient } from "@/lib/convex/server";
import { getFleetUserId } from "@/lib/fleet-user";
import {
  authorizeCctBridgeBearer,
  buildCctSchedulePage,
} from "@/lib/integrations/juliboop/cct-bridge";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
};
const MAX_RANGE_MS = 93 * 24 * 60 * 60 * 1_000;

export async function GET(request: Request) {
  const authorization = authorizeCctBridgeBearer(
    request.headers.get("authorization"),
    process.env.CLAPCHEEKS_JULIBOOP_READ_TOKEN,
  );
  if (authorization === "misconfigured") {
    return NextResponse.json(
      { error: "bridge_read_secret_misconfigured" },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
  if (authorization !== "authorized") {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: PRIVATE_HEADERS },
    );
  }

  const url = new URL(request.url);
  const now = Date.now();
  const from = Date.parse(
    url.searchParams.get("from") ?? new Date(now).toISOString(),
  );
  const requestedTo = Date.parse(
    url.searchParams.get("to")
      ?? new Date(now + 31 * 24 * 60 * 60 * 1_000).toISOString(),
  );
  if (
    !Number.isFinite(from)
    || !Number.isFinite(requestedTo)
    || requestedTo < from
    || requestedTo - from > MAX_RANGE_MS
  ) {
    return NextResponse.json(
      { error: "invalid_schedule_range" },
      { status: 422, headers: PRIVATE_HEADERS },
    );
  }

  try {
    const userId = getFleetUserId();
    const convex = getConvexServerClient();
    const scheduledApi = (api as unknown as {
      scheduled_messages: {
        listForUser: Parameters<typeof convex.query>[0];
      };
    }).scheduled_messages.listForUser;
    const [rows, conversations] = await Promise.all([
      convex.query(scheduledApi, { user_id: userId, limit: 200 }),
      convex.query(api.conversations.listForUser, {
        user_id: userId,
        limit: 200,
      }),
    ]);
    return NextResponse.json(
      buildCctSchedulePage({
        rows,
        conversations,
        from,
        to: requestedTo,
        requestId: randomUUID(),
        now,
      }),
      { headers: PRIVATE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { error: "bridge_schedule_unavailable" },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}
