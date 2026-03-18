// Communication: Builder-Result → Combiner-Input
// Reichert Builder-Ergebnisse mit Metriken an für den Combiner

import type {
  BuilderResult, PlanObject, PlanBuilder, Primitive,
} from "../core/types.js";
import { getBBox } from "../core/constraints.js";

export interface BuilderMetrics {
  regionId: string;
  primitiveCount: number;
  totalVolume: number;
  density: number;
  boundingBox: { min: [number, number, number]; max: [number, number, number] };
  typeDistribution: Record<string, number>;
  withinBudget: boolean;
  subComponentCoverage: string[];
}

export interface EnrichedBuilderResult extends BuilderResult {
  metrics: BuilderMetrics;
}

// ─── Builder-Result anreichern ───────────────────────────────

export function enrichBuilderResult(
  result: BuilderResult,
  plan: PlanObject,
): EnrichedBuilderResult {
  const builder = plan.builders.find((b) => b.name === result.regionId);
  const area = builder ? plan.areas.find((a) => a.id === builder.area_id) : undefined;

  const metrics = computeBuilderMetrics(
    result.addedPrimitives,
    result.regionId,
    builder?.max_primitives ?? 10,
    area?.sub_components ?? [],
  );

  return { ...result, metrics };
}

// ─── Metriken berechnen ──────────────────────────────────────

function computeBuilderMetrics(
  primitives: Primitive[],
  regionId: string,
  maxPrimitives: number,
  expectedSubComponents: string[],
): BuilderMetrics {
  const typeDistribution: Record<string, number> = {};
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let totalVolume = 0;

  for (const p of primitives) {
    typeDistribution[p.type] = (typeDistribution[p.type] ?? 0) + 1;
    const bb = getBBox(p);
    minX = Math.min(minX, bb.min[0]); minY = Math.min(minY, bb.min[1]); minZ = Math.min(minZ, bb.min[2]);
    maxX = Math.max(maxX, bb.max[0]); maxY = Math.max(maxY, bb.max[1]); maxZ = Math.max(maxZ, bb.max[2]);
    totalVolume += (bb.max[0] - bb.min[0]) * (bb.max[1] - bb.min[1]) * (bb.max[2] - bb.min[2]);
  }

  if (primitives.length === 0) {
    return {
      regionId,
      primitiveCount: 0,
      totalVolume: 0,
      density: 0,
      boundingBox: { min: [0, 0, 0], max: [0, 0, 0] },
      typeDistribution: {},
      withinBudget: true,
      subComponentCoverage: [],
    };
  }

  const bbVolume = (maxX - minX) * (maxY - minY) * (maxZ - minZ);
  const density = bbVolume > 0 ? totalVolume / bbVolume : 0;

  // Prüfe welche Sub-Components tatsächlich gebaut wurden (via Tags)
  const builtSubComponents = new Set<string>();
  for (const p of primitives) {
    for (const tag of p.tags) {
      if (!tag.startsWith("part:") && expectedSubComponents.includes(tag)) {
        builtSubComponents.add(tag);
      }
    }
  }

  return {
    regionId,
    primitiveCount: primitives.length,
    totalVolume: +totalVolume.toFixed(3),
    density: +density.toFixed(3),
    boundingBox: {
      min: [+minX.toFixed(2), +minY.toFixed(2), +minZ.toFixed(2)],
      max: [+maxX.toFixed(2), +maxY.toFixed(2), +maxZ.toFixed(2)],
    },
    typeDistribution,
    withinBudget: primitives.length <= maxPrimitives,
    subComponentCoverage: [...builtSubComponents],
  };
}

// ─── Alle Builder-Results zusammenfassen ─────────────────────

export function summarizeBuilderResults(results: EnrichedBuilderResult[]): string {
  return results.map((r) => {
    const m = r.metrics;
    return `[${m.regionId}] ${m.primitiveCount} prims, density=${m.density}, types=${JSON.stringify(m.typeDistribution)}, budget=${m.withinBudget ? "OK" : "OVER"}`;
  }).join("\n");
}
