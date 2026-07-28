export type ScheduledExecutionMode = "smart" | "fixed";

export interface ScheduledDispatchInput {
  platform: string;
  scheduledMessageId: string;
  conversationId: string;
  personId?: string;
  userId: string;
  body: string;
  executionMode: ScheduledExecutionMode;
  expectedConversationUpdatedAt?: number;
  conversationUpdatedAt: number;
  externalMatchId?: string;
  metadata?: Record<string, unknown>;
}

export type ScheduledDispatch =
  | {
      kind: "job";
      jobType: "send_imessage" | "send_hinge" | "send_tinder";
      payload: Record<string, unknown>;
    }
  | {
      kind: "blocked";
      reasonCode: "conversation_version_conflict" | "unsupported_platform";
    };

const JOB_BY_PLATFORM = {
  imessage: "send_imessage",
  hinge: "send_hinge",
  tinder: "send_tinder",
} as const;

function nonEmptyMetadataValue(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

export function buildScheduledMessageDispatch(
  input: ScheduledDispatchInput,
): ScheduledDispatch {
  if (
    input.executionMode === "smart"
    && input.expectedConversationUpdatedAt !== undefined
    && input.expectedConversationUpdatedAt !== input.conversationUpdatedAt
  ) {
    return {
      kind: "blocked",
      reasonCode: "conversation_version_conflict",
    };
  }

  const jobType =
    JOB_BY_PLATFORM[input.platform as keyof typeof JOB_BY_PLATFORM];
  if (!jobType) {
    return { kind: "blocked", reasonCode: "unsupported_platform" };
  }

  const payload: Record<string, unknown> = {
    conversation_id: input.conversationId,
    person_id: input.personId,
    body: input.body,
    generate_at_fire_time: input.executionMode === "smart",
    source_scheduled_message_id: input.scheduledMessageId,
  };

  if (input.platform === "hinge") {
    payload.sendbird_channel_url = nonEmptyMetadataValue(
      input.metadata,
      "sendbird_channel_url",
    );
    payload.match_id =
      nonEmptyMetadataValue(input.metadata, "match_id")
      ?? input.externalMatchId;
  } else if (input.platform === "tinder") {
    payload.match_id =
      nonEmptyMetadataValue(input.metadata, "match_id")
      ?? input.externalMatchId;
  } else {
    payload.handle = nonEmptyMetadataValue(input.metadata, "handle");
  }

  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) delete payload[key];
  }

  return { kind: "job", jobType, payload };
}

export type ScheduledReceiptPatch =
  | {
      status: "delivered";
      provider_reference?: string;
      delivered_at: number;
      failure_reason: undefined;
      updated_at: number;
    }
  | {
      status: "sent";
      provider_reference?: string;
      failure_reason: undefined;
      updated_at: number;
    }
  | {
      status: "blocked";
      failure_reason: string;
      updated_at: number;
    };

function safeReason(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const reason = value.trim().replace(/[^a-zA-Z0-9._:-]+/g, "_").slice(0, 120);
  return reason || fallback;
}

export function scheduledReceiptPatchFromJobResult(
  result: unknown,
  now: number,
): ScheduledReceiptPatch {
  const row =
    result && typeof result === "object" && !Array.isArray(result)
      ? result as Record<string, unknown>
      : {};
  if (row.skipped === true || row.deferred === true) {
    return {
      status: "blocked",
      failure_reason: safeReason(row.reason, "provider_execution_blocked"),
      updated_at: now,
    };
  }
  if (row.outbound_ambiguous === true) {
    return {
      status: "blocked",
      failure_reason: "provider_readback_ambiguous",
      updated_at: now,
    };
  }

  const providerReference =
    typeof row.provider_reference === "string"
      ? row.provider_reference.trim().slice(0, 240) || undefined
      : typeof row.message_id === "string"
        ? row.message_id.trim().slice(0, 240) || undefined
        : undefined;
  if (
    row.readback_verified === true
    || row.verified === true
    || row.sent_ok === true
  ) {
    return {
      status: "delivered",
      provider_reference: providerReference,
      delivered_at: now,
      failure_reason: undefined,
      updated_at: now,
    };
  }
  if (row.sent === true || row.provider_accepted === true) {
    return {
      status: "sent",
      provider_reference: providerReference,
      failure_reason: undefined,
      updated_at: now,
    };
  }
  return {
    status: "blocked",
    failure_reason: safeReason(row.reason, "provider_delivery_unverified"),
    updated_at: now,
  };
}
