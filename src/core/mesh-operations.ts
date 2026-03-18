// Mesh-Operations-Resolver: Konvertiert deklarative Operationen in Primitives
// Die KI generiert nur Operationen – dieser Code erzeugt die echten Meshes

import type {
  Primitive,
  CubePrimitive,
  SpherePrimitive,
  CylinderPrimitive,
  MeshOperation,
  AddPrimitiveOp,
  AddTerrainRegionOp,
  AddHillOp,
  AddMeshRuleOp,
  AddCurveOp,
  AddGridOp,
  MirrorOp,
  Vec3,
} from "./types.js";

// ─── Hauptfunktion: Operation → Primitives ──────────────────

export function resolveMeshOp(op: MeshOperation, existing: Primitive[]): Primitive[] {
  switch (op.op) {
    case "add_primitive":
      return [resolvePrimitive(op)];
    case "add_terrain_region":
      return resolveTerrain(op);
    case "add_hill":
      return resolveHill(op);
    case "add_mesh_rule":
      return applyMeshRule(op, existing);
    case "add_curve":
      return resolveCurve(op);
    case "add_grid":
      return resolveGrid(op);
    case "mirror":
      return resolveMirror(op, existing);
    default:
      return [];
  }
}

// Alle Operationen in einer Liste auflösen (akkumulierend)
export function resolveAllOps(ops: MeshOperation[]): Primitive[] {
  const result: Primitive[] = [];
  for (const op of ops) {
    const resolved = resolveMeshOp(op, result);
    result.push(...resolved);
  }
  return result;
}

// ─── add_primitive ──────────────────────────────────────────

function resolvePrimitive(op: AddPrimitiveOp): Primitive {
  const base = {
    id: op.id ?? uid(),
    position: op.position,
    rotation: op.rotation ?? [0, 0, 0] as Vec3,
    color: op.color ?? "#888888",
    tags: op.tags ?? [],
  };

  switch (op.type) {
    case "sphere":
      return { ...base, type: "sphere", radius: op.radius ?? 1 } as SpherePrimitive;
    case "cylinder":
      return {
        ...base,
        type: "cylinder",
        radiusTop: op.radiusTop ?? op.radius ?? 0.5,
        radiusBottom: op.radiusBottom ?? op.radius ?? 0.5,
        height: op.height ?? 1,
      } as CylinderPrimitive;
    default:
      return { ...base, type: "cube", size: op.size ?? [1, 1, 1] } as CubePrimitive;
  }
}

// ─── add_terrain_region ─────────────────────────────────────

function resolveTerrain(op: AddTerrainRegionOp): Primitive[] {
  const [min, max] = op.bounds;
  const density = Math.max(1, Math.min(50, op.density));
  const smoothness = Math.max(0, Math.min(1, op.smoothness));
  const seed = op.seed ?? 42;
  const prng = seededRandom(seed);

  const stepX = (max[0] - min[0]) / density;
  const stepZ = (max[2] - min[2]) / density;
  const primitives: Primitive[] = [];

  for (let ix = 0; ix < density; ix++) {
    for (let iz = 0; iz < density; iz++) {
      const x = min[0] + stepX * (ix + 0.5);
      const z = min[2] + stepZ * (iz + 0.5);

      // Höhe via Simplex-artiger Noise-Approximation
      const nx = ix / density;
      const nz = iz / density;
      let h: number;

      switch (op.type) {
        case "flat":
          h = 0.2;
          break;
        case "smooth":
          h = pseudoNoise2D(nx, nz, seed) * 2 * (1 - smoothness) + 0.5;
          break;
        case "rocky":
          h = pseudoNoise2D(nx * 3, nz * 3, seed) * 4 + prng() * 0.5;
          break;
        case "hilly":
          h = pseudoNoise2D(nx * 1.5, nz * 1.5, seed) * 3 + 1;
          break;
        default:
          h = 0.5;
      }

      h = Math.max(0.1, h);

      primitives.push({
        id: op.id ? `${op.id}-${ix}-${iz}` : uid(),
        type: "cube",
        position: [x, min[1] + h / 2, z],
        size: [stepX * 0.95, h, stepZ * 0.95],
        rotation: [0, 0, 0],
        color: op.color ?? heightToColor(h),
        tags: [...(op.tags ?? []), "terrain"],
      } as CubePrimitive);
    }
  }
  return primitives;
}

// ─── add_hill ───────────────────────────────────────────────

