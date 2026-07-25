import { describe, expect, it } from "vitest";
import { approvalFingerprint } from "@/lib/conversation-ai/approval-envelope";

describe("CCT exact approval envelope", () => {
  it("binds recipient, channel, exact body, and source packet", async () => {
    const input = {
      recipient: "person_1",
      channel: "iMessage",
      exactBody: "thursday or saturday?",
      sourcePacketId: "touch:1",
    };
    const approved = await approvalFingerprint(input);
    expect(approved).toHaveLength(64);
    expect(
      await approvalFingerprint({ ...input, exactBody: "friday or saturday?" }),
    ).not.toBe(approved);
    expect(
      await approvalFingerprint({ ...input, recipient: "person_2" }),
    ).not.toBe(approved);
    expect(
      await approvalFingerprint({ ...input, channel: "hinge" }),
    ).not.toBe(approved);
  });
});
