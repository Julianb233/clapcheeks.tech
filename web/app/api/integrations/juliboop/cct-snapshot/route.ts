import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { api } from "@/convex/_generated/api";
import { getClapCheeksUserSettings } from "@/lib/clapcheeks/user-settings";
import { getConvexServerClient } from "@/lib/convex/server";
import { getFleetUserId } from "@/lib/fleet-user";
import {
  authorizeCctBridgeBearer,
  buildCctSnapshotV2,
  CCT_PEOPLE_QUERY_LIMIT,
} from "@/lib/integrations/juliboop/cct-bridge";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
};

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

  try {
    const userId = getFleetUserId();
    const convex = getConvexServerClient();
    const scheduledApi = (api as unknown as {
      scheduled_messages: {
        listForUser: Parameters<typeof convex.query>[0];
      };
    }).scheduled_messages.listForUser;
    const [people, conversations, scheduled, settings] = await Promise.all([
      convex.query(api.people.listForUser, {
        user_id: userId,
        limit: CCT_PEOPLE_QUERY_LIMIT,
      }),
      convex.query(api.conversations.listForUser, {
        user_id: userId,
        limit: 200,
      }),
      convex.query(scheduledApi, { user_id: userId, limit: 200 }),
      getClapCheeksUserSettings().catch(() => ({ row: null })),
    ]);
    const now = Date.now();
    return NextResponse.json(
      buildCctSnapshotV2({
        people,
        conversations,
        scheduled,
        globalAutomationEnabled: settings.row?.ai_active === true,
        now,
        requestId: randomUUID(),
      }),
      { headers: PRIVATE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { error: "bridge_snapshot_unavailable" },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}
