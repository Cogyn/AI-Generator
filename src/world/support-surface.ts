// ─── Support Surface Manager ────────────────────────────────
// Support surfaces are physical planes that carry objects.
// They are NOT regions (which are logical containers).

import type {
  WorldState,
  SupportSurface,
  CreateSupportSurfaceOpts,
  WorldObject,
} from "./types";

function generateSurfaceId(): string {
  return `surf_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function createSupportSurface(opts: CreateSupportSurfaceOpts): SupportSurface {
  return {
    surface_id: opts.surface_id ?? generateSurfaceId(),
    name: opts.name,
    type: opts.type,
    surface_y: opts.surface_y,
    bounds: opts.bounds,
    owner_object_id: opts.owner_object_id ?? null,
    region_id: opts.region_id,
  };
}

export function getSupportSurface(
  state: WorldState,
  surfaceId: string,
): SupportSurface | undefined {
  return state.support_surfaces.get(surfaceId);
}

export function listSupportSurfaces(state: WorldState): SupportSurface[] {
  return [...state.support_surfaces.values()];
}

export function getSurfacesInRegion(
  state: WorldState,
  regionId: string,
): SupportSurface[] {
  return [...state.support_surfaces.values()].filter(
    (s) => s.region_id === regionId,
  );
}

export function getSurfaceForObject(
  state: WorldState,
  objectId: string,
): SupportSurface | undefined {
  const obj = state.objects.get(objectId);
  if (!obj || !obj.supported_by) return undefined;
  return state.support_surfaces.get(obj.supported_by);
}

export function getObjectsOnSurface(
  state: WorldState,
  surfaceId: string,
): WorldObject[] {
  return [...state.objects.values()].filter(
    (o) => o.supported_by === surfaceId,
  );
}

// Check if an object's bottom touches its support surface
export function isObjectGrounded(
  state: WorldState,
  objectId: string,
  tolerance = 0.05,
): boolean {
  const obj = state.objects.get(objectId);
  if (!obj) return false;
  if (!obj.supported_by) return false;

  const surface = state.support_surfaces.get(obj.supported_by);
  if (!surface) return false;

  const bottomY = obj.transform.position[1] - obj.transform.scale[1] / 2;
  return Math.abs(bottomY - surface.surface_y) <= tolerance;
}

// Check if object is within the XZ bounds of its support surface
export function isObjectWithinSurfaceBounds(
  state: WorldState,
  objectId: string,
): boolean {
  const obj = state.objects.get(objectId);
  if (!obj || !obj.supported_by) return false;

  const surface = state.support_surfaces.get(obj.supported_by);
  if (!surface) return false;

  const pos = obj.transform.position;
  const halfW = obj.transform.scale[0] / 2;
  const halfD = obj.transform.scale[2] / 2;

  return (
    pos[0] - halfW >= surface.bounds.min[0] - 0.01 &&
    pos[0] + halfW <= surface.bounds.max[0] + 0.01 &&
    pos[2] - halfD >= surface.bounds.min[2] - 0.01 &&
    pos[2] + halfD <= surface.bounds.max[2] + 0.01
  );
}

// Snap an object's Y position so its bottom touches its support surface
export function snapToSurface(
  state: WorldState,
  objectId: string,
): WorldState {
  const obj = state.objects.get(objectId);
  if (!obj || !obj.supported_by) return state;

  const surface = state.support_surfaces.get(obj.supported_by);
  if (!surface) return state;

  const halfH = obj.transform.scale[1] / 2;
  const targetY = surface.surface_y + halfH;

  if (Math.abs(obj.transform.position[1] - targetY) < 0.001) return state;

  const objects = new Map(state.objects);
  objects.set(objectId, {
    ...obj,
    transform: {
      ...obj.transform,
      position: [obj.transform.position[0], targetY, obj.transform.position[2]],
    },
  });
  return { ...state, objects };
}
