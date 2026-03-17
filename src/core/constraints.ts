import type { Constraint, Scene, Primitive, Vec3 } from "./types.js";
import { getPrimitiveExtents } from "./types.js";

const OVERLAP_TOLERANCE = 0.1;
const CONNECTIVITY_THRESHOLD = 0.5; // max gap to count as "touching"

export interface BBox {
  min: Vec3;
  max: Vec3;
}

// Euler XYZ rotation matrix from degrees
function eulerToMatrix(rot: Vec3): number[][] {
  const [rx, ry, rz] = rot.map((d) => (d * Math.PI) / 180);
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  // Three.js Euler order XYZ: M = Rx * Ry * Rz
  return [
    [cy * cz,                -cy * sz,                 sy      ],
    [sx * sy * cz + cx * sz,  -sx * sy * sz + cx * cz, -sx * cy],
    [-cx * sy * cz + sx * sz, cx * sy * sz + sx * cz,   cx * cy],
  ];
}

// AABB half-extents after rotation
function rotatedHalfExtents(halfExt: Vec3, rot: Vec3): Vec3 {
  if (rot[0] === 0 && rot[1] === 0 && rot[2] === 0) return halfExt;
  const m = eulerToMatrix(rot);
  return [
    Math.abs(m[0][0]) * halfExt[0] + Math.abs(m[0][1]) * halfExt[1] + Math.abs(m[0][2]) * halfExt[2],
    Math.abs(m[1][0]) * halfExt[0] + Math.abs(m[1][1]) * halfExt[1] + Math.abs(m[1][2]) * halfExt[2],
    Math.abs(m[2][0]) * halfExt[0] + Math.abs(m[2][1]) * halfExt[1] + Math.abs(m[2][2]) * halfExt[2],
  ];
}

// Generisch für alle Primitive-Typen (AABB-basiert, rotationsaware)
export function getBBox(p: { position: Vec3; rotation?: Vec3 } & ({ size: Vec3 } | Primitive)): BBox {
  const ext = "type" in p
    ? getPrimitiveExtents(p as Primitive)
    : (p as { size: Vec3 }).size;

  const halfExt: Vec3 = [ext[0] / 2, ext[1] / 2, ext[2] / 2];
  const rot: Vec3 = p.rotation ?? [0, 0, 0];
  const rhe = rotatedHalfExtents(halfExt, rot);

  return {
    min: [
      p.position[0] - rhe[0],
      p.position[1] - rhe[1],
      p.position[2] - rhe[2],
    ],
    max: [
      p.position[0] + rhe[0],
      p.position[1] + rhe[1],
      p.position[2] + rhe[2],
    ],
  };
}

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
  depth: Vec3;
}

export function findOverlaps(scene: Scene, newPrimitive: Primitive): OverlapInfo[] {
  const newBox = getBBox(newPrimitive);
  const overlaps: OverlapInfo[] = [];

  for (const existing of scene.primitives) {
    const exBox = getBBox(existing);
    const depth = overlapDepth(exBox, newBox);

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
    const ext = getPrimitiveExtents(p);
    for (let i = 0; i < 3; i++) {
      if (Math.abs(p.position[i]) + ext[i] / 2 > limit) {
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

// Connectivity: jedes neue Primitive muss ein bestehendes berühren oder fast berühren
// Verhindert freischwebende Teile
export const connectivity: Constraint = {
  name: "connectivity",
  check(scene: Scene, newPrimitive: Primitive) {
    // Erstes Primitive ist immer OK
    if (scene.primitives.length === 0) return { valid: true };

    const newBox = getBBox(newPrimitive);
    let minDist = Infinity;

    for (const existing of scene.primitives) {
      const exBox = getBBox(existing);
      // Berechne minimalen Abstand zwischen zwei AABBs
      let distSq = 0;
      for (let i = 0; i < 3; i++) {
        const gap = Math.max(0, newBox.min[i] - exBox.max[i], exBox.min[i] - newBox.max[i]);
        distSq += gap * gap;
      }
      minDist = Math.min(minDist, Math.sqrt(distSq));
    }

    if (minDist > CONNECTIVITY_THRESHOLD) {
      return {
        valid: false,
        message: `"${newPrimitive.id}" schwebt frei (Abstand ${minDist.toFixed(2)} zum nächsten Primitive). Verschiebe es näher an ein bestehendes Teil.`,
      };
    }
    return { valid: true };
  },
};

export const defaultConstraints: Constraint[] = [noOverlap, withinBounds, connectivity];
