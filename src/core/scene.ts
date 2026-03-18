import type {
  Scene, Primitive, PrimitiveChanges, Vec3,
  SceneExt, WorkRegionExt, MeshOperation, TokenMetrics, SceneStatistics, AABB,
} from "./types.js";
import { getPrimitiveExtents } from "./types.js";
import { getBBox } from "./constraints.js";

const STORAGE_KEY = "ai-gen-scene";
const MAX_UNDO = 30;

// ─── Undo History ──────────────────────────────────────────

const undoStack: Scene[] = [];

function pushUndo(scene: Scene): void {
  undoStack.push(scene);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

export function undo(): Scene | null {
  return undoStack.pop() ?? null;
}

export function canUndo(): boolean {
  return undoStack.length > 0;
}

export function clearUndo(): void {
  undoStack.length = 0;
}

// ─── Scene CRUD ────────────────────────────────────────────

export function createScene(name: string): Scene {
  return {
    id: crypto.randomUUID(),
    name,
    primitives: [],
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stepCount: 0,
    },
  };
}

export function addPrimitive(scene: Scene, primitive: Primitive): Scene {
  pushUndo(scene);
  return {
    ...scene,
    primitives: [...scene.primitives, primitive],
    metadata: {
      ...scene.metadata,
      updatedAt: new Date().toISOString(),
      stepCount: scene.metadata.stepCount + 1,
    },
  };
}

export function removePrimitive(scene: Scene, id: string): Scene {
  if (!scene.primitives.some((p) => p.id === id)) return scene;
  pushUndo(scene);
  return {
    ...scene,
    primitives: scene.primitives.filter((p) => p.id !== id),
    metadata: {
      ...scene.metadata,
      updatedAt: new Date().toISOString(),
      stepCount: scene.metadata.stepCount + 1,
    },
  };
}

export function modifyPrimitive(scene: Scene, id: string, changes: Partial<PrimitiveChanges>): Scene {
  const idx = scene.primitives.findIndex((p) => p.id === id);
  if (idx === -1) return scene;
  pushUndo(scene);

  const old = scene.primitives[idx];
  const updated = { ...old } as any;

  if (changes.position) updated.position = changes.position;
  if (changes.rotation) updated.rotation = changes.rotation;
  if (changes.color) updated.color = changes.color;

  // Type-specific size changes
  if (old.type === "cube" && changes.size) updated.size = changes.size;
  if (old.type === "sphere" && changes.radius != null) updated.radius = changes.radius;
  if (old.type === "cylinder") {
    if (changes.radiusTop != null) updated.radiusTop = changes.radiusTop;
    if (changes.radiusBottom != null) updated.radiusBottom = changes.radiusBottom;
    if (changes.height != null) updated.height = changes.height;
  }

  const newPrimitives = [...scene.primitives];
  newPrimitives[idx] = updated as Primitive;

  return {
    ...scene,
    primitives: newPrimitives,
    metadata: {
      ...scene.metadata,
      updatedAt: new Date().toISOString(),
      stepCount: scene.metadata.stepCount + 1,
    },
  };
}

export function clonePrimitive(scene: Scene, id: string, newId: string, mirror?: "x" | "y" | "z"): Scene {
  const original = scene.primitives.find((p) => p.id === id);
  if (!original) return scene;
  pushUndo(scene);

  const cloned = { ...original, id: newId } as any;

  // Mirror: spiegele Position und Rotation
  if (mirror) {
    const axis = mirror === "x" ? 0 : mirror === "y" ? 1 : 2;
    const pos: Vec3 = [...original.position];
    pos[axis] = -pos[axis];
    cloned.position = pos;

    // Rotation auch spiegeln (negieren der anderen Achsen)
    const rot: Vec3 = [...original.rotation];
    if (mirror === "x") { rot[1] = -rot[1]; rot[2] = -rot[2]; }
    if (mirror === "y") { rot[0] = -rot[0]; rot[2] = -rot[2]; }
    if (mirror === "z") { rot[0] = -rot[0]; rot[1] = -rot[1]; }
    cloned.rotation = rot;
  }

  return {
    ...scene,
    primitives: [...scene.primitives, cloned as Primitive],
    metadata: {
      ...scene.metadata,
      updatedAt: new Date().toISOString(),
      stepCount: scene.metadata.stepCount + 1,
    },
  };
}

// Batch-Add ohne Undo für jeden einzelnen (Combiner nutzt das)
export function addPrimitives(scene: Scene, primitives: Primitive[]): Scene {
  if (primitives.length === 0) return scene;
  pushUndo(scene);
  return {
    ...scene,
    primitives: [...scene.primitives, ...primitives],
    metadata: {
      ...scene.metadata,
      updatedAt: new Date().toISOString(),
      stepCount: scene.metadata.stepCount + primitives.length,
    },
  };
}

