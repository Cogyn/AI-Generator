// PlanObject Schema: Strukturierte Planentwicklung mit Regeln, Bounds und Quality-Targets
// Erzeugt und validiert PlanObjects für die Pipeline

import type {
  PlanObject, PlanArea, PlanBuilder, PlanAreaRules, PlanQualityTargets,
  PlanCostTargets, PlanBoundaryConstraints, BoundaryPair, AssemblyRule,
  Vec3,
} from "../core/types.js";

// ─── Defaults ─────────────────────────────────────────────────

export const DEFAULT_AREA_RULES: PlanAreaRules = {
  no_collision: true,
  no_gap: true,
  smooth: 0.5,
};

export const DEFAULT_QUALITY_TARGETS: PlanQualityTargets = {
  errors_max: 0,
  warnings_max: 2,
  min_score: 0.85,
};

export const DEFAULT_COST_TARGETS: PlanCostTargets = {
  max_primitives_total: 40,
  max_primitives_per_area: 10,
  max_llm_calls: 15,
};

export const DEFAULT_BOUNDARY_CONSTRAINTS: PlanBoundaryConstraints = {
  no_cross_region_collision: true,
  max_cross_region_gap: 0.5,
  boundary_pairs: [],
};

// ─── PlanObject erstellen ────────────────────────────────────

export function createPlanObject(params: {
  goal: string;
  user_prompt: string;
  areas: PlanArea[];
  builders: PlanBuilder[];
  assembly_rules: AssemblyRule[];
  style_tags?: string[];
  color_palette?: string[];
  cost_targets?: Partial<PlanCostTargets>;
  boundary_constraints?: Partial<PlanBoundaryConstraints>;
  global_quality_targets?: Partial<PlanQualityTargets>;
}): PlanObject {
  return {
    id: `plan-${Date.now().toString(36)}`,
    goal: params.goal,
    user_prompt: params.user_prompt,
    areas: params.areas,
    builders: params.builders,
    assembly_rules: params.assembly_rules,
    global_rules: DEFAULT_AREA_RULES,
    global_quality_targets: { ...DEFAULT_QUALITY_TARGETS, ...params.global_quality_targets },
    cost_targets: { ...DEFAULT_COST_TARGETS, ...params.cost_targets },
    boundary_constraints: { ...DEFAULT_BOUNDARY_CONSTRAINTS, ...params.boundary_constraints },
    style_tags: params.style_tags ?? [],
    color_palette: params.color_palette ?? [],
  };
}

// ─── PlanArea erstellen ──────────────────────────────────────

export function createPlanArea(params: {
  id: string;
  label: string;
  area_bounds?: [Vec3, Vec3];
  target_density?: number;
  detail_level?: number;
  rules?: Partial<PlanAreaRules>;
  quality_targets?: Partial<PlanQualityTargets>;
  sub_components?: string[];
}): PlanArea {
  return {
    id: params.id,
    label: params.label,
    area_bounds: params.area_bounds ?? [[-15, -15, -15], [15, 15, 15]],
    target_density: params.target_density ?? 0.5,
    detail_level: params.detail_level ?? 5,
    rules: { ...DEFAULT_AREA_RULES, ...params.rules },
    quality_targets: { ...DEFAULT_QUALITY_TARGETS, ...params.quality_targets },
    sub_components: params.sub_components ?? [],
  };
}

// ─── PlanBuilder erstellen ───────────────────────────────────

export function createPlanBuilder(params: {
  name: string;
  area_id: string;
  description: string;
  target_density?: number;
  detail_level?: number;
  max_primitives?: number;
  color_palette?: string[];
}): PlanBuilder {
  return {
    name: params.name,
    area_id: params.area_id,
    target_density: params.target_density ?? 0.5,
    detail_level: params.detail_level ?? 5,
    max_primitives: params.max_primitives ?? 10,
    description: params.description,
    color_palette: params.color_palette ?? [],
  };
}

// ─── Validierung ─────────────────────────────────────────────

export interface PlanValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validatePlanObject(plan: PlanObject): PlanValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!plan.goal) errors.push("Plan hat kein Ziel");
  if (plan.areas.length === 0) errors.push("Plan hat keine Areas");
  if (plan.builders.length === 0) errors.push("Plan hat keine Builders");

  // Prüfe ob jeder Builder eine gültige Area-Referenz hat
  for (const b of plan.builders) {
    if (!plan.areas.find((a) => a.id === b.area_id)) {
      errors.push(`Builder "${b.name}" referenziert unbekannte Area "${b.area_id}"`);
    }
  }

  // Prüfe ob Assembly-Rules auf gültige Builder zeigen
  for (const r of plan.assembly_rules) {
    if (r.parentPartId !== "ground" && !plan.builders.find((b) => b.name === r.parentPartId)) {
      warnings.push(`Assembly-Rule: parentPartId "${r.parentPartId}" unbekannt`);
    }
  }

  // Prüfe Cost-Targets
  const totalMax = plan.builders.reduce((s, b) => s + b.max_primitives, 0);
  if (totalMax > plan.cost_targets.max_primitives_total) {
    warnings.push(`Builder-Summe (${totalMax}) übersteigt max_primitives_total (${plan.cost_targets.max_primitives_total})`);
  }

  // Prüfe Boundary-Pairs
  for (const bp of plan.boundary_constraints.boundary_pairs) {
    if (!plan.areas.find((a) => a.id === bp.region_a)) {
      warnings.push(`BoundaryPair: region_a "${bp.region_a}" unbekannt`);
    }
    if (!plan.areas.find((a) => a.id === bp.region_b)) {
      warnings.push(`BoundaryPair: region_b "${bp.region_b}" unbekannt`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── PlanObject → kompaktes JSON für LLM-Prompts ────────────

export function planToCompactJSON(plan: PlanObject): string {
  return JSON.stringify({
    goal: plan.goal,
    areas: plan.areas.map((a) => ({
      id: a.id,
      label: a.label,
      density: a.target_density,
      detail: a.detail_level,
      sub_components: a.sub_components,
    })),
    builders: plan.builders.map((b) => ({
      name: b.name,
      area: b.area_id,
      max_prims: b.max_primitives,
      desc: b.description,
    })),
    quality: plan.global_quality_targets,
    rules: plan.global_rules,
    cost: plan.cost_targets,
  });
}
