import type { Constraint, Scene, Primitive, Vec3 } from "./types.js";

// Toleranz: Cubes dürfen sich an Kanten/Flächen berühren oder minimal eindringen.
const OVERLAP_TOLERANCE = 0.1;

export interface BBox {
  min: Vec3;
  max: Vec3;
}

export function getBBox(p: { position: Vec3; size: Vec3 }): BBox {
  return {
    min: [
      p.position[0] - p.size[0] / 2,
      p.position[1] - p.size[1] / 2,
      p.position[2] - p.size[2] / 2,
    ],
    max: [
      p.position[0] + p.size[0] / 2,
      p.position[1] + p.size[1] / 2,
      p.position[2] + p.size[2] / 2,
    ],
  };
}

// Berechnet wie tief zwei Boxes auf jeder Achse eindringen (negativ = kein Overlap)
function overlapDepth(a: BBox, b: BBox): Vec3 {
  return [
    Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]),
    Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]),
    Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]),
  ];
}

export interface OverlapInfo {
  existingId: string;
  existingBBox: BBox;
  newBBox: BBox;
  depth: Vec3; // Eindringtiefe pro Achse
}

// Prüft Overlap und gibt Details zurück
export function findOverlaps(scene: Scene, newPrimitive: Primitive): OverlapInfo[] {
  const newBox = getBBox(newPrimitive);
  const overlaps: OverlapInfo[] = [];

  for (const existing of scene.primitives) {
    const exBox = getBBox(existing);
    const depth = overlapDepth(exBox, newBox);

    // Overlap nur wenn auf ALLEN Achsen > Toleranz
    if (depth[0] > OVERLAP_TOLERANCE && depth[1] > OVERLAP_TOLERANCE && depth[2] > OVERLAP_TOLERANCE) {
      overlaps.push({
        existingId: existing.id,
        existingBBox: exBox,
        newBBox: newBox,
        depth,
      });
    }
  }

  return overlaps;
}

export const noOverlap: Constraint = {
  name: "no-overlap",
  check(scene: Scene, newPrimitive: Primitive) {
    const overlaps = findOverlaps(scene, newPrimitive);
    if (overlaps.length > 0) {
      const details = overlaps.map((o) => {
        const axis = ["x", "y", "z"];
        const depthStr = o.depth.map((d, i) => `${axis[i]}:${d.toFixed(2)}`).join(", ");
        return `"${o.existingId}" (overlap ${depthStr})`;
      }).join("; ");
      return { valid: false, message: details };
    }
    return { valid: true };
  },
};

export const withinBounds: Constraint = {
  name: "within-bounds",
  check(_scene: Scene, p: Primitive) {
    const limit = 100;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(p.position[i]) + p.size[i] / 2 > limit) {
        return { valid: false, message: `"${p.id}" exceeds scene bounds (±${limit})` };
      }
    }
    return { valid: true };
  },
};

export function validateAll(
  constraints: Constraint[],
  scene: Scene,
  primitive: Primitive,
): { valid: boolean; messages: string[] } {
  const messages: string[] = [];
  let valid = true;
  for (const c of constraints) {
    const result = c.check(scene, primitive);
    if (!result.valid) {
      valid = false;
      if (result.message) messages.push(`[${c.name}] ${result.message}`);
    }
  }
  return { valid, messages };
}

export const defaultConstraints: Constraint[] = [noOverlap, withinBounds];
