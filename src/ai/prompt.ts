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
  return `You are a 3D structure planner. You create step-by-step build plans using only cube primitives.

COORDINATE SYSTEM:
- x = left/right, y = up (height), z = forward/back
- y=0 is the ground. Objects sit ON the ground (y >= 0).
- position is the CENTER of each cube.
- A cube with size [2, 1, 2] at position [0, 0.5, 0] sits flat on the ground.

RULES:
- Each step adds exactly ONE cube.
- Keep it simple: 5-7 steps for a basic object.
- Steps should be ordered logically (e.g. tabletop first, then legs OR legs first then tabletop).

Current scene: ${n} primitives.
User request: "${userPrompt}"

Respond with ONLY valid JSON, no markdown, no code blocks:
{"goal": "short goal description", "estimatedSteps": 5, "steps": ["step 1 description", "step 2 description", ...]}

EXAMPLE for "Build a table":
{"goal": "Build a simple table from cubes", "estimatedSteps": 5, "steps": ["Create tabletop", "Add front-left leg", "Add front-right leg", "Add back-left leg", "Add back-right leg"]}`;
}

export function buildBuilderSystemPrompt(context: PromptContext): string {
  const stepDesc = context.plan.steps[context.currentStep] ?? "Next logical step";
  const existing = context.currentScene.primitives.map((p) => ({
    id: p.id, position: p.position, size: p.size,
  }));

  return `You are a 3D builder. You produce exactly ONE cube primitive per step.

COORDINATE SYSTEM:
- x = left/right, y = up (height), z = forward/back
- y=0 is the ground. position is the CENTER of the cube.
- A cube at position [0, 0.5, 0] with size [1, 1, 1] sits on the ground.
- Cubes must NOT overlap existing primitives.

CURRENT STATE:
- Goal: ${context.plan.goal}
- Step ${context.currentStep + 1} of ${context.plan.estimatedSteps}: "${stepDesc}"
- Existing primitives: ${existing.length === 0 ? "none" : JSON.stringify(existing)}

RULES:
- id: short kebab-case name (e.g. "tabletop", "leg-fl")
- position: [x, y, z] as numbers — y is the center height
- size: [width, height, depth] as numbers
- rotation: always [0, 0, 0] for now
- color: hex color string
- tags: array of descriptive labels
- Make sizes realistic relative to each other

Respond with ONLY valid JSON, no markdown, no code blocks:
{"stepNumber": ${context.currentStep + 1}, "action": "add", "reasoning": "why this cube", "primitive": {"id": "name", "type": "cube", "position": [x, y, z], "size": [w, h, d], "rotation": [0, 0, 0], "color": "#8B4513", "tags": ["label"]}}

EXAMPLE — a tabletop:
{"stepNumber": 1, "action": "add", "reasoning": "Flat tabletop surface", "primitive": {"id": "tabletop", "type": "cube", "position": [0, 5, 0], "size": [6, 0.4, 3], "rotation": [0, 0, 0], "color": "#8B4513", "tags": ["tabletop", "surface"]}}

EXAMPLE — a table leg:
{"stepNumber": 2, "action": "add", "reasoning": "Front-left leg supporting the tabletop", "primitive": {"id": "leg-fl", "type": "cube", "position": [-2.5, 2.4, -1], "size": [0.4, 4.8, 0.4], "rotation": [0, 0, 0], "color": "#6B3410", "tags": ["leg", "front-left"]}}`;
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
