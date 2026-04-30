import { DEFAULT_SEARCH_COUNTRIES, type SearchCountry } from "../../config/searchCountries";
import type { NormalizedJob } from "../../types/job";

function cleanString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function findCountryByIso2(
  countries: readonly SearchCountry[],
  iso2: string | undefined,
): SearchCountry | undefined {
  const key = cleanString(iso2).toLowerCase();
  if (!key) return undefined;
  return countries.find((country) => country.iso2 === key);
}

function findCountryByName(
  countries: readonly SearchCountry[],
  name: string | undefined,
): SearchCountry | undefined {
  const text = cleanString(name).toLowerCase();
  if (!text) return undefined;
  return countries.find((country) => country.fullName.toLowerCase() === text);
}

export function deriveCountryFromLocation(
  location: string,
  countries: readonly SearchCountry[] = DEFAULT_SEARCH_COUNTRIES,
): string | undefined {
  const text = cleanString(location);
  if (!text) return undefined;
  const direct = findCountryByName(countries, text);
  if (direct) return direct.fullName;
  const parts = text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    const tail = parts[parts.length - 1];
    const byName = findCountryByName(countries, tail);
    if (byName) return byName.fullName;
    const byIso = findCountryByIso2(countries, tail);
    if (byIso) return byIso.fullName;
    return tail;
  }
  const byIso = findCountryByIso2(countries, text);
  if (byIso) return byIso.fullName;
  return undefined;
}

export function finalizeNormalizedJob(
  job: NormalizedJob | null,
  defaults?: {
    country?: string;
    location?: string;
    isRemote?: boolean;
    countries?: readonly SearchCountry[];
  },
): NormalizedJob | null {
  if (!job) return null;

  const title = cleanString(job.title);
  const company = cleanString(job.company);
  const description = cleanString(job.description);
  const jobUrl = cleanString(job.jobUrl);
  const applyUrl = cleanString(job.applyUrl) || jobUrl;
  const location = cleanString(job.location) || cleanString(defaults?.location) || cleanString(defaults?.country);
  const countries = defaults?.countries ?? DEFAULT_SEARCH_COUNTRIES;
  const country =
    cleanString(job.country) || cleanString(defaults?.country) || deriveCountryFromLocation(location, countries);

  if (!title || !company || !description) return null;
  if (!jobUrl && !applyUrl) return null;
  if (!location) return null;

  return {
    ...job,
    title,
    company,
    description,
    jobUrl: jobUrl || applyUrl,
    applyUrl,
    location,
    country: country || undefined,
    isRemote: defaults?.isRemote ?? job.isRemote,
  };
}
