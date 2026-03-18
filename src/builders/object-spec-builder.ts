// ─── Object Spec Builder: KI erzeugt ObjectConstraintSpecs aus Plan ─────────
// Die KI beschreibt Absicht, Regeln und Relationen – Code berechnet Koordinaten.

import type { Vec3, PlanObject } from "../core/types.js";
import type { ObjectConstraintSpec, PrimitiveIntent } from "../constraints/object-constraint-spec.js";
import type { AnchorRelation, PlacementZone, RepairStrategy } from "../constraints/constraint-types.js";
import { callLLMTracked } from "../ai/client.js";

// ─── Hauptfunktion: PlanObject → ObjectConstraintSpecs ──────

export async function generateObjectSpecs(
  planObject: PlanObject,
  log: (msg: string, level?: "info" | "success" | "warn" | "error") => void = console.log,
): Promise<{ anchorSpecs: ObjectConstraintSpec[]; objectSpecs: ObjectConstraintSpec[] }> {
  const anchorSpecs: ObjectConstraintSpec[] = [];
  const objectSpecs: ObjectConstraintSpec[] = [];

  // 1. Anker-Objekte identifizieren (aus assembly_rules oder erstem Builder)
  const anchorBuilders = planObject.builders.filter((b) =>
    b.description.toLowerCase().includes("anker") ||
    b.description.toLowerCase().includes("anchor") ||
    b.name.toLowerCase().includes("tisch") ||
    b.name.toLowerCase().includes("desk") ||
    b.name.toLowerCase().includes("table") ||
    b.name.toLowerCase().includes("boden") ||
    b.name.toLowerCase().includes("floor") ||
    b.name.toLowerCase().includes("ground"),
  );

  // Wenn kein expliziter Anker, nehme den ersten Builder
  if (anchorBuilders.length === 0 && planObject.builders.length > 0) {
    anchorBuilders.push(planObject.builders[0]);
  }

  const anchorIds = new Set(anchorBuilders.map((b) => b.name));
  const nonAnchorBuilders = planObject.builders.filter((b) => !anchorIds.has(b.name));

  // 2. KI generiert Specs für alle Objekte in einem Batch-Call
  log("ObjectSpecBuilder: Generiere Constraint-Specs via KI...", "info");

  const allBuilderNames = planObject.builders.map((b) => `${b.name}: ${b.description}`).join("\n");
  const anchorNames = anchorBuilders.map((b) => b.name).join(", ");

  const systemPrompt = buildSpecBuilderSystemPrompt();
  const userMessage = buildSpecBuilderUserMessage(planObject, anchorNames, allBuilderNames);

  try {
    const raw = await callLLMTracked(systemPrompt, userMessage, "object-spec-builder", 4096);
    const parsed = JSON.parse(raw);

    if (parsed.specs && Array.isArray(parsed.specs)) {
      for (const specData of parsed.specs) {
        const spec = parseObjectSpec(specData);
        if (anchorIds.has(spec.object_id) || anchorIds.has(spec.object_type)) {
          anchorSpecs.push(spec);
        } else {
          objectSpecs.push(spec);
        }
      }
      log(`  ${anchorSpecs.length} Anker-Specs + ${objectSpecs.length} Objekt-Specs generiert`, "success");
    } else {
      throw new Error("KI-Antwort enthält kein 'specs'-Array");
    }
  } catch (e) {
    log(`KI Spec-Generierung fehlgeschlagen: ${e}. Verwende Heuristik.`, "warn");

    // Fallback: Heuristische Specs
    for (const builder of anchorBuilders) {
      anchorSpecs.push(createHeuristicAnchorSpec(builder.name, builder.description));
    }
    for (const builder of nonAnchorBuilders) {
      const anchorId = anchorSpecs[0]?.object_id ?? "ground";
      objectSpecs.push(createHeuristicObjectSpec(builder.name, builder.description, anchorId));
    }
    log(`  Heuristik: ${anchorSpecs.length} Anker + ${objectSpecs.length} Objekte`, "info");
  }

  return { anchorSpecs, objectSpecs };
}

// ─── System Prompt für ObjectSpecBuilder ────────────────────

