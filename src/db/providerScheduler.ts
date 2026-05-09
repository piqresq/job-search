import type { SearchRoleTierId } from "../config/searchRoles";
import type { JobSourceId } from "../types/job";

export type ProviderCountryPlan = {
  key: string;
  iso2: string;
  fullName: string;
};

export type ProviderQueryUnitPlan = {
  id: string;
  tier: SearchRoleTierId;
  queryValue: string;
};

export type ProviderSchedulerStateRow = {
  provider_id: JobSourceId;
  cycle_id: string;
  plan_hash: string;
  country_cursor: number;
  tier1_pick_count: number;
  tier2_pick_count: number;
  updated_at: number;
};

export type ProviderCountryStateRow = {
  provider_id: JobSourceId;
  country_key: string;
  cycle_id: string;
  schedule_pos: number;
  tier1_cursor: number;
  tier2_cursor: number;
  exhausted: number;
  next_eligible_at: number;
  last_error: string | null;
  updated_at: number;
};

export type ProviderQueryUnitStateRow = {
  provider_id: JobSourceId;
  country_key: string;
  unit_id: string;
  cycle_id: string;
  tier: SearchRoleTierId;
  query_value: string;
  pagination_cursor: string | null;
  exhausted: number;
  next_eligible_at: number;
  consecutive_errors: number;
  last_error: string | null;
  updated_at: number;
};

export type ProviderUnitScheduleStateRow = {
  provider_id: JobSourceId;
  unit_id: string;
  plan_hash: string;
  tier: SearchRoleTierId;
  query_value: string;
  pick_count: number;
  last_picked_at: number;
  updated_at: number;
};

function stablePlanHash(
  countries: readonly ProviderCountryPlan[],
  units: readonly ProviderQueryUnitPlan[],
): string {
  return JSON.stringify({
    countries: countries.map((c) => c.key),
    units: units.map((u) => ({ id: u.id, tier: u.tier, queryValue: u.queryValue })),
  });
}

async function resetProviderCycleState(
  db: D1Database,
  userId: string,
  providerId: JobSourceId,
  cycleId: string,
  countries: readonly ProviderCountryPlan[],
  units: readonly ProviderQueryUnitPlan[],
  now: number,
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    db
      .prepare("DELETE FROM provider_country_state WHERE user_id = ? AND provider_id = ?")
      .bind(userId, providerId),
    db
      .prepare("DELETE FROM provider_query_unit_state WHERE user_id = ? AND provider_id = ?")
      .bind(userId, providerId),
    db
      .prepare(
        `UPDATE provider_unit_schedule_state
         SET pick_count = 0, last_picked_at = 0, updated_at = ?
         WHERE user_id = ? AND provider_id = ?`,
      )
      .bind(now, userId, providerId),
    db
      .prepare(
        `UPDATE provider_scheduler_state
         SET cycle_id = ?, country_cursor = 0, tier1_pick_count = 0, tier2_pick_count = 0, updated_at = ?
         WHERE user_id = ? AND provider_id = ?`,
      )
      .bind(cycleId, now, userId, providerId),
  ];

  for (const country of countries) {
    statements.push(
      db
        .prepare(
          `INSERT INTO provider_country_state (
            user_id, provider_id, country_key, cycle_id, schedule_pos, tier1_cursor, tier2_cursor,
            exhausted, next_eligible_at, last_error, updated_at
          ) VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, NULL, ?)`,
        )
        .bind(userId, providerId, country.key, cycleId, now),
    );

    for (const unit of units) {
      statements.push(
        db
          .prepare(
            `INSERT INTO provider_query_unit_state (
              user_id, provider_id, country_key, unit_id, cycle_id, tier, query_value,
              pagination_cursor, exhausted, next_eligible_at, consecutive_errors, last_error, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, 0, 0, NULL, ?)`,
          )
          .bind(userId, providerId, country.key, unit.id, cycleId, unit.tier, unit.queryValue, now),
      );
    }
  }

  await db.batch(statements);
}

