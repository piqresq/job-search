/** Full country names for `location_filter` (Fantastic Jobs — no ISO abbreviations). */
export const LINKEDIN_NON_US_COUNTRIES: readonly string[] = [
  "United Kingdom",
  "Switzerland",
  "Norway",
  "Iceland",
  "Liechtenstein",
  "Austria",
  "Belgium",
  "Bulgaria",
  "Croatia",
  "Cyprus",
  "Czechia",
  "Denmark",
  "Estonia",
  "Finland",
  "France",
  "Germany",
  "Greece",
  "Hungary",
  "Ireland",
  "Italy",
  "Latvia",
  "Lithuania",
  "Luxembourg",
  "Malta",
  "Netherlands",
  "Poland",
  "Portugal",
  "Romania",
  "Slovakia",
  "Slovenia",
  "Spain",
  "Sweden",
] as const;

export const LINKEDIN_COUNTRY_UNITED_STATES = "United States";

/**
 * Map monotonic run sequence to a country. Every `usEveryNRuns`-th run targets the US;
 * other runs round-robin non-US countries (spread across runs).
 */
export function linkedinPickCountry(seq: number, usEveryNRuns: number): string {
  const every = Math.max(2, usEveryNRuns);
  const block = Math.floor((seq - 1) / every);
  const pos = (seq - 1) % every;
  if (pos === every - 1) {
    return LINKEDIN_COUNTRY_UNITED_STATES;
  }
  const n = LINKEDIN_NON_US_COUNTRIES.length;
  const nonUsIndex = (block * (every - 1) + pos) % n;
  return LINKEDIN_NON_US_COUNTRIES[nonUsIndex]!;
}

export async function getLinkedinCountryOffset(db: D1Database, country: string): Promise<number> {
  const row = await db
    .prepare("SELECT offset FROM linkedin_country_offset WHERE country = ?")
    .bind(country)
    .first<{ offset: number }>();
  return typeof row?.offset === "number" && row.offset >= 0 ? row.offset : 0;
}

export async function setLinkedinCountryOffset(
  db: D1Database,
  country: string,
  offset: number,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO linkedin_country_offset (country, offset, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(country) DO UPDATE SET
         offset = excluded.offset,
         updated_at = excluded.updated_at`,
    )
    .bind(country, offset, now)
    .run();
}

export async function getLinkedinCountryDrained(db: D1Database, country: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT drained FROM linkedin_country_offset WHERE country = ?")
    .bind(country)
    .first<{ drained: number }>();
  return row?.drained === 1;
}

export async function setLinkedinCountryDrained(
  db: D1Database,
  country: string,
  drained: boolean,
  now: number,
): Promise<void> {
  const row = await db
    .prepare("SELECT offset FROM linkedin_country_offset WHERE country = ?")
    .bind(country)
    .first<{ offset: number }>();
  const d = drained ? 1 : 0;
  if (row) {
    await db
      .prepare(
        `UPDATE linkedin_country_offset SET drained = ?, updated_at = ? WHERE country = ?`,
      )
      .bind(d, now, country)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO linkedin_country_offset (country, offset, drained, updated_at) VALUES (?, 0, ?, ?)`,
      )
      .bind(country, d, now)
      .run();
  }
}

/** After a 24h freeze window ends: reset offsets and drained flags for all countries. */
export async function resetLinkedinCountryCycle(db: D1Database, now: number): Promise<void> {
  await db
    .prepare(
      `UPDATE linkedin_country_offset SET offset = 0, drained = 0, updated_at = ?`,
    )
    .bind(now)
    .run();
}
