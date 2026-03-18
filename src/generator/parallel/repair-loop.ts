// Repair Loop: Wiederholbare Prüf- und Reparatur-Logik
// Jeder Pipeline-Schritt wird geprüft, bei Fehler repariert, erneut geprüft
// Max N Iterationen, dann Abbruch mit aktuellem Stand

import type {
  Scene, SceneQuality, RepairPlan, RepairLoopResult,
  QualityRule, BuilderTask, BuilderResult, ScenePartition,
} from "../../core/types.js";
import { validateScene, DEFAULT_RULES } from "../../core/quality-rules.js";
import { planRepairs, executeAllRepairs } from "../../core/repair-engine.js";
import { regionBuilder } from "./region-builder.js";
import type { LogFn } from "../pipeline.js";

export interface RepairLoopConfig {
  maxIterations: number;              // Max Reparatur-Zyklen
  minQualityScore: number;            // Mindest-Score für "bestanden"
  rules: QualityRule[];               // Aktive Regeln
  allowReset: boolean;                // Region-Reset erlaubt?
}

const DEFAULT_REPAIR_CONFIG: RepairLoopConfig = {
  maxIterations: 3,
  minQualityScore: 0.7,
  rules: DEFAULT_RULES,
  allowReset: true,
};

// ─── Hauptfunktion: Validate → Repair → Repeat ─────────────

export async function repairLoop(
  scene: Scene,
  config: Partial<RepairLoopConfig> = {},
  log: LogFn = console.log,
): Promise<RepairLoopResult> {
  const cfg = { ...DEFAULT_REPAIR_CONFIG, ...config };
  let current = scene;
  let quality = validateScene(current, cfg.rules);
  const allRepairs: RepairPlan[] = [];
  let iteration = 0;

  log(`Repair-Loop: Start (Score: ${(quality.score * 100).toFixed(0)}%, ${quality.violations.length} violations)`, "info");

  while (!quality.valid && iteration < cfg.maxIterations) {
    iteration++;
    log(`Repair-Loop: Iteration ${iteration}/${cfg.maxIterations}`, "info");

    // 1. Reparatur-Pläne ableiten
    const repairs = planRepairs(quality);
    if (repairs.length === 0) {
      log("  Keine automatische Reparatur möglich", "warn");
      break;
    }

    // Reset-Regions filtern wenn nicht erlaubt
    const filtered = cfg.allowReset
      ? repairs
      : repairs.filter((r) => r.action !== "reset_region");

    log(`  ${filtered.length} Reparatur(en) geplant:`, "info");
    for (const r of filtered) {
      log(`    [${r.action}] ${r.regionId}: ${r.reason}`, "info");
    }

    // 2. Reparaturen ausführen
    current = executeAllRepairs(current, filtered);
    allRepairs.push(...filtered);

    // 3. Erneut validieren
    quality = validateScene(current, cfg.rules);
    log(`  Nach Reparatur: Score ${(quality.score * 100).toFixed(0)}%, ${quality.violations.length} violations`, "info");

    // Frühzeitiger Abbruch wenn gut genug
    if (quality.score >= cfg.minQualityScore) {
      log(`  Score ausreichend (${(quality.score * 100).toFixed(0)}% ≥ ${(cfg.minQualityScore * 100).toFixed(0)}%)`, "success");
      break;
    }
  }

  const fullyResolved = quality.valid || quality.score >= cfg.minQualityScore;
  log(
    fullyResolved
      ? `Repair-Loop: Abgeschlossen nach ${iteration} Iteration(en) — Score: ${(quality.score * 100).toFixed(0)}%`
      : `Repair-Loop: Max Iterationen erreicht — Score: ${(quality.score * 100).toFixed(0)}% (ungelöste Issues)`,
    fullyResolved ? "success" : "warn",
  );

  return {
    finalScene: current,
    finalQuality: quality,
    iterations: iteration,
    repairsApplied: allRepairs,
    fullyResolved,
  };
}

// ─── Region-Level Repair Loop ───────────────────────────────
// Prüft eine einzelne Region nach dem Build und repariert lokal