export async function rolloverProviderCycleState(
  db: D1Database,
  userId: string,
  providerId: JobSourceId,
  cycleId: string,
  now: number,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `UPDATE provider_scheduler_state
         SET cycle_id = ?, country_cursor = 0, tier1_pick_count = 0, tier2_pick_count = 0, updated_at = ?
         WHERE user_id = ? AND provider_id = ?`,
      )
      .bind(cycleId, now, userId, providerId),
    db
      .prepare(
        `UPDATE provider_country_state
         SET cycle_id = ?, schedule_pos = 0, tier1_cursor = 0, tier2_cursor = 0,
             exhausted = 0, next_eligible_at = 0, last_error = NULL, updated_at = ?
         WHERE user_id = ? AND provider_id = ?`,
      )
      .bind(cycleId, now, userId, providerId),
    db
      .prepare(
        `UPDATE provider_query_unit_state
         SET cycle_id = ?, pagination_cursor = NULL, exhausted = 0, next_eligible_at = 0,
             consecutive_errors = 0, last_error = NULL, updated_at = ?
         WHERE user_id = ? AND provider_id = ?`,
      )
      .bind(cycleId, now, userId, providerId),
    db
      .prepare(
        `UPDATE provider_unit_schedule_state
         SET pick_count = 0, last_picked_at = 0, updated_at = ?
         WHERE user_id = ? AND provider_id = ?`,
      )
      .bind(now, userId, providerId),
  ]);
}

async function resetProviderPlan(
  db: D1Database,
  userId: string,
  providerId: JobSourceId,
  cycleId: string,
  planHash: string,
  countries: readonly ProviderCountryPlan[],
  units: readonly ProviderQueryUnitPlan[],
  now: number,
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    db
      .prepare("DELETE FROM provider_scheduler_state WHERE user_id = ? AND provider_id = ?")
      .bind(userId, providerId),
    db
      .prepare("DELETE FROM provider_country_state WHERE user_id = ? AND provider_id = ?")
      .bind(userId, providerId),
    db
      .prepare("DELETE FROM provider_query_unit_state WHERE user_id = ? AND provider_id = ?")
      .bind(userId, providerId),
    db
      .prepare("DELETE FROM provider_unit_schedule_state WHERE user_id = ? AND provider_id = ?")
      .bind(userId, providerId),
    db
      .prepare(
        `INSERT INTO provider_scheduler_state (
          user_id, provider_id, cycle_id, plan_hash, country_cursor, tier1_pick_count, tier2_pick_count, updated_at
        ) VALUES (?, ?, ?, ?, 0, 0, 0, ?)`,
      )
      .bind(userId, providerId, cycleId, planHash, now),
  ];

  for (const unit of units) {
    statements.push(
      db
        .prepare(
          `INSERT INTO provider_unit_schedule_state (
            user_id, provider_id, unit_id, plan_hash, tier, query_value, pick_count, last_picked_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`,
        )
        .bind(userId, providerId, unit.id, planHash, unit.tier, unit.queryValue, now),
    );
  }

  for (const country of countries) {
    statements.push(
      db
        .prepare(
          `INSERT INTO provider_country_state (
            user_id, provider_id, country_key, cycle_id, schedule_pos, tier1_cursor, tier2_cursor,
            exhausted, next_eligible_at, last_error, updated_at
          ) VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, NULL, ?)`,
        )
        .bind(userId, providerId, country.key, cycleId, now),
    );

    for (const unit of units) {
      statements.push(
        db
          .prepare(
            `INSERT INTO provider_query_unit_state (
              user_id, provider_id, country_key, unit_id, cycle_id, tier, query_value,
              pagination_cursor, exhausted, next_eligible_at, consecutive_errors, last_error, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, 0, 0, NULL, ?)`,
          )
          .bind(userId, providerId, country.key, unit.id, cycleId, unit.tier, unit.queryValue, now),
      );
    }
  }

  await db.batch(statements);
}