// ─── Persistence ───────────────────────────────────────────

export function saveScene(scene: Scene): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scene));
}

export function loadScene(): Scene | null {
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return null;
  return JSON.parse(data) as Scene;
}

export function clearScene(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// ─── Extended Scene (mit Regionen, Ops-Log, Token-Metriken) ─

export function createSceneExt(name: string): SceneExt {
  return {
    ...createScene(name),
    regions: [],
    meshOpsLog: [],
    tokenMetrics: { totalTokensIn: 0, totalTokensOut: 0, stepsCompleted: 0, avgTokensPerStep: 0 },
  };
}

export function addRegion(scene: SceneExt, region: WorkRegionExt): SceneExt {
  return {
    ...scene,
    regions: [...scene.regions, region],
    metadata: { ...scene.metadata, updatedAt: new Date().toISOString() },
  };
}

export function logMeshOps(scene: SceneExt, ops: MeshOperation[]): SceneExt {
  return {
    ...scene,
    meshOpsLog: [...scene.meshOpsLog, ...ops],
    metadata: { ...scene.metadata, updatedAt: new Date().toISOString() },
  };
}

export function updateTokenMetrics(scene: SceneExt, tokensIn: number, tokensOut: number): SceneExt {
  const m = scene.tokenMetrics;
  const newIn = m.totalTokensIn + tokensIn;
  const newOut = m.totalTokensOut + tokensOut;
  const steps = m.stepsCompleted + 1;
  return {
    ...scene,
    tokenMetrics: {
      totalTokensIn: newIn,
      totalTokensOut: newOut,
      stepsCompleted: steps,
      avgTokensPerStep: (newIn + newOut) / steps,
    },
  };
}

// ─── Scene Statistics (kompakte Zusammenfassung, keine raw Vertices) ─

export function computeSceneStatistics(scene: Scene, regionCount = 0, opCount = 0): SceneStatistics {
  const prims = scene.primitives;
  if (prims.length === 0) {
    return {
      primitiveCount: 0, regionCount, operationCount: opCount,
      densityAvg: 0, heightRange: [0, 0], variationScore: 0,
      collisionIndicators: 0, boundingBox: { min: [0, 0, 0], max: [0, 0, 0] },
      typeDistribution: {},
    };
  }

  const bb: AABB = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const typeDist: Record<string, number> = {};
  let minY = Infinity, maxY = -Infinity;

  for (const p of prims) {
    const box = getBBox(p);
    for (let i = 0; i < 3; i++) {
      bb.min[i] = Math.min(bb.min[i], box.min[i]);
      bb.max[i] = Math.max(bb.max[i], box.max[i]);
    }
    minY = Math.min(minY, box.min[1]);
    maxY = Math.max(maxY, box.max[1]);
    typeDist[p.type] = (typeDist[p.type] ?? 0) + 1;
  }

  // Variationscore: wie viele verschiedene Typen/Farben
  const uniqueColors = new Set(prims.map((p) => p.color)).size;
  const uniqueTypes = Object.keys(typeDist).length;
  const variation = Math.min(1, (uniqueColors + uniqueTypes) / (prims.length * 0.5));

  // Dichte: Primitives pro Volumen-Einheit
  const vol = (bb.max[0] - bb.min[0]) * Math.max(0.1, bb.max[1] - bb.min[1]) * (bb.max[2] - bb.min[2]);
  const density = vol > 0 ? prims.length / vol : 0;

  // Kollisionsindikatoren (einfache O(n²) Prüfung, nur Count)
  let collisions = 0;
  for (let i = 0; i < prims.length; i++) {
    const a = getBBox(prims[i]);
    for (let j = i + 1; j < prims.length; j++) {
      const b = getBBox(prims[j]);
      let overlaps = true;
      for (let k = 0; k < 3; k++) {
        if (a.max[k] <= b.min[k] + 0.05 || b.max[k] <= a.min[k] + 0.05) { overlaps = false; break; }
      }
      if (overlaps) collisions++;
    }
  }

  return {
    primitiveCount: prims.length,
    regionCount,
    operationCount: opCount,
    densityAvg: +density.toFixed(3),
    heightRange: [+minY.toFixed(2), +maxY.toFixed(2)],
    variationScore: +variation.toFixed(2),
    collisionIndicators: collisions,
    boundingBox: bb,
    typeDistribution: typeDist,
  };
}
