// ─── Object Registry ────────────────────────────────────────

import type {
  WorldState,
  WorldObject,
  ObjectRelation,
  ObjectTransform,
  CreateObjectOpts,
  PlacementRules,
  ProportionConstraints,
  OrientationRules,
} from "./types";

function generateObjectId(): string {
  return `obj_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

const DEFAULT_PROPORTION: ProportionConstraints = {
  max_area_ratio: 1,
  preferred_width_ratio: [0, 1],
  preferred_depth_ratio: [0, 1],
  preferred_height_range: [0, 10],
};

const DEFAULT_ORIENTATION: OrientationRules = {
  primary_axis: "z",
  front_direction: [0, 0, 1],
  snap_rotation_deg: 0,
  allowed_y_rotations: null,
};

const DEFAULT_PLACEMENT_RULES: PlacementRules = {
  must_touch_anchor_plane: true,
  upright_only: true,
  no_floating: true,
  keep_within_bounds: null,
  no_overlap_with: [],
  near_object: null,
  preferred_zone: "anywhere",
  avoid_center: false,
  proportion: DEFAULT_PROPORTION,
  orientation: DEFAULT_ORIENTATION,
};

export function createObject(opts: CreateObjectOpts): WorldObject {
  return {
    id: opts.id ?? generateObjectId(),
    name: opts.name,
    type: opts.type,
    category: opts.category ?? "default",
    subtype: opts.subtype ?? "",
    region_id: opts.region_id,
    parent_id: opts.parent_id ?? null,
    anchor_id: opts.anchor_id ?? null,
    supported_by: opts.supported_by ?? null,
    editable: opts.editable ?? true,
    locked: opts.locked ?? false,
    ai_allowed: opts.ai_allowed ?? true,
    manual_override: opts.manual_override ?? false,
    generated_by: opts.generated_by ?? "user",
    asset_ref: opts.asset_ref ?? null,
    transform: {
      position: opts.transform?.position ?? [0, 0, 0],
      rotation: opts.transform?.rotation ?? [0, 0, 0],
      scale: opts.transform?.scale ?? [1, 1, 1],
    },
    tags: opts.tags ?? [],
    constraints: opts.constraints ?? [],
    placement_rules: {
      ...DEFAULT_PLACEMENT_RULES,
      ...opts.placement_rules,
    },
    state: {
      active: opts.state?.active ?? true,
      hidden: opts.state?.hidden ?? false,
      selected: opts.state?.selected ?? false,
      dirty: opts.state?.dirty ?? false,
    },
  };
}

export function getObject(state: WorldState, objectId: string): WorldObject | undefined {
  return state.objects.get(objectId);
}

export function listObjects(state: WorldState): WorldObject[] {
  return [...state.objects.values()];
}

export function filterByRegion(state: WorldState, regionId: string): WorldObject[] {
  return [...state.objects.values()].filter((o) => o.region_id === regionId);
}

export function filterByType(state: WorldState, type: string): WorldObject[] {
  return [...state.objects.values()].filter((o) => o.type === type);
}

export function filterByCategory(state: WorldState, category: string): WorldObject[] {
  return [...state.objects.values()].filter((o) => o.category === category);
}

export function getRelationsFor(state: WorldState, objectId: string): ObjectRelation[] {
  return state.relations.filter(
    (r) => r.source_id === objectId || r.target_id === objectId
  );
}

export function setObjectLock(
  state: WorldState,
  objectId: string,
  locked: boolean
): WorldState {
  const obj = state.objects.get(objectId);
  if (!obj) return state;
  const objects = new Map(state.objects);
  objects.set(objectId, { ...obj, locked });
  return { ...state, objects };
}

export function setObjectEditable(
  state: WorldState,
  objectId: string,
  editable: boolean
): WorldState {
  const obj = state.objects.get(objectId);
  if (!obj) return state;
  const objects = new Map(state.objects);
  objects.set(objectId, { ...obj, editable });
  return { ...state, objects };
}

export function setObjectAiAllowed(
  state: WorldState,
  objectId: string,
  allowed: boolean
): WorldState {
  const obj = state.objects.get(objectId);
  if (!obj) return state;
  const objects = new Map(state.objects);
  objects.set(objectId, { ...obj, ai_allowed: allowed });
  return { ...state, objects };
}

export function updateObjectTransform(
  state: WorldState,
  objectId: string,
  transform: Partial<ObjectTransform>
): WorldState {
  const obj = state.objects.get(objectId);
  if (!obj) return state;
  const objects = new Map(state.objects);
  objects.set(objectId, {
    ...obj,
    transform: {
      ...obj.transform,
      ...transform,
    },
  });
  return { ...state, objects };
}
