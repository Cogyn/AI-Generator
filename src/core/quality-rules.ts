// Quality Rules Engine: Feste, algorithmische Regeln für Scene-Validierung
// Keine KI nötig – rein metrisch/regelbasiert
// Jede Regel prüft einen Aspekt und liefert Violations zurück

import type {
  Scene, Primitive, Vec3, AABB,
  QualityRule, QualityRuleType,
  QualityMetrics, QualityViolation, SceneQuality, RegionQuality,
} from "./types.js";
import { getPrimitiveExtents } from "./types.js";
import { getBBox } from "./constraints.js";

// ─── Default-Regelset ───────────────────────────────────────

export const DEFAULT_RULES: QualityRule[] = [
  { type: "no_overlap",    enabled: true,  params: { tolerance: 0.1 } },
  { type: "density",       enabled: true,  params: { min: 0.001, max: 2.0 } },
  { type: "height_diff",   enabled: true,  params: { maxDelta: 1.5 } },
  { type: "smoothness",    enabled: true,  params: { maxDiff: 0.3 } },
  { type: "detail_level",  enabled: true,  params: { objectsPer100Units: 10 } },
  { type: "bounds_check",  enabled: true,  params: { limit: 100 } },
  { type: "connectivity",  enabled: true,  params: { maxGap: 0.5 } },
  { type: "type_allowed",  enabled: true,  params: { allowed: ["cube", "sphere", "cylinder"] } },
];

// ─── Metriken berechnen (einmal pro Szene/Region) ───────────

export function computeMetrics(primitives: Primitive[], bounds?: AABB): QualityMetrics {
  if (primitives.length === 0) {
    return { collisions: 0, density: 0, heightDiff: 0, smoothness: 0, detailLevel: 0, outOfBounds: 0, disconnected: 0 };
  }

  const bb = bounds ?? computeBounds(primitives);
  const vol = boundsVolume(bb);
  const area = (bb.max[0] - bb.min[0]) * (bb.max[2] - bb.min[2]);

  return {
    collisions: countCollisions(primitives),
    density: vol > 0 ? primitives.length / vol : 0,
    heightDiff: computeMaxHeightDiff(primitives),
    smoothness: computeSmoothness(primitives),
    detailLevel: area > 0 ? (primitives.length / area) * 100 : 0,
    outOfBounds: countOutOfBounds(primitives, 100),
    disconnected: countDisconnected(primitives, 0.5),
  };
}

// ─── Regel-Prüfung ──────────────────────────────────────────

export function checkRule(
  rule: QualityRule,
  primitives: Primitive[],
  metrics: QualityMetrics,
  regionId?: string,
): QualityViolation[] {
  if (!rule.enabled) return [];

  switch (rule.type) {
    case "no_overlap":    return checkNoOverlap(primitives, rule.params.tolerance as number, regionId);
    case "density":       return checkDensity(metrics, rule.params.min as number, rule.params.max as number, regionId);
    case "height_diff":   return checkHeightDiff(metrics, rule.params.maxDelta as number, regionId);
    case "smoothness":    return checkSmoothness(metrics, rule.params.maxDiff as number, regionId);
    case "detail_level":  return checkDetailLevel(metrics, rule.params.objectsPer100Units as number, primitives.length, regionId);
    case "bounds_check":  return checkBounds(primitives, rule.params.limit as number, regionId);
    case "connectivity":  return checkConnectivity(primitives, rule.params.maxGap as number, regionId);
    case "type_allowed":  return checkTypeAllowed(primitives, rule.params.allowed as string[], regionId);
    default:              return [];
  }
}

// Alle Regeln auf eine Primitive-Liste anwenden
export function validateWithRules(
  primitives: Primitive[],
  rules: QualityRule[],
  regionId?: string,
  bounds?: AABB,
): { metrics: QualityMetrics; violations: QualityViolation[] } {
  const metrics = computeMetrics(primitives, bounds);
  const violations: QualityViolation[] = [];
  for (const rule of rules) {
    violations.push(...checkRule(rule, primitives, metrics, regionId));
  }
  return { metrics, violations };
}

