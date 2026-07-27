import { timingSafeEqual } from "node:crypto";

export type CctBridgeAuthorization =
  | "authorized"
  | "unauthorized"
  | "misconfigured";

export type CctHealthStatus = "healthy" | "degraded" | "unavailable";
export type CctRelationshipStage =
  | "roster"
  | "talking"
  | "first_date"
  | "consistent";
export type CctPersonPolicy =
  | "automatic"
  | "manual_only"
  | "never_contact";

type BridgeHandle = {
  channel?: unknown;
};

type BridgePersonInput = {
  _id: unknown;
  display_name?: unknown;
  status?: unknown;
  courtship_stage?: unknown;
  conversation_temperature?: unknown;
  last_inbound_at?: unknown;
  last_outbound_at?: unknown;
  next_followup_at?: unknown;
  next_best_move?: unknown;
  whitelist_for_autoreply?: unknown;
  handles?: unknown;
};

type BridgeConversationInput = {
  _id: unknown;
  person_id?: unknown;
  platform?: unknown;
  unread_count?: unknown;
  updated_at?: unknown;
  last_inbound_at?: unknown;
  last_outbound_at?: unknown;
  metadata?: unknown;
};

type BridgeScheduledInput = {
  _id: unknown;
  conversation_id?: unknown;
  scheduled_for?: unknown;
  status?: unknown;
  execution_mode?: unknown;
  provider_reference?: unknown;
  body?: unknown;
};

type BridgeMessageInput = {
  _id: unknown;
  direction?: unknown;
  body?: unknown;
  sent_at?: unknown;
  delivery_status?: unknown;
};

export interface CctBridgePersonV2 {
  id: string;
  displayLabel: string;
  stage: CctRelationshipStage;
  temperature: "hot" | "warm" | "cool" | "cold" | "dormant" | "unknown";
  lastContact: string | null;
  nextMove: string | null;
  nextFollowUpAt: string | null;
  channels: Array<"tinder" | "hinge" | "imessage">;
  conversations: Array<{
    id: string;
    platform: "tinder" | "hinge" | "imessage";
    version: number;
  }>;
  policy: CctPersonPolicy;
}

export interface CctSnapshotV2 {
  schemaVersion: 2;
  requestId: string;
  updatedAt: string;
  globalAutomation: { enabled: boolean };
  today: {
    needsReply: number;
    coolingOff: number;
    followUpDue: number;
    scheduledMessages: number;
    blockedCommands: number;
    providerAuthProblems: number;
  };
  sources: {
    people: { status: CctHealthStatus };
    conversations: { status: CctHealthStatus };
    calendar: { status: CctHealthStatus };
    runtime: { status: CctHealthStatus };
  };
  people: CctBridgePersonV2[];
  truncated: boolean;
}

export interface CctConversationPage {
  schemaVersion: 2;
  requestId: string;
  updatedAt: string;
  conversation: {
    id: string;
    personId: string | null;
    platform: "tinder" | "hinge" | "imessage";
    version: number;
  };
  messages: Array<{
    id: string;
    direction: "inbound" | "outbound";
    body: string;
    sentAt: string;
    deliveryState: string;
  }>;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CctSchedulePage {
  schemaVersion: 2;
  requestId: string;
  updatedAt: string;
  from: string;
  to: string;
  items: Array<{
    id: string;
    conversationId: string;
    personId: string | null;
    category: "message";
    platform: "tinder" | "hinge" | "imessage";
    executionMode: "smart" | "fixed";
    scheduledFor: string;
    state: string;
    providerReference: string | null;
  }>;
}

const MIN_BRIDGE_SECRET_LENGTH = 32;
const PEOPLE_LIMIT = 50;
const SUPPORTED_CHANNELS = new Set(["tinder", "hinge", "imessage"]);
const TEMPERATURES = new Set(["hot", "warm", "cool", "cold", "dormant"]);

function exactSecretMatch(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length
    && timingSafeEqual(actualBytes, expectedBytes)
  );
}

