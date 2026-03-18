// RegionBuilder: Baut Primitives in lokalem Koordinatensystem
// Erweitert: Unterstützt PlanObject-basierte Builder-Prompts mit Token-Tracking

import type {
  BuilderTask, BuilderResult, Primitive,
  BuilderTaskExt, BuilderResultExt, MeshOperation,
  PlanObject,
} from "../../core/types.js";
import { callLLM, callLLMTracked } from "../../ai/client.js";
import { resolveMeshOp } from "../../core/mesh-operations.js";
import { buildEnhancedBuilderPrompt } from "../../communication/plan-to-builder.js";

// ─── Standard Builder (Primitive-basiert, bestehend) ────────

export async function regionBuilder(task: BuilderTask): Promise<BuilderResult> {
  const systemPrompt = buildLocalBuilderPrompt(task);
  const raw = await callLLM(systemPrompt, `Build: ${task.localGoal}`);
  return parseBuilderResponse(raw, task);
}

// ─── PlanObject-basierter Builder ────────────────────────────

export async function regionBuilderWithPlan(
  task: BuilderTask,
  planObject: PlanObject,
): Promise<BuilderResult> {
  const builder = planObject.builders.find((b) => b.name === task.region.id);
  const area = builder ? planObject.areas.find((a) => a.id === builder.area_id) : undefined;

  let systemPrompt: string;
  if (builder && area) {
    // Erweiterter Prompt mit PlanObject-Kontext
    systemPrompt = buildEnhancedBuilderPrompt(builder, area, planObject);
  } else {
    // Fallback auf Standard-Prompt
    systemPrompt = buildLocalBuilderPrompt(task);
  }

  const raw = await callLLMTracked(
    systemPrompt,
    `Build: ${task.localGoal}`,
    `builder:${task.region.id}`,
  );

  return parseBuilderResponse(raw, task);
}

// ─── Erweiterter Builder (Mesh-Operations-basiert) ──────────

export async function regionBuilderExt(task: BuilderTaskExt): Promise<BuilderResultExt> {
  const systemPrompt = buildMeshOpsBuilderPrompt(task);
  const raw = await callLLMTracked(
    systemPrompt,
    `Build region "${task.region.label}": ${task.localGoal}`,
    `builder-ext:${task.region.id}`,
  );

  try {
    const parsed = JSON.parse(raw);
    const meshOps: MeshOperation[] = (parsed.operations ?? [])
      .filter((op: any) => task.allowedOps.includes(op.op))
      .map((op: any) => ({
        ...op,
        tags: [...(op.tags ?? []), `part:${task.region.id}`],
      }));

    const primitives: Primitive[] = [];
    for (const op of meshOps) {
      const resolved = resolveMeshOp(op, primitives);
      primitives.push(...resolved);
    }

    for (const p of primitives) {
      if (!p.tags.includes(`part:${task.region.id}`)) {
        p.tags.push(`part:${task.region.id}`);
      }
    }

    return {
      taskId: task.taskId,
      regionId: task.region.id,
      addedPrimitives: primitives,
      reasoning: parsed.reasoning ?? "",
      meshOps,
    };
  } catch {
    return {
      taskId: task.taskId,
      regionId: task.region.id,
      addedPrimitives: [],
      reasoning: "Failed to parse mesh-ops builder response",
      meshOps: [],
    };
  }
}

// ─── Response Parser ─────────────────────────────────────────

function parseBuilderResponse(raw: string, task: BuilderTask): BuilderResult {
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

// ─── Prompts ────────────────────────────────────────────────

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

function buildMeshOpsBuilderPrompt(task: BuilderTaskExt): string {
  const { region, localGoal, styleDirectives, allowedOps, densityLevel, styleConstraint } = task;

  const opDocs: Record<string, string> = {
    add_primitive: `{"op": "add_primitive", "type": "cube|sphere|cylinder", "position": [x,y,z], "size": [w,h,d], "rotation": [rx,ry,rz], "color": "#hex"}`,
    add_terrain_region: `{"op": "add_terrain_region", "bounds": [[minX,minY,minZ],[maxX,maxY,maxZ]], "type": "smooth|rocky|flat|hilly", "density": 1-50, "smoothness": 0-1, "color": "#hex"}`,
    add_hill: `{"op": "add_hill", "center": [x,y,z], "radius": R, "height": H, "smoothness": 0-1, "color": "#hex"}`,
    add_mesh_rule: `{"op": "add_mesh_rule", "pattern": "noise|wave|ripple|erosion", "strength": 0-1, "iterations": 1-5, "scale": 1.0}`,
    add_curve: `{"op": "add_curve", "points": [[x,y,z], ...], "radius": R, "segments": N, "color": "#hex"}`,
    add_grid: `{"op": "add_grid", "type": "cube|sphere|cylinder", "bounds": [[min],[max]], "spacing": [sx,sy,sz], "size": [w,h,d], "color": "#hex", "jitter": 0-1}`,
    mirror: `{"op": "mirror", "sourceId": "id-of-existing", "axis": "x|y|z"}`,
  };

  const allowedDocs = allowedOps.map((op) => `- ${opDocs[op] ?? op}`).join("\n");

  return `You are a region builder using MESH OPERATIONS. You generate declarative operations, NOT raw vertices or faces.
Each operation will be algorithmically resolved into actual geometry.

REGION: "${region.label}"
BUILD GOAL: ${localGoal}
DENSITY LEVEL: ${densityLevel} (1=sparse, 10=dense)
${styleConstraint ? `STYLE CONSTRAINT: ${styleConstraint}` : ""}

COORDINATE SYSTEM:
- Build centered around origin [0, 0, 0].
- x = left/right, y = up (height), z = forward/back

ALLOWED OPERATIONS:
${allowedDocs}

GLOBAL CONTEXT: Part of "${styleDirectives.goal}"${styleDirectives.colorPalette ? `\nColors: ${styleDirectives.colorPalette.join(", ")}` : ""}${styleDirectives.styleTags ? `\nStyle: ${styleDirectives.styleTags.join(", ")}` : ""}

Max primitives: ${region.maxPrimitives}

RULES:
- Generate ONLY mesh operations. NO raw vertex/face data.
- Build centered around [0, 0, 0].
- Use the most efficient operation (e.g., add_grid for repetitive patterns, add_terrain_region for landscapes).
- Keep operations minimal — the resolver handles the heavy geometry.

Respond with ONLY valid JSON:
{"reasoning": "what you built and why", "operations": [${allowedOps.length > 0 ? "..." : ""}]}`;
}
