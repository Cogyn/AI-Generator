import type { PromptContext, Scene, GenerationPlan } from "../core/types.js";
import { getBBox } from "../core/constraints.js";

export function buildPromptContext(
  userPrompt: string,
  scene: Scene,
  plan: GenerationPlan,
  currentStep: number,
): PromptContext {
  return { userPrompt, currentScene: scene, plan, currentStep };
}

// Erzeugt eine lesbare Liste aller Cubes mit ihren exakten Kanten
function formatExistingPrimitives(scene: Scene): string {
  if (scene.primitives.length === 0) return "none";

  return JSON.stringify(scene.primitives.map((p) => {
    const bb = getBBox(p);
    return {
      id: p.id,
      position: p.position,
      size: p.size,
      edges: {
        x: [+bb.min[0].toFixed(2), +bb.max[0].toFixed(2)],
        y: [+bb.min[1].toFixed(2), +bb.max[1].toFixed(2)],
        z: [+bb.min[2].toFixed(2), +bb.max[2].toFixed(2)],
      },
    };
  }));
}

export function buildPlannerSystemPrompt(userPrompt: string, scene: Scene): string {
  const n = scene.primitives.length;
  return `You are a 3D structure planner. You decompose any object into simple cube primitives and create a step-by-step build plan.

COORDINATE SYSTEM:
- x = left/right, y = up (height), z = forward/back
- y=0 is the ground. position = CENTER of each cube.

PLANNING RULES:
- Each step adds exactly ONE cube.
- 5-10 steps for a typical object.
- Think about the object structurally: what are its main parts? Break each part into one or more cubes.
- Order steps logically: large structural parts first, details last.
- Step descriptions should be short and clear.

Current scene: ${n} primitives.
User request: "${userPrompt}"

Respond with ONLY valid JSON, no markdown, no code blocks:
{"goal": "short goal description", "estimatedSteps": N, "steps": ["step 1", "step 2", ...]}`;
}

export function buildBuilderSystemPrompt(context: PromptContext, correctionContext?: string): string {
  const stepDesc = context.plan.steps[context.currentStep] ?? "Next logical step";
  const existingStr = formatExistingPrimitives(context.currentScene);

  let correction = "";
  if (correctionContext) {
    correction = `
CORRECTION REQUIRED — YOUR PREVIOUS ATTEMPT FAILED:
${correctionContext}
You MUST fix the placement. Adjust position and/or size so there is NO overlap.
`;
  }

  return `You are a 3D builder. You produce exactly ONE cube primitive per step.

COORDINATE SYSTEM:
- x = left/right, y = up (height), z = forward/back
- y=0 is the ground. position = CENTER of the cube.
- Bottom of a cube = position.y - size.y/2
- Top of a cube = position.y + size.y/2

NO-OVERLAP RULE — CRITICAL:
Each existing primitive below has "edges" showing its exact occupied range on each axis.
Your new cube's edges must NOT overlap with ANY existing cube's edges on ALL THREE axes simultaneously.
Two cubes overlap when: new.x_min < existing.x_max AND new.x_max > existing.x_min AND same for y AND same for z.
Cubes MAY touch (share an edge). They must NOT penetrate.

To place a part BELOW an existing cube: new cube's top (position.y + size.y/2) should equal existing cube's bottom edge (edges.y[0]).
To place a part NEXT TO: ensure at least one axis has no range overlap.

CURRENT STATE:
- Goal: ${context.plan.goal}
- Step ${context.currentStep + 1} of ${context.plan.estimatedSteps}: "${stepDesc}"
- Existing primitives with edge coordinates: ${existingStr}
${correction}
OUTPUT RULES:
- id: short kebab-case name
- position: [x, y, z] as numbers
- size: [width, height, depth] as numbers (all > 0)
- rotation: [0, 0, 0]
- color: hex color fitting the object
- tags: descriptive labels
- VERIFY before responding: calculate your cube's edges and check they don't penetrate existing cubes.

Respond with ONLY valid JSON, no markdown, no code blocks:
{"stepNumber": ${context.currentStep + 1}, "action": "add", "reasoning": "why this cube", "primitive": {"id": "name", "type": "cube", "position": [x, y, z], "size": [w, h, d], "rotation": [0, 0, 0], "color": "#hex", "tags": ["label"]}}`;
}

export function buildCriticSystemPrompt(scene: Scene, plan: GenerationPlan, stepNumber: number): string {
  const primitives = scene.primitives.map((p) => ({
    id: p.id, position: p.position, size: p.size, tags: p.tags,
  }));

  return `You are a 3D build critic. Evaluate the current scene state.

Goal: ${plan.goal}
Step ${stepNumber} of ${plan.estimatedSteps} completed.
Primitives: ${JSON.stringify(primitives)}

Set isComplete to true ONLY when all planned steps are done (step ${plan.estimatedSteps} of ${plan.estimatedSteps}).

Respond with ONLY valid JSON, no markdown, no code blocks:
{"approved": true, "feedback": "short feedback", "isComplete": ${stepNumber >= plan.estimatedSteps}}`;
}