// ─── Szene komplett validieren (global + pro Region) ────────

export function validateScene(
  scene: Scene,
  rules: QualityRule[] = DEFAULT_RULES,
): SceneQuality {
  // Globale Validierung
  const { metrics, violations } = validateWithRules(scene.primitives, rules);

  // Pro Region validieren
  const regionGroups = groupByRegion(scene.primitives);
  const regionQualities: RegionQuality[] = [];

  for (const [regionId, prims] of regionGroups) {
    const regionResult = validateWithRules(prims, rules, regionId);
    regionQualities.push({
      regionId,
      valid: regionResult.violations.filter((v) => v.severity === "error").length === 0,
      metrics: regionResult.metrics,
      violations: regionResult.violations,
    });
  }

  const errors = violations.filter((v) => v.severity === "error");
  const valid = errors.length === 0;

  // Score: 1.0 minus Abzüge pro Violation
  const errorPenalty = errors.length * 0.15;
  const warnPenalty = violations.filter((v) => v.severity === "warning").length * 0.05;
  const score = Math.max(0, Math.min(1, 1.0 - errorPenalty - warnPenalty));

  return {
    valid,
    score: +score.toFixed(3),
    metrics,
    violations,
    regionQualities,
    timestamp: new Date().toISOString(),
  };
}

// ─── Einzelne Regel-Implementierungen ───────────────────────

function checkNoOverlap(
  primitives: Primitive[], tolerance: number, regionId?: string,
): QualityViolation[] {
  const violations: QualityViolation[] = [];
  for (let i = 0; i < primitives.length; i++) {
    const a = getBBox(primitives[i]);
    for (let j = i + 1; j < primitives.length; j++) {
      const b = getBBox(primitives[j]);
      let overlaps = true;
      let minDepth = Infinity;
      for (let k = 0; k < 3; k++) {
        const depth = Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]);
        if (depth <= tolerance) { overlaps = false; break; }
        minDepth = Math.min(minDepth, depth);
      }
      if (overlaps) {
        violations.push({
          rule: "no_overlap",
          severity: "error",
          message: `Collision: "${primitives[i].id}" ↔ "${primitives[j].id}" (depth: ${minDepth.toFixed(2)})`,
          affectedIds: [primitives[i].id, primitives[j].id],
          regionId,
          measured: minDepth,
          threshold: tolerance,
        });
      }
    }
  }
  return violations;
}

function checkDensity(
  metrics: QualityMetrics, min: number, max: number, regionId?: string,
): QualityViolation[] {
  const violations: QualityViolation[] = [];
  if (metrics.density < min) {
    violations.push({
      rule: "density",
      severity: "warning",
      message: `Density too low: ${metrics.density.toFixed(3)} (min: ${min})`,
      affectedIds: [],
      regionId,
      measured: metrics.density,
      threshold: min,
    });
  }
  if (metrics.density > max) {
    violations.push({
      rule: "density",
      severity: "warning",
      message: `Density too high: ${metrics.density.toFixed(3)} (max: ${max})`,
      affectedIds: [],
      regionId,
      measured: metrics.density,
      threshold: max,
    });
  }
  return violations;
}

function checkHeightDiff(
  metrics: QualityMetrics, maxDelta: number, regionId?: string,
): QualityViolation[] {
  if (metrics.heightDiff <= maxDelta) return [];
  return [{
    rule: "height_diff",
    severity: "warning",
    message: `Height difference too large: ${metrics.heightDiff.toFixed(2)} (max: ${maxDelta})`,
    affectedIds: [],
    regionId,
    measured: metrics.heightDiff,
    threshold: maxDelta,
  }];
}

function checkSmoothness(
  metrics: QualityMetrics, maxDiff: number, regionId?: string,
): QualityViolation[] {
  if (metrics.smoothness <= maxDiff) return [];
  return [{
    rule: "smoothness",
    severity: "warning",
    message: `Surface not smooth enough: laplacian diff ${metrics.smoothness.toFixed(3)} (max: ${maxDiff})`,
    affectedIds: [],
    regionId,
    measured: metrics.smoothness,
    threshold: maxDiff,
  }];
}

