import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  claim,
  claimByTypes,
  complete,
  enqueue,
  enqueueAt,
  fail,
  failPermanent,
  renewLease,
} from "../convex/agent_jobs";

const NOW = 1_800_000_000_000;
const SECRET = "dating-secret-fixture";
const ELECTED_RUNNER = "clapcheeks-primary-dating-v2-test";

type MutationFunction = {
  _handler: (ctx: any, args: Record<string, unknown>) => Promise<any>;
  exportArgs: () => string;
};

function invoke(
  fn: unknown,
  ctx: any,
  args: Record<string, unknown>,
) {
  return (fn as MutationFunction)._handler(ctx, args);
}

function job(id: string, jobType: string, status = "queued") {
  return {
    _id: id,
    _creationTime: NOW - 10_000,
    user_id: "fleet-julian",
    job_type: jobType,
    payload: {},
    status,
    priority: 0,
    attempts: status === "running" ? 2 : 0,
    max_attempts: 3,
    locked_by: status === "running" ? ELECTED_RUNNER : undefined,
    locked_until: status === "running" ? NOW + 60_000 : undefined,
    created_at: NOW - 10_000,
    updated_at: NOW - 5_000,
  };
}

function harness(seed: ReturnType<typeof job>[]) {
  let rows = seed.map((row) => ({ ...row }));
  const collect = vi.fn(async () => rows.map((row) => ({ ...row })));
  const order = vi.fn(() => ({ collect }));
  const withIndex = vi.fn(() => ({ order }));
  const query = vi.fn(() => ({ withIndex }));
  const patch = vi.fn(async (id: string, values: Record<string, unknown>) => {
    rows = rows.map((row) => row._id === id ? { ...row, ...values } : row);
  });
  const get = vi.fn(async (id: string) =>
    rows.find((row) => row._id === id) ?? null);
  const insert = vi.fn(async () => "inserted-job");
  const runAt = vi.fn(async () => "scheduled-job");
  return {
    ctx: { db: { query, patch, get, insert }, scheduler: { runAt } },
    patch,
    insert,
    runAt,
    rows: () => rows,
  };
}

let priorSecret: string | undefined;

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  priorSecret = process.env.CONVEX_DATING_RUNNER_SECRET;
  process.env.CONVEX_DATING_RUNNER_SECRET = SECRET;
});

afterEach(() => {
  if (priorSecret === undefined) delete process.env.CONVEX_DATING_RUNNER_SECRET;
  else process.env.CONVEX_DATING_RUNNER_SECRET = priorSecret;
  vi.restoreAllMocks();
});