function buildSpecBuilderSystemPrompt(): string {
  return `Du bist ein 3D-Szenen-Architekt. Du erzeugst strukturierte ObjectConstraintSpecs für Objekte.

WICHTIG: Du beschreibst nur REGELN und ABSICHT. Code berechnet Koordinaten.

Für jedes Objekt erzeugst du ein Spec mit:
- object_id, object_type, label
- anchor_target: auf welchem Objekt steht/liegt es
- relation_to_anchor: "on_top_of" | "beside_left" | "beside_right" | "in_front_of" | "behind" | "under" | "attached_to" | "inside_bounds_of" | "supported_by"
- size_rules: preferred_size [w,h,d], max_area_ratio_of_anchor (0-1)
- placement_rules: preferred_zone ("center"|"front_center"|"back_center"|"back_left"|"back_right"|"front_left"|"front_right"|"left_edge"|"right_edge"|"any_edge"|"any_corner"|"anywhere"), min_edge_clearance, keep_within_bounds
- collision_rules: no_overlap, min_spacing
- rotation_rules: upright_only, allowed_y_rotations, align_with_anchor
- semantic_rules: must_be_on_surface, must_be_accessible, gravity_bound
- repair_priority (1=höchste), repair_strategy: "reposition"|"rescale"|"remove"
- primitive_spec: Beschreibung + primitives Array mit {id, type, role, relative_size [0-1], relative_position [-1 to 1], color}

Antworte NUR mit JSON: { "specs": [...] }
Alle Größen in Metern (z.B. Tisch: [1.2, 0.75, 0.6], Laptop: [0.35, 0.02, 0.25]).`;
}

function buildSpecBuilderUserMessage(
  plan: PlanObject,
  anchorNames: string,
  allBuilders: string,
): string {
  return `Szene: "${plan.goal}"
Farben: ${plan.color_palette?.join(", ") ?? "neutral"}

Anker-Objekte (stehen auf dem Boden): ${anchorNames}

Alle Objekte:
${allBuilders}

Erzeuge für JEDES Objekt ein ObjectConstraintSpec. Anker-Objekte haben anchor_target: "ground".
Objekte die AUF einem Anker stehen haben relation_to_anchor: "on_top_of" oder "supported_by".
Achte auf realistische Größen (Meter) und sinnvolle preferred_zone Platzierung.`;
}

// ─── KI-Antwort → ObjectConstraintSpec parsen ───────────────

function parseObjectSpec(data: any): ObjectConstraintSpec {
  return {
    object_id: data.object_id ?? data.id ?? "unknown",
    object_type: data.object_type ?? data.type ?? "object",
    label: data.label ?? data.object_id ?? "Objekt",

    anchor_target: data.anchor_target ?? "ground",
    relation_to_anchor: validateAnchorRelation(data.relation_to_anchor),
    allowed_support_surfaces: data.allowed_support_surfaces ?? [data.anchor_target ?? "ground"],

    size_rules: {
      preferred_size: toVec3(data.size_rules?.preferred_size, [0.3, 0.3, 0.3]),
      min_size: data.size_rules?.min_size ? toVec3(data.size_rules.min_size) : undefined,
      max_size: data.size_rules?.max_size ? toVec3(data.size_rules.max_size) : undefined,
      max_area_ratio_of_anchor: data.size_rules?.max_area_ratio_of_anchor ?? 0.25,
    },

    placement_rules: {
      preferred_zone: validateZone(data.placement_rules?.preferred_zone),
      min_edge_clearance: data.placement_rules?.min_edge_clearance ?? 0.05,
      keep_within_bounds: data.placement_rules?.keep_within_bounds ?? true,
    },

    collision_rules: {
      no_overlap: data.collision_rules?.no_overlap ?? true,
      min_spacing: data.collision_rules?.min_spacing ?? 0.05,
      avoid_ids: data.collision_rules?.avoid_ids,
    },

    rotation_rules: {
      upright_only: data.rotation_rules?.upright_only ?? true,
      allowed_y_rotations: data.rotation_rules?.allowed_y_rotations,
      fixed_rotation: data.rotation_rules?.fixed_rotation
        ? toVec3(data.rotation_rules.fixed_rotation)
        : undefined,
      align_with_anchor: data.rotation_rules?.align_with_anchor ?? false,
    },

    semantic_rules: {
      must_be_on_surface: data.semantic_rules?.must_be_on_surface ?? true,
      must_be_accessible: data.semantic_rules?.must_be_accessible ?? true,
      must_not_block: data.semantic_rules?.must_not_block ?? [],
      gravity_bound: data.semantic_rules?.gravity_bound ?? true,
    },

    repair_priority: data.repair_priority ?? 5,
    repair_strategy: validateRepairStrategy(data.repair_strategy),
    max_reposition_attempts: data.max_reposition_attempts ?? 5,
    allow_rescale: data.allow_rescale ?? true,

    primitive_spec: {
      description: data.primitive_spec?.description ?? data.label ?? "Objekt",
      primitives: parsePrimitiveIntents(data.primitive_spec?.primitives ?? []),
      color_palette: data.primitive_spec?.color_palette ?? ["#888888"],
    },
  };
}

