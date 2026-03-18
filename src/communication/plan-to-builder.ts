// Communication: PlanObject → Builder-Input
// Konvertiert das strukturierte PlanObject in konkrete BuilderTasks

import type {
  PlanObject, PlanBuilder, PlanArea,
  BuilderTask, WorkRegion, GlobalStyleDirectives,
  ScenePartition, RegionAssignment, AssemblyConfig, AABB,
} from "../core/types.js";

// ─── PlanObject → ScenePartition (für bestehende Pipeline) ──

export function planObjectToPartition(plan: PlanObject): ScenePartition {
  const regions: WorkRegion[] = [];
  const assignments: RegionAssignment[] = [];

  for (const builder of plan.builders) {
    const area = plan.areas.find((a) => a.id === builder.area_id);
    const bounds: AABB = area
      ? { min: area.area_bounds[0], max: area.area_bounds[1] }
      : { min: [-15, -15, -15], max: [15, 15, 15] };

    regions.push({
      id: builder.name,
      label: area?.label ?? builder.name,
      bounds,
      maxPrimitives: builder.max_primitives,
      allowedTypes: ["cube", "sphere", "cylinder"],
    });

    assignments.push({
      regionId: builder.name,
      localGoal: builder.description,
      priority: plan.assembly_rules.find((r) => r.partId === builder.name)?.priority ?? 1,
    });
  }

  const styleDirectives: GlobalStyleDirectives = {
    goal: plan.goal,
    colorPalette: plan.color_palette,
    styleTags: plan.style_tags,
    maxPrimitivesTotal: plan.cost_targets.max_primitives_total,
    constraints: [
      plan.global_rules.no_collision ? "No collisions between primitives" : "",
      plan.global_rules.no_gap ? "No floating parts (all must connect)" : "",
      `Smoothness target: ${plan.global_rules.smooth}`,
    ].filter(Boolean),
  };

  let assemblyConfig: AssemblyConfig | undefined;
  if (plan.assembly_rules.length > 0) {
    const sorted = [...plan.assembly_rules].sort((a, b) => a.priority - b.priority);
    assemblyConfig = {
      rootPartId: sorted[0].partId,
      rules: plan.assembly_rules,
      groundPlane: 0,
    };
  }

  return { regions, assignments, styleDirectives, assemblyConfig };
}

// ─── Erweiterten Builder-Prompt erstellen ────────────────────

export function buildEnhancedBuilderPrompt(
  builder: PlanBuilder,
  area: PlanArea,
  plan: PlanObject,
): string {
  const rulesStr = [
    area.rules.no_collision ? "- NO overlapping primitives within your part" : "",
    area.rules.no_gap ? "- Every primitive must touch or nearly touch another (no floating parts)" : "",
    `- Target smoothness: ${area.rules.smooth} (0=rough, 1=perfectly smooth)`,
    `- Quality target: max ${area.quality_targets.errors_max} errors, max ${area.quality_targets.warnings_max} warnings`,
  ].filter(Boolean).join("\n");

  const subCompsStr = area.sub_components.length > 0
    ? `\nSUB-COMPONENTS to build: ${area.sub_components.join(", ")}\nTag each primitive with its sub-component name (e.g., tags: ["tire", "part:wheels"])`
    : "";

  return `You are a part builder. You build ONE PART of a larger object in LOCAL coordinate space.

YOUR PART: "${area.label}"
BUILD GOAL: ${builder.description}

COORDINATE SYSTEM:
- Build centered around origin [0, 0, 0].
- x = left/right, y = up (height), z = forward/back
- y=0 is the center height. The Combiner handles final ground placement.

PRIMITIVE TYPES:
- cube: {"type": "cube", "size": [width, height, depth]}
- sphere: {"type": "sphere", "radius": R}
- cylinder: {"type": "cylinder", "radiusTop": R1, "radiusBottom": R2, "height": H}
  Cylinders are VERTICAL by default. For horizontal: rotation [90, 0, 0] (along Z) or [0, 0, 90] (along X)

TARGET METRICS:
- Density: ${builder.target_density} (0=sparse, 1=dense)
- Detail level: ${builder.detail_level}/10
- Max primitives: ${builder.max_primitives}

RULES:
${rulesStr}
${subCompsStr}

GLOBAL CONTEXT: Part of "${plan.goal}"
Color palette: ${builder.color_palette.length > 0 ? builder.color_palette.join(", ") : plan.color_palette.join(", ")}${plan.style_tags.length > 0 ? `\nStyle: ${plan.style_tags.join(", ")}` : ""}

Respond with ONLY valid JSON:
{"reasoning": "what you built and why", "primitives": [{"id": "...", "type": "cube|sphere|cylinder", "position": [x,y,z], ...type-specific fields, "rotation": [rx,ry,rz], "color": "#hex", "tags": ["sub-component-name", "part:${builder.name}"]}]}`;
}
