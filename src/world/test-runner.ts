// ─── Test Runner for Fix Validation ─────────────────────────
// Runs the seed world through validation and prints detailed debug report.
// Execute: npx vite-node src/world/test-runner.ts

import { createSeedWorld } from "./seed";
import {
  validateWorldState,
  extractRequiredObjects,
  normalizeObjectName,
  canonicalObjectName,
  namesMatch,
} from "./validation";
import { debugFullReport } from "./debug";

// ─── Test 1: Name Normalization ────────────────────────────

console.log("═══════════════════════════════════════════════════════");
console.log("  TEST 1: Name Normalization (FIX 1)");
console.log("═══════════════════════════════════════════════════════\n");

const normTests: [string, string][] = [
  ["filing cabinet", "filing_cabinet"],
  ["filing_cabinet", "filing_cabinet"],
  ["filing-cabinet", "filing_cabinet"],
  ["Filing Cabinet", "filing_cabinet"],
  ["FILING_CABINET", "filing_cabinet"],
  ["filing  cabinet", "filing_cabinet"],
  ["Desk Lamp", "lamp"],
  ["laptop", "laptop"],
  ["table", "table"],
];

let normPass = 0;
for (const [input, expected] of normTests) {
  const normalized = normalizeObjectName(input);
  const canonical = canonicalObjectName(input);
  const ok = canonical === expected;
  if (ok) normPass++;
  console.log(`  ${ok ? "PASS" : "FAIL"} | normalize("${input}") = "${normalized}" | canonical = "${canonical}" | expected = "${expected}"`);
}
console.log(`\n  Result: ${normPass}/${normTests.length} passed\n`);

// ─── Test 2: namesMatch ────────────────────────────────────

console.log("═══════════════════════════════════════════════════════");
console.log("  TEST 2: namesMatch (FIX 1)");
console.log("═══════════════════════════════════════════════════════\n");

const matchTests: [string, string, boolean][] = [
  ["filing_cabinet", "filing-cabinet", true],
  ["filing cabinet", "filing_cabinet", true],
  ["Filing Cabinet", "filing_cabinet", true],
  ["laptop", "Laptop", true],
  ["lamp", "desk_lamp", true],
  ["table", "laptop", false],
];

let matchPass = 0;
for (const [a, b, expected] of matchTests) {
  const result = namesMatch(a, b);
  const ok = result === expected;
  if (ok) matchPass++;
  console.log(`  ${ok ? "PASS" : "FAIL"} | namesMatch("${a}", "${b}") = ${result} | expected = ${expected}`);
}
console.log(`\n  Result: ${matchPass}/${matchTests.length} passed\n`);

// ─── Test 3: Required Object Extraction ────────────────────

console.log("═══════════════════════════════════════════════════════");
console.log("  TEST 3: extractRequiredObjects");
console.log("═══════════════════════════════════════════════════════\n");

const testPrompt = "Test scene with logical desk and floor regions, a desk table, laptop, lamp, and filing cabinet using explicit support surfaces and clear placement relations";
const required = extractRequiredObjects(testPrompt);
console.log(`  Prompt: "${testPrompt}"`);
console.log(`  Extracted: [${required.join(", ")}]`);
const expectedRequired = ["table", "laptop", "lamp", "filing_cabinet"];
const allFound = expectedRequired.every(r => required.includes(r));
console.log(`  Expected: [${expectedRequired.join(", ")}]`);
console.log(`  All expected found: ${allFound ? "PASS" : "FAIL"}\n`);

// ─── Test 4: Seed World Validation ─────────────────────────

console.log("═══════════════════════════════════════════════════════");
console.log("  TEST 4: Seed World Validation (ALL FIXES)");
console.log("═══════════════════════════════════════════════════════\n");

const seedWorld = createSeedWorld();

// Test with various name formats for required objects
const requiredVariants = [
  "table",
  "laptop",
  "lamp",
  "filing_cabinet",   // underscore format
  "filing-cabinet",   // hyphen format — this was the bug
  "filing cabinet",   // space format — this was the bug
];

console.log("  Testing required object matching with name variants:");
const validationResult = validateWorldState(seedWorld, requiredVariants);

// Print the full debug report
console.log("\n" + debugFullReport(seedWorld, requiredVariants, validationResult));

// ─── Test 5: Summary ──────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════════");
console.log("  TEST SUMMARY");
console.log("═══════════════════════════════════════════════════════\n");

const checks = [
  { name: "FIX 1: Name normalization", pass: normPass === normTests.length },
  { name: "FIX 1: namesMatch",         pass: matchPass === matchTests.length },
  { name: "FIX 1: Required extraction", pass: allFound },
  { name: "FIX 1: No false missing",   pass: validationResult.required_object_matches.every(m => m.found) },
  { name: "FIX 2: Type separation",    pass: seedWorld.regions.size > 0 && seedWorld.objects.size > 0 && seedWorld.support_surfaces.size > 0 },
  { name: "FIX 3: Height metrics",     pass: validationResult.object_metrics.every(m => m.height.object_height > 0) },
  { name: "FIX 3: Support metrics",    pass: validationResult.object_metrics.every(m => m.support.support_score > 0) },
  { name: "FIX 4: Zone metrics",       pass: validationResult.object_metrics.every(m => m.zone.zone_score > 0) },
  { name: "FIX 5: Orientation metrics", pass: validationResult.object_metrics.every(m => m.orientation.orientation_score > 0) },
  { name: "FIX 6: Score breakdown",    pass: validationResult.scores.height_relation_score >= 0 && validationResult.scores.semantic_relation_score >= 0 },
  { name: "FIX 7: Object metrics output", pass: validationResult.object_metrics.length === 4 },
  { name: "Overall: valid=true",       pass: validationResult.valid },
  { name: "Overall: score > 0.7",      pass: validationResult.score > 0.7 },
];

let totalPass = 0;
for (const c of checks) {
  if (c.pass) totalPass++;
  console.log(`  ${c.pass ? "PASS" : "FAIL"} | ${c.name}`);
}
console.log(`\n  Total: ${totalPass}/${checks.length} passed`);
console.log(`  Overall Score: ${(validationResult.score * 100).toFixed(1)}%`);
console.log(`  Errors: ${validationResult.errors.length}`);
console.log(`  Warnings: ${validationResult.warnings.length}`);

if (totalPass === checks.length) {
  console.log("\n  ALL TESTS PASSED\n");
} else {
  console.log("\n  SOME TESTS FAILED — see details above\n");
}
