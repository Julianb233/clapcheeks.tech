import { describe, expect, it } from "vitest";

import {
  authorizeCctBridgeBearer,
  buildCctConversationPage,
  buildCctSchedulePage,
  buildCctSnapshotV2,
  CCT_PEOPLE_QUERY_LIMIT,
} from "../lib/integrations/juliboop/cct-bridge";

const TOKEN = "bridge-test-token-with-at-least-32-characters";

describe("JuliBoop CCT read bridge", () => {
  it("fails closed when the deployment secret is missing and compares callers exactly", () => {
    expect(authorizeCctBridgeBearer(`Bearer ${TOKEN}`, TOKEN)).toBe("authorized");
    expect(
      authorizeCctBridgeBearer(
        "Bearer wrong-but-long-enough-token-value",
        TOKEN,
      ),
    ).toBe("unauthorized");
    expect(authorizeCctBridgeBearer(`Bearer ${TOKEN}`, undefined)).toBe(
      "misconfigured",
    );
  });

  it("builds a bounded schema-v2 snapshot without provider or job secrets", () => {
    const now = Date.UTC(2026, 6, 27, 20, 0, 0);
    const people = Array.from({ length: 55 }, (_, index) => ({
      _id: `person_${index}`,
      display_name: index === 0 ? "Example Person" : undefined,
      status: "active",
      courtship_stage: index === 0 ? "early_chat" : undefined,
      conversation_temperature: index === 0 ? "warm" : undefined,
      last_inbound_at: now - 60_000,
      last_outbound_at: now - 120_000,
      next_followup_at: index === 0 ? now - 1 : now + 86_400_000,
      next_best_move: index === 0 ? "Reply with the approved draft" : undefined,
      whitelist_for_autoreply: index === 0,
      handles: [
        {
          channel: index === 0 ? "hinge" : "bumble",
          value: "provider-handle-must-not-leak",
        },
      ],
      raw_payload: "must-not-leak",
    }));
    const conversations = [
      {
        _id: "conversation_1",
        person_id: "person_0",
        platform: "hinge",
        unread_count: 1,
        updated_at: now - 30_000,
        last_inbound_at: now - 60_000,
        last_outbound_at: now - 120_000,
        metadata: { token: "must-not-leak" },
      },
    ];
    const scheduled = [
      {
        _id: "scheduled_1",
        user_id: "fleet-user",
        conversation_id: "conversation_1",
        scheduled_for: now + 60_000,
        status: "pending",
        body: "must-not-leak-from-snapshot",
      },
    ];

    const snapshot = buildCctSnapshotV2({
      people,
      conversations,
      scheduled,
      globalAutomationEnabled: true,
      now,
      requestId: "request_test",
    });

    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.globalAutomation).toEqual({ enabled: true });
    expect(snapshot.people).toHaveLength(50);
    expect(Object.keys(snapshot.people[0])).toEqual([
      "id",
      "displayLabel",
      "stage",
      "temperature",
      "lastContact",
      "nextMove",
      "nextFollowUpAt",
      "channels",
      "conversations",
      "policy",
    ]);
    expect(snapshot.people[0]).toMatchObject({
      id: "person_0",
      displayLabel: "Example Person",
      stage: "talking",
      temperature: "warm",
      channels: ["hinge"],
      conversations: [
        {
          id: "conversation_1",
          platform: "hinge",
          version: now - 30_000,
        },
      ],
      policy: "automatic",
    });
    expect(snapshot.today).toMatchObject({
      needsReply: 1,
      followUpDue: 1,
      scheduledMessages: 1,
    });
    expect(snapshot.truncated).toBe(true);

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toMatch(
      /provider-handle|raw_payload|job_payload|must-not-leak/i,
    );
    expect(serialized).not.toMatch(/"token"/i);
  });

  it("keeps the schema-v1 person projection intact inside schema v2", () => {
    const snapshot = buildCctSnapshotV2({
      people: [
        {
          _id: "person_opaque",
          display_name: "Example",
          status: "lead",
          whitelist_for_autoreply: false,
          handles: [],
        },
      ],
      conversations: [],
      scheduled: [],
      globalAutomationEnabled: false,
      now: 0,
      requestId: "request_v1_compat",
    });

    expect(snapshot.people[0]).toMatchObject({
      id: "person_opaque",
      displayLabel: "Example",
      stage: "roster",
      temperature: "unknown",
      lastContact: null,
      nextMove: null,
      nextFollowUpAt: null,
      channels: [],
      conversations: [],
      policy: "manual_only",
    });
  });

  it("excludes archived people from CCT without deleting their canonical rows", () => {
    const snapshot = buildCctSnapshotV2({
      people: [
        {
          _id: "person_active",
          display_name: "Active Person",
          status: "active",
        },
        {
          _id: "person_archived",
          display_name: "Archived Person",
          status: "active",
          archived_at: 1_000,
        },
      ],
      conversations: [],
      scheduled: [],
      globalAutomationEnabled: false,
      now: 2_000,
      requestId: "request_archive_filter",
    });

    expect(snapshot.people.map((person) => person.id)).toEqual(["person_active"]);
    expect(snapshot.truncated).toBe(false);
  });

  it("queries the full supported roster before filtering archived people", () => {
    expect(CCT_PEOPLE_QUERY_LIMIT).toBe(2_000);

    const snapshot = buildCctSnapshotV2({
      people: [
        ...Array.from({ length: 51 }, (_, index) => ({
          _id: `person_archived_${index}`,
          display_name: `Archived Person ${index}`,
          status: "active",
          archived_at: 1_000 + index,
        })),
        {
          _id: "person_active_after_archived_page",
          display_name: "Active Person",
          status: "active",
        },
      ],
      conversations: [],
      scheduled: [],
      globalAutomationEnabled: false,
      now: 2_000,
      requestId: "request_full_roster_filter",
    });

    expect(snapshot.people.map((person) => person.id)).toEqual([
      "person_active_after_archived_page",
    ]);
    expect(snapshot.truncated).toBe(false);
  });

  it("sanitizes and bounds a conversation page", () => {
    const page = buildCctConversationPage({
      conversation: {
        _id: "conversation_opaque",
        person_id: "person_opaque",
        platform: "hinge",
        updated_at: 100,
        metadata: { token: "must-not-leak" },
      },
      messages: Array.from({ length: 105 }, (_, index) => ({
        _id: `message_${index}`,
        direction: index % 2 ? "outbound" : "inbound",
        body: `safe message ${index}`,
        sent_at: index,
        delivery_status: index % 2 ? "sent" : undefined,
        raw_payload: { token: "must-not-leak" },
      })),
      cursor: null,
      limit: 100,
      requestId: "request_conversation",
      now: 1_000,
    });

    expect(page.messages).toHaveLength(100);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe("message_99");
    expect(page.messages[0]).toEqual({
      id: "message_0",
      direction: "inbound",
      body: "safe message 0",
      sentAt: "1970-01-01T00:00:00.000Z",
      deliveryState: "received",
    });
    expect(JSON.stringify(page)).not.toMatch(/raw_payload|must-not-leak|token/i);
  });

  it("returns only bounded schedule metadata and never message bodies", () => {
    const page = buildCctSchedulePage({
      rows: [
        {
          _id: "scheduled_opaque",
          conversation_id: "conversation_opaque",
          scheduled_for: 2_000,
          execution_mode: "smart",
          status: "queued",
          body: "must-not-leak",
          provider_reference: "provider_opaque",
        },
      ],
      conversations: [
        {
          _id: "conversation_opaque",
          person_id: "person_opaque",
          platform: "tinder",
        },
      ],
      from: 1_000,
      to: 3_000,
      requestId: "request_schedule",
      now: 1_500,
    });

    expect(page.items).toEqual([
      {
        id: "scheduled_opaque",
        conversationId: "conversation_opaque",
        personId: "person_opaque",
        category: "message",
        platform: "tinder",
        executionMode: "smart",
        scheduledFor: "1970-01-01T00:00:02.000Z",
        state: "queued",
        providerReference: "provider_opaque",
      },
    ]);
    expect(JSON.stringify(page)).not.toContain("must-not-leak");
  });
});
