// BoundaryValidator: Prüft Übergänge zwischen Regionen nach dem Merge
// Erweitert: Prüft Kollisionen, Höhen-Sprünge, Dichte-Unterschiede, Stil-Konsistenz

import type {
  Scene,
  MergeConflict,
  ScenePartition,
  Primitive,
  AABB,
  WorkRegionExt,
} from "../../core/types.js";
import { getPrimitiveExtents } from "../../core/types.js";
import { getBBox } from "../../core/constraints.js";

export interface BoundaryValidationResult {
  valid: boolean;
  conflicts: MergeConflict[];
  heightJumps: BoundaryHeightJump[];
  densityMismatches: BoundaryDensityMismatch[];
  styleMismatches: BoundaryStyleMismatch[];
}

export interface BoundaryHeightJump {
  regionA: string;
  regionB: string;
  avgHeightA: number;
  avgHeightB: number;
  delta: number;
}

export interface BoundaryDensityMismatch {
  regionA: string;
  regionB: string;
  densityA: number;
  densityB: number;
  ratio: number;
}

export interface BoundaryStyleMismatch {
  regionA: string;
  regionB: string;
  typesA: string[];
  typesB: string[];
  description: string;
}

// ─── Haupt-Validierung ─────────────────────────────────────

export function validateBoundaries(
  scene: Scene,
  partition: ScenePartition,
): BoundaryValidationResult {
  const conflicts: MergeConflict[] = [];
  const heightJumps: BoundaryHeightJump[] = [];
  const densityMismatches: BoundaryDensityMismatch[] = [];
  const styleMismatches: BoundaryStyleMismatch[] = [];

  // Gruppiere Primitives nach Region-Tag
  const regionPrimitives = groupByRegion(scene.primitives);

  // Prüfe jedes Regionenpaar
  for (let i = 0; i < partition.regions.length; i++) {
    for (let j = i + 1; j < partition.regions.length; j++) {
      const rA = partition.regions[i];
      const rB = partition.regions[j];

      // Prüfe ob Regionen benachbart sind (bei lokalen Koordinaten: immer prüfen)
      const primsA = regionPrimitives.get(rA.id) ?? [];
      const primsB = regionPrimitives.get(rB.id) ?? [];

      if (primsA.length === 0 || primsB.length === 0) continue;

      // 1. Boundary-Gap-Check (bestehend)
      const gap = checkBoundaryGap(scene.primitives, rA.bounds, rB.bounds);
      if (gap) {
        conflicts.push({
          type: "boundary-gap",
          regionA: rA.id,
          regionB: rB.id,
          description: gap,
          affectedPrimitives: [],
        });
      }

      // 2. Höhen-Sprung-Check
      const heightJump = checkHeightJump(primsA, primsB, rA.id, rB.id);
      if (heightJump) heightJumps.push(heightJump);

      // 3. Dichte-Mismatch-Check
      const densityMismatch = checkDensityMismatch(primsA, primsB, rA, rB);
      if (densityMismatch) densityMismatches.push(densityMismatch);

      // 4. Stil-Konsistenz-Check
      const styleMismatch = checkStyleMismatch(primsA, primsB, rA.id, rB.id);
      if (styleMismatch) styleMismatches.push(styleMismatch);
    }
  }

  // Kollisions-Check zwischen Regionen
  const collisionConflicts = checkCrossRegionCollisions(regionPrimitives);
  conflicts.push(...collisionConflicts);

  const valid = conflicts.length === 0 &&
    heightJumps.length === 0 &&
    densityMismatches.length === 0 &&
    styleMismatches.length === 0;

  return { valid, conflicts, heightJumps, densityMismatches, styleMismatches };
}

// ─── Erweiterte Validierung mit ExtRegions ──────────────────

export function validateBoundariesExt(
  scene: Scene,
  partition: ScenePartition,
  extRegions: WorkRegionExt[],
): BoundaryValidationResult {
  const baseResult = validateBoundaries(scene, partition);

  // Zusätzliche Prüfungen mit erweiterten Region-Daten
  const regionPrimitives = groupByRegion(scene.primitives);

  for (let i = 0; i < extRegions.length; i++) {
    for (let j = i + 1; j < extRegions.length; j++) {
      const rA = extRegions[i];
      const rB = extRegions[j];

      // Dichte-Level-Differenz prüfen
      const densityDiff = Math.abs(rA.densityLevel - rB.densityLevel);
      if (densityDiff > 5) {
        baseResult.densityMismatches.push({
          regionA: rA.id,
          regionB: rB.id,
          densityA: rA.densityLevel,
          densityB: rB.densityLevel,
          ratio: Math.max(rA.densityLevel, rB.densityLevel) / Math.max(1, Math.min(rA.densityLevel, rB.densityLevel)),
        });
      }
    }
  }

  baseResult.valid = baseResult.conflicts.length === 0 &&
    baseResult.heightJumps.length === 0 &&
    baseResult.densityMismatches.length === 0 &&
    baseResult.styleMismatches.length === 0;

  return baseResult;
}

// ─── Hilfsfunktionen ────────────────────────────────────────

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

