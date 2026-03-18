// Merger: Führt regionale BuilderResults in den globalen Scene State zusammen
// Erweitert: Verwaltet globale Objekt-/Region-IDs, Bounds und Dichte-Level

import type {
  Scene,
  BuilderResult,
  BuilderResultExt,
  MergeResult,
  MergeConflict,
  Primitive,
  Vec3,
  AABB,
  MeshOperation,
} from "../../core/types.js";
import { addPrimitive } from "../../core/scene.js";
import { getBBox } from "../../core/constraints.js";

const OVERLAP_TOLERANCE = 0.1;

// ─── Standard Merge (bestehend) ─────────────────────────────

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

// ─── Erweiterter Merge mit Mesh-Ops-Tracking ────────────────

export interface MergeResultExt extends MergeResult {
  globalBounds: AABB;
  globalDensity: number;
  regionStats: RegionMergeStat[];
  allMeshOps: MeshOperation[];
}

export interface RegionMergeStat {
  regionId: string;
  primitivesAdded: number;
  primitivesDropped: number;
  meshOpsCount: number;
  localBounds: AABB;
}

export function mergeResultsExt(
  scene: Scene,
  results: BuilderResultExt[],
): MergeResultExt {
  // Standard-Merge
  const baseResult = mergeResults(scene, results);
  const droppedIds = new Set(baseResult.droppedPrimitives.map((p) => p.id));

  // Globale Bounds berechnen
  const allPrims = baseResult.scene.primitives;
  const globalBounds = computeGlobalBounds(allPrims);

  // Globale Dichte
  const vol = boundsVolume(globalBounds);
  const globalDensity = vol > 0 ? allPrims.length / vol : 0;

  // Region-Statistiken
  const regionStats: RegionMergeStat[] = results.map((r) => {
    const added = r.addedPrimitives.filter((p) => !droppedIds.has(p.id));
    const dropped = r.addedPrimitives.filter((p) => droppedIds.has(p.id));
    return {
      regionId: r.regionId,
      primitivesAdded: added.length,
      primitivesDropped: dropped.length,
      meshOpsCount: r.meshOps.length,
      localBounds: computeGlobalBounds(r.addedPrimitives),
    };
  });

  // Alle Mesh-Ops sammeln
  const allMeshOps = results.flatMap((r) => r.meshOps);

  return {
    ...baseResult,
    globalBounds,
    globalDensity: +globalDensity.toFixed(4),
    regionStats,
    allMeshOps,
  };
}

// ─── Hilfsfunktionen ────────────────────────────────────────

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

function computeGlobalBounds(primitives: Primitive[]): AABB {
  if (primitives.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of primitives) {
    const box = getBBox(p);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], box.min[i]);
      max[i] = Math.max(max[i], box.max[i]);
    }
  }
  return { min, max };
}

function boundsVolume(b: AABB): number {
  return Math.max(0.001,
    (b.max[0] - b.min[0]) *
    (b.max[1] - b.min[1]) *
    (b.max[2] - b.min[2]),
  );
}