function parsePrimitiveIntents(intents: any[]): PrimitiveIntent[] {
  if (!Array.isArray(intents) || intents.length === 0) {
    // Default: ein einzelner Cube als Body
    return [{
      id: "body",
      type: "cube",
      role: "body",
      relative_size: [1, 1, 1],
      relative_position: [0, 0, 0],
    }];
  }

  return intents.map((i, idx) => ({
    id: i.id ?? `part-${idx}`,
    type: validatePrimType(i.type),
    role: i.role ?? "body",
    relative_size: toVec3(i.relative_size, [1, 1, 1]),
    relative_position: toVec3(i.relative_position, [0, 0, 0]),
    local_rotation: i.local_rotation ? toVec3(i.local_rotation) : undefined,
    color: i.color,
  }));
}

// ─── Heuristische Fallback-Specs ────────────────────────────

function createHeuristicAnchorSpec(name: string, description: string): ObjectConstraintSpec {
  // Erkennung bekannter Anker-Typen
  const lower = description.toLowerCase() + " " + name.toLowerCase();
  let size: Vec3 = [1.2, 0.75, 0.6];
  let prims: PrimitiveIntent[] = [];

  if (lower.includes("tisch") || lower.includes("desk") || lower.includes("table")) {
    size = [1.2, 0.75, 0.6];
    prims = [
      { id: "top", type: "cube", role: "surface", relative_size: [1, 0.05, 1], relative_position: [0, 0.93, 0], color: "#8B6914" },
      { id: "leg-fl", type: "cube", role: "leg", relative_size: [0.06, 0.9, 0.06], relative_position: [-0.85, -0.05, 0.85] },
      { id: "leg-fr", type: "cube", role: "leg", relative_size: [0.06, 0.9, 0.06], relative_position: [0.85, -0.05, 0.85] },
      { id: "leg-bl", type: "cube", role: "leg", relative_size: [0.06, 0.9, 0.06], relative_position: [-0.85, -0.05, -0.85] },
      { id: "leg-br", type: "cube", role: "leg", relative_size: [0.06, 0.9, 0.06], relative_position: [0.85, -0.05, -0.85] },
    ];
  } else if (lower.includes("boden") || lower.includes("floor") || lower.includes("ground")) {
    size = [5, 0.05, 5];
    prims = [{ id: "floor", type: "cube", role: "surface", relative_size: [1, 1, 1], relative_position: [0, 0, 0], color: "#A0A0A0" }];
  }

  if (prims.length === 0) {
    prims = [{ id: "body", type: "cube", role: "body", relative_size: [1, 1, 1], relative_position: [0, 0, 0] }];
  }

  return {
    object_id: name,
    object_type: name,
    label: name,
    anchor_target: "ground",
    relation_to_anchor: "supported_by",
    allowed_support_surfaces: ["ground"],
    size_rules: { preferred_size: size },
    placement_rules: { preferred_zone: "center", min_edge_clearance: 0, keep_within_bounds: false },
    collision_rules: { no_overlap: true, min_spacing: 0.1 },
    rotation_rules: { upright_only: true, align_with_anchor: false },
    semantic_rules: { must_be_on_surface: true, must_be_accessible: true, must_not_block: [], gravity_bound: true },
    repair_priority: 1,
    repair_strategy: "reposition",
    max_reposition_attempts: 3,
    allow_rescale: false,
    primitive_spec: { description: name, primitives: prims, color_palette: ["#8B6914"] },
  };
}

