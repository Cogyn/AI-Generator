// RegionBuilder: Baut Primitives innerhalb einer zugewiesenen Region
// Erhält nur lokalen Kontext + Boundary-Info, nicht die ganze Szene

import type { BuilderTask, BuilderResult, Primitive } from "../../core/types.js";
import { callLLM } from "../../ai/client.js";

export async function regionBuilder(task: BuilderTask): Promise<BuilderResult> {
  const systemPrompt = buildRegionBuilderPrompt(task);
  const raw = await callLLM(systemPrompt, `Build: ${task.localGoal}`);

  try {
    const parsed = JSON.parse(raw);
    const primitives: Primitive[] = (parsed.primitives ?? []).map((p: any) => ({
      ...p,
      type: p.type ?? "cube",
      id: p.id ?? `${task.region.id}-${Math.random().toString(36).slice(2, 6)}`,
      position: p.position ?? [0, 0, 0],
      size: p.size ?? [1, 1, 1],
      rotation: p.rotation ?? [0, 0, 0],
      color: p.color ?? "#888888",
      tags: [...(p.tags ?? []), `region:${task.region.id}`],
    }));

    return {
      taskId: task.taskId,
      regionId: task.region.id,
      addedPrimitives: primitives,
      reasoning: parsed.reasoning ?? "",
    };
  } catch {
    return {
      taskId: task.taskId,
      regionId: task.region.id,
      addedPrimitives: [],
      reasoning: "Failed to parse builder response",
    };
  }
}

function buildRegionBuilderPrompt(task: BuilderTask): string {
  const { region, localGoal, styleDirectives, boundaryContext, existingPrimitives } = task;
  const bounds = region.bounds;

  let boundaryInfo = "";
  if (boundaryContext.length > 0) {
    boundaryInfo = "\nNEIGHBOR CONTEXT (do NOT place primitives here, but align with these edges):\n";
    for (const bc of boundaryContext) {
      if (bc.edgePrimitives.length > 0) {
        boundaryInfo += `- Edge ${bc.sharedEdge} (region "${bc.regionId}"): ${JSON.stringify(bc.edgePrimitives.map((p) => ({ id: p.id, position: p.position })))}\n`;
      }
    }
  }

  return `You are a regional 3D builder. You build primitives ONLY within your assigned region.

YOUR REGION: "${region.label}"
  Bounds: x=[${bounds.min[0]}, ${bounds.max[0]}], y=[${bounds.min[1]}, ${bounds.max[1]}], z=[${bounds.min[2]}, ${bounds.max[2]}]
  Allowed types: ${region.allowedTypes.join(", ")}
  Max primitives: ${region.maxPrimitives}

GLOBAL STYLE: ${styleDirectives.goal}${styleDirectives.colorPalette ? `\nColor palette: ${styleDirectives.colorPalette.join(", ")}` : ""}${styleDirectives.styleTags ? `\nStyle: ${styleDirectives.styleTags.join(", ")}` : ""}

LOCAL GOAL: ${localGoal}

EXISTING IN THIS REGION: ${existingPrimitives.length === 0 ? "none" : JSON.stringify(existingPrimitives.map((p) => ({ id: p.id, position: p.position, type: p.type })))}
${boundaryInfo}
RULES:
- ALL primitives must have their center within your region bounds.
- Do NOT place anything outside your bounds.
- Respect the max primitives limit.
- Only use allowed primitive types.
- Each primitive needs: id, type, position, size (for cube), rotation, color, tags.

Respond with ONLY valid JSON:
{"reasoning": "what you built and why", "primitives": [{"id": "...", "type": "cube", "position": [x,y,z], "size": [w,h,d], "rotation": [0,0,0], "color": "#hex", "tags": ["..."]}]}`;
}
