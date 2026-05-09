import { aggregateTitleQueryHealthByVendor, type TitleQueryHealthVendorAggregate } from "../db/titleQueryHealthStats";
import {
  ensureStatisticsBackfilled,
  listStatisticsDailyProviderRows,
  listStatisticsProviderAggregates,
  listStatisticsVariantAggregates,
  listStatisticsVariantProviderRequestBreakdown,
  normalizeStatisticsDays,
  statisticsExactRangeWindow,
  statisticsSingleDayWindow,
  statisticsWindow,
  statisticsWindowEndingOn,
  type StatisticsDailyProviderRow,
  type StatisticsProviderAggregateRow,
  type StatisticsVariantAggregateRow,
  type StatisticsVariantProviderRequestRow,
} from "../db/statistics";
import { utcYmdFromUnix } from "../db/pipelineState";
import type { JobSourceId } from "../types/job";

const VENDOR_LABELS: Record<JobSourceId, string> = {
  linkedin_jobs: "LinkedIn (Fantastic Jobs)",
  jsearch: "JSearch",
  jobs_api: "Jobs API (Pat92)",
};

type StatisticsOverview = {
  requestCount: number;
  jobsReceived: number;
  jobsKept: number;
  jobsProcessed: number;
  jobsQualified: number;
  jobsHigh: number;
  jobsMedium: number;
  jobsLow: number;
  jobsFiltered: number;
  keepRatePct: number;
  qualityYieldPct: number;
  jobsReceivedPerRequest: number;
};

type StatisticsDailySeriesPoint = StatisticsOverview & {
  dayUtc: string;
};

/** Per-vendor per-day rollups (client can sum for vendor-filtered charts). */
export type StatisticsDailyProviderPoint = {
  dayUtc: string;
  providerId: JobSourceId;
  requestCount: number;
  jobsReceived: number;
  jobsKept: number;
  jobsProcessed: number;
  jobsHigh: number;
  jobsMedium: number;
  jobsLow: number;
  jobsFiltered: number;
};

type StatisticsVendorRow = StatisticsOverview & {
  id: string;
  label: string;
  qualityScore: number;
};

type StatisticsVariantRow = StatisticsOverview & {
  searchQuery: string;
  tier: number;
  tierLabel: string;
  providers: string[];
  qualityScore: number;
  /** Jobs received but not counted in pipeline outcomes (mostly cycle dedupe / early skips). */
  jobsOutstanding: number;
  /** RapidAPI request credits per vendor for this variant (same window as the row). */
  providerRequestBreakdown: { providerId: JobSourceId; requestCount: number }[];
};

export type StatisticsPayload = {
  ok: true;
  days: number;
  fromYmd: string;
  toYmd: string;
  historyCaveat: string;
  overview: StatisticsOverview;
  dailySeries: StatisticsDailySeriesPoint[];
  /** Per vendor × UTC day; use with dashboard vendor toggles to rebuild `dailySeries`. */
  dailyProviders: StatisticsDailyProviderPoint[];
  vendors: StatisticsVendorRow[];
  /** Title vs canonical intended role (0..10); jobs with persisted metric only. */
  titleQueryHealthByVendor: TitleQueryHealthVendorAggregate[];
  variants: StatisticsVariantRow[];
};

function toNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function roundPct(n: number): number {
  return Math.round(n * 10) / 10;
}

function buildOverview(base: {
  requestCount: number;
  jobsReceived: number;
  jobsKept: number;
  jobsProcessed: number;
  jobsHigh: number;
  jobsMedium: number;
  jobsLow: number;
  jobsFiltered: number;
}): StatisticsOverview {
  const jobsQualified = base.jobsHigh + base.jobsMedium + base.jobsLow;
  const keepRatePct = base.jobsReceived > 0 ? roundPct((base.jobsKept / base.jobsReceived) * 100) : 0;
  const qualityYieldPct = base.jobsProcessed > 0 ? roundPct((jobsQualified / base.jobsProcessed) * 100) : 0;
  const jobsReceivedPerRequest = base.requestCount > 0 ? roundPct(base.jobsReceived / base.requestCount) : 0;
  return {
    ...base,
    jobsQualified,
    keepRatePct,
    qualityYieldPct,
    jobsReceivedPerRequest,
  };
}

function emptyDayPoint(dayUtc: string): StatisticsDailySeriesPoint {
  return {
    dayUtc,
    ...buildOverview({
      requestCount: 0,
      jobsReceived: 0,
      jobsKept: 0,
      jobsProcessed: 0,
      jobsHigh: 0,
      jobsMedium: 0,
      jobsLow: 0,
      jobsFiltered: 0,
    }),
  };
}

function enumerateDays(fromYmd: string, toYmd: string): string[] {
  const out: string[] = [];
  const start = new Date(`${fromYmd}T00:00:00Z`);
  const end = new Date(`${toYmd}T00:00:00Z`);
  for (let cur = start; cur <= end; cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000)) {
    out.push(cur.toISOString().slice(0, 10));
  }
  return out;
}

