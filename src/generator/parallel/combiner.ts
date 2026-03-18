// Combiner: Nimmt lokal gebaute Part-Gruppen, skaliert und positioniert sie
// im Hauptfenster so dass ein kohärentes Gesamtobjekt entsteht.

import type {
  Scene,
  Primitive,
  PartGroup,
  PartTransform,
  CombinerResult,
  Vec3,
  AABB,
  GlobalStyleDirectives,
  AssemblyConfig,
} from "../../core/types.js";
import { createScene, addPrimitives } from "../../core/scene.js";
import { getPrimitiveExtents } from "../../core/types.js";
import { getBBox } from "../../core/constraints.js";
import { resolveAssembly, generateDefaultAssemblyConfig, transformPrimitive } from "../../core/assembly-resolver.js";

// Berechnet die lokale AABB einer Gruppe von Primitives
export function computeLocalBounds(primitives: Primitive[]): AABB {
  if (primitives.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of primitives) {
    const bb = getBBox(p);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], bb.min[i]);
      max[i] = Math.max(max[i], bb.max[i]);
    }
  }
  return { min, max };
}

// Erstellt PartGroups aus BuilderResults
export function buildPartGroups(
  results: Array<{ taskId: string; regionId: string; addedPrimitives: Primitive[]; reasoning: string }>,
  labels: Map<string, string>,
): PartGroup[] {
  return results
    .filter((r) => r.addedPrimitives.length > 0)
    .map((r) => ({
      partId: r.regionId,
      label: labels.get(r.regionId) ?? r.regionId,
      primitives: r.addedPrimitives,
      localBounds: computeLocalBounds(r.addedPrimitives),
    }));
}

// Re-export transformPrimitive from assembly-resolver for backwards compatibility
export { transformPrimitive } from "../../core/assembly-resolver.js";

// Algorithmischer Combiner: nutzt AssemblyRules statt LLM
export async function combineParts(
  partGroups: PartGroup[],
  assemblyConfig: AssemblyConfig | undefined,
  styleDirectives: GlobalStyleDirectives,
  existingScene?: Scene,
): Promise<CombinerResult> {
  const config = assemblyConfig ?? generateDefaultAssemblyConfig(partGroups);
  return resolveAssembly(partGroups, config, existingScene);
}
