import { createHash } from "node:crypto";

export type CctCommand =
  | {
      type: "send_now";
      conversationId: string;
      body: string;
      expectedConversationVersion: number;
    }
  | {
      type: "schedule_message";
      conversationId: string;
      body: string;
      scheduledFor: string;
      executionMode: "smart" | "fixed";
      expectedConversationVersion: number;
    }
  | {
      type: "cancel_scheduled_message";
      scheduledMessageId: string;
    }
  | {
      type: "reschedule_message";
      scheduledMessageId: string;
      scheduledFor: string;
    }
  | {
      type: "set_person_policy";
      personId: string;
      policy: "automatic" | "manual_only" | "never_contact";
    }
  | {
      type: "set_global_automation";
      enabled: boolean;
    }
  | {
      type: "set_relationship_stage";
      personId: string;
      stage: "roster" | "talking" | "first_date" | "consistent";
    }
  | {
      type: "set_first_date";
      personId: string;
      startsAt: string;
      calendarEventId?: string;
    };

export type CctCommandErrorCode =
  | "invalid_command"
  | "unsupported_platform";

export class CctCommandError extends Error {
  readonly code: CctCommandErrorCode;

  constructor(code: CctCommandErrorCode, message: string) {
    super(message);
    this.name = "CctCommandError";
    this.code = code;
  }
}

const BODY_LIMIT = 4_000;
const ID_LIMIT = 240;
const MAX_FUTURE_MS = 365 * 24 * 60 * 60 * 1_000;
const POLICIES = new Set(["automatic", "manual_only", "never_contact"]);
const STAGES = new Set(["roster", "talking", "first_date", "consistent"]);
const EXECUTION_MODES = new Set(["smart", "fixed"]);
const COMMAND_KEYS: Record<string, Set<string>> = {
  send_now: new Set([
    "type",
    "conversationId",
    "body",
    "expectedConversationVersion",
  ]),
  schedule_message: new Set([
    "type",
    "conversationId",
    "body",
    "scheduledFor",
    "executionMode",
    "expectedConversationVersion",
  ]),
  cancel_scheduled_message: new Set(["type", "scheduledMessageId"]),
  reschedule_message: new Set(["type", "scheduledMessageId", "scheduledFor"]),
  set_person_policy: new Set(["type", "personId", "policy"]),
  set_global_automation: new Set(["type", "enabled"]),
  set_relationship_stage: new Set(["type", "personId", "stage"]),
  set_first_date: new Set([
    "type",
    "personId",
    "startsAt",
    "calendarEventId",
  ]),
};

function invalid(message: string): never {
  throw new CctCommandError("invalid_command", message);
}

function plainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("Command must be an object");
  }
  return value as Record<string, unknown>;
}

