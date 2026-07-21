import { describe, expect, it } from "vitest";

import { claimContextMatches } from "../lib/agent-jobs/lease";

describe("agent job lease ownership", () => {
  const runningJob = {
    status: "running",
    locked_by: "mac-1",
    locked_until: 2_000,
    attempts: 2,
  };

  it("accepts the agent and attempt that claimed the job", () => {
    expect(claimContextMatches(runningJob, "mac-1", 2, 1_000)).toBe(true);
  });

  it("rejects stale attempts and different agents", () => {
    expect(claimContextMatches(runningJob, "mac-1", 1, 1_000)).toBe(false);
    expect(claimContextMatches(runningJob, "mac-2", 2, 1_000)).toBe(false);
  });

  it("rejects missing ownership and expired leases", () => {
    expect(claimContextMatches(runningJob, undefined, undefined, 1_000)).toBe(false);
    expect(claimContextMatches(runningJob, "mac-1", undefined, 1_000)).toBe(false);
    expect(claimContextMatches(runningJob, "mac-1", 2, 2_000)).toBe(false);
  });
});
