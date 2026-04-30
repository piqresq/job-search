import assert from "node:assert/strict";
import {
  pickProviderByBudgetFill,
  type ProviderBudgetInfo,
} from "../src/orchestration/providerRotation";
import type { JobSourceId } from "../src/types/job";

/**
 * Simulate N pump ticks with the budget-balanced scheduler. After each pick the
 * chosen provider's `consumed` counter is bumped by 1 (which matches production
 * behavior: each pump enqueues exactly one chunk and every HTTP request bumps the
 * UTC-day counter in D1).
 *
 * The `runnableGate` callback decides whether each provider is currently runnable
 * at step i — this lets tests simulate vendor backoffs (provider not runnable
 * during the backoff window).
 */
function simulate(
  budgets: ProviderBudgetInfo[],
  steps: number,
  runnableGate?: (pid: JobSourceId, step: number) => boolean,
): { picks: JobSourceId[]; finalBudgets: ProviderBudgetInfo[] } {
  const state = budgets.map((b) => ({ ...b }));
  const picks: JobSourceId[] = [];
  for (let i = 0; i < steps; i++) {
    const runnable = state
      .filter((b) => b.consumed < b.cap || b.cap === 0)
      .filter((b) => (runnableGate ? runnableGate(b.providerId, i) : true))
      .map((b) => b.providerId);
    const { providerId } = pickProviderByBudgetFill(runnable, state);
    if (!providerId) break;
    picks.push(providerId);
    const idx = state.findIndex((b) => b.providerId === providerId);
    state[idx] = { ...state[idx]!, consumed: state[idx]!.consumed + 1 };
  }
  return { picks, finalBudgets: state };
}

// ---- Test 1: Steady state (no backoff) picks match the cap ratio ----
{
  const { picks, finalBudgets } = simulate(
    [
      { providerId: "jobs_api", cap: 1908, consumed: 0 },
      { providerId: "jsearch", cap: 323, consumed: 0 },
    ],
    2231, // sum of caps → both should hit their cap
  );
  const jobsApiPicks = picks.filter((p) => p === "jobs_api").length;
  const jsearchPicks = picks.filter((p) => p === "jsearch").length;
  assert.equal(jobsApiPicks, 1908, `jobs_api picks: ${jobsApiPicks}`);
  assert.equal(jsearchPicks, 323, `jsearch picks: ${jsearchPicks}`);
  for (const b of finalBudgets) {
    assert.equal(b.consumed, b.cap, `${b.providerId} did not hit cap: ${b.consumed}/${b.cap}`);
  }
}

// ---- Test 2: Backoff asymmetry still balances by end of cycle ----
// jsearch is backed off (non-runnable) for the first half of the cycle. The picker
// must give jsearch priority after recovery so both still finish together.
{
  const HALF = 1115;
  const { picks } = simulate(
    [
      { providerId: "jobs_api", cap: 1908, consumed: 0 },
      { providerId: "jsearch", cap: 323, consumed: 0 },
    ],
    2231,
    (pid, step) => (pid === "jsearch" ? step >= HALF : true),
  );
  const jobsApiPicks = picks.filter((p) => p === "jobs_api").length;
  const jsearchPicks = picks.filter((p) => p === "jsearch").length;
  assert.equal(jobsApiPicks, 1908, `jobs_api picks after backoff recovery: ${jobsApiPicks}`);
  assert.equal(jsearchPicks, 323, `jsearch picks after backoff recovery: ${jsearchPicks}`);
}

// ---- Test 3: Unlimited provider coexists with finite-cap peer ----
{
  const { picks } = simulate(
    [
      { providerId: "jobs_api", cap: 0, consumed: 0 },
      { providerId: "jsearch", cap: 100, consumed: 0 },
    ],
    200,
  );
  const jobsApiPicks = picks.filter((p) => p === "jobs_api").length;
  const jsearchPicks = picks.filter((p) => p === "jsearch").length;
  // Unlimited jobs_api is assigned virtualCap = 100 (the max finite cap), so both
  // should drain at ~1:1 over 200 steps.
  assert.equal(jsearchPicks, 100, `jsearch should hit its cap of 100, got ${jsearchPicks}`);
  assert.ok(
    Math.abs(jobsApiPicks - 100) <= 1,
    `jobs_api should share rotation ~1:1, got ${jobsApiPicks}`,
  );
}

// ---- Test 4: Tie-break uses runnable order (deterministic) ----
{
  const picked = pickProviderByBudgetFill(
    ["jobs_api", "jsearch"],
    [
      { providerId: "jobs_api", cap: 100, consumed: 0 },
      { providerId: "jsearch", cap: 100, consumed: 0 },
    ],
  );
  assert.equal(picked.providerId, "jobs_api");
  const pickedReversed = pickProviderByBudgetFill(
    ["jsearch", "jobs_api"],
    [
      { providerId: "jobs_api", cap: 100, consumed: 0 },
      { providerId: "jsearch", cap: 100, consumed: 0 },
    ],
  );
  assert.equal(pickedReversed.providerId, "jsearch");
}

// ---- Test 5: Empty runnable set returns null ----
{
  const { providerId } = pickProviderByBudgetFill([], [
    { providerId: "jobs_api", cap: 100, consumed: 0 },
  ]);
  assert.equal(providerId, null);
}

// ---- Test 6: A provider already over-drained still doesn't win ----
// Simulates a case where consumed exceeds cap (e.g. counter bumped after cap check).
{
  const picked = pickProviderByBudgetFill(
    ["jobs_api", "jsearch"],
    [
      { providerId: "jobs_api", cap: 100, consumed: 110 },
      { providerId: "jsearch", cap: 100, consumed: 50 },
    ],
  );
  assert.equal(picked.providerId, "jsearch");
}

console.log("test-provider-rotation: ok");
