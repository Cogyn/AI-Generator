// ─── World State Types ──────────────────────────────────────
// Phase 1: World Foundation – alle Interfaces fuer das World-State-System

import type { Vec3, AABB } from "../core/types";

// ─── WorldState ─────────────────────────────────────────────

export interface WorldState {
  world_id: string;
  version: string;
  metadata: WorldMetadata;
  global_settings: GlobalSettings;
  regions: Map<string, Region>;
  objects: Map<string, WorldObject>;
  support_surfaces: Map<string, SupportSurface>;
  relations: ObjectRelation[];
  generation_history: HistoryEntry[];
  user_edit_history: HistoryEntry[];
}

export interface WorldMetadata {
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  author: string;
}

export interface GlobalSettings {
  default_editable: boolean;
  default_ai_allowed: boolean;
  grid_size: number;
}

// ─── Region ─────────────────────────────────────────────────
// Regions are LOGICAL CONTAINERS, NOT physical objects.
// They define workspace bounds, edit rights, and hold object lists.
// They have NO meshes, NO primitives, NO physical presence.
// They must NEVER appear in grounded/no_overlap/support/placement checks.

export interface Region {
  region_id: string;
  name: string;
  type: string;
  bounds: AABB;
  parent_region_id: string | null;
  child_region_ids: string[];
  editable: boolean;
  locked: boolean;
  ai_allowed: boolean;
  tags: string[];
  object_ids: string[];
  metadata: Record<string, unknown>;
}

export interface CreateRegionOpts {
  region_id?: string;
  name: string;
  type: string;
  bounds: AABB;
  parent_region_id?: string | null;
  editable?: boolean;
  locked?: boolean;
  ai_allowed?: boolean;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

// ─── Support Surface ────────────────────────────────────────
// Support surfaces are physical planes that carry objects.
// They are SEPARATE from regions (logical) and objects (physical things).
// Examples: floor_surface (ground plane), tabletop_surface (top of table).

export type SupportSurfaceType = "ground_plane" | "object_surface";

export interface SupportSurface {
  surface_id: string;
  name: string;
  type: SupportSurfaceType;
  surface_y: number;
  bounds: AABB;
  owner_object_id: string | null;
  region_id: string;
}

export interface CreateSupportSurfaceOpts {
  surface_id?: string;
  name: string;
  type: SupportSurfaceType;
  surface_y: number;
  bounds: AABB;
  owner_object_id?: string | null;
  region_id: string;
}

// ─── WorldObject ────────────────────────────────────────────

export interface WorldObject {
  id: string;
  name: string;
  type: string;
  category: string;
  subtype: string;
  region_id: string;
  parent_id: string | null;
  anchor_id: string | null;
  supported_by: string | null;
  editable: boolean;
  locked: boolean;
  ai_allowed: boolean;
  manual_override: boolean;
  generated_by: string;
  asset_ref: string | null;
  transform: ObjectTransform;
  tags: string[];
  constraints: string[];
  placement_rules: PlacementRules;
  state: ObjectState;
}

export interface ObjectTransform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export interface ObjectState {
  active: boolean;
  hidden: boolean;
  selected: boolean;
  dirty: boolean;
}

// ─── Placement Rules ────────────────────────────────────────
// Per-object rules for physical placement validation.

export type PlacementZoneType =
  | "center" | "center_front" | "center_back"
  | "front_left" | "front_right" | "back_left" | "back_right"
  | "left_edge" | "right_edge" | "front_edge" | "back_edge"
  | "any_edge" | "any_corner" | "anywhere"
  | "under" | "left_adjacent" | "right_adjacent";

export interface PlacementRules {
  // Support / grounding
  must_touch_anchor_plane: boolean;
  upright_only: boolean;
  no_floating: boolean;
  keep_within_bounds: string | null;     // surface_id to stay within
  no_overlap_with: string[];
  near_object: string | null;

  // Zone
  preferred_zone: PlacementZoneType;
  avoid_center: boolean;

  // Proportions — relative to support surface
  proportion: ProportionConstraints;