function createHeuristicObjectSpec(
  name: string,
  description: string,
  anchorId: string,
): ObjectConstraintSpec {
  const lower = description.toLowerCase() + " " + name.toLowerCase();
  let size: Vec3 = [0.3, 0.2, 0.3];
  let zone: PlacementZone = "center";
  let maxRatio = 0.2;
  let prims: PrimitiveIntent[] = [];

  if (lower.includes("laptop") || lower.includes("notebook")) {
    size = [0.35, 0.02, 0.25];
    zone = "center";
    maxRatio = 0.18;
    prims = [
      { id: "base", type: "cube", role: "base", relative_size: [1, 0.4, 1], relative_position: [0, -0.3, 0], color: "#333333" },
      { id: "screen", type: "cube", role: "screen", relative_size: [0.95, 0.6, 0.03], relative_position: [0, 0.5, -0.45], color: "#1a1a2e" },
    ];
  } else if (lower.includes("printer") || lower.includes("drucker")) {
    size = [0.4, 0.25, 0.35];
    zone = "back_right";
    maxRatio = 0.15;
    prims = [
      { id: "body", type: "cube", role: "body", relative_size: [1, 0.8, 1], relative_position: [0, -0.1, 0], color: "#F0F0F0" },
      { id: "tray", type: "cube", role: "tray", relative_size: [0.8, 0.05, 0.4], relative_position: [0, 0.4, 0.3], color: "#E0E0E0" },
    ];
  } else if (lower.includes("lamp") || lower.includes("lampe")) {
    size = [0.15, 0.45, 0.15];
    zone = "back_left";
    maxRatio = 0.05;
    prims = [
      { id: "base", type: "cylinder", role: "base", relative_size: [1, 0.1, 1], relative_position: [0, -0.45, 0], color: "#333333" },
      { id: "arm", type: "cylinder", role: "arm", relative_size: [0.15, 0.7, 0.15], relative_position: [0, 0, 0], color: "#555555" },
      { id: "shade", type: "cylinder", role: "shade", relative_size: [0.8, 0.2, 0.8], relative_position: [0, 0.4, 0], color: "#FFD700" },
    ];
  } else if (lower.includes("monitor") || lower.includes("bildschirm") || lower.includes("screen")) {
    size = [0.55, 0.35, 0.05];
    zone = "back_center";
    maxRatio = 0.12;
    prims = [
      { id: "screen", type: "cube", role: "screen", relative_size: [1, 0.85, 0.3], relative_position: [0, 0.1, 0], color: "#1a1a1a" },
      { id: "stand", type: "cube", role: "stand", relative_size: [0.15, 0.15, 0.5], relative_position: [0, -0.42, 0.2], color: "#333333" },
      { id: "foot", type: "cube", role: "foot", relative_size: [0.4, 0.02, 0.6], relative_position: [0, -0.49, 0.15], color: "#333333" },
    ];
  } else if (lower.includes("tastatur") || lower.includes("keyboard")) {
    size = [0.44, 0.03, 0.15];
    zone = "front_center";
    maxRatio = 0.10;
    prims = [
      { id: "body", type: "cube", role: "body", relative_size: [1, 1, 1], relative_position: [0, 0, 0], color: "#2a2a2a" },
    ];
  } else if (lower.includes("maus") || lower.includes("mouse")) {
    size = [0.06, 0.035, 0.1];
    zone = "front_right";
    maxRatio = 0.02;
    prims = [
      { id: "body", type: "cube", role: "body", relative_size: [1, 1, 1], relative_position: [0, 0, 0], color: "#222222" },
    ];
  } else if (lower.includes("tasse") || lower.includes("cup") || lower.includes("mug") || lower.includes("becher")) {
    size = [0.08, 0.1, 0.08];
    zone = "right_edge";
    maxRatio = 0.02;
    prims = [
      { id: "body", type: "cylinder", role: "body", relative_size: [1, 1, 1], relative_position: [0, 0, 0], color: "#FFFFFF" },
    ];
  } else if (lower.includes("filing") || lower.includes("cabinet") || lower.includes("aktenschrank") || lower.includes("schrank")) {
    // Filing cabinet: stands on floor, not on desk anchor
    size = [0.4, 0.7, 0.4];
    zone = "anywhere";
    maxRatio = 0;
    prims = [
      { id: "body", type: "cube", role: "body", relative_size: [1, 1, 1], relative_position: [0, 0, 0], color: "#808080" },
      { id: "drawer1", type: "cube", role: "drawer", relative_size: [0.9, 0.28, 0.95], relative_position: [0, 0.35, 0], color: "#909090" },
      { id: "drawer2", type: "cube", role: "drawer", relative_size: [0.9, 0.28, 0.95], relative_position: [0, -0.05, 0], color: "#909090" },
      { id: "drawer3", type: "cube", role: "drawer", relative_size: [0.9, 0.28, 0.95], relative_position: [0, -0.35, 0], color: "#909090" },
    ];
    // Filing cabinet goes on ground, not on anchor
    return {
      object_id: name,
      object_type: name,
      label: name,
      anchor_target: "ground",
      relation_to_anchor: "supported_by",
      allowed_support_surfaces: ["ground"],
      size_rules: { preferred_size: size },
      placement_rules: { preferred_zone: zone, min_edge_clearance: 0.1, keep_within_bounds: false },
      collision_rules: { no_overlap: true, min_spacing: 0.1, avoid_ids: [anchorId] },
      rotation_rules: { upright_only: true, align_with_anchor: false },
      semantic_rules: { must_be_on_surface: true, must_be_accessible: true, must_not_block: [], gravity_bound: true },
      repair_priority: 4,
      repair_strategy: "reposition",
      max_reposition_attempts: 5,
      allow_rescale: false,
      primitive_spec: { description: "Filing cabinet with drawers", primitives: prims, color_palette: ["#808080", "#909090"] },
    };
  }

  if (prims.length === 0) {
    prims = [{ id: "body", type: "cube", role: "body", relative_size: [1, 1, 1], relative_position: [0, 0, 0] }];
  }

  return {
    object_id: name,
    object_type: name,
    label: name,
    anchor_target: anchorId,
    relation_to_anchor: "on_top_of",
    allowed_support_surfaces: [anchorId],
    size_rules: { preferred_size: size, max_area_ratio_of_anchor: maxRatio },
    placement_rules: { preferred_zone: zone, min_edge_clearance: 0.05, keep_within_bounds: true },
    collision_rules: { no_overlap: true, min_spacing: 0.05 },
    rotation_rules: { upright_only: true, align_with_anchor: true },
    semantic_rules: { must_be_on_surface: true, must_be_accessible: true, must_not_block: [], gravity_bound: true },
    repair_priority: 5,
    repair_strategy: "reposition",
    max_reposition_attempts: 5,
    allow_rescale: true,
    primitive_spec: { description: name, primitives: prims, color_palette: ["#888888"] },
  };
}