function resolveHill(op: AddHillOp): Primitive[] {
  const rings = Math.max(2, Math.ceil(op.radius / 0.8));
  const smoothness = Math.max(0, Math.min(1, op.smoothness));
  const primitives: Primitive[] = [];

  for (let r = 0; r < rings; r++) {
    const ringRadius = (op.radius * (r + 1)) / rings;
    const ringHeight = op.height * Math.pow(1 - r / rings, 1 + smoothness * 2);
    const circumference = 2 * Math.PI * ringRadius;
    const segments = Math.max(4, Math.ceil(circumference / 1.2));

    if (r === 0) {
      // Spitze
      primitives.push({
        id: op.id ? `${op.id}-top` : uid(),
        type: "sphere",
        position: [op.center[0], op.center[1] + op.height * 0.5, op.center[2]],
        radius: op.radius / rings * 0.8,
        rotation: [0, 0, 0],
        color: op.color ?? "#6B8E23",
        tags: [...(op.tags ?? []), "hill", "peak"],
      } as SpherePrimitive);
      continue;
    }

    for (let s = 0; s < segments; s++) {
      const angle = (2 * Math.PI * s) / segments;
      const x = op.center[0] + Math.cos(angle) * ringRadius * 0.8;
      const z = op.center[2] + Math.sin(angle) * ringRadius * 0.8;
      const blockSize = ringRadius / rings * 1.5;

      primitives.push({
        id: op.id ? `${op.id}-r${r}-s${s}` : uid(),
        type: "cube",
        position: [x, op.center[1] + ringHeight / 2, z],
        size: [blockSize, ringHeight, blockSize],
        rotation: [0, (angle * 180) / Math.PI, 0],
        color: op.color ?? heightToColor(ringHeight),
        tags: [...(op.tags ?? []), "hill"],
      } as CubePrimitive);
    }
  }
  return primitives;
}

// ─── add_mesh_rule ──────────────────────────────────────────

function applyMeshRule(op: AddMeshRuleOp, existing: Primitive[]): Primitive[] {
  const strength = Math.max(0, Math.min(1, op.strength));
  const seed = op.seed ?? 123;
  const scale = op.scale ?? 1;
  const prng = seededRandom(seed);

  // Filter nach target region falls angegeben
  let targets = [...existing];
  if (op.targetRegion) {
    targets = targets.filter((p) => p.tags.includes(`part:${op.targetRegion}`));
  }

  // Erzeuge modifizierte Kopien (keine Mutation)
  const modified: Primitive[] = [];
  for (let iter = 0; iter < op.iterations; iter++) {
    for (const p of targets) {
      const displacement: Vec3 = [
        (prng() - 0.5) * strength * scale,
        (prng() - 0.5) * strength * scale * 0.5,
        (prng() - 0.5) * strength * scale,
      ];

      switch (op.pattern) {
        case "noise":
          modified.push(displacePosition(p, displacement));
          break;
        case "wave":
          modified.push(displacePosition(p, [
            Math.sin(p.position[0] * scale) * strength,
            Math.sin(p.position[2] * scale) * strength * 0.5,
            0,
          ]));
          break;
        case "ripple":
          const dist = Math.sqrt(p.position[0] ** 2 + p.position[2] ** 2);
          modified.push(displacePosition(p, [0, Math.sin(dist * scale) * strength, 0]));
          break;
        case "erosion":
          // Erosion senkt höhere Punkte leicht ab
          if (p.position[1] > 1) {
            modified.push(displacePosition(p, [0, -strength * 0.3, 0]));
          }
          break;
      }
    }
  }

  // Mesh-Regeln geben keine neuen Primitives zurück – sie modifizieren bestehende.
  // Da wir immutabel arbeiten: Rückgabe der modifizierten Versionen (ersetzen Originale extern)
  return modified;
}

// ─── add_curve ──────────────────────────────────────────────

function resolveCurve(op: AddCurveOp): Primitive[] {
  if (op.points.length < 2) return [];
  const segments = op.segments ?? Math.max(4, op.points.length * 3);
  const primitives: Primitive[] = [];

  for (let i = 0; i < segments; i++) {
    const t = i / (segments - 1);
    const pos = catmullRomPoint(op.points, t);
    const nextT = Math.min(1, (i + 1) / (segments - 1));
    const nextPos = catmullRomPoint(op.points, nextT);

    // Richtung für Rotation
    const dir: Vec3 = [nextPos[0] - pos[0], nextPos[1] - pos[1], nextPos[2] - pos[2]];
    const len = Math.sqrt(dir[0] ** 2 + dir[1] ** 2 + dir[2] ** 2);
    const segLen = Math.max(0.1, len);

    // Rotation berechnen (Zylinderachse = Y, Zielrichtung = dir)
    const rotX = Math.atan2(dir[2], Math.sqrt(dir[0] ** 2 + dir[1] ** 2)) * 180 / Math.PI;
    const rotZ = -Math.atan2(dir[0], dir[1]) * 180 / Math.PI;

    primitives.push({
      id: op.id ? `${op.id}-seg${i}` : uid(),
      type: "cylinder",
      position: [(pos[0] + nextPos[0]) / 2, (pos[1] + nextPos[1]) / 2, (pos[2] + nextPos[2]) / 2],
      radiusTop: op.radius,
      radiusBottom: op.radius,
      height: segLen,
      rotation: [rotX, 0, rotZ],
      color: op.color ?? "#888888",
      tags: [...(op.tags ?? []), "curve"],
    } as CylinderPrimitive);
  }
  return primitives;
}

