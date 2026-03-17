// Partitioner: Zerlegt eine Szene/Aufgabe in isolierte WorkRegions
// MVP: Platzhalter-Implementierung, später KI-gestützt

import type {
  Scene,
  ScenePartition,
  WorkRegion,
  RegionAssignment,
  GlobalStyleDirectives,
  AABB,
  Primitive,
} from "../../core/types.js";
import { callLLM } from "../../ai/client.js";

// Einfache räumliche Aufteilung entlang einer Achse
export function partitionByAxis(
  bounds: AABB,
  count: number,
  axis: "x" | "y" | "z" = "x",
): AABB[] {
  const idx = axis === "x" ? 0 : axis === "y" ? 1 : 2;
  const min = bounds.min[idx];
  const max = bounds.max[idx];
  const step = (max - min) / count;

  const regions: AABB[] = [];
  for (let i = 0; i < count; i++) {
    const rMin: [number, number, number] = [...bounds.min];
    const rMax: [number, number, number] = [...bounds.max];
    rMin[idx] = min + step * i;
    rMax[idx] = min + step * (i + 1);
    regions.push({ min: rMin, max: rMax });
  }
  return regions;
}

// Ermittelt welche Primitives in einer Region liegen (Zentrum-basiert)
export function primitivesInRegion(primitives: Primitive[], region: AABB): Primitive[] {
  return primitives.filter((p) => {
    for (let i = 0; i < 3; i++) {
      if (p.position[i] < region.min[i] || p.position[i] > region.max[i]) return false;
    }
    return true;
  });
}

// KI-gestützte Partitionierung: fragt das Modell wie die Aufgabe
// in Teilbereiche zerlegt werden soll
export async function partitionWithAI(
  userPrompt: string,
  scene: Scene,
): Promise<ScenePartition> {
  const systemPrompt = `You are a 3D scene partitioner. Given a build goal, split the work into 2-4 spatial regions.
Each region is an axis-aligned box with a local build goal.

COORDINATE SYSTEM: x = left/right, y = up (height), z = forward/back. y=0 is ground.

Respond with ONLY valid JSON:
{
  "styleDirectives": {"goal": "...", "colorPalette": ["#hex", ...], "styleTags": ["..."]},
  "regions": [
    {"id": "region-id", "label": "human label", "bounds": {"min": [x,y,z], "max": [x,y,z]}, "maxPrimitives": N, "allowedTypes": ["cube"]},
    ...
  ],
  "assignments": [
    {"regionId": "region-id", "localGoal": "what to build here", "priority": 1},
    ...
  ]
}`;

  const raw = await callLLM(systemPrompt, `Partition this build task: "${userPrompt}". Scene has ${scene.primitives.length} existing primitives.`);
  try {
    const parsed = JSON.parse(raw);
    return parsed as ScenePartition;
  } catch {
    // Fallback: eine einzige Region für die ganze Szene
    return createSingleRegionPartition(userPrompt);
  }
}

// Fallback: alles in einer Region
export function createSingleRegionPartition(goal: string): ScenePartition {
  const region: WorkRegion = {
    id: "main",
    label: "Gesamte Szene",
    bounds: { min: [-50, 0, -50], max: [50, 50, 50] },
    maxPrimitives: 20,
    allowedTypes: ["cube", "sphere", "cylinder"],
  };

  return {
    regions: [region],
    assignments: [{ regionId: "main", localGoal: goal, priority: 1 }],
    styleDirectives: { goal },
  };
}