// ─── Validierungs-Helfer ────────────────────────────────────

const VALID_ANCHOR_RELATIONS: AnchorRelation[] = [
  "on_top_of", "under", "beside_left", "beside_right",
  "in_front_of", "behind", "attached_to", "inside_bounds_of", "supported_by",
];

function validateAnchorRelation(val: any): AnchorRelation {
  if (typeof val === "string" && VALID_ANCHOR_RELATIONS.includes(val as AnchorRelation)) {
    return val as AnchorRelation;
  }
  return "on_top_of";
}

const VALID_ZONES: PlacementZone[] = [
  "center", "front_center", "back_center", "back_left", "back_right",
  "front_left", "front_right", "left_edge", "right_edge",
  "any_edge", "any_corner", "anywhere",
];

function validateZone(val: any): PlacementZone {
  if (typeof val === "string" && VALID_ZONES.includes(val as PlacementZone)) {
    return val as PlacementZone;
  }
  return "center";
}

function validateRepairStrategy(val: any): RepairStrategy {
  const valid: RepairStrategy[] = ["reposition", "rescale", "rotate_fix", "remove", "skip"];
  if (typeof val === "string" && valid.includes(val as RepairStrategy)) {
    return val as RepairStrategy;
  }
  return "reposition";
}

function validatePrimType(val: any): "cube" | "sphere" | "cylinder" {
  if (val === "cube" || val === "sphere" || val === "cylinder") return val;
  return "cube";
}

function toVec3(val: any, fallback: Vec3 = [0, 0, 0]): Vec3 {
  if (Array.isArray(val) && val.length >= 3) {
    return [Number(val[0]) || 0, Number(val[1]) || 0, Number(val[2]) || 0];
  }
  return [...fallback];
}