// ─── add_grid ───────────────────────────────────────────────

function resolveGrid(op: AddGridOp): Primitive[] {
  const [min, max] = op.bounds;
  const primitives: Primitive[] = [];
  const prng = op.seed != null ? seededRandom(op.seed) : Math.random;
  const jitter = op.jitter ?? 0;
  let idx = 0;

  for (let x = min[0]; x <= max[0]; x += op.spacing[0]) {
    for (let y = min[1]; y <= max[1]; y += op.spacing[1]) {
      for (let z = min[2]; z <= max[2]; z += op.spacing[2]) {
        const jx = x + (prng() - 0.5) * jitter * op.spacing[0];
        const jy = y + (prng() - 0.5) * jitter * op.spacing[1];
        const jz = z + (prng() - 0.5) * jitter * op.spacing[2];

        const base = {
          id: op.id ? `${op.id}-g${idx}` : uid(),
          position: [jx, jy, jz] as Vec3,
          rotation: [0, 0, 0] as Vec3,
          color: op.color ?? "#888888",
          tags: [...(op.tags ?? []), "grid"],
        };

        switch (op.type) {
          case "sphere":
            primitives.push({ ...base, type: "sphere", radius: op.radius ?? 0.5 } as SpherePrimitive);
            break;
          case "cylinder":
            primitives.push({
              ...base, type: "cylinder",
              radiusTop: op.radius ?? 0.5, radiusBottom: op.radius ?? 0.5, height: op.size?.[1] ?? 1,
            } as CylinderPrimitive);
            break;
          default:
            primitives.push({ ...base, type: "cube", size: op.size ?? [1, 1, 1] } as CubePrimitive);
        }
        idx++;
      }
    }
  }
  return primitives;
}

// ─── mirror ─────────────────────────────────────────────────

function resolveMirror(op: MirrorOp, existing: Primitive[]): Primitive[] {
  const source = existing.find((p) => p.id === op.sourceId);
  if (!source) return [];

  const axis = op.axis === "x" ? 0 : op.axis === "y" ? 1 : 2;
  const pos: Vec3 = [...source.position];
  pos[axis] = -pos[axis];

  const rot: Vec3 = [...source.rotation];
  if (op.axis === "x") { rot[1] = -rot[1]; rot[2] = -rot[2]; }
  if (op.axis === "y") { rot[0] = -rot[0]; rot[2] = -rot[2]; }
  if (op.axis === "z") { rot[0] = -rot[0]; rot[1] = -rot[1]; }

  return [{ ...source, id: op.id ?? uid(), position: pos, rotation: rot }];
}

// ─── Hilfsfunktionen ────────────────────────────────────────

function uid(): string {
  return `op-${Math.random().toString(36).slice(2, 8)}`;
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function pseudoNoise2D(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed) * 43758.5453;
  return n - Math.floor(n);
}

function heightToColor(h: number): string {
  // Grün für niedrig, braun für hoch
  const t = Math.min(1, h / 4);
  const r = Math.round(60 + t * 100);
  const g = Math.round(140 - t * 50);
  const b = Math.round(30 + t * 10);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function displacePosition(p: Primitive, offset: Vec3): Primitive {
  const newPos: Vec3 = [
    p.position[0] + offset[0],
    p.position[1] + offset[1],
    p.position[2] + offset[2],
  ];
  return { ...p, position: newPos, id: `${p.id}-mod` };
}

function catmullRomPoint(points: Vec3[], t: number): Vec3 {
  const n = points.length;
  if (n < 2) return points[0] ?? [0, 0, 0];

  const f = t * (n - 1);
  const i = Math.floor(f);
  const frac = f - i;

  const p0 = points[Math.max(0, i - 1)];
  const p1 = points[Math.min(n - 1, i)];
  const p2 = points[Math.min(n - 1, i + 1)];
  const p3 = points[Math.min(n - 1, i + 2)];

  return [
    catmullRom1D(p0[0], p1[0], p2[0], p3[0], frac),
    catmullRom1D(p0[1], p1[1], p2[1], p3[1], frac),
    catmullRom1D(p0[2], p1[2], p2[2], p3[2], frac),
  ];
}

function catmullRom1D(p0: number, p1: number, p2: number, p3: number, t: number): number {
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t
  );
}
