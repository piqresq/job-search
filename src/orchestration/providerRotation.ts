import type { JobSourceId } from "../types/job";

/**
 * Per-provider state used by the budget-balanced scheduler.
 *
 * `cap` is the effective daily RapidAPI request cap (0 = unlimited, see
 * `getResolvedProviderDailyRequestCap`). `consumed` is the current UTC-day request
 * counter from `pipeline_state`.
 */
export interface ProviderBudgetInfo {
  providerId: JobSourceId;
  cap: number;
  consumed: number;
}

/**
 * Budget-balanced scheduler: among the currently runnable providers, pick the one
 * whose UTC-day request counter is furthest below its daily cap (smallest
 * `consumed / cap` fill ratio).
 *
 * This replaces the old weighted-round-robin (weights = caps) scheme which only
 * balanced correctly when every provider was continuously eligible. In practice one
 * provider (jsearch) frequently enters vendor-driven backoff (5xx → 300s pause),
 * during which the other provider (jobs_api) would run alone and burn through its
 * budget hours before jsearch caught up — so jobs_api would "finish" mid-afternoon
 * while jsearch was still grinding through the remaining budget into the evening.
 *
 * Fill-ratio selection is self-correcting against that asymmetry:
 *   - While jsearch is backed off, jobs_api runs alone and its ratio climbs.
 *   - When jsearch becomes runnable again, its ratio is still low, so the picker
 *     preferentially schedules jsearch until the two ratios re-converge.
 *   - At steady state, both providers reach their cap at approximately the same
 *     UTC time (which is the invariant we want for "true balance").
 *
 * Ground truth is the D1 request counter (`consumed`), so no in-memory rotation
 * state needs to be carried across pumps — this also makes the scheduler immune to
 * worker restarts / Durable Object state resets.
 *
 * Unlimited providers (cap = 0) are treated as if they share the largest finite cap
 * so they can't starve a finite-capped peer via a perpetual 0/∞ = 0 ratio.
 *
 * Ties (e.g. both providers at 0/cap at cycle start, or identical fractional fills)
 * are broken by the order of `runnable` — callers pass the canonical enabled-provider
 * order so the behavior is deterministic.
 */
export function pickProviderByBudgetFill(
  runnable: readonly JobSourceId[],
  budgets: readonly ProviderBudgetInfo[],
): {
  providerId: JobSourceId | null;
  fillByProvider: Partial<Record<JobSourceId, number>>;
} {
  if (!runnable.length) return { providerId: null, fillByProvider: {} };

  const byId = new Map<JobSourceId, ProviderBudgetInfo>();
  for (const b of budgets) byId.set(b.providerId, b);

  let maxFiniteCap = 0;
  for (const b of budgets) {
    if (b.cap > maxFiniteCap) maxFiniteCap = b.cap;
  }
  // If no provider has a finite cap, treat them all as weight-1: the fill ratio
  // collapses to `consumed`, which still produces a fair round-robin because every
  // pump bumps exactly one provider's counter.
  const virtualCapForUnlimited = maxFiniteCap > 0 ? maxFiniteCap : 1;

  const fillByProvider: Partial<Record<JobSourceId, number>> = {};
  let bestProvider: JobSourceId | null = null;
  let bestFill = Number.POSITIVE_INFINITY;

  // Iterate in the caller-provided order so ties fall back to enabled order.
  for (const providerId of runnable) {
    const info = byId.get(providerId);
    const cap = info?.cap ?? 0;
    const consumed = Math.max(0, info?.consumed ?? 0);
    const effectiveCap = cap > 0 ? cap : virtualCapForUnlimited;
    const fill = consumed / effectiveCap;
    fillByProvider[providerId] = fill;
    if (fill < bestFill) {
      bestProvider = providerId;
      bestFill = fill;
    }
  }

  return { providerId: bestProvider, fillByProvider };
}
