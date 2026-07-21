import { describe, expect, it } from "vitest";

import { claimContextMatches } from "../lib/agent-jobs/lease";

describe("agent job lease ownership", () => {
  const runningJob = {
    status: "running",
    locked_by: "mac-1",
    attempts: 2,
  };

  it("accepts the agent and attempt that claimed the job", () => {
    expect(claimContextMatches(runningJob, "mac-1", 2)).toBe(true);
  });

  it("rejects stale attempts and different agents", () => {
    expect(claimContextMatches(runningJob, "mac-1", 1)).toBe(false);
    expect(claimContextMatches(runningJob, "mac-2", 2)).toBe(false);
  });

  it("keeps legacy callers compatible only when both fields are omitted", () => {
    expect(claimContextMatches(runningJob, undefined, undefined)).toBe(true);
    expect(claimContextMatches(runningJob, "mac-1", undefined)).toBe(false);
  });
});
