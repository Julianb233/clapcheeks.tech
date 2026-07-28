import { describe, expect, it } from "vitest";

import {
  buildScheduledMessageDispatch,
  scheduledReceiptPatchFromJobResult,
  type ScheduledDispatchInput,
} from "../lib/integrations/juliboop/scheduled-dispatch";

function baseInput(
  platform: ScheduledDispatchInput["platform"],
): ScheduledDispatchInput {
  return {
    platform,
    scheduledMessageId: "scheduled_opaque",
    conversationId: "conversation_opaque",
    personId: "person_opaque",
    userId: "fleet-user",
    body: "Exact approved text",
    executionMode: "fixed",
    expectedConversationUpdatedAt: 100,
    conversationUpdatedAt: 100,
    externalMatchId: "external_opaque",
    metadata: {},
  };
}

describe("scheduled message provider dispatch", () => {
  it.each([
    ["hinge", "send_hinge"],
    ["tinder", "send_tinder"],
    ["imessage", "send_imessage"],
  ] as const)("maps %s to a real provider job", (platform, jobType) => {
    const dispatch = buildScheduledMessageDispatch(baseInput(platform));

    expect(dispatch).toEqual({
      kind: "job",
      jobType,
      payload: expect.objectContaining({
        body: "Exact approved text",
        conversation_id: "conversation_opaque",
        person_id: "person_opaque",
        source_scheduled_message_id: "scheduled_opaque",
      }),
    });
    expect(dispatch).not.toHaveProperty("message");
    expect(JSON.stringify(dispatch)).not.toMatch(/direction.*outbound/i);
  });

  it("blocks a smart schedule when conversation state changed", () => {
    const dispatch = buildScheduledMessageDispatch({
      ...baseInput("hinge"),
      executionMode: "smart",
      expectedConversationUpdatedAt: 100,
      conversationUpdatedAt: 101,
    });

    expect(dispatch).toEqual({
      kind: "blocked",
      reasonCode: "conversation_version_conflict",
    });
  });

  it("fails closed for an unsupported platform", () => {
    expect(
      buildScheduledMessageDispatch({
        ...baseInput("other"),
        platform: "other",
      }),
    ).toEqual({
      kind: "blocked",
      reasonCode: "unsupported_platform",
    });
  });

  it("passes only platform-specific routing metadata", () => {
    const hinge = buildScheduledMessageDispatch({
      ...baseInput("hinge"),
      metadata: {
        sendbird_channel_url: "channel_opaque",
        token: "must-not-copy",
      },
    });
    const tinder = buildScheduledMessageDispatch({
      ...baseInput("tinder"),
      metadata: {
        match_id: "match_opaque",
        session_token: "must-not-copy",
      },
    });
    const imessage = buildScheduledMessageDispatch({
      ...baseInput("imessage"),
      metadata: {
        handle: "handle_opaque",
        chat_db_path: "must-not-copy",
      },
    });

    expect(hinge).toMatchObject({
      kind: "job",
      payload: { sendbird_channel_url: "channel_opaque" },
    });
    expect(tinder).toMatchObject({
      kind: "job",
      payload: { match_id: "match_opaque" },
    });
    expect(imessage).toMatchObject({
      kind: "job",
      payload: { handle: "handle_opaque" },
    });
    expect(JSON.stringify({ hinge, tinder, imessage })).not.toMatch(
      /must-not-copy|session_token|chat_db_path/i,
    );
  });

  it("never promotes an unverified provider completion to delivered", () => {
    expect(
      scheduledReceiptPatchFromJobResult(
        { sent: true, provider_reference: "provider_opaque" },
        500,
      ),
    ).toEqual({
      status: "sent",
      provider_reference: "provider_opaque",
      failure_reason: undefined,
      updated_at: 500,
    });
    expect(
      scheduledReceiptPatchFromJobResult(
        {
          sent: true,
          readback_verified: true,
          provider_reference: "provider_verified",
        },
        600,
      ),
    ).toEqual({
      status: "delivered",
      provider_reference: "provider_verified",
      delivered_at: 600,
      failure_reason: undefined,
      updated_at: 600,
    });
  });

  it("records skipped and ambiguous completions as blocked", () => {
    expect(
      scheduledReceiptPatchFromJobResult(
        { skipped: true, reason: "exact_approval_required" },
        700,
      ),
    ).toEqual({
      status: "blocked",
      failure_reason: "exact_approval_required",
      updated_at: 700,
    });
    expect(
      scheduledReceiptPatchFromJobResult(
        { sent: true, outbound_ambiguous: true },
        800,
      ),
    ).toEqual({
      status: "blocked",
      failure_reason: "provider_readback_ambiguous",
      updated_at: 800,
    });
  });
});