  // Orientation
  orientation: OrientationRules;
}

export interface ProportionConstraints {
  max_area_ratio: number;               // max footprint as ratio of support surface area (0-1)
  preferred_width_ratio: [number, number];  // [min, max] width ratio relative to support surface
  preferred_depth_ratio: [number, number];  // [min, max] depth ratio relative to support surface
  preferred_height_range: [number, number]; // [min, max] absolute height in meters
}

export interface OrientationRules {
  primary_axis: "x" | "y" | "z";        // which axis is "forward"
  front_direction: Vec3;                 // normalized direction the front faces
  snap_rotation_deg: number;             // snap Y-rotation to increments (0 = no snap)
  allowed_y_rotations: number[] | null;  // explicit allowed rotations, or null = any
}

export interface CreateObjectOpts {
  id?: string;
  name: string;
  type: string;
  category?: string;
  subtype?: string;
  region_id: string;
  parent_id?: string | null;
  anchor_id?: string | null;
  supported_by?: string | null;
  editable?: boolean;
  locked?: boolean;
  ai_allowed?: boolean;
  manual_override?: boolean;
  generated_by?: string;
  asset_ref?: string | null;
  transform?: Partial<ObjectTransform>;
  tags?: string[];
  constraints?: string[];
  placement_rules?: Partial<PlacementRules>;
  state?: Partial<ObjectState>;
}

// ─── Relations ──────────────────────────────────────────────

export type RelationType =
  | "on_top_of"
  | "under"
  | "inside"
  | "attached_to"
  | "near"
  | "connected_to"
  | "supported_by";

export interface ObjectRelation {
  source_id: string;
  target_id: string;
  type: RelationType;
}

// ─── History ────────────────────────────────────────────────

export interface HistoryEntry {
  timestamp: string;
  action: string;
  target_id: string;
  details: string;
}

// ─── Lock State Summary ─────────────────────────────────────

export interface LockStateSummary {
  total_regions: number;
  locked_regions: number;
  editable_regions: number;
  ai_allowed_regions: number;
  total_objects: number;
  locked_objects: number;
  editable_objects: number;
  ai_allowed_objects: number;
}

// ─── Object Metrics ─────────────────────────────────────────
// Per-object detailed measurements for validation and debugging.

export interface HeightMetrics {
  object_bottom_y: number;
  object_top_y: number;
  object_height: number;
  support_plane_y: number;
  contact_gap: number;
  grounded: boolean;
}

export interface SupportMetrics {
  support_surface_id: string | null;
  support_surface_name: string;
  support_valid: boolean;
  contact_gap: number;
  within_bounds: boolean;
  support_score: number;
}

export interface ZoneMetrics {
  preferred_zone: PlacementZoneType;
  actual_zone: PlacementZoneType;
  zone_match: boolean;
  zone_distance: number;        // 0 = perfect, 1 = worst
  zone_score: number;           // 0-1
}

export interface OrientationMetrics {
  rotation: Vec3;
  snap_valid: boolean;
  allowed_rotation_valid: boolean;
  upright: boolean;
  orientation_score: number;    // 0-1
}

export interface ObjectMetrics {
  canonical_name: string;
  original_name: string;
  object_id: string;
  object_type: string;
  height: HeightMetrics;
  support: SupportMetrics;
  zone: ZoneMetrics;
  orientation: OrientationMetrics;
}

export interface RequiredObjectMatch {
  required_name: string;
  canonical_name: string;
  matched_object_id: string | null;
  found: boolean;
}

// ─── Validation ─────────────────────────────────────────────

export interface WorldValidationResult {
  valid: boolean;
  score: number;
  scores: WorldScoreBreakdown;
  errors: WorldValidationEntry[];
  warnings: WorldValidationEntry[];
  info: WorldValidationEntry[];
  object_metrics: ObjectMetrics[];
  required_object_matches: RequiredObjectMatch[];
  violations_by_category: Record<string, number>;
}

export interface WorldScoreBreakdown {
  required_object_coverage: number;
  support_validity: number;
  placement_validity: number;
  overlap_score: number;
  semantic_completeness: number;
  proportion_score: number;
  orientation_score: number;
  zone_placement_score: number;
  height_relation_score: number;
  semantic_relation_score: number;
}

export interface WorldValidationEntry {
  check: string;
  message: string;
  target_id?: string;
  category?: string;
}

// ─── Serialization ──────────────────────────────────────────

export interface SerializedWorldState {
  world_id: string;
  version: string;
  metadata: WorldMetadata;
  global_settings: GlobalSettings;
  regions: Record<string, Region>;
  objects: Record<string, WorldObject>;
  support_surfaces: Record<string, SupportSurface>;
  relations: ObjectRelation[];
  generation_history: HistoryEntry[];
  user_edit_history: HistoryEntry[];
}