describe("agent job dating runner authorization", () => {
  const protectedTypes = [
    "send_hinge",
    "send_tinder",
    "cadence_evaluate_one",
    "drip_reengagement",
    "run_swipe",
    "sync_hinge",
    "sync_tinder",
  ];

  test.each([undefined, "wrong-secret"])(
    "claimByTypes rejects every protected type with capability %s",
    async (provided) => {
      for (const jobType of protectedTypes) {
        const state = harness([job(`job-${jobType}`, jobType)]);
        await expect(invoke(claimByTypes, state.ctx, {
          user_id: "fleet-julian",
          agent_instance_id: ELECTED_RUNNER,
          allowed_job_types: [jobType],
          ...(provided ? { dating_runner_secret: provided } : {}),
        })).rejects.toThrow("Dating runner authorization failed");
        expect(state.patch).not.toHaveBeenCalled();
      }
    },
  );

  test("claimByTypes fails closed when the server secret is unset", async () => {
    delete process.env.CONVEX_DATING_RUNNER_SECRET;
    const state = harness([job("dating-job", "send_hinge")]);
    await expect(invoke(claimByTypes, state.ctx, {
      user_id: "fleet-julian",
      agent_instance_id: ELECTED_RUNNER,
      allowed_job_types: ["send_hinge"],
      dating_runner_secret: SECRET,
    })).rejects.toThrow("Dating runner authorization failed");
    expect(state.patch).not.toHaveBeenCalled();
  });

  test("the capability claims protected work", async () => {
    const state = harness([job("dating-job", "send_tinder")]);
    const result = await invoke(claimByTypes, state.ctx, {
      user_id: "fleet-julian",
      agent_instance_id: ELECTED_RUNNER,
      allowed_job_types: ["send_tinder"],
      dating_runner_secret: SECRET,
      lock_seconds: 60,
    });
    expect(result).toMatchObject({
      _id: "dating-job",
      status: "running",
      locked_by: ELECTED_RUNNER,
      attempts: 1,
    });
  });

  test("the capability cannot authorize a non-elected dating runner", async () => {
    const state = harness([job("dating-job", "send_tinder")]);
    await expect(invoke(claimByTypes, state.ctx, {
      user_id: "fleet-julian",
      agent_instance_id: "macbook16-dating-stale",
      allowed_job_types: ["send_tinder"],
      dating_runner_secret: SECRET,
    })).rejects.toThrow("Dating runner authorization failed");
    expect(state.patch).not.toHaveBeenCalled();
  });

  test("a mixed protected request rejects instead of falling through", async () => {
    const state = harness([
      job("dating-job", "send_hinge"),
      job("ordinary-job", "enrich_person"),
    ]);
    await expect(invoke(claimByTypes, state.ctx, {
      user_id: "fleet-julian",
      agent_instance_id: "stale-runner",
      allowed_job_types: ["send_hinge", "enrich_person"],
    })).rejects.toThrow("Dating runner authorization failed");
    expect(state.patch).not.toHaveBeenCalled();
  });

  test("broad claim skips protected and calendar-only jobs", async () => {
    const state = harness([
      job("dating-job", "send_tinder"),
      job("calendar-job", "create_date_event"),
      job("ordinary-job", "enrich_person"),
    ]);
    const result = await invoke(claim, state.ctx, {
      user_id: "fleet-julian",
      agent_instance_id: "stale-runner",
    });
    expect(result._id).toBe("ordinary-job");
    expect(state.rows().find((row) => row._id === "dating-job")?.status).toBe("queued");
    expect(state.rows().find((row) => row._id === "calendar-job")?.status).toBe("queued");
  });

  test("broad claim returns null when only protected jobs exist", async () => {
    const state = harness([job("dating-job", "run_swipe")]);
    await expect(invoke(claim, state.ctx, {
      user_id: "fleet-julian",
      agent_instance_id: "stale-runner",
    })).resolves.toBeNull();
    expect(state.patch).not.toHaveBeenCalled();
  });

  test("calendar work remains claimable only by the existing VPS worker", async () => {
    const state = harness([job("calendar-job", "create_date_event")]);
    const result = await invoke(claimByTypes, state.ctx, {
      user_id: "fleet-julian",
      agent_instance_id: "vps-cal-prod-123",
      allowed_job_types: ["create_date_event"],
    });
    expect(result._id).toBe("calendar-job");
  });

  test.each([enqueue, enqueueAt])(
    "protected enqueue endpoint %s requires the full runner identity",
    async (fn) => {
      const state = harness([]);
      const args = {
        user_id: "fleet-julian",
        job_type: "send_hinge",
        payload: {},
        ...(fn === enqueueAt ? { run_at: NOW + 60_000 } : {}),
      };
      await expect(invoke(fn, state.ctx, args)).rejects.toThrow(
        "Dating runner authorization failed",
      );
      expect(state.insert).not.toHaveBeenCalled();
      expect(state.runAt).not.toHaveBeenCalled();
    },
  );

  test.each([enqueue, enqueueAt])(
    "protected enqueue endpoint %s rejects a capable non-elected runner",
    async (fn) => {
      const state = harness([]);
      const args = {
        user_id: "fleet-julian",
        job_type: "send_hinge",
        payload: {},
        dating_runner_id: "macbook16-dating-stale",
        dating_runner_secret: SECRET,
        ...(fn === enqueueAt ? { run_at: NOW + 60_000 } : {}),
      };
      await expect(invoke(fn, state.ctx, args)).rejects.toThrow(
        "Dating runner authorization failed",
      );
      expect(state.insert).not.toHaveBeenCalled();
      expect(state.runAt).not.toHaveBeenCalled();
    },
  );

  test.each([enqueue, enqueueAt])(
    "protected enqueue endpoint %s rejects an elected runner without the capability",
    async (fn) => {
      const state = harness([]);
      const args = {
        user_id: "fleet-julian",
        job_type: "send_hinge",
        payload: {},
        dating_runner_id: ELECTED_RUNNER,
        dating_runner_secret: "wrong-secret",
        ...(fn === enqueueAt ? { run_at: NOW + 60_000 } : {}),
      };
      await expect(invoke(fn, state.ctx, args)).rejects.toThrow(
        "Dating runner authorization failed",
      );
      expect(state.insert).not.toHaveBeenCalled();
      expect(state.runAt).not.toHaveBeenCalled();
    },
  );

  test.each([enqueue, enqueueAt])(
    "protected enqueue endpoint %s accepts the elected runner",
    async (fn) => {
      const state = harness([]);
      const args = {
        user_id: "fleet-julian",
        job_type: "send_hinge",
        payload: {},
        dating_runner_id: ELECTED_RUNNER,
        dating_runner_secret: SECRET,
        ...(fn === enqueueAt ? { run_at: NOW + 60_000 } : {}),
      };
      await expect(invoke(fn, state.ctx, args)).resolves.toBeTruthy();
      if (fn === enqueueAt) expect(state.runAt).toHaveBeenCalledOnce();
      else expect(state.insert).toHaveBeenCalledOnce();
    },
  );

  test("broad claim rejects a capable non-elected runner for protected work", async () => {
    const state = harness([job("dating-job", "run_swipe")]);
    await expect(invoke(claim, state.ctx, {
      user_id: "fleet-julian",
      agent_instance_id: "macbook16-dating-stale",
      dating_runner_secret: SECRET,
    })).resolves.toBeNull();
    expect(state.patch).not.toHaveBeenCalled();
  });

  test.each([enqueue, enqueueAt])(
    "ordinary enqueue endpoint %s does not require a dating runner identity",
    async (fn) => {
      const state = harness([]);
      const args = {
        user_id: "fleet-julian",
        job_type: "enrich_person",
        payload: {},
        ...(fn === enqueueAt ? { run_at: NOW + 60_000 } : {}),
      };
      await expect(invoke(fn, state.ctx, args)).resolves.toBeTruthy();
    },
  );

  test("protected lease and terminal calls require the capability again", async () => {
    const claimArgs = {
      id: "dating-job",
      agent_instance_id: ELECTED_RUNNER,
      claim_attempt: 2,
    };
    const renewal = harness([job("dating-job", "send_tinder", "running")]);
    await expect(invoke(renewLease, renewal.ctx, claimArgs)).resolves.toEqual({
      renewed: false,
    });
    expect(renewal.patch).not.toHaveBeenCalled();

    for (const [fn, extra] of [
      [complete, { result: {} }],
      [fail, { error: "stale runner" }],
      [failPermanent, { error: "stale runner" }],
    ] as const) {
      const state = harness([job("dating-job", "send_tinder", "running")]);
      await expect(invoke(fn, state.ctx, { ...claimArgs, ...extra })).rejects.toThrow(
        "Agent job lease is missing, expired, or mismatched",
      );
      expect(state.patch).not.toHaveBeenCalled();
    }

    const authorized = harness([job("dating-job", "send_tinder", "running")]);
    await expect(invoke(renewLease, authorized.ctx, {
      ...claimArgs,
      dating_runner_secret: SECRET,
      lock_seconds: 90,
    })).resolves.toMatchObject({ renewed: true });
  });

  test("lease-sensitive fields are required by the public contract", () => {
    for (const fn of [renewLease, complete, fail, failPermanent]) {
      const args = JSON.parse((fn as unknown as MutationFunction).exportArgs());
      expect(args.value.agent_instance_id.optional).toBe(false);
      expect(args.value.claim_attempt.optional).toBe(false);
    }
  });

  test("protected lease and terminal calls reject a capable non-elected runner", async () => {
    const running = job("dating-job", "send_tinder", "running");
    running.locked_by = "macbook16-dating-stale";
    const claimArgs = {
      id: "dating-job",
      agent_instance_id: "macbook16-dating-stale",
      claim_attempt: 2,
      dating_runner_secret: SECRET,
    };

    const renewal = harness([running]);
    await expect(invoke(renewLease, renewal.ctx, claimArgs)).resolves.toEqual({
      renewed: false,
    });
    expect(renewal.patch).not.toHaveBeenCalled();

    for (const [fn, extra] of [
      [complete, { result: {} }],
      [fail, { error: "stale runner" }],
      [failPermanent, { error: "stale runner" }],
    ] as const) {
      const state = harness([running]);
      await expect(invoke(fn, state.ctx, { ...claimArgs, ...extra })).rejects.toThrow(
        "Agent job lease is missing, expired, or mismatched",
      );
      expect(state.patch).not.toHaveBeenCalled();
    }
  });
});