function mapDailyProviderPoint(row: StatisticsDailyProviderRow): StatisticsDailyProviderPoint {
  return {
    dayUtc: row.day_utc,
    providerId: row.provider_id as JobSourceId,
    requestCount: toNum(row.request_count),
    jobsReceived: toNum(row.jobs_received),
    jobsKept: toNum(row.jobs_kept),
    jobsProcessed: toNum(row.jobs_processed),
    jobsHigh: toNum(row.jobs_high),
    jobsMedium: toNum(row.jobs_medium),
    jobsLow: toNum(row.jobs_low),
    jobsFiltered: toNum(row.jobs_filtered),
  };
}

function aggregateDailySeries(rows: StatisticsDailyProviderRow[], fromYmd: string, toYmd: string): StatisticsDailySeriesPoint[] {
  const map = new Map<string, StatisticsDailySeriesPoint>();
  for (const day of enumerateDays(fromYmd, toYmd)) map.set(day, emptyDayPoint(day));
  for (const row of rows) {
    const day = map.get(row.day_utc);
    if (!day) continue;
    day.requestCount += toNum(row.request_count);
    day.jobsReceived += toNum(row.jobs_received);
    day.jobsKept += toNum(row.jobs_kept);
    day.jobsProcessed += toNum(row.jobs_processed);
    day.jobsHigh += toNum(row.jobs_high);
    day.jobsMedium += toNum(row.jobs_medium);
    day.jobsLow += toNum(row.jobs_low);
    day.jobsFiltered += toNum(row.jobs_filtered);
  }
  return [...map.values()].map((row) => ({
    dayUtc: row.dayUtc,
    ...buildOverview(row),
  }));
}

function vendorRow(row: StatisticsProviderAggregateRow): StatisticsVendorRow {
  const base = buildOverview({
    requestCount: toNum(row.request_count),
    jobsReceived: toNum(row.jobs_received),
    jobsKept: toNum(row.jobs_kept),
    jobsProcessed: toNum(row.jobs_processed),
    jobsHigh: toNum(row.jobs_high),
    jobsMedium: toNum(row.jobs_medium),
    jobsLow: toNum(row.jobs_low),
    jobsFiltered: toNum(row.jobs_filtered),
  });
  return {
    id: row.provider_id,
    label: VENDOR_LABELS[row.provider_id as JobSourceId] ?? row.provider_id,
    qualityScore: base.jobsHigh * 3 + base.jobsMedium * 2 + base.jobsLow,
    ...base,
  };
}

function variantKey(searchQuery: string, tier: number): string {
  return `${searchQuery}\0${tier}`;
}

