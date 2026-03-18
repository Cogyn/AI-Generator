// Boundary Constraints: Cross-Region-Regeln basierend auf PlanObject
// Prüft ob Boundary-Constraints aus dem Plan eingehalten werden

import type {
  PlanObject, PlanBoundaryConstraints, BoundaryPair,
  Scene, Primitive, MergeConflict,
} from "../core/types.js";
import { getBBox } from "../core/constraints.js";

export interface BoundaryConstraintResult {
  valid: boolean;
  violations: BoundaryConstraintViolation[];
}

export interface BoundaryConstraintViolation {
  type: "cross_collision" | "excessive_gap" | "pair_collision" | "pair_gap";
  regionA: string;
  regionB: string;
  description: string;
  measured: number;
  threshold: number;
}

// ─── Boundary-Constraints prüfen ─────────────────────────────

export function checkBoundaryConstraints(
  scene: Scene,
  plan: PlanObject,
): BoundaryConstraintResult {
  const constraints = plan.boundary_constraints;
  const violations: BoundaryConstraintViolation[] = [];

  const regionPrimitives = groupByRegion(scene.primitives);

  // 1. Globale Cross-Region-Collision-Prüfung
  if (constraints.no_cross_region_collision) {
    const collisions = checkCrossRegionCollisions(regionPrimitives);
    violations.push(...collisions);
  }

  // 2. Globale Cross-Region-Gap-Prüfung
  const gapViolations = checkCrossRegionGaps(regionPrimitives, constraints.max_cross_region_gap);
  violations.push(...gapViolations);

  // 3. Explizite Boundary-Pair-Regeln
  for (const pair of constraints.boundary_pairs) {
    const pairViolations = checkBoundaryPair(pair, regionPrimitives);
    violations.push(...pairViolations);
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

// ─── Hilfsfunktionen ─────────────────────────────────────────

function groupByRegion(primitives: Primitive[]): Map<string, Primitive[]> {
  const groups = new Map<string, Primitive[]>();
  for (const p of primitives) {
    const regionTag = p.tags.find((t) => t.startsWith("part:"));
    const regionId = regionTag ? regionTag.slice(5) : "unknown";
    if (!groups.has(regionId)) groups.set(regionId, []);
    groups.get(regionId)!.push(p);
  }
  return groups;
}

function checkCrossRegionCollisions(
  regionPrimitives: Map<string, Primitive[]>,
): BoundaryConstraintViolation[] {
  const violations: BoundaryConstraintViolation[] = [];
  const regions = [...regionPrimitives.entries()];

  for (let i = 0; i < regions.length; i++) {
    for (let j = i + 1; j < regions.length; j++) {
      const [idA, primsA] = regions[i];
      const [idB, primsB] = regions[j];

      let collisionCount = 0;
      for (const a of primsA) {
        for (const b of primsB) {
          if (primitivesOverlap(a, b)) collisionCount++;
        }
      }

      if (collisionCount > 0) {
        violations.push({
          type: "cross_collision",
          regionA: idA,
          regionB: idB,
          description: `${collisionCount} collision(s) between "${idA}" and "${idB}"`,
          measured: collisionCount,
          threshold: 0,
        });
      }
    }
  }

  return violations;
}

function checkCrossRegionGaps(
  regionPrimitives: Map<string, Primitive[]>,
  maxGap: number,
): BoundaryConstraintViolation[] {
  const violations: BoundaryConstraintViolation[] = [];
  const regions = [...regionPrimitives.entries()];

  for (let i = 0; i < regions.length; i++) {
    for (let j = i + 1; j < regions.length; j++) {
      const [idA, primsA] = regions[i];
      const [idB, primsB] = regions[j];

      // Berechne minimalen Abstand zwischen den Regionen
      const minDist = computeMinDistance(primsA, primsB);

      if (minDist > maxGap) {
        violations.push({
          type: "excessive_gap",
          regionA: idA,
          regionB: idB,
          description: `Gap of ${minDist.toFixed(2)} between "${idA}" and "${idB}" exceeds max ${maxGap}`,
          measured: +minDist.toFixed(2),
          threshold: maxGap,
        });
      }
    }
  }

  return violations;
}

function checkBoundaryPair(
  pair: BoundaryPair,
  regionPrimitives: Map<string, Primitive[]>,
): BoundaryConstraintViolation[] {
  const violations: BoundaryConstraintViolation[] = [];
  const primsA = regionPrimitives.get(pair.region_a);
  const primsB = regionPrimitives.get(pair.region_b);

  if (!primsA || !primsB || primsA.length === 0 || primsB.length === 0) return violations;

  // Collision-Check
  if (pair.no_collision) {
    let collisionCount = 0;
    for (const a of primsA) {
      for (const b of primsB) {
        if (primitivesOverlap(a, b)) collisionCount++;
      }
    }
    if (collisionCount > 0) {
      violations.push({
        type: "pair_collision",
        regionA: pair.region_a,
        regionB: pair.region_b,
        description: `Boundary pair "${pair.region_a}"-"${pair.region_b}": ${collisionCount} collision(s)`,
        measured: collisionCount,
        threshold: 0,
      });
    }
  }

  // Gap-Check
  const minDist = computeMinDistance(primsA, primsB);
  if (minDist > pair.max_gap) {
    violations.push({
      type: "pair_gap",
      regionA: pair.region_a,
      regionB: pair.region_b,
      description: `Boundary pair "${pair.region_a}"-"${pair.region_b}": gap ${minDist.toFixed(2)} exceeds ${pair.max_gap}`,
      measured: +minDist.toFixed(2),
      threshold: pair.max_gap,
    });
  }

  return violations;
}

function primitivesOverlap(a: Primitive, b: Primitive): boolean {
  const boxA = getBBox(a);
  const boxB = getBBox(b);
  const tolerance = 0.05;
  for (let k = 0; k < 3; k++) {
    if (boxA.max[k] <= boxB.min[k] + tolerance || boxB.max[k] <= boxA.min[k] + tolerance) {
      return false;
    }
  }
  return true;
}

function computeMinDistance(primsA: Primitive[], primsB: Primitive[]): number {
  let minDist = Infinity;
  for (const a of primsA) {
    for (const b of primsB) {
      const dist = aabbDistance(getBBox(a), getBBox(b));
      minDist = Math.min(minDist, dist);
    }
  }
  return minDist;
}

function aabbDistance(
  a: { min: [number, number, number]; max: [number, number, number] },
  b: { min: [number, number, number]; max: [number, number, number] },
): number {
  let distSq = 0;
  for (let i = 0; i < 3; i++) {
    if (a.max[i] < b.min[i]) {
      distSq += (b.min[i] - a.max[i]) ** 2;
    } else if (b.max[i] < a.min[i]) {
      distSq += (a.min[i] - b.max[i]) ** 2;
    }
  }
  return Math.sqrt(distSq);
}
