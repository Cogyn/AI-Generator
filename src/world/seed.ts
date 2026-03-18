// ─── Seed Data ──────────────────────────────────────────────
// Erstellt eine Testwelt mit Regionen, Support Surfaces, Objekten und Relationen.
// Regions = logical containers. Support Surfaces = physical planes. Objects = physical things.

import type { WorldState } from "./types";
import { createWorldState, addRegion, addObject, addRelation, addSupportSurface } from "./world-state";
import { createRegion } from "./region-manager";
import { createObject } from "./object-registry";
import { createSupportSurface } from "./support-surface";

export function createSeedWorld(): WorldState {
  let state = createWorldState("Seed World");
  state = {
    ...state,
    metadata: {
      ...state.metadata,
      description: "A test world with desk and floor regions containing table, laptop, lamp, and filing cabinet",
      author: "system",
    },
  };

  // ─── Regions (LOGICAL containers, NOT physical objects) ────

  const deskRegion = createRegion({
    region_id: "desk_region",
    name: "Desk Area",
    type: "workspace",
    bounds: { min: [-1, 0, -0.5], max: [1, 1.5, 0.5] },
    editable: true,
    locked: false,
    ai_allowed: true,
    tags: ["workspace", "desk"],
  });

  const floorRegion = createRegion({
    region_id: "floor_region",
    name: "Floor Area",
    type: "room",
    bounds: { min: [-3, 0, -3], max: [3, 0.7, 3] },
    editable: true,
    locked: false,
    ai_allowed: true,
    tags: ["floor", "room"],
  });

  state = addRegion(state, deskRegion);
  state = addRegion(state, floorRegion);

  // ─── Support Surfaces (PHYSICAL planes that carry objects) ─

  const floorSurface = createSupportSurface({
    surface_id: "floor_surface",
    name: "Floor Surface",
    type: "ground_plane",
    surface_y: 0,
    bounds: { min: [-3, 0, -3], max: [3, 0, 3] },
    owner_object_id: null,
    region_id: "floor_region",
  });

  state = addSupportSurface(state, floorSurface);

  // ─── Objects (PHYSICAL things) ─────────────────────────────

  // Table: stands on floor, provides tabletop surface
  const table = createObject({
    id: "table",
    name: "Table",
    type: "furniture",
    category: "furniture",
    subtype: "desk",
    region_id: "desk_region",
    supported_by: "floor_surface",
    locked: true,
    editable: false,
    ai_allowed: false,
    generated_by: "seed",
    transform: {
      position: [0, 0.35, 0],   // center Y = half height
      rotation: [0, 0, 0],
      scale: [1.2, 0.7, 0.6],   // realistic desk: 1.2m wide, 0.7m tall, 0.6m deep
    },
    tags: ["static", "surface"],
    placement_rules: {
      must_touch_anchor_plane: true,
      upright_only: true,
      no_floating: true,
      keep_within_bounds: null,
      no_overlap_with: ["filing_cabinet"],
      near_object: null,
      preferred_zone: "center",
      avoid_center: false,
      proportion: {
        max_area_ratio: 0.8,
        preferred_width_ratio: [0.5, 0.8],
        preferred_depth_ratio: [0.3, 0.6],
        preferred_height_range: [0.6, 0.8],
      },
      orientation: {
        primary_axis: "z",
        front_direction: [0, 0, 1],
        snap_rotation_deg: 90,
        allowed_y_rotations: [0, 90, 180, 270],
      },
    },
  });

  state = addObject(state, table);

  // Tabletop surface: created from the table's top face
  const tabletopSurface = createSupportSurface({
    surface_id: "tabletop_surface",
    name: "Tabletop Surface",
    type: "object_surface",
    surface_y: 0.7,              // top of table = position.y + scale.y/2
    bounds: {
      min: [-0.6, 0.7, -0.3],   // half of table width/depth
      max: [0.6, 0.7, 0.3],
    },
    owner_object_id: "table",
    region_id: "desk_region",
  });

  state = addSupportSurface(state, tabletopSurface);

  // Laptop: sits on tabletop
  const laptop = createObject({
    id: "laptop",
    name: "Laptop",
    type: "electronics",
    category: "device",
    subtype: "laptop",
    region_id: "desk_region",
    supported_by: "tabletop_surface",
    editable: true,
    ai_allowed: true,
    generated_by: "seed",
    transform: {
      position: [-0.15, 0.71, 0],  // on tabletop, slightly left of center
      rotation: [0, 0, 0],
      scale: [0.35, 0.02, 0.25],
    },
    tags: ["interactive", "device"],
    placement_rules: {
      must_touch_anchor_plane: true,
      upright_only: true,
      no_floating: true,
      keep_within_bounds: "tabletop_surface",
      no_overlap_with: ["lamp"],
      near_object: null,
      preferred_zone: "center_front",
      avoid_center: false,
      proportion: {
        max_area_ratio: 0.18,
        preferred_width_ratio: [0.25, 0.35],
        preferred_depth_ratio: [0.3, 0.5],
        preferred_height_range: [0.01, 0.04],
      },
      orientation: {
        primary_axis: "z",
        front_direction: [0, 0, 1],
        snap_rotation_deg: 45,
        allowed_y_rotations: null,
      },
    },
  });

  // Lamp: sits on tabletop, at edge/corner
  const lamp = createObject({
    id: "lamp",
    name: "Desk Lamp",
    type: "lighting",
    category: "furniture",
    subtype: "lamp",
    region_id: "desk_region",
    supported_by: "tabletop_surface",
    editable: true,
    ai_allowed: false,
    generated_by: "seed",
    transform: {
      position: [0.45, 0.925, -0.15],  // right side of desk, back
      rotation: [0, 0, 0],
      scale: [0.15, 0.45, 0.15],
    },
    tags: ["lighting"],
    placement_rules: {
      must_touch_anchor_plane: true,
      upright_only: true,
      no_floating: true,
      keep_within_bounds: "tabletop_surface",
      no_overlap_with: ["laptop"],
      near_object: null,
      preferred_zone: "back_right",
      avoid_center: true,
      proportion: {
        max_area_ratio: 0.12,
        preferred_width_ratio: [0.1, 0.2],
        preferred_depth_ratio: [0.1, 0.2],
        preferred_height_range: [0.3, 0.5],
      },
      orientation: {
        primary_axis: "y",
        front_direction: [0, 0, 1],
        snap_rotation_deg: 0,
        allowed_y_rotations: null,
      },
    },
  });

  // Filing cabinet: sits on floor, near table
  const filingCabinet = createObject({
    id: "filing_cabinet",
    name: "Filing Cabinet",
    type: "furniture",
    category: "storage",
    subtype: "cabinet",
    region_id: "floor_region",
    supported_by: "floor_surface",
    editable: true,
    ai_allowed: true,
    generated_by: "seed",
    transform: {
      position: [0.9, 0.35, -0.5],  // beside table, on floor
      rotation: [0, 0, 0],
      scale: [0.4, 0.7, 0.4],
    },
    tags: ["storage"],
    placement_rules: {
      must_touch_anchor_plane: true,
      upright_only: true,
      no_floating: true,
      keep_within_bounds: null,
      no_overlap_with: ["table"],
      near_object: "table",
      preferred_zone: "right_adjacent",
      avoid_center: false,
      proportion: {
        max_area_ratio: 0.15,
        preferred_width_ratio: [0.3, 0.5],
        preferred_depth_ratio: [0.3, 0.5],
        preferred_height_range: [0.5, 0.8],
      },
      orientation: {
        primary_axis: "z",
        front_direction: [0, 0, 1],
        snap_rotation_deg: 90,
        allowed_y_rotations: [0, 90, 180, 270],
      },
    },
  });

  state = addObject(state, laptop);
  state = addObject(state, lamp);
  state = addObject(state, filingCabinet);

  // ─── Relations ──────────────────────────────────────────────

  state = addRelation(state, { source_id: "table", target_id: "floor_surface", type: "supported_by" });
  state = addRelation(state, { source_id: "laptop", target_id: "table", type: "on_top_of" });
  state = addRelation(state, { source_id: "laptop", target_id: "tabletop_surface", type: "supported_by" });
  state = addRelation(state, { source_id: "lamp", target_id: "table", type: "on_top_of" });
  state = addRelation(state, { source_id: "lamp", target_id: "tabletop_surface", type: "supported_by" });
  state = addRelation(state, { source_id: "filing_cabinet", target_id: "floor_surface", type: "supported_by" });
  state = addRelation(state, { source_id: "filing_cabinet", target_id: "table", type: "near" });

  return state;
}
