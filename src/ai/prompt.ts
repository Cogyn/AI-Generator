import type { PromptContext, Scene, GenerationPlan } from "../core/types.js";
import { getPrimitiveExtents } from "../core/types.js";
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
    const ext = getPrimitiveExtents(p);
    return {
      id: p.id,
      type: p.type,
      position: p.position,
      extents: ext,
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
  return `You are a 3D structure planner. You decompose any object into primitives (cubes, spheres, cylinders) and create a step-by-step build plan.

COORDINATE SYSTEM:
- x = left/right, y = up (height), z = forward/back
- y=0 is the ground. position = CENTER of each primitive.

AVAILABLE PRIMITIVES:
- cube: rectangular box with size [width, height, depth]
- sphere: ball with a radius
- cylinder: tube/column with radiusTop, radiusBottom, height
  Cylinders are VERTICAL by default. To make horizontal, specify rotation (e.g. rotation [90,0,0] for along Z-axis).

ROTATION: Primitives can be rotated in degrees [rx, ry, rz]. This is essential for:
- Horizontal cylinders (airplane fuselage, gun barrel, pipe)
- Diagonal parts (wings with angle, ramps, roofs)
- Any non-axis-aligned parts

AVAILABLE ACTIONS:
- "add": Place a new primitive
- "remove": Delete an existing primitive (for creating cutouts or replacing parts)
- "modify": Change position, rotation, size, or color of an existing primitive
- "clone": Duplicate an existing primitive, optionally mirrored (great for symmetry)

PLANNING RULES:
- Each step performs ONE action. Choose the best type for each part.
- 5-10 steps for a typical object.
- Think about the object structurally: what are its main parts? Use spheres for round parts (heads, balls), cylinders for columns/legs/tubes, cubes for flat/boxy parts.
- Order steps logically: large structural parts first, details last.
- Use "clone" with mirror for symmetric parts (e.g., build left wing, then clone+mirror for right wing).
- Use "remove" to delete parts that need to be replaced or to create openings.
- Use "modify" to adjust position/size/rotation of existing parts.
- Step descriptions MUST mention: the action, primitive type (for add), AND rotation if non-zero.
  Example: "Add a cylinder for the fuselage at [0,2,0], rotated 90° around X to lie horizontal along Z"
  Example: "Clone left-wing to right-wing, mirrored on X"
- EVERY new part must physically connect to an existing part. No floating parts!

Current scene: ${n} primitives.${n > 0 ? `\nExisting primitives (DO NOT recreate these — build ON TOP of what exists):\n${formatExistingPrimitives(scene)}` : ""}
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

  return `You are a 3D builder. You produce exactly ONE primitive per step. Choose the best type for the current step.

COORDINATE SYSTEM:
- x = left/right, y = up (height), z = forward/back
- y=0 is the ground. position = CENTER of the primitive.
- The "edges" shown for each existing primitive are the axis-aligned bounding box AFTER rotation.

PRIMITIVE TYPES:
- cube: {"type": "cube", "size": [width, height, depth]}
- sphere: {"type": "sphere", "radius": R} — bounding box is 2R x 2R x 2R (rotation irrelevant)
- cylinder: {"type": "cylinder", "radiusTop": R1, "radiusBottom": R2, "height": H}
  By default a cylinder stands VERTICAL (height along Y). To make it horizontal:
  - Along Z-axis: rotation [90, 0, 0]
  - Along X-axis: rotation [0, 0, 90]

ROTATION (degrees):
- rotation: [rx, ry, rz] in degrees. [0,0,0] = no rotation.
- Use rotation to orient parts diagonally or horizontally. Examples:
  - Horizontal cylinder (fuselage along Z): rotation [90, 0, 0]
  - 45° diagonal beam: rotation [0, 0, 45]
  - Tilted wing: rotation [0, 0, 15]

CONNECTIVITY RULE — CRITICAL:
Every new primitive MUST touch or nearly touch at least one existing primitive. No floating parts!
Place new parts so they connect to what already exists.

NO-OVERLAP RULE — CRITICAL:
Each existing primitive below has "edges" showing its bounding box after rotation.
Your new primitive's bounding box must NOT overlap with ANY existing primitive on ALL THREE axes simultaneously.
Primitives MAY touch (share an edge). They must NOT penetrate.

CURRENT STATE:
- Goal: ${context.plan.goal}
- Step ${context.currentStep + 1} of ${context.plan.estimatedSteps}: "${stepDesc}"
- Existing primitives with edge coordinates: ${existingStr}
${correction}
OUTPUT RULES:
- id: short kebab-case name
- type: "cube", "sphere", or "cylinder"
- position: [x, y, z] as numbers
- For cube: "size": [w, h, d] (all > 0)
- For sphere: "radius": R (> 0)
- For cylinder: "radiusTop": R1, "radiusBottom": R2, "height": H (all > 0)
- rotation: [rx, ry, rz] in degrees. Use [0,0,0] when upright, or angles for diagonal/horizontal orientation.
- color: hex color fitting the object
- tags: descriptive labels
- VERIFY before responding: calculate your primitive's bounding box edges (accounting for rotation!) and check they don't penetrate existing primitives AND that your primitive touches at least one existing primitive.

RESPONSE FORMAT (pick ONE action per step):

For ADD:
{"stepNumber": ${context.currentStep + 1}, "action": "add", "reasoning": "...", "primitive": {"id": "name", "type": "cube|sphere|cylinder", "position": [x,y,z], ...type-fields, "rotation": [rx,ry,rz], "color": "#hex", "tags": ["..."]}}

For REMOVE:
{"stepNumber": ${context.currentStep + 1}, "action": "remove", "targetId": "existing-id", "reasoning": "why remove"}

For MODIFY (move/scale/rotate/recolor):
{"stepNumber": ${context.currentStep + 1}, "action": "modify", "targetId": "existing-id", "changes": {"position": [x,y,z], "size": [w,h,d]}, "reasoning": "why modify"}

For CLONE (duplicate, optionally mirror):
{"stepNumber": ${context.currentStep + 1}, "action": "clone", "targetId": "source-id", "primitive": {"id": "new-id"}, "mirror": "x|y|z or null", "reasoning": "why clone"}

Respond with ONLY valid JSON, no markdown, no code blocks.`;
}

export function buildCriticSystemPrompt(scene: Scene, plan: GenerationPlan, stepNumber: number): string {
  // Give the critic the same edge information the builder sees
  const primitives = scene.primitives.map((p) => {
    const bb = getBBox(p);
    return {
      id: p.id,
      type: p.type,
      position: p.position,
      rotation: p.rotation,
      edges: {
        x: [+bb.min[0].toFixed(2), +bb.max[0].toFixed(2)],
        y: [+bb.min[1].toFixed(2), +bb.max[1].toFixed(2)],
        z: [+bb.min[2].toFixed(2), +bb.max[2].toFixed(2)],
      },
      tags: p.tags,
    };
  });

  return `You are a strict 3D build critic. Evaluate the current scene using the EDGE COORDINATES below. Do NOT just trust the tags/names — verify spatial relationships.

Goal: ${plan.goal}
Step ${stepNumber} of ${plan.estimatedSteps} completed.

Primitives with bounding boxes (edges show occupied space on each axis):
${JSON.stringify(primitives, null, 1)}

CHECK THESE ISSUES — reject (approved: false) if any are true:
1. FLOATING PARTS: Is any primitive disconnected from all others? (edges don't touch or nearly touch on at least 2 axes)
2. WRONG ORIENTATION: Are elongated parts (cylinders for fuselage, tubes) oriented correctly? A horizontal fuselage should span along X or Z, NOT Y.
3. PROPORTIONS: Do the sizes make sense for the goal? (e.g., wings should be wider than the fuselage)
4. SPATIAL LAYOUT: Does the overall arrangement match what "${plan.goal}" should look like? Analyze the actual edge coordinates, not just the names.

Set isComplete to true ONLY when all planned steps are done (step ${plan.estimatedSteps} of ${plan.estimatedSteps}).

Respond with ONLY valid JSON, no markdown, no code blocks:
{"approved": true/false, "feedback": "specific spatial feedback referencing edge coordinates", "isComplete": ${stepNumber >= plan.estimatedSteps}}`;
}
