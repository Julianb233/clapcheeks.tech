import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getConvexServerClient } from "@/lib/convex/server";
import { getFleetUserId } from "@/lib/fleet-user";
import {
  authorizeCctBridgeBearer,
  buildCctConversationPage,
} from "@/lib/integrations/juliboop/cct-bridge";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
};

export async function GET(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
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

  const { conversationId } = await context.params;
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const requestedLimit = Number(url.searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.floor(requestedLimit), 1), 100)
    : 100;

  try {
    const row = await getConvexServerClient().query(
      api.conversations.getWithMessages,
      {
        conversation_id: conversationId as Id<"conversations">,
        limit: 100,
      },
    );
    if (!row || row.conversation.user_id !== getFleetUserId()) {
      return NextResponse.json(
        { error: "conversation_not_found" },
        { status: 404, headers: PRIVATE_HEADERS },
      );
    }
    return NextResponse.json(
      buildCctConversationPage({
        conversation: row.conversation,
        messages: row.messages,
        cursor,
        limit,
        requestId: randomUUID(),
        now: Date.now(),
      }),
      { headers: PRIVATE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { error: "conversation_not_found" },
      { status: 404, headers: PRIVATE_HEADERS },
    );
  }
}
