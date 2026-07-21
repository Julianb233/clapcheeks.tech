export interface ClaimedJob {
  status?: string;
  locked_by?: string;
  attempts?: number;
}

export function claimContextMatches(
  job: ClaimedJob,
  agentInstanceId?: string,
  claimAttempt?: number,
): boolean {
  if (agentInstanceId === undefined && claimAttempt === undefined) return true;
  if (!agentInstanceId || claimAttempt === undefined) return false;
  return (
    job.status === "running" &&
    job.locked_by === agentInstanceId &&
    job.attempts === claimAttempt
  );
}
