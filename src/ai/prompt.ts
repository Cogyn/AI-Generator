import type { PromptContext, Scene, GenerationPlan } from "../core/types.js";

export function buildPromptContext(
  userPrompt: string,
  scene: Scene,
  plan: GenerationPlan,
  currentStep: number,
): PromptContext {
  return { userPrompt, currentScene: scene, plan, currentStep };
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

export function buildBuilderSystemPrompt(context: PromptContext): string {
  const stepDesc = context.plan.steps[context.currentStep] ?? "Next logical step";
  const existing = context.currentScene.primitives.map((p) => ({
    id: p.id, position: p.position, size: p.size,
  }));

  return `You are a 3D builder. You produce exactly ONE cube primitive per step.

COORDINATE SYSTEM:
- x = left/right, y = up (height), z = forward/back
- y=0 is the ground. position = CENTER of the cube.
- Bottom of a cube = position.y - size.y/2
- Top of a cube = position.y + size.y/2
- A cube with size [1, 1, 1] at position [0, 0.5, 0] sits on the ground (bottom at y=0, top at y=1).

SPATIAL PLACEMENT — CRITICAL:
- Parts that sit ON TOP of another part: their bottom edge must equal the top edge of the part below.
  Example: if a surface has top at y=5, a part on top starts at y=5, so its center.y = 5 + own_height/2.
- Parts that support something FROM BELOW: their top edge must equal the bottom edge of the part above.
  Example: if a surface has bottom at y=4.8, a support below has its top at y=4.8, so center.y = 4.8 - own_height/2.
- Parts placed NEXT TO each other: their edges touch but do not penetrate.
- Cubes may touch at edges/faces. That is normal and expected. Only deep penetration is wrong.

CURRENT STATE:
- Goal: ${context.plan.goal}
- Step ${context.currentStep + 1} of ${context.plan.estimatedSteps}: "${stepDesc}"
- Existing primitives: ${existing.length === 0 ? "none" : JSON.stringify(existing)}

OUTPUT RULES:
- id: short kebab-case name (e.g. "seat", "leg-fl", "back-panel")
- position: [x, y, z] as numbers
- size: [width, height, depth] as numbers (all > 0)
- rotation: [0, 0, 0]
- color: hex color fitting the object
- tags: descriptive labels

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
