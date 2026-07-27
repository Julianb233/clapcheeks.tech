import { describe, expect, it } from "vitest";

import {
  CctCommandError,
  buildApprovalEnvelope,
  buildDatingMutationSnapshot,
  parseCctCommand,
} from "../lib/integrations/juliboop/cct-commands";

describe("JuliBoop CCT command bridge", () => {
  it("accepts the closed command union and strips no unknown fields", () => {
    expect(
      parseCctCommand({
        type: "set_person_policy",
        personId: "person_opaque",
        policy: "automatic",
      }),
    ).toEqual({
      type: "set_person_policy",
      personId: "person_opaque",
      policy: "automatic",
    });
    expect(() =>
      parseCctCommand({
        type: "set_person_policy",
        personId: "person_opaque",
        policy: "automatic",
        unexpected: true,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "invalid_command" }),
    );
  });

  it("rejects invalid schedule timestamps and oversized bodies", () => {
    expect(() =>
      parseCctCommand({
        type: "schedule_message",
        conversationId: "conversation_opaque",
        body: "hello",
        scheduledFor: "not-a-date",
        executionMode: "smart",
        expectedConversationVersion: 1,
      }),
    ).toThrow(/scheduledFor/);
    expect(() =>
      parseCctCommand({
        type: "send_now",
        conversationId: "conversation_opaque",
        body: "x".repeat(4_001),
        expectedConversationVersion: 1,
      }),
    ).toThrow(/body/);
  });

  it("returns a stable unsupported-platform error for Facebook Dating", () => {
    expect(() =>
      parseCctCommand({
        type: "send_now",
        conversationId: "conversation_opaque",
        body: "hello",
        expectedConversationVersion: 1,
        platform: "facebook_dating",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "unsupported_platform" }),
    );
  });

  it("binds an approval envelope to exact recipient, provider, body, and packet", () => {
    const envelope = buildApprovalEnvelope({
      recipient: "person_opaque",
      channel: "hinge",
      exactFinalText: "Exact approved text",
      sourcePacketId: "packet_opaque",
      now: 1_000,
      ttlMs: 60_000,
    });

    expect(envelope).toEqual({
      verified_recipient: "person_opaque",
      verified_channel: "hinge",
      exact_final_text: "Exact approved text",
      approval_timestamp: 1_000,
      expires_at: 61_000,
      source_packet_id: "packet_opaque",
      recipient_channel_body_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(
      buildApprovalEnvelope({
        recipient: "person_opaque",
        channel: "hinge",
        exactFinalText: "Exact approved text",
        sourcePacketId: "packet_opaque",
        now: 1_000,
        ttlMs: 60_000,
      }),
    ).toEqual(envelope);
  });

  it("exposes classified command errors without leaking input", () => {
    const error = new CctCommandError("invalid_command", "Invalid command");
    expect(error.code).toBe("invalid_command");
    expect(JSON.stringify(error)).not.toContain("secret");
  });

  it("builds a content-free deterministic conversation version envelope", () => {
    const snapshot = buildDatingMutationSnapshot(
      {
        _id: "conversation_opaque",
        updated_at: 100,
        status: "active",
        external_match_id: "match_opaque",
        person_id: "person_opaque",
        metadata: { sendbird_channel_url: "channel_opaque" },
      },
      [
        {
          _id: "message_1",
          direction: "inbound",
          body: "Private body",
          sent_at: 200,
        },
      ],
    );

    expect(snapshot).toEqual({
      schema_version: 1,
      conversation_id: "conversation_opaque",
      conversation_version:
        "e3c8dd952507894f1577223f5a1250595237332498b3ed8a18e566479efb9690",
      message_version:
        "bcc0a97ccfb0b6bb6f7e927c83adaf4d2966b99cdee84f8b07f754b541095f07",
      latest_message_id: "message_1",
      latest_message_sent_at_ms: 200,
      latest_message_direction: "inbound",
      message_count: 1,
    });
    expect(JSON.stringify(snapshot)).not.toContain("Private body");
    expect(buildDatingMutationSnapshot(
      {
        _id: "conversation_opaque",
        updated_at: 100,
        status: "active",
        external_match_id: "match_opaque",
        person_id: "person_opaque",
        metadata: { sendbird_channel_url: "channel_opaque" },
      },
      [
        {
          _id: "message_1",
          direction: "inbound",
          body: "Private body",
          sent_at: 200,
        },
      ],
    )).toEqual(snapshot);
  });
});