export function authorizeCctBridgeBearer(
  authorization: string | null | undefined,
  expectedSecret: string | null | undefined,
): CctBridgeAuthorization {
  const expected = expectedSecret?.trim() ?? "";
  if (expected.length < MIN_BRIDGE_SECRET_LENGTH) return "misconfigured";

  const prefix = "Bearer ";
  if (!authorization?.startsWith(prefix)) return "unauthorized";
  const actual = authorization.slice(prefix.length);
  return exactSecretMatch(actual, expected) ? "authorized" : "unauthorized";
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asIso(value: unknown): string | null {
  const timestamp = asFiniteNumber(value);
  return timestamp === null ? null : new Date(timestamp).toISOString();
}

function stageForPerson(person: BridgePersonInput): CctRelationshipStage {
  switch (person.courtship_stage) {
    case "early_chat":
    case "phone_swap":
      return "talking";
    case "pre_date":
    case "first_date_done":
      return "first_date";
    case "ongoing":
    case "exclusive":
      return "consistent";
    default:
      return "roster";
  }
}

function policyForPerson(person: BridgePersonInput): CctPersonPolicy {
  if (person.status === "ended") return "never_contact";
  return person.whitelist_for_autoreply === true
    ? "automatic"
    : "manual_only";
}

function channelsForPerson(
  person: BridgePersonInput,
  conversations: BridgeConversationInput[],
): CctBridgePersonV2["channels"] {
  const channels = new Set<string>();
  if (Array.isArray(person.handles)) {
    for (const entry of person.handles as BridgeHandle[]) {
      if (typeof entry?.channel === "string") channels.add(entry.channel);
    }
  }
  const personId = String(person._id);
  for (const conversation of conversations) {
    if (
      String(conversation.person_id ?? "") === personId
      && typeof conversation.platform === "string"
    ) {
      channels.add(conversation.platform);
    }
  }
  return [...channels]
    .filter((channel): channel is CctBridgePersonV2["channels"][number] =>
      SUPPORTED_CHANNELS.has(channel),
    )
    .sort();
}

function conversationsForPerson(
  person: BridgePersonInput,
  conversations: BridgeConversationInput[],
): CctBridgePersonV2["conversations"] {
  const personId = String(person._id);
  return conversations
    .filter((conversation) => String(conversation.person_id ?? "") === personId)
    .flatMap((conversation) => {
      const platform = supportedPlatform(conversation.platform);
      if (!platform) return [];
      return [{
        id: String(conversation._id),
        platform,
        version: asFiniteNumber(conversation.updated_at) ?? 0,
      }];
    })
    .sort((left, right) => right.version - left.version);
}

function safeDisplayLabel(person: BridgePersonInput): string {
  const candidate =
    typeof person.display_name === "string" ? person.display_name.trim() : "";
  return candidate.slice(0, 120) || "Unnamed contact";
}

export function buildCctSnapshotV2(input: {
  people: BridgePersonInput[];
  conversations: BridgeConversationInput[];
  scheduled: BridgeScheduledInput[];
  globalAutomationEnabled: boolean;
  now: number;
  requestId: string;
}): CctSnapshotV2 {
  const visiblePeople = input.people.slice(0, PEOPLE_LIMIT);
  const activeScheduled = input.scheduled.filter((row) =>
    ["pending", "accepted", "queued"].includes(String(row.status ?? "")),
  );

  const people = visiblePeople.map((person): CctBridgePersonV2 => {
    const lastInbound = asFiniteNumber(person.last_inbound_at);
    const lastOutbound = asFiniteNumber(person.last_outbound_at);
    const lastContact =
      lastInbound === null && lastOutbound === null
        ? null
        : new Date(Math.max(lastInbound ?? 0, lastOutbound ?? 0)).toISOString();
    const temperature =
      typeof person.conversation_temperature === "string"
      && TEMPERATURES.has(person.conversation_temperature)
        ? person.conversation_temperature as CctBridgePersonV2["temperature"]
        : "unknown";

    return {
      id: String(person._id),
      displayLabel: safeDisplayLabel(person),
      stage: stageForPerson(person),
      temperature,
      lastContact,
      nextMove:
        typeof person.next_best_move === "string"
          ? person.next_best_move.trim().slice(0, 240) || null
          : null,
      nextFollowUpAt: asIso(person.next_followup_at),
      channels: channelsForPerson(person, input.conversations),
      conversations: conversationsForPerson(person, input.conversations),
      policy: policyForPerson(person),
    };
  });

  const needsReply = input.conversations.filter((conversation) =>
    asFiniteNumber(conversation.unread_count) !== null
    && Number(conversation.unread_count) > 0,
  ).length;
  const followUpDue = visiblePeople.filter((person) => {
    const nextFollowUp = asFiniteNumber(person.next_followup_at);
    return nextFollowUp !== null && nextFollowUp <= input.now;
  }).length;

  return {
    schemaVersion: 2,
    requestId: input.requestId,
    updatedAt: new Date(input.now).toISOString(),
    globalAutomation: { enabled: input.globalAutomationEnabled },
    today: {
      needsReply,
      coolingOff: 0,
      followUpDue,
      scheduledMessages: activeScheduled.length,
      blockedCommands: 0,
      providerAuthProblems: 0,
    },
    sources: {
      people: { status: "healthy" },
      conversations: { status: "healthy" },
      calendar: { status: "healthy" },
      runtime: { status: "healthy" },
    },
    people,
    truncated: input.people.length > PEOPLE_LIMIT,
  };
}

function supportedPlatform(
  value: unknown,
): "tinder" | "hinge" | "imessage" | null {
  return typeof value === "string" && SUPPORTED_CHANNELS.has(value)
    ? value as "tinder" | "hinge" | "imessage"
    : null;
}

export function buildCctConversationPage(input: {
  conversation: BridgeConversationInput;
  messages: BridgeMessageInput[];
  cursor: string | null;
  limit: number;
  requestId: string;
  now: number;
}): CctConversationPage {
  const platform = supportedPlatform(input.conversation.platform);
  if (!platform) throw new Error("unsupported_platform");
  const boundedLimit = Math.min(Math.max(Math.floor(input.limit), 1), 100);
  const cursorIndex = input.cursor
    ? input.messages.findIndex((message) => String(message._id) === input.cursor)
    : -1;
  const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  const source = input.messages.slice(start, start + boundedLimit);
  const hasMore = start + source.length < input.messages.length;
  const direction = (value: unknown): "inbound" | "outbound" =>
    value === "outbound" ? "outbound" : "inbound";

  return {
    schemaVersion: 2,
    requestId: input.requestId,
    updatedAt: new Date(input.now).toISOString(),
    conversation: {
      id: String(input.conversation._id),
      personId: input.conversation.person_id
        ? String(input.conversation.person_id)
        : null,
      platform,
      version: asFiniteNumber(input.conversation.updated_at) ?? 0,
    },
    messages: source.map((message) => ({
      id: String(message._id),
      direction: direction(message.direction),
      body:
        typeof message.body === "string"
          ? message.body.slice(0, 10_000)
          : "",
      sentAt: new Date(asFiniteNumber(message.sent_at) ?? 0).toISOString(),
      deliveryState:
        typeof message.delivery_status === "string"
          ? message.delivery_status.slice(0, 80)
          : direction(message.direction) === "inbound"
            ? "received"
            : "unknown",
    })),
    nextCursor:
      hasMore && source.length > 0
        ? String(source[source.length - 1]._id)
        : null,
    hasMore,
  };
}

export function buildCctSchedulePage(input: {
  rows: BridgeScheduledInput[];
  conversations: BridgeConversationInput[];
  from: number;
  to: number;
  requestId: string;
  now: number;
}): CctSchedulePage {
  const conversations = new Map(
    input.conversations.map((conversation) => [
      String(conversation._id),
      conversation,
    ]),
  );
  const items = input.rows.flatMap((row) => {
    const scheduledFor = asFiniteNumber(row.scheduled_for);
    if (
      scheduledFor === null
      || scheduledFor < input.from
      || scheduledFor > input.to
    ) {
      return [];
    }
    const conversationId = String(row.conversation_id ?? "");
    const conversation = conversations.get(conversationId);
    const platform = supportedPlatform(conversation?.platform);
    if (!conversation || !platform) return [];
    return [{
      id: String(row._id),
      conversationId,
      personId: conversation.person_id
        ? String(conversation.person_id)
        : null,
      category: "message" as const,
      platform,
      executionMode: row.execution_mode === "smart" ? "smart" as const : "fixed" as const,
      scheduledFor: new Date(scheduledFor).toISOString(),
      state: typeof row.status === "string" ? row.status.slice(0, 80) : "unknown",
      providerReference:
        typeof row.provider_reference === "string"
          ? row.provider_reference.slice(0, 240)
          : null,
    }];
  });

  return {
    schemaVersion: 2,
    requestId: input.requestId,
    updatedAt: new Date(input.now).toISOString(),
    from: new Date(input.from).toISOString(),
    to: new Date(input.to).toISOString(),
    items: items.slice(0, 200),
  };
}
