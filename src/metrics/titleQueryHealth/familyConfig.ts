import { DEFAULT_FAMILY_ADJACENCY, DEFAULT_FAMILY_CONFLICT } from "./defaultConfig";

export type FamilyAdjacencyRow = { a: string; b: string; strength: number };
export type FamilyConflictRow = { a: string; b: string; weight: number };

export function mergeFamilyAdjacency(
  base: readonly FamilyAdjacencyRow[],
  extra?: readonly FamilyAdjacencyRow[] | null,
): FamilyAdjacencyRow[] {
  if (!extra?.length) return [...base];
  return [...base, ...extra];
}

export function mergeFamilyConflict(
  base: readonly FamilyConflictRow[],
  extra?: readonly FamilyConflictRow[] | null,
): FamilyConflictRow[] {
  if (!extra?.length) return [...base];
  return [...base, ...extra];
}

export function adjacentFamilyStrength(
  a: string,
  b: string,
  rows: readonly FamilyAdjacencyRow[],
): number {
  if (a === b) return 1;
  for (const row of rows) {
    if ((row.a === a && row.b === b) || (row.a === b && row.b === a)) return row.strength;
  }
  return 0;
}

export function familyConflictStrength(
  a: string,
  b: string,
  rows: readonly FamilyConflictRow[],
): number {
  let w = 0;
  for (const row of rows) {
    if ((row.a === a && row.b === b) || (row.a === b && row.b === a)) w = Math.max(w, row.weight);
  }
  return w;
}
