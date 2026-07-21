export interface ClaimedJob {
  status?: string;
  locked_by?: string;
  locked_until?: number;
  attempts?: number;
}

export function claimContextMatches(
  job: ClaimedJob,
  agentInstanceId: string | undefined,
  claimAttempt: number | undefined,
  now: number = Date.now(),
): boolean {
  return (
    Boolean(agentInstanceId) &&
    Number.isInteger(claimAttempt) &&
    Number(claimAttempt) > 0 &&
    job.status === "running" &&
    job.locked_by === agentInstanceId &&
    job.attempts === claimAttempt &&
    typeof job.locked_until === "number" &&
    job.locked_until > now
  );
}
