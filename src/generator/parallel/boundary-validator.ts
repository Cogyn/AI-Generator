// BoundaryValidator: Prüft Übergänge zwischen Regionen nach dem Merge
// Erkennt Lücken, Stilbrüche und strukturelle Probleme an Grenzen

import type {
  Scene,
  MergeConflict,
  ScenePartition,
  Primitive,
  AABB,
} from "../../core/types.js";
import { getPrimitiveExtents } from "../../core/types.js";

export interface BoundaryValidationResult {
  valid: boolean;
  conflicts: MergeConflict[];
}

export function validateBoundaries(
  scene: Scene,
  partition: ScenePartition,
): BoundaryValidationResult {
  const conflicts: MergeConflict[] = [];

  // Prüfe jedes Regionenpaar auf Boundary-Probleme
  for (let i = 0; i < partition.regions.length; i++) {
    for (let j = i + 1; j < partition.regions.length; j++) {
      const rA = partition.regions[i];
      const rB = partition.regions[j];

      if (!regionsAdjacent(rA.bounds, rB.bounds)) continue;

      // Prüfe ob es eine sichtbare Lücke an der Grenze gibt
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
    }
  }

  return {
    valid: conflicts.length === 0,
    conflicts,
  };
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
