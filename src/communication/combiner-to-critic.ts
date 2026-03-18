// Communication: Combiner → KI-Critic
// Erstellt den Critic-Prompt mit PlanObject, Scene-State und Metriken

import type {
  PlanObject, Scene, SceneStatistics, SceneQuality, MergeConflict,
} from "../core/types.js";
import type { EnrichedBuilderResult } from "./builder-to-combiner.js";
import { planToCompactJSON } from "../plan/plan-object.js";

export interface CriticInput {
  planObject: PlanObject;
  sceneStats: SceneStatistics;
  quality: SceneQuality;
  mergeConflicts: MergeConflict[];
  builderMetrics: EnrichedBuilderResult[];
  iteration: number;
  isRepairPass: boolean;
}

// ─── Critic-Prompt erstellen ─────────────────────────────────

export function buildCriticPrompt(input: CriticInput): string {
  const { planObject, sceneStats, quality, mergeConflicts, builderMetrics, iteration, isRepairPass } = input;

  const planSummary = planToCompactJSON(planObject);

  const qualityStr = `QUALITY ASSESSMENT:
- Score: ${(quality.score * 100).toFixed(0)}%
- Valid: ${quality.valid}
- Errors: ${quality.violations.filter((v) => v.severity === "error").length}
- Warnings: ${quality.violations.filter((v) => v.severity === "warning").length}
- Collisions: ${quality.metrics.collisions}
- Disconnected: ${quality.metrics.disconnected}
- Out of bounds: ${quality.metrics.outOfBounds}`;

  const violationsStr = quality.violations.length > 0
    ? `\nVIOLATIONS:\n${quality.violations.map((v) => `- [${v.severity}] ${v.rule}: ${v.message}`).join("\n")}`
    : "\nNo violations.";

  const conflictStr = mergeConflicts.length > 0
    ? `\nMERGE CONFLICTS:\n${mergeConflicts.map((c) => `- ${c.type}: ${c.description}`).join("\n")}`
    : "\nNo merge conflicts.";

  const builderStr = builderMetrics.length > 0
    ? `\nBUILDER METRICS:\n${builderMetrics.map((r) => {
      const m = r.metrics;
      return `- ${m.regionId}: ${m.primitiveCount} prims, density=${m.density}, budget=${m.withinBudget ? "OK" : "OVER"}`;
    }).join("\n")}`
    : "";

  const targetStr = `QUALITY TARGETS (from plan):
- Max errors: ${planObject.global_quality_targets.errors_max}
- Max warnings: ${planObject.global_quality_targets.warnings_max}
- Min score: ${(planObject.global_quality_targets.min_score * 100).toFixed(0)}%
- Max primitives total: ${planObject.cost_targets.max_primitives_total}`;

  const repairStr = isRepairPass
    ? `\nREPAIR ITERATION: ${iteration} (this is a post-repair evaluation)`
    : "";

  return `You are a 3D scene critic. Evaluate the scene using COMPACT STATISTICS and PLAN TARGETS.

PLAN: ${planSummary}

SCENE STATISTICS:
- Primitives: ${sceneStats.primitiveCount}
- Regions: ${sceneStats.regionCount}
- Types: ${JSON.stringify(sceneStats.typeDistribution)}
- Density: ${sceneStats.densityAvg}
- Height range: [${sceneStats.heightRange[0]}, ${sceneStats.heightRange[1]}]
- Bounding box: min=${JSON.stringify(sceneStats.boundingBox.min)}, max=${JSON.stringify(sceneStats.boundingBox.max)}
- Collision indicators: ${sceneStats.collisionIndicators}

${qualityStr}
${violationsStr}
${conflictStr}
${builderStr}
${targetStr}
${repairStr}

Evaluate:
1. Does the scene match the plan's goal and targets?
2. Are quality targets met (errors ≤ ${planObject.global_quality_targets.errors_max}, warnings ≤ ${planObject.global_quality_targets.warnings_max})?
3. Is primitive count within budget?
4. Are there unresolved collisions or disconnected parts?
5. Overall quality score (0.0-1.0)?

IMPORTANT: Be objective. Base evaluation ONLY on the metrics provided. Do not hallucinate visual details.

Respond with ONLY valid JSON:
{"approved": true/false, "feedback": "specific feedback", "isComplete": true, "qualityScore": 0.0-1.0, "issues": ["issue1", ...]}`;
}