function variantRow(row: StatisticsVariantAggregateRow): StatisticsVariantRow {
  const base = buildOverview({
    requestCount: toNum(row.request_count),
    jobsReceived: toNum(row.jobs_received),
    jobsKept: toNum(row.jobs_kept),
    jobsProcessed: toNum(row.jobs_processed),
    jobsHigh: toNum(row.jobs_high),
    jobsMedium: toNum(row.jobs_medium),
    jobsLow: toNum(row.jobs_low),
    jobsFiltered: toNum(row.jobs_filtered),
  });
  const tier = toNum(row.tier);
  const jobsOutstanding = Math.max(0, base.jobsReceived - base.jobsProcessed);
  return {
    searchQuery: row.search_query,
    tier: 1,
    tierLabel: "Tier 1",
    providers: String(row.providers_csv || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    qualityScore: base.jobsHigh * 3 + base.jobsMedium * 2 + base.jobsLow,
    jobsOutstanding,
    providerRequestBreakdown: [],
    ...base,
  };
}

function indexVariantProviderRequests(
  rows: StatisticsVariantProviderRequestRow[],
): Map<string, { providerId: JobSourceId; requestCount: number }[]> {
  const map = new Map<string, { providerId: JobSourceId; requestCount: number }[]>();
  for (const r of rows) {
    const key = variantKey(r.search_query, toNum(r.tier));
    const arr = map.get(key) ?? [];
    arr.push({ providerId: r.provider_id as JobSourceId, requestCount: toNum(r.request_count) });
    map.set(key, arr);
  }
  for (const [key, arr] of map) {
    arr.sort((a, b) => a.providerId.localeCompare(b.providerId));
    map.set(key, arr);
  }
  return map;
}

export async function buildStatisticsPayload(
  env: Env,
  userId: string,
  opts?: {
    days?: string | number | null;
    top?: string | number | null;
    from?: string | null;
    to?: string | null;
    date?: string | null;
    end?: string | null;
  },
): Promise<StatisticsPayload> {
  const nowSec = Math.floor(Date.now() / 1000);
  const days = normalizeStatisticsDays(opts?.days);
  const topVariants = Math.max(5, Math.min(30, Math.floor(toNum(opts?.top) || 12)));
  await ensureStatisticsBackfilled(env.DB, userId, nowSec);

  const todayYmd = utcYmdFromUnix(nowSec);
  const fromRaw = typeof opts?.from === "string" ? opts.from.trim() : "";
  const toRaw = typeof opts?.to === "string" ? opts.to.trim() : "";
  const exactDateRaw = typeof opts?.date === "string" ? opts.date.trim() : "";
  const endRaw = typeof opts?.end === "string" ? opts.end.trim() : "";
  let fromYmd: string;
  let toYmd: string;
  if (fromRaw || toRaw) {
    const clampedFrom = (fromRaw || toRaw) <= todayYmd ? (fromRaw || toRaw) : todayYmd;
    const clampedTo = (toRaw || fromRaw) <= todayYmd ? (toRaw || fromRaw) : todayYmd;
    const w = statisticsExactRangeWindow(clampedFrom, clampedTo);
    if (w) {
      fromYmd = w.fromYmd;
      toYmd = w.toYmd;
    } else {
      const fallback = statisticsWindow(nowSec, days);
      fromYmd = fallback.fromYmd;
      toYmd = fallback.toYmd;
    }
  } else if (exactDateRaw) {
    const clampedDate = exactDateRaw <= todayYmd ? exactDateRaw : todayYmd;
    const w = statisticsSingleDayWindow(clampedDate);
    if (w) {
      fromYmd = w.fromYmd;
      toYmd = w.toYmd;
    } else {
      const fallback = statisticsWindow(nowSec, days);
      fromYmd = fallback.fromYmd;
      toYmd = fallback.toYmd;
    }
  } else if (endRaw) {
    const clampedEnd = endRaw <= todayYmd ? endRaw : todayYmd;
    const w = statisticsWindowEndingOn(clampedEnd, days);
    if (w) {
      fromYmd = w.fromYmd;
      toYmd = w.toYmd;
    } else {
      const fallback = statisticsWindow(nowSec, days);
      fromYmd = fallback.fromYmd;
      toYmd = fallback.toYmd;
    }
  } else {
    const w = statisticsWindow(nowSec, days);
    fromYmd = w.fromYmd;
    toYmd = w.toYmd;
  }
  const [dailyRows, providerRows, variantRows, variantProviderRequests, titleQueryHealthByVendor] =
    await Promise.all([
      listStatisticsDailyProviderRows(env.DB, userId, fromYmd, toYmd),
      listStatisticsProviderAggregates(env.DB, userId, fromYmd, toYmd),
      listStatisticsVariantAggregates(env.DB, userId, fromYmd, toYmd, topVariants),
      listStatisticsVariantProviderRequestBreakdown(env.DB, userId, fromYmd, toYmd),
      aggregateTitleQueryHealthByVendor(env.DB, userId, fromYmd, toYmd),
    ]);

  const dailySeries = aggregateDailySeries(dailyRows, fromYmd, toYmd);
  const dailyProviders = dailyRows.map(mapDailyProviderPoint);
  const vendors = providerRows.map(vendorRow).sort((a, b) => b.qualityScore - a.qualityScore || b.jobsReceived - a.jobsReceived);
  const requestByVariant = indexVariantProviderRequests(variantProviderRequests);
  const variants = variantRows
    .map(variantRow)
    .map((v) => ({
      ...v,
      providerRequestBreakdown: requestByVariant.get(variantKey(v.searchQuery, v.tier)) ?? [],
    }))
    .sort(
      (a, b) =>
        b.requestCount - a.requestCount ||
        b.qualityScore - a.qualityScore ||
        b.jobsReceived - a.jobsReceived ||
        a.searchQuery.localeCompare(b.searchQuery) ||
        a.tier - b.tier,
    );
  const overviewBase = dailySeries.reduce(
    (acc, row) => {
      acc.requestCount += row.requestCount;
      acc.jobsReceived += row.jobsReceived;
      acc.jobsKept += row.jobsKept;
      acc.jobsProcessed += row.jobsProcessed;
      acc.jobsHigh += row.jobsHigh;
      acc.jobsMedium += row.jobsMedium;
      acc.jobsLow += row.jobsLow;
      acc.jobsFiltered += row.jobsFiltered;
      return acc;
    },
    {
      requestCount: 0,
      jobsReceived: 0,
      jobsKept: 0,
      jobsProcessed: 0,
      jobsHigh: 0,
      jobsMedium: 0,
      jobsLow: 0,
      jobsFiltered: 0,
    },
  );
  const overview = buildOverview(overviewBase);

  return {
    ok: true,
    days,
    fromYmd,
    toYmd,
    historyCaveat:
      "Historical rows from before live statistics tracking are best-effort from retained jobs, logs, and request counters; older activity may be undercounted.",
    overview,
    dailySeries,
    dailyProviders,
    vendors,
    titleQueryHealthByVendor,
    variants,
  };
}