async function ensureProviderUnitScheduleState(
  db: D1Database,
  userId: string,
  providerId: JobSourceId,
  planHash: string,
  units: readonly ProviderQueryUnitPlan[],
  now: number,
): Promise<void> {
  const res = await db
    .prepare(
      `SELECT provider_id, unit_id, plan_hash, tier, query_value, pick_count, last_picked_at, updated_at
       FROM provider_unit_schedule_state
       WHERE user_id = ? AND provider_id = ?`,
    )
    .bind(userId, providerId)
    .all<ProviderUnitScheduleStateRow>();
  const existing = new Map((res.results ?? []).map((row) => [row.unit_id, row]));
  const statements: D1PreparedStatement[] = [];

  for (const unit of units) {
    const row = existing.get(unit.id);
    if (!row) {
      statements.push(
        db
          .prepare(
            `INSERT INTO provider_unit_schedule_state (
              user_id, provider_id, unit_id, plan_hash, tier, query_value, pick_count, last_picked_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`,
          )
          .bind(userId, providerId, unit.id, planHash, unit.tier, unit.queryValue, now),
      );
      continue;
    }
    existing.delete(unit.id);
    if (row.plan_hash !== planHash || row.tier !== unit.tier || row.query_value !== unit.queryValue) {
      statements.push(
        db
          .prepare(
            `UPDATE provider_unit_schedule_state
             SET plan_hash = ?, tier = ?, query_value = ?, updated_at = ?
             WHERE user_id = ? AND provider_id = ? AND unit_id = ?`,
          )
          .bind(planHash, unit.tier, unit.queryValue, now, userId, providerId, unit.id),
      );
    }
  }

  for (const staleUnitId of existing.keys()) {
    statements.push(
      db
        .prepare(
          "DELETE FROM provider_unit_schedule_state WHERE user_id = ? AND provider_id = ? AND unit_id = ?",
        )
        .bind(userId, providerId, staleUnitId),
    );
  }

  if (statements.length > 0) {
    await db.batch(statements);
  }
}

export async function ensureProviderPlanInitialized(
  db: D1Database,
  userId: string,
  providerId: JobSourceId,
  cycleId: string,
  countries: readonly ProviderCountryPlan[],
  units: readonly ProviderQueryUnitPlan[],
  now: number,
): Promise<void> {
  const planHash = stablePlanHash(countries, units);
  const row = await db
    .prepare(
      `SELECT provider_id, cycle_id, plan_hash, country_cursor, tier1_pick_count, tier2_pick_count, updated_at
       FROM provider_scheduler_state
       WHERE user_id = ? AND provider_id = ?`,
    )
    .bind(userId, providerId)
    .first<ProviderSchedulerStateRow>();
  if (!row || row.plan_hash !== planHash) {
    await resetProviderPlan(db, userId, providerId, cycleId, planHash, countries, units, now);
    return;
  }
  await ensureProviderUnitScheduleState(db, userId, providerId, planHash, units, now);
  if (row.cycle_id !== cycleId) {
    await resetProviderCycleState(db, userId, providerId, cycleId, countries, units, now);
  }
}

export async function loadProviderSchedulerState(
  db: D1Database,
  userId: string,
  providerId: JobSourceId,
): Promise<ProviderSchedulerStateRow | null> {
  const row = await db
    .prepare(
      `SELECT provider_id, cycle_id, plan_hash, country_cursor, tier1_pick_count, tier2_pick_count, updated_at
       FROM provider_scheduler_state
       WHERE user_id = ? AND provider_id = ?`,
    )
    .bind(userId, providerId)
    .first<ProviderSchedulerStateRow>();
  return row ?? null;
}

export async function listProviderCountryStates(
  db: D1Database,
  userId: string,
  providerId: JobSourceId,
): Promise<ProviderCountryStateRow[]> {
  const res = await db
    .prepare(
      `SELECT provider_id, country_key, cycle_id, schedule_pos, tier1_cursor, tier2_cursor,
              exhausted, next_eligible_at, last_error, updated_at
       FROM provider_country_state
       WHERE user_id = ? AND provider_id = ?
       ORDER BY rowid ASC`,
    )
    .bind(userId, providerId)
    .all<ProviderCountryStateRow>();
  return res.results ?? [];
}

