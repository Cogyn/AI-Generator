// ─── Region Manager ─────────────────────────────────────────

import type {
  WorldState,
  Region,
  WorldObject,
  CreateRegionOpts,
} from "./types";

function generateRegionId(): string {
  return `reg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function createRegion(opts: CreateRegionOpts): Region {
  return {
    region_id: opts.region_id ?? generateRegionId(),
    name: opts.name,
    type: opts.type,
    bounds: opts.bounds,
    parent_region_id: opts.parent_region_id ?? null,
    child_region_ids: [],
    editable: opts.editable ?? true,
    locked: opts.locked ?? false,
    ai_allowed: opts.ai_allowed ?? true,
    tags: opts.tags ?? [],
    object_ids: [],
    metadata: opts.metadata ?? {},
  };
}

export function getRegion(state: WorldState, regionId: string): Region | undefined {
  return state.regions.get(regionId);
}

export function listRegions(state: WorldState): Region[] {
  return [...state.regions.values()];
}

export function getChildRegions(state: WorldState, regionId: string): Region[] {
  return [...state.regions.values()].filter(
    (r) => r.parent_region_id === regionId
  );
}

export function getObjectsInRegion(state: WorldState, regionId: string): WorldObject[] {
  return [...state.objects.values()].filter(
    (o) => o.region_id === regionId
  );
}

export function setRegionLock(
  state: WorldState,
  regionId: string,
  locked: boolean
): WorldState {
  const region = state.regions.get(regionId);
  if (!region) return state;
  const regions = new Map(state.regions);
  regions.set(regionId, { ...region, locked });
  return { ...state, regions };
}

export function setRegionEditable(
  state: WorldState,
  regionId: string,
  editable: boolean
): WorldState {
  const region = state.regions.get(regionId);
  if (!region) return state;
  const regions = new Map(state.regions);
  regions.set(regionId, { ...region, editable });
  return { ...state, regions };
}

export function setRegionAiAllowed(
  state: WorldState,
  regionId: string,
  allowed: boolean
): WorldState {
  const region = state.regions.get(regionId);
  if (!region) return state;
  const regions = new Map(state.regions);
  regions.set(regionId, { ...region, ai_allowed: allowed });
  return { ...state, regions };
}
