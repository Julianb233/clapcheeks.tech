export interface MorningSwipeJob {
  platform: "tinder" | "hinge";
  max_swipes: number;
  like_ratio: number;
  schedule_key: string;
  source: "morning_cron";
}

export function pacificWindowKey(
  nowMs: number,
  prefix: string,
): string | null {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(nowMs));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(values.hour);
  if (hour < 8 || hour >= 12) return null;
  return `${prefix}:${values.year}-${values.month}-${values.day}`;
}

export function buildMorningSwipeJobs(baseKey: string): MorningSwipeJob[] {
  return [
    {
      platform: "tinder",
      max_swipes: 12,
      like_ratio: 0.25,
      schedule_key: `${baseKey}:tinder`,
      source: "morning_cron",
    },
    {
      platform: "hinge",
      max_swipes: 8,
      like_ratio: 0.25,
      schedule_key: `${baseKey}:hinge`,
      source: "morning_cron",
    },
  ];
}