export async function listProviderQueryUnitStates(
  db: D1Database,
  userId: string,
  providerId: JobSourceId,
): Promise<ProviderQueryUnitStateRow[]> {
  const res = await db
    .prepare(
      `SELECT provider_id, country_key, unit_id, cycle_id, tier, query_value,
              pagination_cursor, exhausted, next_eligible_at, consecutive_errors, last_error, updated_at
       FROM provider_query_unit_state
       WHERE user_id = ? AND provider_id = ?
       ORDER BY country_key ASC, tier ASC, rowid ASC`,
    )
    .bind(userId, providerId)
    .all<ProviderQueryUnitStateRow>();
  return res.results ?? [];
}

export async function listProviderUnitScheduleStates(
  db: D1Database,
  userId: string,
  providerId: JobSourceId,
): Promise<ProviderUnitScheduleStateRow[]> {
  const res = await db
    .prepare(
      `SELECT provider_id, unit_id, plan_hash, tier, query_value, pick_count, last_picked_at, updated_at
       FROM provider_unit_schedule_state
       WHERE user_id = ? AND provider_id = ?
       ORDER BY tier ASC, pick_count ASC, last_picked_at ASC, rowid ASC`,
    )
    .bind(userId, providerId)
    .all<ProviderUnitScheduleStateRow>();
  return res.results ?? [];
}

