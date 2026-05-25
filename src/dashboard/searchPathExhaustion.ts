import { getEnabledJobSourceIdsFromDb, getSearchCountries } from "../db/appSettings";
import {
  listProviderCountryStates,
  listProviderQueryUnitStates,
  loadProviderSchedulerState,
} from "../db/providerScheduler";
import { getCoordinatorStatus } from "../orchestration/client";
import { getRegisteredProviderIds } from "../providers";
import type { JobSourceId } from "../types/job";

const MAX_LABEL = 140;

function clip(s: string, max = MAX_LABEL): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export type SearchPathExhaustionRoleJson = {
  unitId: string;
  label: string;
  exhausted: boolean;
  tier: number;
};

export type SearchPathExhaustionCountryJson = {
  key: string;
  label: string;
  exhausted: boolean;
  exhaustedRoles: number;
  totalRoles: number;
  roles: SearchPathExhaustionRoleJson[];
};

export type SearchPathExhaustionVendorJson = {
  providerId: JobSourceId;
  exhausted: boolean;
  exhaustedCountries: number;
  totalCountries: number;
  countries: SearchPathExhaustionCountryJson[];
  /** Coordinator snapshot: provider reported done for this logical cycle. */
  orchestrationDoneForCycle: boolean;
  /** D1 scheduler row cycle id (null if plan not initialized). */
  schedulerCycleId: string | null;
  /** True when scheduler cycle differs from coordinator cycle (plan reset in flight). */
  cycleMismatch: boolean;
};

export type SearchPathExhaustionPayload =
  | {
      ok: true;
      cycleId: string | null;
      coordinatorStatus: string;
      vendors: SearchPathExhaustionVendorJson[];
      hint: string | null;
    }
  | { ok: false; error: string };

/**
 * Current-cycle search path exhaustion for planned-search providers (D1 `provider_*_state` rows),
 * aligned with {@link CoordinatorState.cycleId} from the pipeline coordinator.
 */
export async function buildSearchPathExhaustionPayload(env: Env, userId: string): Promise<SearchPathExhaustionPayload> {
  const coord = await getCoordinatorStatus(env, userId);
  if (!coord || coord.ok !== true) {
    return { ok: false, error: "coordinator_unavailable" };
  }

  const cycleId = coord.cycleId;
  const enabled = await getEnabledJobSourceIdsFromDb(env.DB, userId, getRegisteredProviderIds());
  const searchCountries = await getSearchCountries(env.DB, userId);
  const labelByKey = new Map(searchCountries.map((c) => [c.key, c.fullName]));

  const vendors: SearchPathExhaustionVendorJson[] = [];

  for (const providerId of enabled) {
    const orch = coord.providerOrchestration?.[providerId];
    const orchestrationDoneForCycle = Boolean(orch?.doneForCycle);
    /**
     * Coordinator is the strongest truth for "no more fetchable work this cycle" at provider scope.
     * When it marks a provider done-for-cycle (request cap, freeze, provider exhausted, etc.), keep
     * all descendants gray so the UI never shows a fake active path beneath a done provider.
     */
    const forceExhaustedFromCoordinator = orchestrationDoneForCycle;

    const scheduler = await loadProviderSchedulerState(env.DB, userId, providerId);
    const schedulerCycleId = scheduler?.cycle_id ?? null;
    const cycleMismatch = Boolean(
      cycleId && schedulerCycleId && schedulerCycleId !== cycleId,
    );

    const [countryRows, unitRows] = await Promise.all([
      listProviderCountryStates(env.DB, userId, providerId),
      listProviderQueryUnitStates(env.DB, userId, providerId),
    ]);

    const countriesForCycle = cycleId
      ? countryRows.filter((c) => c.cycle_id === cycleId)
      : [];
    const unitsForCycle = cycleId ? unitRows.filter((u) => u.cycle_id === cycleId) : [];

    const unitsByCountry = new Map<string, typeof unitsForCycle>();
    for (const u of unitsForCycle) {
      const arr = unitsByCountry.get(u.country_key) ?? [];
      arr.push(u);
      unitsByCountry.set(u.country_key, arr);
    }

    const countries: SearchPathExhaustionCountryJson[] = countriesForCycle.map((c) => {
      const rolesRaw = unitsByCountry.get(c.country_key) ?? [];
      const roles: SearchPathExhaustionRoleJson[] = rolesRaw
        .slice()
        .sort((a, b) => a.tier - b.tier || a.query_value.localeCompare(b.query_value))
        .map((u) => ({
          unitId: u.unit_id,
          label: clip(u.query_value),
          exhausted: forceExhaustedFromCoordinator || u.exhausted === 1,
          tier: u.tier,
        }));
      const exhaustedRoles = roles.filter((r) => r.exhausted).length;
      const totalRoles = roles.length;
      /** DB flag is authoritative; also treat as exhausted when every role row is exhausted (propagation). */
      const countryExhausted =
        forceExhaustedFromCoordinator || c.exhausted === 1 || (totalRoles > 0 && exhaustedRoles === totalRoles);
      return {
        key: c.country_key,
        label: clip(labelByKey.get(c.country_key) ?? c.country_key),
        exhausted: countryExhausted,
        exhaustedRoles,
        totalRoles,
        roles,
      };
    });

    countries.sort((a, b) => a.label.localeCompare(b.label));

    const totalCountries = countries.length;
    const exhaustedCountries = countries.filter((x) => x.exhausted).length;
    const vendorExhausted =
      forceExhaustedFromCoordinator ||
      (totalCountries > 0 ? exhaustedCountries === totalCountries : orchestrationDoneForCycle);

    vendors.push({
      providerId,
      exhausted: vendorExhausted,
      exhaustedCountries,
      totalCountries,
      countries,
      orchestrationDoneForCycle,
      schedulerCycleId,
      cycleMismatch,
    });
  }

  vendors.sort((a, b) => a.providerId.localeCompare(b.providerId));

  let hint: string | null = null;
  if (!cycleId) {
    hint =
      "No coordinator cycle id yet (idle or coordinator not started). Path state appears when a pipeline cycle is active.";
  }

  return {
    ok: true,
    cycleId,
    coordinatorStatus: coord.status,
    vendors,
    hint,
  };
}
