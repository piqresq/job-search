import {
  DEFAULT_SEARCH_COUNTRIES,
  findSearchCountryByIso2,
  type SearchCountry,
} from "../config/searchCountries";

/**
 * Choose the pre-selected countries for a new user based on the home country
 * detected from their CV.
 *
 * Rules:
 * - If detected country is in DEFAULT_SEARCH_COUNTRIES → pre-select ONLY that
 *   country (the UI always shows the full default list for the user to expand).
 * - If detected country is NOT in DEFAULT_SEARCH_COUNTRIES → pre-select only
 *   that country (added as a custom entry alongside the default list).
 * - If detection failed (null/empty) → pre-select the entire default list.
 */
export function chooseRecommendedCountries(detectedIso2: string | null): SearchCountry[] {
  if (!detectedIso2) return [...DEFAULT_SEARCH_COUNTRIES];
  const found = findSearchCountryByIso2(detectedIso2);
  if (found) return [found];
  // Non-default country — create a minimal entry; fullName comes from the AI.
  return [{ key: detectedIso2, iso2: detectedIso2, fullName: detectedIso2.toUpperCase() }];
}
