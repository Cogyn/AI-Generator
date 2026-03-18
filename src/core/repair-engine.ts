// Repair Engine: Algorithmische Reparatur basierend auf Quality-Violations
// Kein LLM nötig für Standardfälle – nur bei "reset_region" wird der Builder erneut gerufen

import type {
  Scene, Primitive, Vec3, AABB,
  QualityViolation, SceneQuality, RepairPlan, RepairAction,
} from "./types.js";
import { getPrimitiveExtents } from "./types.js";
import { getBBox } from "./constraints.js";
import { removePrimitive, addPrimitive, modifyPrimitive } from "./scene.js";

// ─── Repair-Pläne aus Violations ableiten ───────────────────

export function planRepairs(quality: SceneQuality): RepairPlan[] {
  const plans: RepairPlan[] = [];
  const handled = new Set<string>(); // bereits geplante Primitive-IDs

  // Sortiere Violations: errors zuerst, dann warnings
  const sorted = [...quality.violations].sort((a, b) => {
    if (a.severity === "error" && b.severity !== "error") return -1;
    if (a.severity !== "error" && b.severity === "error") return 1;
    return 0;
  });

  for (const v of sorted) {
    // Keine doppelten Reparaturen für gleiche Primitives
    if (v.affectedIds.some((id) => handled.has(id))) continue;

    const plan = violationToRepair(v);
    if (plan) {
      plans.push(plan);
      for (const id of v.affectedIds) handled.add(id);
    }
  }

  // Sortiere nach Priorität
  plans.sort((a, b) => a.priority - b.priority);
  return plans;
}

// ─── Violation → RepairPlan Mapping ─────────────────────────

function violationToRepair(v: QualityViolation): RepairPlan | null {
  switch (v.rule) {
    case "no_overlap":
      return {
        regionId: v.regionId ?? "global",
        action: "reposition",
        reason: v.message,
        priority: 1,
        parameters: { targetIds: v.affectedIds },
      };

    case "density":
      // Zu dicht → Objekte entfernen, zu dünn → ignorieren (Builder muss mehr generieren)
      if (v.measured > v.threshold) {
        return {
          regionId: v.regionId ?? "global",
          action: "tune_density",
          reason: v.message,
          priority: 3,
          parameters: { targetDensity: v.threshold * 0.8 },
        };
      }
      return null;

    case "height_diff":
      return {
        regionId: v.regionId ?? "global",
        action: "smooth_heights",
        reason: v.message,
        priority: 2,
        parameters: { maxHeight: v.threshold },
      };

    case "smoothness":
      return {
        regionId: v.regionId ?? "global",
        action: "smooth_heights",
        reason: v.message,
        priority: 2,
        parameters: { maxHeight: v.threshold },
      };

    case "bounds_check":
      return {
        regionId: v.regionId ?? "global",
        action: "reposition",
        reason: v.message,
        priority: 1,
        parameters: { targetIds: v.affectedIds },
      };

    case "connectivity":
      return {
        regionId: v.regionId ?? "global",
        action: "reposition",
        reason: v.message,
        priority: 2,
        parameters: { targetIds: v.affectedIds },
      };

    case "type_allowed":
      return {
        regionId: v.regionId ?? "global",
        action: "remove_objects",
        reason: v.message,
        priority: 1,
        parameters: { targetIds: v.affectedIds },
      };

    default:
      return null;
  }
}

// ─── Reparatur-Aktionen ausführen ───────────────────────────

export function executeRepair(scene: Scene, plan: RepairPlan): Scene {
  switch (plan.action) {
    case "remove_objects":
      return repairRemoveObjects(scene, plan);
    case "reposition":
      return repairReposition(scene, plan);
    case "tune_density":
      return repairTuneDensity(scene, plan);
    case "smooth_heights":
      return repairSmoothHeights(scene, plan);
    case "reset_region":
      // Reset wird extern behandelt (Builder erneut aufrufen)
      return repairResetRegion(scene, plan);
    default:
      return scene;
  }
}

// Alle Repairs einer Liste ausführen
export function executeAllRepairs(scene: Scene, plans: RepairPlan[]): Scene {
  let current = scene;
  for (const plan of plans) {
    current = executeRepair(current, plan);
  }
  return current;
}

// ─── Konkrete Reparatur-Implementierungen ───────────────────

function repairRemoveObjects(scene: Scene, plan: RepairPlan): Scene {
  let current = scene;
  for (const id of plan.parameters.targetIds ?? []) {
    current = removePrimitive(current, id);
  }
  return current;
}

function repairReposition(scene: Scene, plan: RepairPlan): Scene {
  let current = scene;
  const targetIds = plan.parameters.targetIds ?? [];

  for (const id of targetIds) {
    const prim = current.primitives.find((p) => p.id === id);
    if (!prim) continue;

    // Strategie: Finde nächste kollisionsfreie Position
    const newPos = findNonOverlappingPosition(prim, current);
    if (newPos) {
      current = modifyPrimitive(current, id, { position: newPos });
    }
  }
  return current;
}

