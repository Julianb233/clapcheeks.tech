import { describe, expect, it } from "vitest";

import {
  buildMorningSwipeJobs,
  pacificWindowKey,
} from "../lib/autonomy/morning-schedule";

describe("Pacific morning scheduling", () => {
  it("opens at 8am Pacific during daylight saving time", () => {
    expect(
      pacificWindowKey(Date.parse("2026-07-21T15:05:00Z"), "digest"),
    ).toBe("digest:2026-07-21");
  });

  it("opens at 8am Pacific during standard time", () => {
    expect(
      pacificWindowKey(Date.parse("2026-12-21T16:05:00Z"), "digest"),
    ).toBe("digest:2026-12-21");
  });

  it("stays closed before 8am and after the recovery window", () => {
    expect(
      pacificWindowKey(Date.parse("2026-07-21T14:59:00Z"), "digest"),
    ).toBeNull();
    expect(
      pacificWindowKey(Date.parse("2026-07-21T19:00:00Z"), "digest"),
    ).toBeNull();
  });
});

describe("morning swipe jobs", () => {
  it("builds one bounded Tinder job and one bounded Hinge job", () => {
    expect(buildMorningSwipeJobs("swipes:2026-07-21")).toEqual([
      {
        platform: "tinder",
        max_swipes: 12,
        like_ratio: 0.25,
        schedule_key: "swipes:2026-07-21:tinder",
        source: "morning_cron",
      },
      {
        platform: "hinge",
        max_swipes: 8,
        like_ratio: 0.25,
        schedule_key: "swipes:2026-07-21:hinge",
        source: "morning_cron",
      },
    ]);
  });
});
