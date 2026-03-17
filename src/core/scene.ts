import type { Scene, Primitive, PrimitiveChanges, Vec3 } from "./types.js";

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