function repairTuneDensity(scene: Scene, plan: RepairPlan): Scene {
  const regionId = plan.regionId;
  const targetDensity = plan.parameters.targetDensity ?? 1.0;

  // Finde Primitives in der Region
  const regionPrims = scene.primitives.filter((p) =>
    p.tags.some((t) => t === `part:${regionId}`),
  );

  if (regionPrims.length === 0) return scene;

  // Berechne aktuelle Dichte
  const bb = computeBounds(regionPrims);
  const vol = boundsVolume(bb);
  const currentDensity = regionPrims.length / vol;

  if (currentDensity <= targetDensity) return scene;

  // Entferne überschüssige Primitives (die am wenigsten "verbundenen" zuerst)
  const toRemove = Math.ceil(regionPrims.length - targetDensity * vol);
  const sorted = [...regionPrims].sort((a, b) => {
    // Weniger verbundene Primitives zuerst entfernen
    const connA = countNeighbors(a, regionPrims);
    const connB = countNeighbors(b, regionPrims);
    return connA - connB;
  });

  let current = scene;
  for (let i = 0; i < Math.min(toRemove, sorted.length - 1); i++) {
    current = removePrimitive(current, sorted[i].id);
  }
  return current;
}

function repairSmoothHeights(scene: Scene, plan: RepairPlan): Scene {
  const regionId = plan.regionId;
  const maxHeight = plan.parameters.maxHeight ?? 1.5;

  // Finde Primitives in der Region
  const regionPrims = scene.primitives.filter((p) =>
    regionId === "global" || p.tags.some((t) => t === `part:${regionId}`),
  );

  if (regionPrims.length < 3) return scene;

  let current = scene;

  // Laplacian-Smoothing: Verschiebe jedes Primitive Richtung Nachbar-Durchschnitt
  for (const p of regionPrims) {
    const neighbors = regionPrims.filter((q) =>
      q.id !== p.id &&
      Math.sqrt((p.position[0] - q.position[0]) ** 2 + (p.position[2] - q.position[2]) ** 2) < 3,
    );

    if (neighbors.length === 0) continue;

    const avgY = neighbors.reduce((s, n) => s + n.position[1], 0) / neighbors.length;
    const diff = p.position[1] - avgY;

    // Nur korrigieren wenn Differenz > maxHeight
    if (Math.abs(diff) > maxHeight) {
      const correction = diff > 0
        ? avgY + maxHeight * 0.8
        : avgY - maxHeight * 0.8;

      current = modifyPrimitive(current, p.id, {
        position: [p.position[0], correction, p.position[2]],
      });
    }
  }
  return current;
}

function repairResetRegion(scene: Scene, plan: RepairPlan): Scene {
  // Entferne alle Primitives der Region → Builder kann sie neu generieren
  const regionId = plan.regionId;
  let current = scene;
  const toRemove = current.primitives.filter((p) =>
    p.tags.some((t) => t === `part:${regionId}`),
  );
  for (const p of toRemove) {
    current = removePrimitive(current, p.id);
  }
  return current;
}

// ─── Hilfsfunktionen ────────────────────────────────────────

function findNonOverlappingPosition(prim: Primitive, scene: Scene): Vec3 | null {
  const ext = getPrimitiveExtents(prim);
  const maxExtent = Math.max(ext[0], ext[1], ext[2]);

  // Probiere Verschiebungen in alle Richtungen
  const directions: Vec3[] = [
    [maxExtent, 0, 0], [-maxExtent, 0, 0],
    [0, maxExtent, 0], [0, -maxExtent, 0],
    [0, 0, maxExtent], [0, 0, -maxExtent],
  ];

  for (let scale = 1; scale <= 4; scale++) {
    for (const dir of directions) {
      const candidate: Vec3 = [
        prim.position[0] + dir[0] * scale,
        prim.position[1] + dir[1] * scale,
        prim.position[2] + dir[2] * scale,
      ];

      // Prüfe ob neue Position kollisionsfrei ist
      const testPrim = { ...prim, position: candidate } as Primitive;
      const testBox = getBBox(testPrim);
      let collision = false;

      for (const existing of scene.primitives) {
        if (existing.id === prim.id) continue;
        const exBox = getBBox(existing);
        let overlaps = true;
        for (let k = 0; k < 3; k++) {
          if (testBox.max[k] <= exBox.min[k] + 0.1 || exBox.max[k] <= testBox.min[k] + 0.1) {
            overlaps = false;
            break;
          }
        }
        if (overlaps) { collision = true; break; }
      }

      if (!collision) {
        // Prüfe Bounds
        let inBounds = true;
        for (let i = 0; i < 3; i++) {
          if (Math.abs(candidate[i]) + ext[i] / 2 > 100) { inBounds = false; break; }
        }
        if (inBounds) return candidate;
      }
    }
  }

  return null; // Keine kollisionsfreie Position gefunden
}

function countNeighbors(p: Primitive, all: Primitive[]): number {
  const pBox = getBBox(p);
  let count = 0;
  for (const q of all) {
    if (q.id === p.id) continue;
    const qBox = getBBox(q);
    let distSq = 0;
    for (let k = 0; k < 3; k++) {
      const gap = Math.max(0, pBox.min[k] - qBox.max[k], qBox.min[k] - pBox.max[k]);
      distSq += gap * gap;
    }
    if (Math.sqrt(distSq) < 1.0) count++;
  }
  return count;
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
