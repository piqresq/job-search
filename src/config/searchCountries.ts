export type SearchCountry = {
  key: string;
  iso2: string;
  fullName: string;
};

function country(iso2: string, fullName: string): SearchCountry {
  return {
    key: iso2.trim().toLowerCase(),
    iso2: iso2.trim().toLowerCase(),
    fullName: fullName.trim(),
  };
}

export const DEFAULT_SEARCH_COUNTRIES: readonly SearchCountry[] = [
  country("gb", "United Kingdom"),
  country("ch", "Switzerland"),
  country("no", "Norway"),
  country("is", "Iceland"),
  country("li", "Liechtenstein"),
  country("at", "Austria"),
  country("be", "Belgium"),
  country("bg", "Bulgaria"),
  country("hr", "Croatia"),
  country("cy", "Cyprus"),
  country("cz", "Czechia"),
  country("dk", "Denmark"),
  country("ee", "Estonia"),
  country("fi", "Finland"),
  country("fr", "France"),
  country("de", "Germany"),
  country("gr", "Greece"),
  country("hu", "Hungary"),
  country("ie", "Ireland"),
  country("it", "Italy"),
  country("lv", "Latvia"),
  country("lt", "Lithuania"),
  country("lu", "Luxembourg"),
  country("mt", "Malta"),
  country("nl", "Netherlands"),
  country("pl", "Poland"),
  country("pt", "Portugal"),
  country("ro", "Romania"),
  country("sk", "Slovakia"),
  country("si", "Slovenia"),
  country("es", "Spain"),
  country("se", "Sweden"),
  country("us", "United States"),
] as const;

export const SEARCH_COUNTRIES = DEFAULT_SEARCH_COUNTRIES;

export const SEARCH_COUNTRY_UNITED_STATES = DEFAULT_SEARCH_COUNTRIES.find((country) => country.iso2 === "us")!;

export const SEARCH_COUNTRIES_NON_US = DEFAULT_SEARCH_COUNTRIES.filter(
  (country) => country.iso2 !== SEARCH_COUNTRY_UNITED_STATES.iso2,
);

export function normalizeSearchCountries(input: unknown): SearchCountry[] {
  if (!Array.isArray(input)) return [...DEFAULT_SEARCH_COUNTRIES];
  const out: SearchCountry[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Partial<SearchCountry>;
    const iso2 = typeof item.iso2 === "string" ? item.iso2.trim().toLowerCase() : "";
    const fullName = typeof item.fullName === "string" ? item.fullName.trim() : "";
    if (!iso2 || !fullName) continue;
    if (seen.has(iso2)) continue;
    seen.add(iso2);
    out.push({
      key: iso2,
      iso2,
      fullName,
    });
  }
  return out.length ? out : [...DEFAULT_SEARCH_COUNTRIES];
}

export function findSearchCountryByIso2(iso2: string | undefined): SearchCountry | undefined {
  const key = (iso2 ?? "").trim().toLowerCase();
  return DEFAULT_SEARCH_COUNTRIES.find((country) => country.iso2 === key);
}

export function findSearchCountryByName(name: string | undefined): SearchCountry | undefined {
  const text = (name ?? "").trim().toLowerCase();
  if (!text) return undefined;
  return DEFAULT_SEARCH_COUNTRIES.find((country) => country.fullName.toLowerCase() === text);
}
