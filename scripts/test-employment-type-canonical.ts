/**
 * Employment type canonicalization (no network).
 * Run: npm run test:employment-type-canonical
 */
import assert from "node:assert/strict";
import {
  canonicalizeEmploymentFragment,
  canonicalizeEmploymentType,
  normalizeEmploymentMatchKey,
} from "../src/providers/lib/employmentTypeCanonical";
import { normalizeEmploymentType } from "../src/providers/lib/providerFieldSemantics";

assert.equal(normalizeEmploymentMatchKey("Full–Time"), "full-time");
assert.equal(canonicalizeEmploymentFragment("Vollzeit"), "Fulltime");
assert.equal(canonicalizeEmploymentFragment("A Tiempo Completo"), "Fulltime");
assert.equal(canonicalizeEmploymentFragment("Tempo inteiro"), "Fulltime");
assert.equal(canonicalizeEmploymentFragment("Temporary"), "Temporary");
assert.equal(canonicalizeEmploymentFragment("temporário"), "Temporary");
assert.equal(canonicalizeEmploymentFragment("Teilzeit"), "Parttime");
assert.equal(canonicalizeEmploymentType("FULL_TIME"), "Fulltime");
assert.equal(normalizeEmploymentType("FULL_TIME"), "Fulltime");
assert.equal(
  canonicalizeEmploymentType("FULL_TIME, CONTRACT"),
  "Fulltime, Contract",
);

assert.equal(canonicalizeEmploymentFragment("Deeltijd", "nl"), "Parttime");
assert.equal(canonicalizeEmploymentFragment("Deeltijd", "Netherlands"), "Parttime");
assert.equal(
  canonicalizeEmploymentFragment("voltijd", "be"),
  "Fulltime",
);

assert.equal(canonicalizeEmploymentFragment("kokoaikainen"), "Fulltime");
assert.equal(canonicalizeEmploymentFragment("määräaikainen"), "Temporary");
assert.equal(canonicalizeEmploymentFragment("pełny etat"), "Fulltime");
assert.equal(canonicalizeEmploymentFragment("indeterminato"), "indeterminato");

console.log("test-employment-type-canonical: ok");