export async function updateProviderCountryCursor(
  db: D1Database,
  userId: string,
  providerId: JobSourceId,
  countryCursor: number,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE provider_scheduler_state
       SET country_cursor = ?, updated_at = ?
       WHERE user_id = ? AND provider_id = ?`,
    )
    .bind(countryCursor, now, userId, providerId)
    .run();
}

export async function commitProviderUnitPickAndPagination(
  db: D1Database,
  userId: string,
  args: {
    providerId: JobSourceId;
    countryKey: string;
    unitId: string;
    tier: SearchRoleTierId;
    planHash: string;
    queryValue: string;
    paginationCursor: string | null;
    exhausted: boolean;
    now: number;
  },
): Promise<void> {
  const exhaustedInt = args.exhausted ? 1 : 0;
  await db.batch([
    db
      .prepare(
        `UPDATE provider_query_unit_state
         SET pagination_cursor = ?, exhausted = ?, next_eligible_at = ?,
             consecutive_errors = ?, last_error = ?, updated_at = ?
         WHERE user_id = ? AND provider_id = ? AND country_key = ? AND unit_id = ?`,
      )
      .bind(
        args.paginationCursor,
        exhaustedInt,
        0,
        0,
        null,
        args.now,
        userId,
        args.providerId,
        args.countryKey,
        args.unitId,
      ),
    db
      .prepare(
        `UPDATE provider_scheduler_state
         SET tier1_pick_count = tier1_pick_count + 1, updated_at = ?
         WHERE user_id = ? AND provider_id = ?`,
      )
      .bind(args.now, userId, args.providerId),
    db
      .prepare(
        `INSERT INTO provider_unit_schedule_state (
           user_id, provider_id, unit_id, plan_hash, tier, query_value, pick_count, last_picked_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(user_id, provider_id, unit_id) DO UPDATE SET
           pick_count = pick_count + 1,
           last_picked_at = excluded.last_picked_at,
           updated_at = excluded.updated_at,
           plan_hash = excluded.plan_hash,
           tier = excluded.tier,
           query_value = excluded.query_value`,
      )
      .bind(
        userId,
        args.providerId,
        args.unitId,
        args.planHash,
        args.tier,
        args.queryValue,
        args.now,
        args.now,
      ),
  ]);
}

export async function updateCountryState(
  db: D1Database,
  userId: string,
  providerId: JobSourceId,
  countryKey: string,
  state: {
    schedulePos?: number;
    tier1Cursor?: number;
    tier2Cursor?: number;
    exhausted?: boolean;
    nextEligibleAt?: number;
    lastError?: string | null;
  },
  now: number,
): Promise<void> {
  const current = await db
    .prepare(
      `SELECT schedule_pos, tier1_cursor, tier2_cursor, exhausted, next_eligible_at, last_error
       FROM provider_country_state
       WHERE user_id = ? AND provider_id = ? AND country_key = ?`,
    )
    .bind(userId, providerId, countryKey)
    .first<ProviderCountryStateRow>();
  if (!current) return;
  await db
    .prepare(
      `UPDATE provider_country_state
       SET schedule_pos = ?, tier1_cursor = ?, tier2_cursor = ?,
           exhausted = ?, next_eligible_at = ?, last_error = ?, updated_at = ?
       WHERE user_id = ? AND provider_id = ? AND country_key = ?`,
    )
    .bind(
      state.schedulePos ?? current.schedule_pos,
      state.tier1Cursor ?? current.tier1_cursor,
      state.tier2Cursor ?? current.tier2_cursor,
      state.exhausted == null ? current.exhausted : state.exhausted ? 1 : 0,
      state.nextEligibleAt ?? current.next_eligible_at,
      state.lastError === undefined ? current.last_error : state.lastError,
      now,
      userId,
      providerId,
      countryKey,
    )
    .run();
}

export async function updateQueryUnitState(
  db: D1Database,
  userId: string,
  providerId: JobSourceId,
  countryKey: string,
  unitId: string,
  state: {
    paginationCursor?: string | null;
    exhausted?: boolean;
    nextEligibleAt?: number;
    consecutiveErrors?: number;
    lastError?: string | null;
  },
  now: number,
): Promise<void> {
  const current = await db
    .prepare(
      `SELECT pagination_cursor, exhausted, next_eligible_at, consecutive_errors, last_error
       FROM provider_query_unit_state
       WHERE user_id = ? AND provider_id = ? AND country_key = ? AND unit_id = ?`,
    )
    .bind(userId, providerId, countryKey, unitId)
    .first<ProviderQueryUnitStateRow>();
  if (!current) return;
  await db
    .prepare(
      `UPDATE provider_query_unit_state
       SET pagination_cursor = ?, exhausted = ?, next_eligible_at = ?,
           consecutive_errors = ?, last_error = ?, updated_at = ?
       WHERE user_id = ? AND provider_id = ? AND country_key = ? AND unit_id = ?`,
    )
    .bind(
      state.paginationCursor === undefined ? current.pagination_cursor : state.paginationCursor,
      state.exhausted == null ? current.exhausted : state.exhausted ? 1 : 0,
      state.nextEligibleAt ?? current.next_eligible_at,
      state.consecutiveErrors ?? current.consecutive_errors,
      state.lastError === undefined ? current.last_error : state.lastError,
      now,
      userId,
      providerId,
      countryKey,
      unitId,
    )
    .run();
}

export async function clearProviderExhaustionState(
  db: D1Database,
  userId: string,
  providerId: JobSourceId,
  now: number,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `UPDATE provider_scheduler_state
         SET country_cursor = 0, updated_at = ?
         WHERE user_id = ? AND provider_id = ?`,
      )
      .bind(now, userId, providerId),
    db
      .prepare(
        `UPDATE provider_country_state
         SET schedule_pos = 0, tier1_cursor = 0, tier2_cursor = 0,
             exhausted = 0, next_eligible_at = 0, last_error = NULL, updated_at = ?
         WHERE user_id = ? AND provider_id = ?`,
      )
      .bind(now, userId, providerId),
    db
      .prepare(
        `UPDATE provider_query_unit_state
         SET pagination_cursor = NULL, exhausted = 0, next_eligible_at = 0,
             consecutive_errors = 0, last_error = NULL, updated_at = ?
         WHERE user_id = ? AND provider_id = ?`,
      )
      .bind(now, userId, providerId),
  ]);
}