function checkHeightJump(
  primsA: Primitive[], primsB: Primitive[],
  regionA: string, regionB: string,
): BoundaryHeightJump | null {
  const avgA = primsA.reduce((s, p) => s + p.position[1], 0) / primsA.length;
  const avgB = primsB.reduce((s, p) => s + p.position[1], 0) / primsB.length;
  const delta = Math.abs(avgA - avgB);

  // Sprünge > 5 Einheiten sind verdächtig
  if (delta > 5) {
    return { regionA, regionB, avgHeightA: +avgA.toFixed(2), avgHeightB: +avgB.toFixed(2), delta: +delta.toFixed(2) };
  }
  return null;
}

function checkDensityMismatch(
  primsA: Primitive[], primsB: Primitive[],
  rA: { id: string; bounds: AABB }, rB: { id: string; bounds: AABB },
): BoundaryDensityMismatch | null {
  const volA = boundsVolume(rA.bounds);
  const volB = boundsVolume(rB.bounds);
  const densityA = primsA.length / Math.max(0.001, volA);
  const densityB = primsB.length / Math.max(0.001, volB);

  const ratio = Math.max(densityA, densityB) / Math.max(0.001, Math.min(densityA, densityB));
  // Ratio > 3x ist verdächtig
  if (ratio > 3) {
    return {
      regionA: rA.id, regionB: rB.id,
      densityA: +densityA.toFixed(3), densityB: +densityB.toFixed(3),
      ratio: +ratio.toFixed(2),
    };
  }
  return null;
}

function checkStyleMismatch(
  primsA: Primitive[], primsB: Primitive[],
  regionA: string, regionB: string,
): BoundaryStyleMismatch | null {
  const typesA = [...new Set(primsA.map((p) => p.type))].sort();
  const typesB = [...new Set(primsB.map((p) => p.type))].sort();

  // Prüfe ob die Typen-Verteilung stark abweicht
  const allTypes = new Set([...typesA, ...typesB]);
  let mismatchScore = 0;
  for (const t of allTypes) {
    const countA = primsA.filter((p) => p.type === t).length / primsA.length;
    const countB = primsB.filter((p) => p.type === t).length / primsB.length;
    mismatchScore += Math.abs(countA - countB);
  }

  if (mismatchScore > 1.5) {
    return {
      regionA, regionB, typesA, typesB,
      description: `Style mismatch: Region ${regionA} uses [${typesA}] vs Region ${regionB} uses [${typesB}]`,
    };
  }
  return null;
}

function checkCrossRegionCollisions(regionPrimitives: Map<string, Primitive[]>): MergeConflict[] {
  const conflicts: MergeConflict[] = [];
  const regions = [...regionPrimitives.entries()];

  for (let i = 0; i < regions.length; i++) {
    for (let j = i + 1; j < regions.length; j++) {
      const [idA, primsA] = regions[i];
      const [idB, primsB] = regions[j];

      for (const a of primsA) {
        for (const b of primsB) {
          const boxA = getBBox(a);
          const boxB = getBBox(b);
          let overlaps = true;
          for (let k = 0; k < 3; k++) {
            if (boxA.max[k] <= boxB.min[k] + 0.05 || boxB.max[k] <= boxA.min[k] + 0.05) {
              overlaps = false;
              break;
            }
          }
          if (overlaps) {
            conflicts.push({
              type: "overlap",
              regionA: idA,
              regionB: idB,
              description: `Cross-region collision: "${a.id}" (${idA}) ↔ "${b.id}" (${idB})`,
              affectedPrimitives: [a.id, b.id],
            });
          }
        }
      }
    }
  }
  return conflicts;
}

function regionsAdjacent(a: AABB, b: AABB): boolean {
  for (let i = 0; i < 3; i++) {
    if (Math.abs(a.max[i] - b.min[i]) < 0.01 || Math.abs(a.min[i] - b.max[i]) < 0.01) {
      return true;
    }
  }
  return false;
}

// Einfache Prüfung: gibt es Primitives nahe der Grenze auf beiden Seiten?
function checkBoundaryGap(
  primitives: Primitive[],
  boundsA: AABB,
  boundsB: AABB,
): string | null {
  const NEAR_BOUNDARY = 2.0;

  // Finde die geteilte Achse und Position
  for (let i = 0; i < 3; i++) {
    const axis = ["x", "y", "z"][i];
    let boundaryPos: number | null = null;

    if (Math.abs(boundsA.max[i] - boundsB.min[i]) < 0.01) {
      boundaryPos = boundsA.max[i];
    } else if (Math.abs(boundsA.min[i] - boundsB.max[i]) < 0.01) {
      boundaryPos = boundsA.min[i];
    }

    if (boundaryPos === null) continue;

    // Gibt es Primitives nahe der Grenze auf Seite A?
    const nearA = primitives.some((p) =>
      Math.abs(p.position[i] - boundaryPos!) < NEAR_BOUNDARY &&
      p.position[i] < boundaryPos!
    );
    // Und auf Seite B?
    const nearB = primitives.some((p) =>
      Math.abs(p.position[i] - boundaryPos!) < NEAR_BOUNDARY &&
      p.position[i] > boundaryPos!
    );

    // Wenn eine Seite baut aber die andere nicht, ist das verdächtig
    if (nearA && !nearB) {
      return `Region boundary at ${axis}=${boundaryPos}: primitives on A-side but gap on B-side`;
    }
    if (!nearA && nearB) {
      return `Region boundary at ${axis}=${boundaryPos}: primitives on B-side but gap on A-side`;
    }
  }

  return null;
}

function boundsVolume(b: AABB): number {
  return (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);
}
