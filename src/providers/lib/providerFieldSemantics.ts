import { DEFAULT_SEARCH_COUNTRIES, type SearchCountry } from "../../config/searchCountries";
import { canonicalizeEmploymentType } from "./employmentTypeCanonical";

function findCountryByIso2(
  countries: readonly SearchCountry[],
  iso2: string | undefined,
): SearchCountry | undefined {
  const key = (iso2 ?? "").trim().toLowerCase();
  return countries.find((country) => country.iso2 === key);
}

function findCountryByName(
  countries: readonly SearchCountry[],
  name: string | undefined,
): SearchCountry | undefined {
  const text = (name ?? "").trim().toLowerCase();
  if (!text) return undefined;
  return countries.find((country) => country.fullName.toLowerCase() === text);
}

export function normalizeCountryName(
  value: string | undefined,
  countries: readonly SearchCountry[] = DEFAULT_SEARCH_COUNTRIES,
): string | undefined {
  const text = (value ?? "").trim();
  if (!text) return undefined;
  return findCountryByName(countries, text)?.fullName ?? findCountryByIso2(countries, text)?.fullName ?? text;
}

/**
 * Unified English labels (Fulltime, Parttime, …); multilingual + punctuation handled in {@link canonicalizeEmploymentType}.
 * @param countryHint — optional job country (ISO2 or full name) for disambiguation when phrase lists miss; falls back to franc.
 */
export function normalizeEmploymentType(value: string | undefined, countryHint?: string): string | undefined {
  return canonicalizeEmploymentType(value, countryHint);
}

export function normalizeSalaryCurrency(value: string | undefined): string | undefined {
  const text = (value ?? "").trim();
  if (!text) return undefined;
  return text.toUpperCase();
}