function boundedString(
  value: unknown,
  name: string,
  limit = ID_LIMIT,
): string {
  if (typeof value !== "string") invalid(`${name} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > limit) {
    invalid(`${name} is invalid`);
  }
  return normalized;
}

function finiteVersion(value: unknown): number {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value < 0
    || !Number.isInteger(value)
  ) {
    invalid("expectedConversationVersion must be a non-negative integer");
  }
  return value;
}

function isoDate(value: unknown, name: string): string {
  if (typeof value !== "string") invalid(`${name} must be an ISO timestamp`);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) invalid(`${name} must be an ISO timestamp`);
  if (timestamp > Date.now() + MAX_FUTURE_MS) {
    invalid(`${name} cannot be more than 365 days away`);
  }
  return new Date(timestamp).toISOString();
}

function enforceClosedKeys(
  command: Record<string, unknown>,
  type: string,
): void {
  const allowed = COMMAND_KEYS[type];
  if (!allowed || Object.keys(command).some((key) => !allowed.has(key))) {
    invalid("Command contains unsupported fields");
  }
}

export function parseCctCommand(value: unknown): CctCommand {
  const command = plainObject(value);
  if (
    command.platform === "facebook_dating"
    || command.platform === "facebook-dating"
  ) {
    throw new CctCommandError(
      "unsupported_platform",
      "Facebook Dating is not supported",
    );
  }
  const type = boundedString(command.type, "type", 80);
  enforceClosedKeys(command, type);

  switch (type) {
    case "send_now":
      return {
        type,
        conversationId: boundedString(
          command.conversationId,
          "conversationId",
        ),
        body: boundedString(command.body, "body", BODY_LIMIT),
        expectedConversationVersion: finiteVersion(
          command.expectedConversationVersion,
        ),
      };
    case "schedule_message": {
      const executionMode = boundedString(
        command.executionMode,
        "executionMode",
        20,
      );
      if (!EXECUTION_MODES.has(executionMode)) {
        invalid("executionMode must be smart or fixed");
      }
      return {
        type,
        conversationId: boundedString(
          command.conversationId,
          "conversationId",
        ),
        body: boundedString(command.body, "body", BODY_LIMIT),
        scheduledFor: isoDate(command.scheduledFor, "scheduledFor"),
        executionMode: executionMode as "smart" | "fixed",
        expectedConversationVersion: finiteVersion(
          command.expectedConversationVersion,
        ),
      };
    }
    case "cancel_scheduled_message":
      return {
        type,
        scheduledMessageId: boundedString(
          command.scheduledMessageId,
          "scheduledMessageId",
        ),
      };
    case "reschedule_message":
      return {
        type,
        scheduledMessageId: boundedString(
          command.scheduledMessageId,
          "scheduledMessageId",
        ),
        scheduledFor: isoDate(command.scheduledFor, "scheduledFor"),
      };
    case "set_person_policy": {
      const policy = boundedString(command.policy, "policy", 40);
      if (!POLICIES.has(policy)) invalid("policy is invalid");
      return {
        type,
        personId: boundedString(command.personId, "personId"),
        policy: policy as "automatic" | "manual_only" | "never_contact",
      };
    }
    case "set_global_automation":
      if (typeof command.enabled !== "boolean") {
        invalid("enabled must be a boolean");
      }
      return { type, enabled: command.enabled };
    case "set_relationship_stage": {
      const stage = boundedString(command.stage, "stage", 40);
      if (!STAGES.has(stage)) invalid("stage is invalid");
      return {
        type,
        personId: boundedString(command.personId, "personId"),
        stage: stage as "roster" | "talking" | "first_date" | "consistent",
      };
    }
    case "set_first_date":
      return {
        type,
        personId: boundedString(command.personId, "personId"),
        startsAt: isoDate(command.startsAt, "startsAt"),
        calendarEventId:
          command.calendarEventId === undefined
            ? undefined
            : boundedString(command.calendarEventId, "calendarEventId"),
      };
    default:
      return invalid("Unknown command type");
  }
}

export interface ApprovalEnvelope {
  verified_recipient: string;
  verified_channel: string;
  exact_final_text: string;
  approval_timestamp: number;
  expires_at: number;
  source_packet_id: string;
  recipient_channel_body_fingerprint: string;
}

export function buildApprovalEnvelope(input: {
  recipient: string;
  channel: "tinder" | "hinge" | "imessage";
  exactFinalText: string;
  sourcePacketId: string;
  now: number;
  ttlMs: number;
}): ApprovalEnvelope {
  const canonical = [
    input.recipient.trim(),
    input.channel.trim().toLowerCase(),
    input.exactFinalText,
    input.sourcePacketId,
  ].join("\x1f");
  return {
    verified_recipient: input.recipient.trim(),
    verified_channel: input.channel,
    exact_final_text: input.exactFinalText,
    approval_timestamp: input.now,
    expires_at: input.now + Math.max(1, input.ttlMs),
    source_packet_id: input.sourcePacketId,
    recipient_channel_body_fingerprint: createHash("sha256")
      .update(canonical, "utf8")
      .digest("hex"),
  };
}

export interface DatingMutationSnapshot {
  schema_version: 1;
  conversation_id: string;
  conversation_version: string;
  message_version: string;
  latest_message_id: string;
  latest_message_sent_at_ms: number;
  latest_message_direction: string;
  message_count: number;
}

function sortedJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJsonValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [
          key,
          record[key] === undefined ? null : sortedJsonValue(record[key]),
        ]),
    );
  }
  return value === undefined ? null : value;
}

function stableDigest(value: Record<string, unknown>): string {
  const json = JSON.stringify(sortedJsonValue(value)).replace(
    /[^\x00-\x7F]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return createHash("sha256").update(json, "utf8").digest("hex");
}

function messageTimestamp(message: Record<string, unknown>): number {
  const value = message.sent_at ?? message.timestamp ?? 0;
  const timestamp = Number(value);
  return Number.isFinite(timestamp) ? Math.trunc(timestamp) : 0;
}

function messageId(message: Record<string, unknown>): string {
  const value =
    message.external_guid
    ?? message.external_message_id
    ?? message._id
    ?? `ts:${messageTimestamp(message)}`;
  return String(value);
}

export function buildDatingMutationSnapshot(
  conversation: Record<string, unknown>,
  messages: Array<Record<string, unknown>>,
): DatingMutationSnapshot {
  const conversationId = String(conversation._id ?? "").trim();
  if (!conversationId) throw new Error("conversation_snapshot_id_missing");
  const ordered = messages
    .filter((message) => message && typeof message === "object")
    .slice()
    .sort((left, right) =>
      messageTimestamp(left) - messageTimestamp(right)
      || messageId(left).localeCompare(messageId(right)),
    );
  if (!ordered.length) throw new Error("conversation_snapshot_message_missing");
  const latest = ordered[ordered.length - 1];
  const latestId = messageId(latest).trim();
  const latestSentAt = messageTimestamp(latest);
  if (!latestId || latestSentAt <= 0) {
    throw new Error("conversation_snapshot_message_version_missing");
  }
  const metadata =
    conversation.metadata
    && typeof conversation.metadata === "object"
    && !Array.isArray(conversation.metadata)
      ? conversation.metadata as Record<string, unknown>
      : {};
  const conversationVersionFields = {
    id: conversationId,
    updated_at:
      conversation._updatedAt
      ?? conversation.updated_at
      ?? conversation.updated_at_ms
      ?? null,
    status: conversation.status ?? null,
    external_match_id: conversation.external_match_id ?? null,
    person_id: conversation.person_id ?? null,
    is_active: conversation.is_active ?? null,
    is_unmatched: conversation.is_unmatched ?? null,
    blocked_at: conversation.blocked_at ?? null,
    deleted_at: conversation.deleted_at ?? null,
    ended_at: conversation.ended_at ?? null,
    unmatched_at: conversation.unmatched_at ?? null,
    provider_binding: {
      sendbird_channel_url: metadata.sendbird_channel_url ?? null,
      status: metadata.status ?? null,
      is_active: metadata.is_active ?? null,
      is_unmatched: metadata.is_unmatched ?? null,
      blocked_at: metadata.blocked_at ?? null,
      deleted_at: metadata.deleted_at ?? null,
      ended_at: metadata.ended_at ?? null,
      unmatched_at: metadata.unmatched_at ?? null,
    },
  };
  const direction = String(latest.direction ?? "").trim().toLowerCase();
  const messageVersionFields = {
    id: latestId,
    sent_at: latestSentAt,
    direction,
    body_digest: createHash("sha256")
      .update(String(latest.body ?? ""), "utf8")
      .digest("hex"),
    external_guid: latest.external_guid ?? null,
    external_message_id: latest.external_message_id ?? null,
  };

  return {
    schema_version: 1,
    conversation_id: conversationId,
    conversation_version: stableDigest(conversationVersionFields),
    message_version: stableDigest(messageVersionFields),
    latest_message_id: latestId,
    latest_message_sent_at_ms: latestSentAt,
    latest_message_direction: direction,
    message_count: ordered.length,
  };
}
