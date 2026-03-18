// ─── Placement Validator: Prüft finale Platzierungen auf Korrektheit ────────
// Rein algorithmisch, keine KI. Validiert Ergebnisse der Constraint Engine.
// IMPORTANT: Only validates PHYSICAL OBJECTS. Regions are NEVER validated here.

import type { Vec3, Primitive } from "../core/types.js";
import type { PlacementResult, AnchorInfo } from "../constraints/object-constraint-spec.js";
import type { ConstraintEngineResult } from "../constraints/constraint-engine.js";

// ─── Validation Result ──────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  score: number;
  scores: PlacementScoreBreakdown;
  checks: ValidationCheck[];
  summary: string;
}

export interface PlacementScoreBreakdown {
  placement_success: number;     // ratio of successfully placed objects
  overlap_free: number;          // ratio of pairs without overlap
  grounding: number;             // ratio of grounded objects
  size_validity: number;         // ratio of valid sizes
}

export interface ValidationCheck {
  name: string;
  passed: boolean;
  message: string;
  severity: "error" | "warning" | "info";
}

// ─── Hauptfunktion: Validiere Engine-Ergebnis ───────────────

export function validatePlacements(
  engineResult: ConstraintEngineResult,
): ValidationResult {
  const checks: ValidationCheck[] = [];

  // 1. Grundlegende Erfolgs-Prüfung (only physical objects, not regions)
  for (const placement of engineResult.placements) {
    checks.push({
      name: `placement_success:${placement.object_id}`,
      passed: placement.success,
      message: placement.success
        ? `"${placement.object_id}" erfolgreich platziert`
        : `"${placement.object_id}" Platzierung fehlgeschlagen: ${
            placement.failed_constraints.map((f) => f.message).join("; ")
          }`,
      severity: placement.success ? "info" : "error",
    });
  }

  // 2. Kollisionsprüfung zwischen PHYSISCHEN OBJEKTEN (nicht Regionen)
  const successfulPlacements = engineResult.placements.filter((p) => p.success);
  for (let i = 0; i < successfulPlacements.length; i++) {
    for (let j = i + 1; j < successfulPlacements.length; j++) {
      const a = successfulPlacements[i];
      const b = successfulPlacements[j];
      const overlap = checkAABBOverlap(
        a.final_position, a.final_size,
        b.final_position, b.final_size,
      );
      checks.push({
        name: `no_overlap:${a.object_id}↔${b.object_id}`,
        passed: !overlap,
        message: overlap
          ? `Überlappung zwischen "${a.object_id}" und "${b.object_id}" (${overlap.toFixed(3)}m)`
          : `Keine Überlappung zwischen "${a.object_id}" und "${b.object_id}"`,
        severity: overlap ? "warning" : "info",
      });
    }
  }

  // 3. Schwebe-Prüfung: Kein Objekt schwebt in der Luft
  for (const p of successfulPlacements) {
    const bottomY = p.final_position[1] - p.final_size[1] / 2;
    const isFloating = bottomY > 0.01;

    let isSupported = false;
    if (isFloating) {
      for (const other of successfulPlacements) {
        if (other.object_id === p.object_id) continue;
        const otherTopY = other.final_position[1] + other.final_size[1] / 2;
        if (Math.abs(bottomY - otherTopY) < 0.05) {
          const xOverlap = checkAxisOverlap(
            p.final_position[0], p.final_size[0],
            other.final_position[0], other.final_size[0],
          );
          const zOverlap = checkAxisOverlap(
            p.final_position[2], p.final_size[2],
            other.final_position[2], other.final_size[2],
          );
          if (xOverlap && zOverlap) {
            isSupported = true;
            break;
          }
        }
      }
    }

    const grounded = !isFloating || isSupported;
    checks.push({
      name: `grounded:${p.object_id}`,
      passed: grounded,
      message: grounded
        ? `"${p.object_id}" ist gestützt (y_bottom=${bottomY.toFixed(3)})`
        : `"${p.object_id}" schwebt (y_bottom=${bottomY.toFixed(3)}, keine Stütze)`,
      severity: grounded ? "info" : "warning",
    });
  }

  // 4. Größenplausibilität
  for (const p of successfulPlacements) {
    const sizeValid = p.final_size[0] > 0.001 && p.final_size[1] > 0.001 && p.final_size[2] > 0.001;
    checks.push({
      name: `size_valid:${p.object_id}`,
      passed: sizeValid,
      message: sizeValid
        ? `"${p.object_id}" Größe OK: [${p.final_size.map((v) => v.toFixed(3)).join(", ")}]`
        : `"${p.object_id}" ungültige Größe: [${p.final_size.map((v) => v.toFixed(3)).join(", ")}]`,
      severity: sizeValid ? "info" : "error",
    });
  }

  // 5. Primitives-Check
  checks.push({
    name: "primitives_generated",
    passed: engineResult.primitives.length > 0,
    message: `${engineResult.primitives.length} Primitives erzeugt`,
    severity: engineResult.primitives.length > 0 ? "info" : "error",
  });

  // 6. Repair-Budget-Check
  const totalRepairs = engineResult.stats.total_repairs;
  const repairsOk = totalRepairs <= engineResult.stats.total_specs * 3;
  checks.push({
    name: "repair_budget",
    passed: repairsOk,
    message: `${totalRepairs} Reparaturen für ${engineResult.stats.total_specs} Objekte`,
    severity: repairsOk ? "info" : "warning",
  });

  // Compute sub-scores
  const placementChecks = checks.filter((c) => c.name.startsWith("placement_success:"));
  const overlapChecks = checks.filter((c) => c.name.startsWith("no_overlap:"));
  const groundedChecks = checks.filter((c) => c.name.startsWith("grounded:"));
  const sizeChecks = checks.filter((c) => c.name.startsWith("size_valid:"));

  const scores: PlacementScoreBreakdown = {
    placement_success: ratio(placementChecks),
    overlap_free: ratio(overlapChecks),
    grounding: ratio(groundedChecks),
    size_validity: ratio(sizeChecks),
  };

  // Weighted overall score — more nuanced than binary pass/fail
  const score =
    scores.placement_success * 0.40 +
    scores.overlap_free * 0.20 +
    scores.grounding * 0.25 +
    scores.size_validity * 0.15;

  const errorChecks = checks.filter((c) => c.severity === "error" && !c.passed);
  const valid = errorChecks.length === 0;

  const failedChecks = checks.filter((c) => !c.passed);
  const summary = valid
    ? `Alle Checks bestanden (Score: ${(score * 100).toFixed(0)}%)`
    : `${failedChecks.length}/${checks.length} Checks fehlgeschlagen (Score: ${(score * 100).toFixed(0)}%): ${
        failedChecks.slice(0, 5).map((c) => c.name).join(", ")
      }${failedChecks.length > 5 ? ` +${failedChecks.length - 5} more` : ""}`;

  return { valid, score, scores, checks, summary };
}

// ─── Helfer ────────────────────────────────────────────────

function ratio(checks: ValidationCheck[]): number {
  if (checks.length === 0) return 1;
  return checks.filter((c) => c.passed).length / checks.length;
}

function checkAABBOverlap(
  posA: Vec3, sizeA: Vec3,
  posB: Vec3, sizeB: Vec3,
): number | null {
  let minOverlap = Infinity;

  for (let i = 0; i < 3; i++) {
    const halfA = sizeA[i] / 2;
    const halfB = sizeB[i] / 2;
    const dist = Math.abs(posA[i] - posB[i]);
    const overlap = (halfA + halfB) - dist;
    if (overlap <= 0) return null;
    minOverlap = Math.min(minOverlap, overlap);
  }

  return minOverlap;
}

function checkAxisOverlap(
  posA: number, sizeA: number,
  posB: number, sizeB: number,
): boolean {
  const halfA = sizeA / 2;
  const halfB = sizeB / 2;
  return Math.abs(posA - posB) < (halfA + halfB);
}
