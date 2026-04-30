/**
 * One-shot: recompute `salary_monthly_eur` / `salary_display_eur` for any rows whose
 * cache is NULL, using the current production logic. Reads rows via `wrangler d1 execute`,
 * computes locally, then writes updates back in chunked transactions.
 *
 * Run: `npx tsx scripts/backfill-salary-cache-remote.ts`
 *
 * Why not just rely on the Worker's waitUntil/cron backfill?
 *   - After large invalidations (e.g. period-detection fix) we want to see correct values
 *     in the dashboard immediately instead of waiting for the first nudge.
 *   - This script uses the exact same `computeSalaryEurCache` the Worker uses, so results
 *     match what the Worker would write.
 */

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeSalaryEurCache, type DashboardSalarySource } from "../src/dashboard/salary";
import {
  failSafeUsdGbpToEurRates,
  fetchUsdGbpToEurRates,
  type HardFilterFxRates,
} from "../src/pipeline/hardFilters";

type Row = {
  id: string;
  title: string | null;
  description: string | null;
  salary_raw: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
};

const DB_NAME = "job-search-db";

/**
 * `wrangler d1 execute --file` returns a SUMMARY (queries executed / rows read) instead of
 * the actual rows, so SELECT queries have to go through `--command` to capture `results[]`.
 * Writes (UPDATE/INSERT) can use either and we prefer --file so big batches aren't limited
 * by the OS command-line length.
 */
function d1ExecuteCommand(sql: string): unknown {
  const escaped = sql.replace(/"/g, '\\"');
  const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --json --command "${escaped}"`;
  const out = execSync(cmd, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  const firstBrace = out.indexOf("[");
  const json = firstBrace >= 0 ? out.slice(firstBrace) : out;
  return JSON.parse(json);
}

function d1ExecuteFile(filePath: string): unknown {
  const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --json --file "${filePath}"`;
  const out = execSync(cmd, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  const firstBrace = out.indexOf("[");
  const json = firstBrace >= 0 ? out.slice(firstBrace) : out;
  return JSON.parse(json);
}

function sqlString(value: string | null): string {
  if (value == null) return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

async function main(): Promise<void> {
  const tmp = join(tmpdir(), `salary-cache-backfill-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });

  console.log("Fetching IDs with NULL salary_display_eur...");
  const idsResp = d1ExecuteCommand(
    `SELECT id FROM jobs WHERE salary_display_eur IS NULL`,
  ) as Array<{ results: Array<{ id: string }> }>;
  const ids = (idsResp[0]?.results ?? []).map((r) => r.id);
  console.log(`  ${ids.length} rows to backfill.`);
  if (ids.length === 0) return;

  // Pull full rows in chunks — a flat WHERE id IN (...) with hundreds of ids keeps the
  // command line and SQL parser happy, and each chunk is one round trip. Description can
  // be large so we cap the chunk size conservatively.
  const selectChunkSize = 80;
  const rows: Row[] = [];
  for (let offset = 0; offset < ids.length; offset += selectChunkSize) {
    const slice = ids.slice(offset, offset + selectChunkSize);
    const inList = slice.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
    const resp = d1ExecuteCommand(
      `SELECT id, title, description, salary_raw, salary_min, salary_max, salary_currency FROM jobs WHERE id IN (${inList})`,
    ) as Array<{ results: Row[] }>;
    const batch = resp[0]?.results ?? [];
    rows.push(...batch);
    console.log(`  Fetched ${rows.length}/${ids.length} rows...`);
  }
  console.log(`  Found ${rows.length} rows.`);
  if (rows.length === 0) return;

  let fx: HardFilterFxRates;
  try {
    fx = await fetchUsdGbpToEurRates();
    console.log(`  FX: USD→EUR=${fx.usdToEur.toFixed(4)}  GBP→EUR=${fx.gbpToEur.toFixed(4)}`);
  } catch {
    fx = failSafeUsdGbpToEurRates();
    console.log(`  FX (fail-safe): USD→EUR=${fx.usdToEur}  GBP→EUR=${fx.gbpToEur}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const updates: string[] = [];
  let resolvedCount = 0;
  for (const row of rows) {
    const src: DashboardSalarySource = {
      title: row.title,
      description: row.description,
      salary_raw: row.salary_raw,
      salary_min: row.salary_min,
      salary_max: row.salary_max,
      salary_currency: row.salary_currency,
    };
    const cache = computeSalaryEurCache(src, fx);
    const monthlySql =
      typeof cache.monthlyEur === "number" && Number.isFinite(cache.monthlyEur)
        ? String(cache.monthlyEur)
        : "NULL";
    const displaySql = sqlString(cache.display);
    if (cache.monthlyEur != null) resolvedCount += 1;
    updates.push(
      `UPDATE jobs SET salary_monthly_eur = ${monthlySql}, salary_display_eur = ${displaySql}, updated_at = COALESCE(updated_at, ${now}) WHERE id = '${row.id.replace(/'/g, "''")}';`,
    );
  }
  console.log(
    `  Computed ${updates.length} updates (${resolvedCount} resolved numeric, ${updates.length - resolvedCount} → N/A).`,
  );

  const chunkSize = 200;
  let written = 0;
  // D1's --file mode treats all statements in the file atomically; BEGIN/COMMIT would
  // error ("use state.storage.transaction() instead"). Plain `;`-separated UPDATEs work.
  for (let offset = 0; offset < updates.length; offset += chunkSize) {
    const slice = updates.slice(offset, offset + chunkSize);
    const filePath = join(tmp, `batch-${offset}.sql`);
    writeFileSync(filePath, slice.join("\n") + "\n", "utf8");
    const resp = d1ExecuteFile(filePath) as Array<{ meta?: { changes?: number } }>;
    const changes = resp[0]?.meta?.changes ?? slice.length;
    written += slice.length;
    console.log(`  Batch ${offset}–${offset + slice.length - 1}: wrote ${changes} rows.`);
  }
  console.log(`Done. Wrote ${written} rows.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