function checkDetailLevel(
  metrics: QualityMetrics, targetPer100: number, totalPrims: number, regionId?: string,
): QualityViolation[] {
  // Nur warnen wenn signifikant abweichend (Faktor 3x)
  if (totalPrims < 2) return [];
  if (metrics.detailLevel < targetPer100 / 3) {
    return [{
      rule: "detail_level",
      severity: "warning",
      message: `Detail too sparse: ${metrics.detailLevel.toFixed(1)} obj/100u² (target: ${targetPer100})`,
      affectedIds: [],
      regionId,
      measured: metrics.detailLevel,
      threshold: targetPer100,
    }];
  }
  if (metrics.detailLevel > targetPer100 * 3) {
    return [{
      rule: "detail_level",
      severity: "warning",
      message: `Detail too dense: ${metrics.detailLevel.toFixed(1)} obj/100u² (target: ${targetPer100})`,
      affectedIds: [],
      regionId,
      measured: metrics.detailLevel,
      threshold: targetPer100,
    }];
  }
  return [];
}

function checkBounds(
  primitives: Primitive[], limit: number, regionId?: string,
): QualityViolation[] {
  const violations: QualityViolation[] = [];
  for (const p of primitives) {
    const ext = getPrimitiveExtents(p);
    for (let i = 0; i < 3; i++) {
      if (Math.abs(p.position[i]) + ext[i] / 2 > limit) {
        violations.push({
          rule: "bounds_check",
          severity: "error",
          message: `"${p.id}" exceeds bounds (±${limit}) on ${["x", "y", "z"][i]}-axis`,
          affectedIds: [p.id],
          regionId,
          measured: Math.abs(p.position[i]) + ext[i] / 2,
          threshold: limit,
        });
        break; // eine Violation pro Primitive reicht
      }
    }
  }
  return violations;
}

function checkConnectivity(
  primitives: Primitive[], maxGap: number, regionId?: string,
): QualityViolation[] {
  if (primitives.length <= 1) return [];
  const violations: QualityViolation[] = [];

  for (let i = 1; i < primitives.length; i++) {
    const pBox = getBBox(primitives[i]);
    let nearest = Infinity;

    for (let j = 0; j < primitives.length; j++) {
      if (i === j) continue;
      const oBox = getBBox(primitives[j]);
      let distSq = 0;
      for (let k = 0; k < 3; k++) {
        const gap = Math.max(0, pBox.min[k] - oBox.max[k], oBox.min[k] - pBox.max[k]);
        distSq += gap * gap;
      }
      nearest = Math.min(nearest, Math.sqrt(distSq));
    }

    if (nearest > maxGap) {
      violations.push({
        rule: "connectivity",
        severity: "warning",
        message: `"${primitives[i].id}" is disconnected (gap: ${nearest.toFixed(2)}, max: ${maxGap})`,
        affectedIds: [primitives[i].id],
        regionId,
        measured: nearest,
        threshold: maxGap,
      });
    }
  }
  return violations;
}

function checkTypeAllowed(
  primitives: Primitive[], allowed: string[], regionId?: string,
): QualityViolation[] {
  const violations: QualityViolation[] = [];
  for (const p of primitives) {
    if (!allowed.includes(p.type)) {
      violations.push({
        rule: "type_allowed",
        severity: "error",
        message: `"${p.id}" has disallowed type "${p.type}" (allowed: [${allowed.join(", ")}])`,
        affectedIds: [p.id],
        regionId,
        measured: 0,
        threshold: 0,
      });
    }
  }
  return violations;
}

// ─── Metriken-Hilfsfunktionen ───────────────────────────────

function countCollisions(primitives: Primitive[]): number {
  let count = 0;
  const tolerance = 0.1;
  for (let i = 0; i < primitives.length; i++) {
    const a = getBBox(primitives[i]);
    for (let j = i + 1; j < primitives.length; j++) {
      const b = getBBox(primitives[j]);
      let overlaps = true;
      for (let k = 0; k < 3; k++) {
        if (a.max[k] <= b.min[k] + tolerance || b.max[k] <= a.min[k] + tolerance) {
          overlaps = false;
          break;
        }
      }
      if (overlaps) count++;
    }
  }
  return count;
}

