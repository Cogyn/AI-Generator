// GlobalCritic: Bewertet die gesamte Szene nach dem Merge aller Regionen
// Prüft Kohärenz, Stil-Konsistenz und strukturelle Qualität

import type {
  Scene,
  GlobalStyleDirectives,
  CriticResponse,
  MergeConflict,
} from "../../core/types.js";
import { callLLM } from "../../ai/client.js";

export interface GlobalCriticResult extends CriticResponse {
  qualityScore: number; // 0-1
  issues: string[];
}

export async function globalCritic(
  scene: Scene,
  styleDirectives: GlobalStyleDirectives,
  mergeConflicts: MergeConflict[],
): Promise<GlobalCriticResult> {
  const primitives = scene.primitives.map((p) => ({
    id: p.id, type: p.type, position: p.position, color: p.color, tags: p.tags,
  }));

  const conflictInfo = mergeConflicts.length > 0
    ? `\nMERGE CONFLICTS:\n${mergeConflicts.map((c) => `- ${c.type}: ${c.description}`).join("\n")}`
    : "\nNo merge conflicts.";

  const systemPrompt = `You are a global 3D scene critic. Evaluate the COMPLETE scene after all regions have been built.

SCENE:
- ${scene.primitives.length} primitives total
- Primitives: ${JSON.stringify(primitives)}

ORIGINAL GOAL: ${styleDirectives.goal}${styleDirectives.styleTags ? `\nStyle: ${styleDirectives.styleTags.join(", ")}` : ""}
${conflictInfo}

Evaluate:
1. Does the scene match the goal?
2. Is the style consistent across all parts?
3. Are there structural problems (floating parts, gaps)?
4. Overall quality (0.0 to 1.0)?

Respond with ONLY valid JSON:
{"approved": true/false, "feedback": "...", "isComplete": true/false, "qualityScore": 0.0-1.0, "issues": ["issue1", ...]}`;

  const raw = await callLLM(systemPrompt, "Evaluate the complete scene.");
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