export async function repairRegion(
  scene: Scene,
  regionId: string,
  config: Partial<RepairLoopConfig> = {},
  log: LogFn = console.log,
): Promise<RepairLoopResult> {
  const cfg = { ...DEFAULT_REPAIR_CONFIG, ...config };
  let current = scene;
  let iteration = 0;
  const allRepairs: RepairPlan[] = [];

  // Nur Primitives dieser Region validieren (+ globale Collision-Checks)
  let quality = validateScene(current, cfg.rules);
  const regionViolations = quality.violations.filter(
    (v) => v.regionId === regionId || v.affectedIds.some((id) =>
      current.primitives.find((p) => p.id === id)?.tags.includes(`part:${regionId}`),
    ),
  );

  if (regionViolations.length === 0) {
    return {
      finalScene: current,
      finalQuality: quality,
      iterations: 0,
      repairsApplied: [],
      fullyResolved: true,
    };
  }

  log(`Region-Repair [${regionId}]: ${regionViolations.length} violations`, "info");

  while (iteration < cfg.maxIterations) {
    iteration++;

    // Leite Reparaturen ab, nur für diese Region
    const regionQuality: SceneQuality = {
      ...quality,
      violations: regionViolations,
    };
    const repairs = planRepairs(regionQuality);

    if (repairs.length === 0) break;

    const filtered = cfg.allowReset
      ? repairs
      : repairs.filter((r) => r.action !== "reset_region");

    for (const r of filtered) {
      log(`  [${r.action}] ${r.reason}`, "info");
    }

    current = executeAllRepairs(current, filtered);
    allRepairs.push(...filtered);

    // Re-validate
    quality = validateScene(current, cfg.rules);
    const remaining = quality.violations.filter(
      (v) => v.regionId === regionId || v.affectedIds.some((id) =>
        current.primitives.find((p) => p.id === id)?.tags.includes(`part:${regionId}`),
      ),
    );

    if (remaining.length === 0 || quality.score >= cfg.minQualityScore) break;
  }

  return {
    finalScene: current,
    finalQuality: validateScene(current, cfg.rules),
    iterations: iteration,
    repairsApplied: allRepairs,
    fullyResolved: quality.score >= cfg.minQualityScore,
  };
}

// ─── Post-Merge Repair Loop ─────────────────────────────────
// Wird nach dem Merge aufgerufen und repariert die gesamte Szene

export async function postMergeRepairLoop(
  scene: Scene,
  partition: ScenePartition,
  config: Partial<RepairLoopConfig> = {},
  log: LogFn = console.log,
): Promise<RepairLoopResult> {
  log("Post-Merge Repair-Loop gestartet...", "info");

  // Erst regionale Reparaturen
  let current = scene;
  const allRepairs: RepairPlan[] = [];
  let totalIterations = 0;

  for (const region of partition.regions) {
    const regionResult = await repairRegion(current, region.id, config, log);
    current = regionResult.finalScene;
    allRepairs.push(...regionResult.repairsApplied);
    totalIterations += regionResult.iterations;
  }

  // Dann globale Reparatur
  const globalResult = await repairLoop(current, config, log);
  current = globalResult.finalScene;
  allRepairs.push(...globalResult.repairsApplied);
  totalIterations += globalResult.iterations;

  return {
    finalScene: current,
    finalQuality: globalResult.finalQuality,
    iterations: totalIterations,
    repairsApplied: allRepairs,
    fullyResolved: globalResult.fullyResolved,
  };
}

// ─── Quality-Gate: Entscheide ob KI-Critic gerufen wird ────
// Spart Token: KI-Critic nur bei kritischen Fällen

export function needsAICritic(quality: SceneQuality): boolean {
  // KI-Critic nur wenn:
  // 1. Score zwischen 0.4-0.85 (unclear cases)
  // 2. Keine harten Errors, aber Warnings
  // 3. Max 2 Violations (sonst klar algorithmisch lösbar)
  const errors = quality.violations.filter((v) => v.severity === "error");
  const warnings = quality.violations.filter((v) => v.severity === "warning");

  if (errors.length > 0) return false; // Algorithmisch reparierbar
  if (quality.score >= 0.85) return false; // Gut genug
  if (quality.score < 0.4) return false; // Zu schlecht, Reset nötig
  if (warnings.length > 2) return false; // Viele Warnings → algorithmisch

  return warnings.length > 0 && warnings.length <= 2;
}
