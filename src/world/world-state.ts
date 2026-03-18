// ─── WorldState Manager ─────────────────────────────────────
// Immutable-Update-Pattern: Funktionen geben neuen State zurueck

import type {
  WorldState,
  WorldMetadata,
  Region,
  WorldObject,
  ObjectRelation,
  RelationType,
  LockStateSummary,
  SupportSurface,
} from "./types";

// Modul-Level Variable fuer aktuelle Welt
let currentWorldState: WorldState | null = null;

function generateId(): string {
  return `w_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function createWorldState(name: string): WorldState {
  const now = new Date().toISOString();
  const state: WorldState = {
    world_id: generateId(),
    version: "1.0.0",
    metadata: {
      name,
      description: "",
      created_at: now,
      updated_at: now,
      author: "",
    },
    global_settings: {
      default_editable: true,
      default_ai_allowed: true,
      grid_size: 1,
    },
    regions: new Map(),
    objects: new Map(),
    support_surfaces: new Map(),
    relations: [],
    generation_history: [],
    user_edit_history: [],
  };
  currentWorldState = state;
  return state;
}

export function getWorldState(): WorldState {
  if (!currentWorldState) {
    throw new Error("No world state initialized. Call createWorldState() first.");
  }
  return currentWorldState;
}

export function setWorldState(state: WorldState): void {
  currentWorldState = state;
}

function touchMetadata(metadata: WorldMetadata): WorldMetadata {
  return { ...metadata, updated_at: new Date().toISOString() };
}

export function addRegion(state: WorldState, region: Region): WorldState {
  const regions = new Map(state.regions);
  regions.set(region.region_id, region);
  return {
    ...state,
    metadata: touchMetadata(state.metadata),
    regions,
  };
}

export function removeRegion(state: WorldState, regionId: string): WorldState {
  const regions = new Map(state.regions);
  regions.delete(regionId);
  const objects = new Map(state.objects);
  for (const [id, obj] of objects) {
    if (obj.region_id === regionId) {
      objects.delete(id);
    }
  }
  const removedObjectIds = new Set(
    [...state.objects.values()]
      .filter((o) => o.region_id === regionId)
      .map((o) => o.id)
  );
  const relations = state.relations.filter(
    (r) => !removedObjectIds.has(r.source_id) && !removedObjectIds.has(r.target_id)
  );
  // Remove support surfaces in this region
  const support_surfaces = new Map(state.support_surfaces);
  for (const [id, s] of support_surfaces) {
    if (s.region_id === regionId) support_surfaces.delete(id);
  }
  return {
    ...state,
    metadata: touchMetadata(state.metadata),
    regions,
    objects,
    relations,
    support_surfaces,
  };
}

export function addObject(state: WorldState, obj: WorldObject): WorldState {
  const objects = new Map(state.objects);
  objects.set(obj.id, obj);
  const regions = new Map(state.regions);
  const region = regions.get(obj.region_id);
  if (region) {
    regions.set(obj.region_id, {
      ...region,
      object_ids: [...region.object_ids, obj.id],
    });
  }
  return {
    ...state,
    metadata: touchMetadata(state.metadata),
    objects,
    regions,
  };
}

export function removeObject(state: WorldState, objectId: string): WorldState {
  const objects = new Map(state.objects);
  const obj = objects.get(objectId);
  objects.delete(objectId);
  const regions = new Map(state.regions);
  if (obj) {
    const region = regions.get(obj.region_id);
    if (region) {
      regions.set(obj.region_id, {
        ...region,
        object_ids: region.object_ids.filter((id) => id !== objectId),
      });
    }
  }
  // Remove support surfaces owned by this object
  const support_surfaces = new Map(state.support_surfaces);
  for (const [id, s] of support_surfaces) {
    if (s.owner_object_id === objectId) support_surfaces.delete(id);
  }
  const relations = state.relations.filter(
    (r) => r.source_id !== objectId && r.target_id !== objectId
  );
  return {
    ...state,
    metadata: touchMetadata(state.metadata),
    objects,
    regions,
    relations,
    support_surfaces,
  };
}

export function addSupportSurface(state: WorldState, surface: SupportSurface): WorldState {
  const support_surfaces = new Map(state.support_surfaces);
  support_surfaces.set(surface.surface_id, surface);
  return {
    ...state,
    metadata: touchMetadata(state.metadata),
    support_surfaces,
  };
}

export function removeSupportSurface(state: WorldState, surfaceId: string): WorldState {
  const support_surfaces = new Map(state.support_surfaces);
  support_surfaces.delete(surfaceId);
  return {
    ...state,
    metadata: touchMetadata(state.metadata),
    support_surfaces,
  };
}

export function addRelation(state: WorldState, relation: ObjectRelation): WorldState {
  return {
    ...state,
    metadata: touchMetadata(state.metadata),
    relations: [...state.relations, relation],
  };
}

export function removeRelation(
  state: WorldState,
  sourceId: string,
  targetId: string,
  type: RelationType
): WorldState {
  return {
    ...state,
    metadata: touchMetadata(state.metadata),
    relations: state.relations.filter(
      (r) => !(r.source_id === sourceId && r.target_id === targetId && r.type === type)
    ),
  };
}

export function getLockStateSummary(state: WorldState): LockStateSummary {
  const regions = [...state.regions.values()];
  const objects = [...state.objects.values()];
  return {
    total_regions: regions.length,
    locked_regions: regions.filter((r) => r.locked).length,
    editable_regions: regions.filter((r) => r.editable).length,
    ai_allowed_regions: regions.filter((r) => r.ai_allowed).length,
    total_objects: objects.length,
    locked_objects: objects.filter((o) => o.locked).length,
    editable_objects: objects.filter((o) => o.editable).length,
    ai_allowed_objects: objects.filter((o) => o.ai_allowed).length,
  };
}
