import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { upsertClapCheeksUserSettings } from "@/lib/clapcheeks/user-settings";
import { getConvexServerClient } from "@/lib/convex/server";
import { getFleetUserId } from "@/lib/fleet-user";
import { authorizeCctBridgeBearer } from "@/lib/integrations/juliboop/cct-bridge";
import {
  buildApprovalEnvelope,
  buildDatingMutationSnapshot,
  CctCommandError,
  parseCctCommand,
  type CctCommand,
} from "@/lib/integrations/juliboop/cct-commands";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
};
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;
const COURTSHIP_STAGE = {
  roster: "matched",
  talking: "early_chat",
  first_date: "pre_date",
  consistent: "ongoing",
} as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: PRIVATE_HEADERS,
  });
}

function receipt(input: {
  commandId: string;
  requestId: string;
  state: string;
  reasonCode?: string;
  conversationVersion?: number;
  updatedAt?: number;
}) {
  return {
    commandId: input.commandId,
    requestId: input.requestId,
    state: input.state,
    reasonCode: input.reasonCode,
    conversationVersion: input.conversationVersion,
    updatedAt: new Date(input.updatedAt ?? Date.now()).toISOString(),
  };
}

async function loadOwnedPerson(personId: string) {
  const person = await getConvexServerClient().query(api.people.get, {
    id: personId as Id<"people">,
  });
  return person?.user_id === getFleetUserId() ? person : null;
}

async function executeMessageCommand(
  command: Extract<CctCommand, { type: "send_now" | "schedule_message" }>,
  idempotencyKey: string,
  requestId: string,
) {
  const convex = getConvexServerClient();
  const row = await convex.query(api.conversations.getWithMessages, {
    conversation_id: command.conversationId as Id<"conversations">,
    limit: 100,
  });
  if (!row || row.conversation.user_id !== getFleetUserId()) {
    return json({ error: "conversation_not_found", requestId }, 404);
  }
  if (!["tinder", "hinge", "imessage"].includes(row.conversation.platform)) {
    return json({ error: "unsupported_platform", requestId }, 422);
  }
  if (row.conversation.updated_at !== command.expectedConversationVersion) {
    return json(
      {
        error: "conversation_version_conflict",
        requestId,
        conversationVersion: row.conversation.updated_at,
      },
      409,
    );
  }

  const person = row.conversation.person_id
    ? await loadOwnedPerson(String(row.conversation.person_id))
    : null;
  if (person?.status === "ended") {
    return json({ error: "person_policy_blocked", requestId }, 423);
  }
  const metadata =
    row.conversation.metadata
    && typeof row.conversation.metadata === "object"
    && !Array.isArray(row.conversation.metadata)
      ? row.conversation.metadata as Record<string, unknown>
      : {};
  const recipient =
    row.conversation.person_id
      ? String(row.conversation.person_id)
      : row.conversation.platform === "imessage"
        ? String(metadata.handle ?? "")
        : row.conversation.external_match_id;
  if (!recipient) {
    return json({ error: "provider_binding_missing", requestId }, 424);
  }

  const now = Date.now();
  const scheduledFor =
    command.type === "send_now" ? now : Date.parse(command.scheduledFor);
  const approval = buildApprovalEnvelope({
    recipient,
    channel: row.conversation.platform as "tinder" | "hinge" | "imessage",
    exactFinalText: command.body,
    sourcePacketId: idempotencyKey,
    now,
    ttlMs: Math.max(15 * 60 * 1_000, scheduledFor - now + 15 * 60 * 1_000),
  });
  const snapshot = buildDatingMutationSnapshot(
    row.conversation as unknown as Record<string, unknown>,
    row.messages as unknown as Array<Record<string, unknown>>,
  );
  const scheduledApi = (api as any).scheduled_messages;
  const scheduled = await convex.mutation(scheduledApi.createBridgeCommand, {
    conversation_id: command.conversationId as Id<"conversations">,
    user_id: getFleetUserId(),
    body: command.body,
    scheduled_for: scheduledFor,
    schedule_reason: command.type,
    idempotency_key: idempotencyKey,
    execution_mode:
      command.type === "schedule_message" ? command.executionMode : "fixed",
    expected_conversation_updated_at:
      command.expectedConversationVersion,
    approval_envelope: approval,
    mutation_snapshot: snapshot,
  });
  return json(
    receipt({
      commandId: String(scheduled.id),
      requestId,
      state:
        command.type === "schedule_message"
          ? "scheduled"
          : String(scheduled.state),
      conversationVersion: row.conversation.updated_at,
      updatedAt: scheduled.updated_at,
    }),
    scheduled.replayed ? 200 : 202,
  );
}

