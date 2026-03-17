// RegionBuilder: Baut Primitives in lokalem Koordinatensystem
// Jeder Builder arbeitet unabhängig um seinen Ursprung herum

import type { BuilderTask, BuilderResult, Primitive } from "../../core/types.js";
import { callLLM } from "../../ai/client.js";

export async function regionBuilder(task: BuilderTask): Promise<BuilderResult> {
  const systemPrompt = buildLocalBuilderPrompt(task);
  const raw = await callLLM(systemPrompt, `Build: ${task.localGoal}`);

  try {
    const parsed = JSON.parse(raw);
    const primitives: Primitive[] = (parsed.primitives ?? []).map((p: any) => {
      const type = (["cube", "sphere", "cylinder"].includes(p.type)) ? p.type : "cube";
      const base = {
        id: p.id ?? `${task.region.id}-${Math.random().toString(36).slice(2, 6)}`,
        type,
        position: Array.isArray(p.position) && p.position.length >= 3 ? p.position : [0, 0, 0],
        rotation: Array.isArray(p.rotation) && p.rotation.length >= 3 ? p.rotation : [0, 0, 0],
        color: p.color ?? "#888888",
        tags: [...(p.tags ?? []), `part:${task.region.id}`],
      };
      switch (type) {
        case "sphere":
          return { ...base, radius: typeof p.radius === "number" && p.radius > 0 ? p.radius : (p.size ? p.size[0] / 2 : 1) };
        case "cylinder":
          return {
            ...base,
            radiusTop: typeof p.radiusTop === "number" && p.radiusTop > 0 ? p.radiusTop : (p.radius ?? (p.size ? p.size[0] / 2 : 0.5)),
            radiusBottom: typeof p.radiusBottom === "number" && p.radiusBottom > 0 ? p.radiusBottom : (p.radius ?? (p.size ? p.size[0] / 2 : 0.5)),
            height: typeof p.height === "number" && p.height > 0 ? p.height : (p.size ? p.size[1] : 1),
          };
        default:
          return { ...base, size: Array.isArray(p.size) && p.size.length >= 3 ? p.size : [1, 1, 1] };
      }
    }) as Primitive[];

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

function buildLocalBuilderPrompt(task: BuilderTask): string {
  const { region, localGoal, styleDirectives } = task;

  return `You are a part builder. You build ONE PART of a larger object in LOCAL coordinate space.
Your part will later be scaled and positioned by a Combiner to form the complete object.

YOUR PART: "${region.label}"
BUILD GOAL: ${localGoal}

COORDINATE SYSTEM:
- Build centered around origin [0, 0, 0].
- x = left/right, y = up (height), z = forward/back
- y=0 is the center height of your part. The Combiner will handle final ground placement.

PRIMITIVE TYPES:
- cube: {"type": "cube", "size": [width, height, depth]} — rectangular box
- sphere: {"type": "sphere", "radius": R} — ball
- cylinder: {"type": "cylinder", "radiusTop": R1, "radiusBottom": R2, "height": H}
  Cylinders are VERTICAL by default (height along Y). To orient differently:
  - Horizontal along Z: rotation [90, 0, 0]
  - Horizontal along X: rotation [0, 0, 90]
  - Diagonal: use appropriate angles

ROTATION: [rx, ry, rz] in degrees. Essential for non-upright parts.

GLOBAL CONTEXT: Building part of "${styleDirectives.goal}"${styleDirectives.colorPalette ? `\nColor palette: ${styleDirectives.colorPalette.join(", ")}` : ""}${styleDirectives.styleTags ? `\nStyle: ${styleDirectives.styleTags.join(", ")}` : ""}

Max primitives: ${region.maxPrimitives}

RULES:
- Build centered around [0, 0, 0]. The Combiner handles final positioning.
- Primitives within your part must NOT overlap each other.
- Every primitive after the first must touch or nearly touch another in your part.
- Use appropriate colors from the palette.
- Use rotation for horizontal/diagonal parts (e.g., a fuselage should be a cylinder with rotation [90,0,0]).

Respond with ONLY valid JSON:
{"reasoning": "what you built and why", "primitives": [{"id": "...", "type": "cube|sphere|cylinder", "position": [x,y,z], ...type-specific fields, "rotation": [rx,ry,rz], "color": "#hex", "tags": ["..."]}]}`;
}
