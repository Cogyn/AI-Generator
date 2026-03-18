// GlobalCritic: Bewertet die gesamte Szene nach dem Merge aller Regionen
// Erweitert: Nutzt kompakte Statistiken und optional Renderer-Output, keine raw Vertices

import type {
  Scene,
  GlobalStyleDirectives,
  CriticResponse,
  MergeConflict,
  SceneStatistics,
} from "../../core/types.js";
import { callLLM } from "../../ai/client.js";
import { computeSceneStatistics } from "../../core/scene.js";

export interface GlobalCriticResult extends CriticResponse {
  qualityScore: number; // 0-1
  issues: string[];
}

// ─── Standard Critic (bestehend, optimiert) ─────────────────

export async function globalCritic(
  scene: Scene,
  styleDirectives: GlobalStyleDirectives,
  mergeConflicts: MergeConflict[],
): Promise<GlobalCriticResult> {
  // Kompakte Statistik statt raw Primitives – spart Tokens
  const stats = computeSceneStatistics(scene);
  return globalCriticWithStats(stats, styleDirectives, mergeConflicts);
}

// ─── Erweiterter Critic mit kompakten Stats ─────────────────

export async function globalCriticWithStats(
  stats: SceneStatistics,
  styleDirectives: GlobalStyleDirectives,
  mergeConflicts: MergeConflict[],
  rendererScreenshot?: string, // Base64-encoded Bild (optional)
): Promise<GlobalCriticResult> {
  const conflictInfo = mergeConflicts.length > 0
    ? `\nMERGE CONFLICTS:\n${mergeConflicts.map((c) => `- ${c.type}: ${c.description}`).join("\n")}`
    : "\nNo merge conflicts.";

  const statsInfo = `SCENE STATISTICS (compact, no raw vertices):
- Primitive count: ${stats.primitiveCount}
- Region count: ${stats.regionCount}
- Operation count: ${stats.operationCount}
- Type distribution: ${JSON.stringify(stats.typeDistribution)}
- Average density: ${stats.densityAvg}
- Height range: [${stats.heightRange[0]}, ${stats.heightRange[1]}]
- Variation score: ${stats.variationScore} (0=uniform, 1=diverse)
- Collision indicators: ${stats.collisionIndicators}
- Bounding box: min=${JSON.stringify(stats.boundingBox.min)}, max=${JSON.stringify(stats.boundingBox.max)}`;

  const systemPrompt = `You are a global 3D scene critic. Evaluate the COMPLETE scene using COMPACT STATISTICS only.
You do NOT see raw vertices or faces – only aggregated metrics.

${statsInfo}

ORIGINAL GOAL: ${styleDirectives.goal}${styleDirectives.styleTags ? `\nStyle: ${styleDirectives.styleTags.join(", ")}` : ""}
${conflictInfo}
${rendererScreenshot ? "\nA renderer screenshot was provided for visual inspection." : ""}

Evaluate:
1. Does the primitive count and type distribution match the goal?
2. Is the density appropriate for the described object?
3. Are there collision indicators (should be 0 for clean scenes)?
4. Does the bounding box make sense for the object?
5. Is the height range reasonable?
6. Overall quality (0.0 to 1.0)?

IMPORTANT: Base your evaluation ONLY on statistics and metrics. Do not hallucinate visual details.

Respond with ONLY valid JSON:
{"approved": true/false, "feedback": "...", "isComplete": true/false, "qualityScore": 0.0-1.0, "issues": ["issue1", ...]}`;

  const raw = await callLLM(systemPrompt, "Evaluate the complete scene using statistics.");
  try {
    return JSON.parse(raw) as GlobalCriticResult;
  } catch {
    return {
      approved: true,
      feedback: "Evaluation failed",
      isComplete: true,
      qualityScore: 0.5,
      issues: ["Could not parse critic response"],
    };
  }
}
