import type { Scene, Primitive } from "./types.js";

const STORAGE_KEY = "ai-gen-scene";

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