export async function POST(request: Request) {
  const authorization = authorizeCctBridgeBearer(
    request.headers.get("authorization"),
    process.env.CLAPCHEEKS_JULIBOOP_COMMAND_TOKEN,
  );
  if (authorization === "misconfigured") {
    return json({ error: "bridge_command_secret_misconfigured" }, 503);
  }
  if (authorization !== "authorized") {
    return json({ error: "unauthorized" }, 401);
  }
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return json({ error: "invalid_idempotency_key" }, 422);
  }

  let command: CctCommand;
  try {
    command = parseCctCommand(await request.json());
  } catch (error) {
    if (error instanceof CctCommandError) {
      return json({ error: error.code, message: error.message }, 422);
    }
    return json({ error: "invalid_json" }, 400);
  }

  const requestId = randomUUID();
  try {
    if (command.type === "send_now" || command.type === "schedule_message") {
      return await executeMessageCommand(command, idempotencyKey, requestId);
    }

    const convex = getConvexServerClient();
    const scheduledApi = (api as any).scheduled_messages;
    if (
      command.type === "cancel_scheduled_message"
      || command.type === "reschedule_message"
    ) {
      const existing = await convex.query(scheduledApi.get, {
        id: command.scheduledMessageId as Id<"scheduled_messages">,
      });
      if (!existing || existing.user_id !== getFleetUserId()) {
        return json({ error: "scheduled_message_not_found", requestId }, 404);
      }
      if (command.type === "cancel_scheduled_message") {
        await convex.mutation(scheduledApi.cancel, {
          id: command.scheduledMessageId as Id<"scheduled_messages">,
        });
        return json(receipt({
          commandId: idempotencyKey,
          requestId,
          state: "cancelled",
        }));
      }
      const updated = await convex.mutation(scheduledApi.reschedule, {
        id: command.scheduledMessageId as Id<"scheduled_messages">,
        scheduled_for: Date.parse(command.scheduledFor),
      });
      return json(receipt({
        commandId: idempotencyKey,
        requestId,
        state: "scheduled",
        updatedAt: updated.updated_at,
      }));
    }

    if (command.type === "set_global_automation") {
      await upsertClapCheeksUserSettings({ ai_active: command.enabled });
      return json(receipt({
        commandId: idempotencyKey,
        requestId,
        state: "accepted",
      }));
    }

    const person = await loadOwnedPerson(command.personId);
    if (!person) return json({ error: "person_not_found", requestId }, 404);
    if (command.type === "set_person_policy") {
      const patch =
        command.policy === "automatic"
          ? { status: "active" as const, whitelist_for_autoreply: true }
          : command.policy === "never_contact"
            ? { status: "ended" as const, whitelist_for_autoreply: false }
            : { whitelist_for_autoreply: false };
      await convex.mutation(api.people.patchPerson, {
        person_id: command.personId as Id<"people">,
        ...patch,
      });
    } else if (command.type === "remove_person_from_cct") {
      await convex.mutation(api.people.archivePerson, {
        person_id: command.personId as Id<"people">,
        reason: command.reason,
      });
      const readback = await loadOwnedPerson(command.personId);
      if (!readback?.archived_at || readback.whitelist_for_autoreply !== false) {
        return json({ error: "person_removal_readback_failed", requestId }, 503);
      }
      return json(receipt({
        commandId: idempotencyKey,
        requestId,
        state: "completed",
        updatedAt: readback.updated_at,
      }));
    } else if (command.type === "set_relationship_stage") {
      await convex.mutation(api.people.patchPerson, {
        person_id: command.personId as Id<"people">,
        courtship_stage: COURTSHIP_STAGE[command.stage],
      });
    } else {
      await convex.mutation(api.people.patchPerson, {
        person_id: command.personId as Id<"people">,
        courtship_stage: "pre_date",
        first_date_starts_at: Date.parse(command.startsAt),
        first_date_calendar_event_id: command.calendarEventId,
      });
    }
    return json(receipt({
      commandId: idempotencyKey,
      requestId,
      state: "accepted",
    }));
  } catch {
    return json({ error: "command_execution_failed", requestId }, 503);
  }
}
