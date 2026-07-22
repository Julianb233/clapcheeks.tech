import { describe, expect, it } from "vitest";
import { deriveConversationDirectionState } from "@/lib/tinder-direction-repair";

describe("deriveConversationDirectionState", () => {
  it("removes repaired outbound rows from inbound and unread state", () => {
    expect(deriveConversationDirectionState([
      { direction: "outbound", sent_at: 100 },
      { direction: "inbound", sent_at: 200, read_at: 250 },
      { direction: "outbound", sent_at: 300 },
      { direction: "inbound", sent_at: 400 },
      { direction: "outbound", sent_at: 500 },
    ])).toEqual({
      last_message_at: 500,
      last_inbound_at: 400,
      last_outbound_at: 500,
      unread_count: 1,
    });
  });

  it("clears inbound state when every imported row is outbound", () => {
    expect(deriveConversationDirectionState([
      { direction: "outbound", sent_at: 100 },
      { direction: "outbound", sent_at: 200 },
    ])).toEqual({
      last_message_at: 200,
      last_inbound_at: undefined,
      last_outbound_at: 200,
      unread_count: 0,
    });
  });
});