function computeMaxHeightDiff(primitives: Primitive[]): number {
  if (primitives.length < 2) return 0;

  // Finde Nachbar-Paare (räumlich nah auf XZ-Ebene) und messe Y-Differenz
  let maxDiff = 0;
  for (let i = 0; i < primitives.length; i++) {
    for (let j = i + 1; j < primitives.length; j++) {
      const a = primitives[i];
      const b = primitives[j];
      const xzDist = Math.sqrt((a.position[0] - b.position[0]) ** 2 + (a.position[2] - b.position[2]) ** 2);

      // Nur benachbarte Objekte (XZ-Abstand < 3 Units)
      if (xzDist < 3) {
        const yDiff = Math.abs(a.position[1] - b.position[1]);
        maxDiff = Math.max(maxDiff, yDiff);
      }
    }
  }
  return +maxDiff.toFixed(3);
}

function computeSmoothness(primitives: Primitive[]): number {
  if (primitives.length < 3) return 0;

  // Laplacian-Smoothness: Für jedes Primitive, berechne Differenz zur
  // durchschnittlichen Höhe seiner Nachbarn (Nachbar = XZ-Abstand < 3)
  let totalDiff = 0;
  let count = 0;

  for (const p of primitives) {
    const neighbors = primitives.filter((q) =>
      q.id !== p.id &&
      Math.sqrt((p.position[0] - q.position[0]) ** 2 + (p.position[2] - q.position[2]) ** 2) < 3,
    );

    if (neighbors.length === 0) continue;
    const avgNeighborY = neighbors.reduce((s, n) => s + n.position[1], 0) / neighbors.length;
    totalDiff += Math.abs(p.position[1] - avgNeighborY);
    count++;
  }

  return count > 0 ? +(totalDiff / count).toFixed(3) : 0;
}

function countOutOfBounds(primitives: Primitive[], limit: number): number {
  let count = 0;
  for (const p of primitives) {
    const ext = getPrimitiveExtents(p);
    for (let i = 0; i < 3; i++) {
      if (Math.abs(p.position[i]) + ext[i] / 2 > limit) { count++; break; }
    }
  }
  return count;
}

function countDisconnected(primitives: Primitive[], maxGap: number): number {
  if (primitives.length <= 1) return 0;
  let count = 0;

  for (let i = 0; i < primitives.length; i++) {
    const pBox = getBBox(primitives[i]);
    let connected = false;
    for (let j = 0; j < primitives.length; j++) {
      if (i === j) continue;
      const oBox = getBBox(primitives[j]);
      let distSq = 0;
      for (let k = 0; k < 3; k++) {
        const gap = Math.max(0, pBox.min[k] - oBox.max[k], oBox.min[k] - pBox.max[k]);
        distSq += gap * gap;
      }
      if (Math.sqrt(distSq) <= maxGap) { connected = true; break; }
    }
    if (!connected) count++;
  }
  return count;
}

// ─── Allgemeine Hilfsfunktionen ─────────────────────────────

function groupByRegion(primitives: Primitive[]): Map<string, Primitive[]> {
  const groups = new Map<string, Primitive[]>();
  for (const p of primitives) {
    const tag = p.tags.find((t) => t.startsWith("part:"));
    const id = tag ? tag.slice(5) : "global";
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(p);
  }
  return groups;
}

function computeBounds(primitives: Primitive[]): AABB {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of primitives) {
    const box = getBBox(p);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], box.min[i]);
      max[i] = Math.max(max[i], box.max[i]);
    }
  }
  if (min[0] === Infinity) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

function boundsVolume(b: AABB): number {
  return Math.max(0.001,
    (b.max[0] - b.min[0]) *
    Math.max(0.1, b.max[1] - b.min[1]) *
    (b.max[2] - b.min[2]),
  );
}
