// ─── JSON Import/Export + Validation ────────────────────────

import type {
  WorldState,
  SerializedWorldState,
  Region,
  WorldObject,
  SupportSurface,
  ObjectRelation,
  RelationType,
} from "./types";

const VALID_RELATION_TYPES: RelationType[] = [
  "on_top_of", "under", "inside", "attached_to", "near", "connected_to", "supported_by",
];

// ─── Export ─────────────────────────────────────────────────

export function exportWorldState(state: WorldState): string {
  const serialized: SerializedWorldState = {
    world_id: state.world_id,
    version: state.version,
    metadata: state.metadata,
    global_settings: state.global_settings,
    regions: Object.fromEntries(state.regions),
    objects: Object.fromEntries(state.objects),
    support_surfaces: Object.fromEntries(state.support_surfaces),
    relations: state.relations,
    generation_history: state.generation_history,
    user_edit_history: state.user_edit_history,
  };
  return JSON.stringify(serialized, null, 2);
}

// ─── Import ─────────────────────────────────────────────────

export function importWorldState(json: string): { state: WorldState | null; errors: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { state: null, errors: ["Invalid JSON: failed to parse"] };
  }

  const errors = validateSerializedWorldState(data);
  if (errors.length > 0) {
    return { state: null, errors };
  }

  const raw = data as SerializedWorldState;

  const state: WorldState = {
    world_id: raw.world_id,
    version: raw.version,
    metadata: raw.metadata,
    global_settings: raw.global_settings,
    regions: new Map(Object.entries(raw.regions)),
    objects: new Map(Object.entries(raw.objects)),
    support_surfaces: new Map(Object.entries(raw.support_surfaces ?? {})),
    relations: raw.relations,
    generation_history: raw.generation_history,
    user_edit_history: raw.user_edit_history,
  };

  return { state, errors: [] };
}

// ─── Validation ─────────────────────────────────────────────

export function validateSerializedWorldState(data: unknown): string[] {
  const errors: string[] = [];

  if (typeof data !== "object" || data === null) {
    errors.push("Root must be an object");
    return errors;
  }

  const d = data as Record<string, unknown>;

  if (typeof d.world_id !== "string") errors.push("Missing or invalid 'world_id'");
  if (typeof d.version !== "string") errors.push("Missing or invalid 'version'");

  if (typeof d.metadata !== "object" || d.metadata === null) {
    errors.push("Missing or invalid 'metadata'");
  } else {
    const m = d.metadata as Record<string, unknown>;
    if (typeof m.name !== "string") errors.push("metadata.name must be a string");
    if (typeof m.created_at !== "string") errors.push("metadata.created_at must be a string");
    if (typeof m.updated_at !== "string") errors.push("metadata.updated_at must be a string");
  }

  if (typeof d.global_settings !== "object" || d.global_settings === null) {
    errors.push("Missing or invalid 'global_settings'");
  } else {
    const gs = d.global_settings as Record<string, unknown>;
    if (typeof gs.default_editable !== "boolean") errors.push("global_settings.default_editable must be boolean");
    if (typeof gs.default_ai_allowed !== "boolean") errors.push("global_settings.default_ai_allowed must be boolean");
    if (typeof gs.grid_size !== "number") errors.push("global_settings.grid_size must be a number");
  }

  if (typeof d.regions !== "object" || d.regions === null) {
    errors.push("Missing or invalid 'regions'");
  }
  if (typeof d.objects !== "object" || d.objects === null) {
    errors.push("Missing or invalid 'objects'");
  }
  if (!Array.isArray(d.relations)) {
    errors.push("Missing or invalid 'relations'");
  }
  if (!Array.isArray(d.generation_history)) errors.push("Missing 'generation_history' array");
  if (!Array.isArray(d.user_edit_history)) errors.push("Missing 'user_edit_history' array");

  if (errors.length > 0) return errors;

  const regions = d.regions as Record<string, Region>;
  const objects = d.objects as Record<string, WorldObject>;
  const relations = d.relations as ObjectRelation[];
  const regionIds = new Set(Object.keys(regions));
  const objectIds = new Set(Object.keys(objects));

  // support_surfaces is optional for backward compat
  const supportSurfaces = (d.support_surfaces ?? {}) as Record<string, SupportSurface>;
  const surfaceIds = new Set(Object.keys(supportSurfaces));

  for (const [id, region] of Object.entries(regions)) {
    if (region.region_id !== id) {
      errors.push(`Region key '${id}' does not match region_id '${region.region_id}'`);
    }
    if (!region.bounds || !Array.isArray(region.bounds.min) || !Array.isArray(region.bounds.max)) {
      errors.push(`Region '${id}' has invalid bounds`);
    }
    if (region.parent_region_id !== null && !regionIds.has(region.parent_region_id)) {
      errors.push(`Region '${id}' references non-existent parent '${region.parent_region_id}'`);
    }
  }

  for (const [id, obj] of Object.entries(objects)) {
    if (obj.id !== id) {
      errors.push(`Object key '${id}' does not match object id '${obj.id}'`);
    }
    if (!regionIds.has(obj.region_id)) {
      errors.push(`Object '${id}' references non-existent region '${obj.region_id}'`);
    }
    if (obj.parent_id !== null && !objectIds.has(obj.parent_id)) {
      errors.push(`Object '${id}' references non-existent parent '${obj.parent_id}'`);
    }
    if (obj.supported_by !== null && obj.supported_by !== undefined && !surfaceIds.has(obj.supported_by)) {
      errors.push(`Object '${id}' references non-existent support surface '${obj.supported_by}'`);
    }
  }

  for (const rel of relations) {
    // Relations can reference objects or support surfaces
    if (!objectIds.has(rel.source_id) && !surfaceIds.has(rel.source_id)) {
      errors.push(`Relation source '${rel.source_id}' does not exist`);
    }
    if (!objectIds.has(rel.target_id) && !surfaceIds.has(rel.target_id)) {
      errors.push(`Relation target '${rel.target_id}' does not exist`);
    }
    if (!VALID_RELATION_TYPES.includes(rel.type)) {
      errors.push(`Invalid relation type '${rel.type}'`);
    }
  }

  return errors;
}
