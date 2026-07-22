export type Direction = "inbound" | "outbound";

export type DirectionStateMessage = {
  direction: Direction;
  sent_at: number;
  read_at?: number;
};

export function deriveConversationDirectionState(
  messages: DirectionStateMessage[],
): {
  last_message_at?: number;
  last_inbound_at?: number;
  last_outbound_at?: number;
  unread_count: number;
} {
  let lastMessageAt: number | undefined;
  let lastInboundAt: number | undefined;
  let lastOutboundAt: number | undefined;
  let unreadCount = 0;

  for (const message of messages) {
    if (!Number.isFinite(message.sent_at)) continue;
    lastMessageAt = Math.max(lastMessageAt ?? 0, message.sent_at);
    if (message.direction === "inbound") {
      lastInboundAt = Math.max(lastInboundAt ?? 0, message.sent_at);
      if (message.read_at === undefined) unreadCount += 1;
    } else {
      lastOutboundAt = Math.max(lastOutboundAt ?? 0, message.sent_at);
    }
  }

  return {
    last_message_at: lastMessageAt,
    last_inbound_at: lastInboundAt,
    last_outbound_at: lastOutboundAt,
    unread_count: unreadCount,
  };
}
