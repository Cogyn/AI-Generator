// Merger: Führt regionale BuilderResults in den globalen Scene State zusammen
// Prüft auf Konflikte zwischen Regionen

import type {
  Scene,
  BuilderResult,
  MergeResult,
  MergeConflict,
  Primitive,
  Vec3,
} from "../../core/types.js";
import { addPrimitive } from "../../core/scene.js";
import { getBBox, type BBox } from "../../core/constraints.js";
import { getPrimitiveExtents } from "../../core/types.js";

const OVERLAP_TOLERANCE = 0.1;

export function mergeResults(scene: Scene, results: BuilderResult[]): MergeResult {
  let merged = scene;
  const allNew: Array<Primitive & { regionId: string }> = [];
  const conflicts: MergeConflict[] = [];

  // Sammle alle neuen Primitives
  for (const result of results) {
    for (const p of result.addedPrimitives) {
      allNew.push({ ...p, regionId: result.regionId });
    }
  }

  // Prüfe Konflikte zwischen neuen Primitives verschiedener Regionen
  for (let i = 0; i < allNew.length; i++) {
    for (let j = i + 1; j < allNew.length; j++) {
      const a = allNew[i];
      const b = allNew[j];
      if (a.regionId === b.regionId) continue; // gleiche Region ist OK (Builder intern)

      if (primitivesOverlap(a, b)) {
        conflicts.push({
          type: "overlap",
          regionA: a.regionId,
          regionB: b.regionId,
          description: `"${a.id}" and "${b.id}" overlap across region boundary`,
          affectedPrimitives: [a.id, b.id],
        });
      }
    }
  }

  // Prüfe auch gegen bestehende Scene-Primitives
  for (const p of allNew) {
    for (const existing of scene.primitives) {
      if (primitivesOverlap(p, existing)) {
        conflicts.push({
          type: "overlap",
          regionA: p.regionId,
          regionB: "existing",
          description: `New "${p.id}" overlaps existing "${existing.id}"`,
          affectedPrimitives: [p.id, existing.id],
        });
      }
    }
  }

  // Merge: füge alle konfliktfreien Primitives hinzu
  const conflictedIds = new Set(conflicts.flatMap((c) => c.affectedPrimitives));

  for (const p of allNew) {
    if (!conflictedIds.has(p.id)) {
      const { regionId, ...primitive } = p;
      merged = addPrimitive(merged, primitive);
    }
  }

  return {
    scene: merged,
    conflicts,
    resolved: conflicts.length === 0,
  };
}

function primitivesOverlap(a: Primitive, b: Primitive): boolean {
  const boxA = getPrimitiveBBox(a);
  const boxB = getPrimitiveBBox(b);

  for (let i = 0; i < 3; i++) {
    if (boxA.max[i] <= boxB.min[i] + OVERLAP_TOLERANCE ||
        boxB.max[i] <= boxA.min[i] + OVERLAP_TOLERANCE) {
      return false;
    }
  }
  return true;
}

function getPrimitiveBBox(p: Primitive): BBox {
  const ext = getPrimitiveExtents(p);
  return {
    min: [
      p.position[0] - ext[0] / 2,
      p.position[1] - ext[1] / 2,
      p.position[2] - ext[2] / 2,
    ],
    max: [
      p.position[0] + ext[0] / 2,
      p.position[1] + ext[1] / 2,
      p.position[2] + ext[2] / 2,
    ],
  };
}
