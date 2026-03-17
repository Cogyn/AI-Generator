import type { Constraint, Scene, Primitive, Vec3 } from "./types.js";

// Toleranz: Cubes dürfen sich an Kanten/Flächen berühren oder minimal eindringen.
// Ohne das werden aneinander anschließende Bauteile fälschlich als Überschneidung erkannt.
const OVERLAP_TOLERANCE = 0.1;

function boxesOverlap(posA: Vec3, sizeA: Vec3, posB: Vec3, sizeB: Vec3): boolean {
  for (let i = 0; i < 3; i++) {
    const minA = posA[i] - sizeA[i] / 2;
    const maxA = posA[i] + sizeA[i] / 2;
    const minB = posB[i] - sizeB[i] / 2;
    const maxB = posB[i] + sizeB[i] / 2;
    // Kein Overlap wenn Abstand >= Toleranz auf irgendeiner Achse
    if (maxA <= minB + OVERLAP_TOLERANCE || maxB <= minA + OVERLAP_TOLERANCE) return false;
  }
  return true;
}

export const noOverlap: Constraint = {
  name: "no-overlap",
  check(scene: Scene, newPrimitive: Primitive) {
    for (const existing of scene.primitives) {
      if (boxesOverlap(existing.position, existing.size, newPrimitive.position, newPrimitive.size)) {
        return { valid: false, message: `Überschneidung mit "${existing.id}"` };
      }
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
        return { valid: false, message: `"${p.id}" überschreitet Szenen-Grenzen (±${limit})` };
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
