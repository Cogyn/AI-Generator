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
import { getBBox } from "../../core/constraints.js";

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

  // Merge: füge alle konfliktfreien Primitives hinzu, sammle verworfene
  const conflictedIds = new Set(conflicts.flatMap((c) => c.affectedPrimitives));
  const droppedPrimitives: Primitive[] = [];

  for (const p of allNew) {
    const { regionId, ...primitive } = p;
    if (!conflictedIds.has(p.id)) {
      merged = addPrimitive(merged, primitive);
    } else {
      droppedPrimitives.push(primitive);
    }
  }

  return {
    scene: merged,
    conflicts,
    droppedPrimitives,
    resolved: conflicts.length === 0,
  };
}

function primitivesOverlap(a: Primitive, b: Primitive): boolean {
  const boxA = getBBox(a);
  const boxB = getBBox(b);

  for (let i = 0; i < 3; i++) {
    if (boxA.max[i] <= boxB.min[i] + OVERLAP_TOLERANCE ||
        boxB.max[i] <= boxA.min[i] + OVERLAP_TOLERANCE) {
      return false;
    }
  }
  return true;
}
