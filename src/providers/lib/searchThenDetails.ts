import type { NormalizedJob } from "../../types/job";

/**
 * Reusable 2-step RapidAPI pattern: one GET returns a list (with stable IDs), then one GET per row
 * for full payload (e.g. description). Keeps sequential detail calls to reduce 429s.
 *
 * See `jobsApi.ts` (Pat92 Jobs API — LinkedIn search + get by id).
 */
export async function searchThenDetailsPipeline<TSearchRow>(opts: {
  fetchSearch: () => Promise<Response>;
  parseSearchRows: (json: unknown) => TSearchRow[];
  rowId: (row: TSearchRow) => string | undefined;
  maxDetailFetches: number;
  fetchDetail: (id: string) => Promise<Response>;
  /** Parse JSON body of GET …/get?id= (unwrap `{ data: {...} }` in the provider). */
  parseDetail: (json: unknown) => Record<string, unknown> | null;
  merge: (searchRow: TSearchRow, detail: Record<string, unknown> | null) => NormalizedJob | null;
}): Promise<NormalizedJob[]> {
  const searchRes = await opts.fetchSearch();
  if (!searchRes.ok) {
    const t = await searchRes.text();
    throw new Error(`Search HTTP ${searchRes.status}: ${t.slice(0, 500)}`);
  }
  const searchJson: unknown = await searchRes.json();
  const rows = opts.parseSearchRows(searchJson);
  const limited = rows.slice(0, Math.max(0, opts.maxDetailFetches));

  const out: NormalizedJob[] = [];
  for (const row of limited) {
    const id = opts.rowId(row)?.trim();
    if (!id) continue;

    let detail: Record<string, unknown> | null = null;
    try {
      const dr = await opts.fetchDetail(id);
      if (dr.ok) {
        const dj: unknown = await dr.json();
        detail = opts.parseDetail(dj);
      }
    } catch {
      detail = null;
    }
    const n = opts.merge(row, detail);
    if (n) out.push(n);
  }
  return out;
}
