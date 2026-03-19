// ─── World Validation ───────────────────────────────────────
// Validates WorldState: support, placement, overlaps, required objects.
// NEVER validates regions as physical objects.
// FIX 1: Robust name normalization for required object matching
// FIX 2: Clear type separation (Region / SupportSurface / PhysicalObject)
// FIX 3: Height/Support metrics with real numeric values
// FIX 4: Hard zone rules with strong penalties
// FIX 5: Orientation/Rotation metrics
// FIX 6: Extended score breakdown

import type {
  WorldState,
  WorldValidationResult,
  WorldScoreBreakdown,
  WorldValidationEntry,
  WorldObject,
  SupportSurface,
  PlacementZoneType,
  ObjectMetrics,
  HeightMetrics,
  SupportMetrics,
  ZoneMetrics,
  OrientationMetrics,
  RequiredObjectMatch,
} from "./types";

// ─── FIX 1: Name Normalization ─────────────────────────────

/** Strip to lowercase, replace separators with underscore, trim */
export function normalizeObjectName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[\s\-]+/g, "_")      // spaces and hyphens → underscore
    .replace(/_+/g, "_")           // collapse multiple underscores
    .replace(/^_|_$/g, "");        // trim leading/trailing underscores
}

/** Map common aliases to canonical IDs */
const CANONICAL_ALIASES: Record<string, string> = {
  // Table
  table: "table", tisch: "table", desk: "table", schreibtisch: "table",
  // Laptop
  laptop: "laptop", notebook: "laptop",
  // Lamp
  lamp: "lamp", lampe: "lamp", desk_lamp: "lamp", tischlampe: "lamp",
  // Filing cabinet
  filing_cabinet: "filing_cabinet", filing_cabinets: "filing_cabinet",
  aktenschrank: "filing_cabinet", cabinet: "filing_cabinet",
  file_cabinet: "filing_cabinet", filecabinet: "filing_cabinet",
  filingcabinet: "filing_cabinet",
  // Chair
  chair: "chair", stuhl: "chair",
  // Printer
  printer: "printer", drucker: "printer",
  // Monitor
  monitor: "monitor", bildschirm: "monitor", screen: "monitor",
  // Keyboard
  keyboard: "keyboard", tastatur: "keyboard",
  // Mouse
  mouse: "mouse", maus: "mouse",
  // Phone
  phone: "phone", telefon: "phone",
  // Cup
  cup: "cup", tasse: "cup", mug: "cup",
  // Plant
  plant: "plant", pflanze: "plant",
  // Book
  book: "book", buch: "book",
  // Shelf
  shelf: "shelf", regal: "shelf",
};

/** Get canonical name for any object name variant */
export function canonicalObjectName(name: string): string {
  const normalized = normalizeObjectName(name);
  return CANONICAL_ALIASES[normalized] ?? normalized;
}

/** Check if two names refer to the same object */
export function namesMatch(a: string, b: string): boolean {
  return canonicalObjectName(a) === canonicalObjectName(b);
}

/**
 * Check required object coverage with robust normalization.
 * Matches required names against object IDs AND object names.
 */
function checkRequiredObjectsCoverage(
  state: WorldState,
  requiredNames: string[],
  errors: WorldValidationEntry[],
  info: WorldValidationEntry[],
): { score: number; matches: RequiredObjectMatch[] } {
  if (requiredNames.length === 0) return { score: 1, matches: [] };

  const matches: RequiredObjectMatch[] = [];
  let found = 0;

  for (const reqName of requiredNames) {
    const reqCanonical = canonicalObjectName(reqName);
    let matchedId: string | null = null;

    // Try matching by object ID (canonical)
    for (const [objId, obj] of state.objects) {
      const idCanonical = canonicalObjectName(objId);
      const nameCanonical = canonicalObjectName(obj.name);
      const subtypeCanonical = canonicalObjectName(obj.subtype);

      if (idCanonical === reqCanonical || nameCanonical === reqCanonical || subtypeCanonical === reqCanonical) {
        matchedId = objId;
        break;
      }
    }

    const match: RequiredObjectMatch = {
      required_name: reqName,
      canonical_name: reqCanonical,
      matched_object_id: matchedId,
      found: matchedId !== null,
    };
    matches.push(match);

    if (matchedId) {
      found++;
      info.push({
        check: "required_object",
        message: `Required "${reqName}" (canonical: "${reqCanonical}") matched to object "${matchedId}"`,
        target_id: matchedId,
        category: "required_coverage",
      });
    } else {
      errors.push({
        check: "required_object_missing",
        message: `Required "${reqName}" (canonical: "${reqCanonical}") is MISSING — no object matches by id, name, or subtype`,
        category: "required_coverage",
      });
    }
  }

  return { score: found / requiredNames.length, matches };
}

// ─── FIX 3: Height / Support Metrics ────────────────────────

const MAX_ALLOWED_SUPPORT_GAP = 0.05; // 5cm tolerance

function computeHeightMetrics(obj: WorldObject, surface: SupportSurface | null): HeightMetrics {
  const halfH = obj.transform.scale[1] / 2;
  const bottomY = obj.transform.position[1] - halfH;
  const topY = obj.transform.position[1] + halfH;
  const surfaceY = surface?.surface_y ?? 0;
  const gap = Math.abs(bottomY - surfaceY);

  return {
    object_bottom_y: bottomY,
    object_top_y: topY,
    object_height: obj.transform.scale[1],
    support_plane_y: surfaceY,
    contact_gap: gap,
    grounded: gap <= MAX_ALLOWED_SUPPORT_GAP,
  };
}

function computeSupportMetrics(
  obj: WorldObject,
  state: WorldState,
): SupportMetrics {
  if (!obj.supported_by) {
    return {
      support_surface_id: null,
      support_surface_name: "NONE",
      support_valid: false,
      contact_gap: Infinity,
      within_bounds: false,
      support_score: 0,
    };
  }

  const surface = state.support_surfaces.get(obj.supported_by);
  if (!surface) {
    return {
      support_surface_id: obj.supported_by,
      support_surface_name: "INVALID_REF",
      support_valid: false,
      contact_gap: Infinity,
      within_bounds: false,
      support_score: 0,
    };
  }

  const height = computeHeightMetrics(obj, surface);
  const pos = obj.transform.position;
  const halfW = obj.transform.scale[0] / 2;
  const halfD = obj.transform.scale[2] / 2;
  const withinBounds =
    pos[0] - halfW >= surface.bounds.min[0] - 0.05 &&
    pos[0] + halfW <= surface.bounds.max[0] + 0.05 &&
    pos[2] - halfD >= surface.bounds.min[2] - 0.05 &&
    pos[2] + halfD <= surface.bounds.max[2] + 0.05;

  // Score: 1.0 if grounded + within bounds, degrade by gap and bounds violation
  let score = 1.0;
  if (height.contact_gap > MAX_ALLOWED_SUPPORT_GAP) {
    score -= Math.min(0.5, height.contact_gap * 5); // up to -0.5 for gap
  }
  if (!withinBounds) {
    score -= 0.3;
  }
  score = Math.max(0, score);

  return {
    support_surface_id: surface.surface_id,
    support_surface_name: surface.name,
    support_valid: height.grounded,
    contact_gap: height.contact_gap,
    within_bounds: withinBounds,
    support_score: score,
  };
}

// ─── FIX 4: Zone Metrics (hard rules) ──────────────────────

function computeZoneMetrics(
  obj: WorldObject,
  state: WorldState,
): ZoneMetrics {
  const preferred = obj.placement_rules.preferred_zone;
  const surface = obj.supported_by ? state.support_surfaces.get(obj.supported_by) : null;

  if (!surface || preferred === "anywhere") {
    return {
      preferred_zone: preferred,
      actual_zone: "anywhere",
      zone_match: true,
      zone_distance: 0,
      zone_score: 1,
    };
  }

  const actual = computeActualZone(obj, surface);
  const match = zoneMatches(preferred, actual);
  const distance = computeZoneDistance(preferred, actual, obj, surface);

  // Score: exact match = 1.0, close = 0.7, far = 0.2, terrible = 0
  let score: number;
  if (match) {
    score = 1.0;
  } else if (distance < 0.3) {
    score = 0.7;
  } else if (distance < 0.6) {
    score = 0.4;
  } else {
    score = 0.1; // Hard penalty for gross zone violation
  }

  // FIX 4: Hard penalties for specific violations
  if (obj.placement_rules.avoid_center && (actual === "center" || actual === "center_front" || actual === "center_back")) {
    score = Math.min(score, 0.2); // Strong penalty
  }

  return {
    preferred_zone: preferred,
    actual_zone: actual,
    zone_match: match,
    zone_distance: distance,
    zone_score: score,
  };
}

function computeZoneDistance(
  preferred: PlacementZoneType,
  actual: PlacementZoneType,
  obj: WorldObject,
  surface: SupportSurface,
): number {
  if (preferred === actual || preferred === "anywhere") return 0;

  // Compute ideal position for preferred zone
  const cx = (surface.bounds.min[0] + surface.bounds.max[0]) / 2;
  const cz = (surface.bounds.min[2] + surface.bounds.max[2]) / 2;
  const hw = (surface.bounds.max[0] - surface.bounds.min[0]) / 2;
  const hd = (surface.bounds.max[2] - surface.bounds.min[2]) / 2;

  const idealPos = zoneIdealPosition(preferred, cx, cz, hw, hd);
  if (!idealPos) return 0.5; // Unknown zone, moderate distance

  const px = obj.transform.position[0];
  const pz = obj.transform.position[2];
  const dx = hw > 0 ? Math.abs(px - idealPos[0]) / hw : 0;
  const dz = hd > 0 ? Math.abs(pz - idealPos[1]) / hd : 0;

  return Math.min(1, Math.sqrt(dx * dx + dz * dz) / 2);
}

function zoneIdealPosition(
  zone: PlacementZoneType,
  cx: number, cz: number, hw: number, hd: number,
): [number, number] | null {
  switch (zone) {
    case "center":        return [cx, cz];
    case "center_front":  return [cx, cz + hd * 0.5];
    case "center_back":   return [cx, cz - hd * 0.5];
    case "front_left":    return [cx - hw * 0.7, cz + hd * 0.7];
    case "front_right":   return [cx + hw * 0.7, cz + hd * 0.7];
    case "back_left":     return [cx - hw * 0.7, cz - hd * 0.7];
    case "back_right":    return [cx + hw * 0.7, cz - hd * 0.7];
    case "left_edge":     return [cx - hw * 0.7, cz];
    case "right_edge":    return [cx + hw * 0.7, cz];
    case "front_edge":    return [cx, cz + hd * 0.7];
    case "back_edge":     return [cx, cz - hd * 0.7];
    case "any_edge":      return [cx + hw * 0.7, cz]; // pick one edge
    case "any_corner":    return [cx + hw * 0.7, cz + hd * 0.7]; // pick one corner
    default:              return null;
  }
}

// ─── FIX 5: Orientation / Rotation Metrics ─────────────────

function computeOrientationMetrics(obj: WorldObject): OrientationMetrics {
  const rules = obj.placement_rules.orientation;
  const rot = obj.transform.rotation;
  const yRot = rot[1];

  // Upright check: X and Z rotation must be near 0
  const upright = Math.abs(rot[0]) < 5 && Math.abs(rot[2]) < 5;

  // Snap check
  let snapValid = true;
  if (rules.snap_rotation_deg > 0) {
    const remainder = Math.abs(yRot % rules.snap_rotation_deg);
    snapValid = remainder < 1 || Math.abs(remainder - rules.snap_rotation_deg) < 1;
  }

  // Allowed rotations check
  let allowedValid = true;
  if (rules.allowed_y_rotations) {
    const normalizedRot = ((yRot % 360) + 360) % 360;
    allowedValid = rules.allowed_y_rotations.some(
      (r) => Math.abs(((r % 360 + 360) % 360) - normalizedRot) < 1
    );
  }

  // Score
  let score = 1.0;
  if (!upright && obj.placement_rules.upright_only) score -= 0.5;
  if (!snapValid) score -= 0.3;
  if (!allowedValid) score -= 0.3;
  score = Math.max(0, score);

  return {
    rotation: rot,
    snap_valid: snapValid,
    allowed_rotation_valid: allowedValid,
    upright,
    orientation_score: score,
  };
}

// ─── Compute All Object Metrics ────────────────────────────

function computeAllObjectMetrics(state: WorldState): ObjectMetrics[] {
  const metrics: ObjectMetrics[] = [];

  for (const obj of state.objects.values()) {
    const surface = obj.supported_by ? state.support_surfaces.get(obj.supported_by) ?? null : null;

    metrics.push({
      canonical_name: canonicalObjectName(obj.name),
      original_name: obj.name,
      object_id: obj.id,
      object_type: obj.type,
      height: computeHeightMetrics(obj, surface),
      support: computeSupportMetrics(obj, state),
      zone: computeZoneMetrics(obj, state),
      orientation: computeOrientationMetrics(obj),
    });
  }

  return metrics;
}

// ─── Main Validation ────────────────────────────────────────

export function validateWorldState(
  state: WorldState,
  requiredObjectIds: string[] = [],
): WorldValidationResult {
  const errors: WorldValidationEntry[] = [];
  const warnings: WorldValidationEntry[] = [];
  const info: WorldValidationEntry[] = [];

  // Compute detailed metrics for all objects
  const objectMetrics = computeAllObjectMetrics(state);

  // 1. Required object coverage (FIX 1: normalized matching)
  const { score: coverageScore, matches: requiredMatches } =
    checkRequiredObjectsCoverage(state, requiredObjectIds, errors, info);

  // 2. Support validity (FIX 3: real metrics)
  const supportScore = checkSupportValidity(state, objectMetrics, errors, warnings, info);

  // 3. Placement validity
  const placementScore = checkPlacementRules(state, objectMetrics, errors, warnings, info);

  // 4. Overlap check (ONLY physical objects, NEVER regions — FIX 2)
  const overlapScore = checkOverlaps(state, errors, warnings);

  // 5. Semantic completeness
  const semanticScore = checkSemanticCompleteness(state, requiredObjectIds, warnings, info);

  // 6. Proportion validity
  const proportionScore = checkProportions(state, warnings, info);

  // 7. Orientation validity (FIX 5: enhanced)
  const orientationScore = computeAggregateOrientationScore(objectMetrics);

  // 8. Zone placement validity (FIX 4: hard rules)
  const zoneScore = computeAggregateZoneScore(objectMetrics);

  // 9. Height relation score (FIX 3)
  const heightRelationScore = checkHeightRelations(state, objectMetrics, warnings, info);

  // 10. Semantic relation score
  const semanticRelationScore = checkSemanticRelations(state, warnings, info);

  const scores: WorldScoreBreakdown = {
    required_object_coverage: coverageScore,
    support_validity: supportScore,
    placement_validity: placementScore,
    overlap_score: overlapScore,
    semantic_completeness: semanticScore,
    proportion_score: proportionScore,
    orientation_score: orientationScore,
    zone_placement_score: zoneScore,
    height_relation_score: heightRelationScore,
    semantic_relation_score: semanticRelationScore,
  };

  // FIX 6: Rebalanced weighted score — visual plausibility matters more
  const score =
    coverageScore * 0.15 +
    supportScore * 0.15 +
    placementScore * 0.10 +
    overlapScore * 0.10 +
    semanticScore * 0.05 +
    proportionScore * 0.10 +
    orientationScore * 0.10 +
    zoneScore * 0.10 +
    heightRelationScore * 0.10 +
    semanticRelationScore * 0.05;

  // Count violations by category
  const violations_by_category: Record<string, number> = {};
  for (const e of [...errors, ...warnings]) {
    const cat = e.category ?? e.check;
    violations_by_category[cat] = (violations_by_category[cat] ?? 0) + 1;
  }

  return {
    valid: errors.length === 0,
    score,
    scores,
    errors,
    warnings,
    info,
    object_metrics: objectMetrics,
    required_object_matches: requiredMatches,
    violations_by_category,
  };
}

// ─── Support Validity (FIX 3: real numeric metrics) ────────

function checkSupportValidity(
  state: WorldState,
  metrics: ObjectMetrics[],
  errors: WorldValidationEntry[],
  warnings: WorldValidationEntry[],
  info: WorldValidationEntry[],
): number {
  if (metrics.length === 0) return 1;

  let totalScore = 0;

  for (const m of metrics) {
    const s = m.support;

    if (!s.support_surface_id) {
      warnings.push({
        check: "no_support",
        message: `"${m.original_name}" (${m.object_id}) has no support surface assigned`,
        target_id: m.object_id,
        category: "support",
      });
      continue;
    }

    if (s.support_surface_name === "INVALID_REF") {
      errors.push({
        check: "invalid_support",
        message: `"${m.original_name}" references non-existent support surface "${s.support_surface_id}"`,
        target_id: m.object_id,
        category: "support",
      });
      continue;
    }

    if (!s.support_valid) {
      warnings.push({
        check: "floating",
        message: `"${m.original_name}" bottom_y=${m.height.object_bottom_y.toFixed(3)} does not touch surface "${s.support_surface_name}" (y=${m.height.support_plane_y.toFixed(3)}), gap=${s.contact_gap.toFixed(3)}m`,
        target_id: m.object_id,
        category: "support",
      });
    } else {
      info.push({
        check: "support_ok",
        message: `"${m.original_name}" grounded on "${s.support_surface_name}" (gap=${s.contact_gap.toFixed(4)}m)`,
        target_id: m.object_id,
        category: "support",
      });
    }

    totalScore += s.support_score;
  }

  return metrics.length > 0 ? totalScore / metrics.length : 1;
}

// ─── Placement Rules ────────────────────────────────────────

function checkPlacementRules(
  state: WorldState,
  metrics: ObjectMetrics[],
  errors: WorldValidationEntry[],
  warnings: WorldValidationEntry[],
  info: WorldValidationEntry[],
): number {
  const objects = [...state.objects.values()];
  if (objects.length === 0) return 1;

  let passedChecks = 0;
  let totalChecks = 0;

  for (const obj of objects) {
    const rules = obj.placement_rules;

    // must_touch_anchor_plane
    if (rules.must_touch_anchor_plane && obj.supported_by) {
      totalChecks++;
      const surface = state.support_surfaces.get(obj.supported_by);
      if (surface) {
        const bottomY = obj.transform.position[1] - obj.transform.scale[1] / 2;
        if (Math.abs(bottomY - surface.surface_y) <= MAX_ALLOWED_SUPPORT_GAP) {
          passedChecks++;
        } else {
          warnings.push({
            check: "anchor_plane",
            message: `"${obj.name}" must touch anchor plane but gap=${Math.abs(bottomY - surface.surface_y).toFixed(3)}m`,
            target_id: obj.id,
            category: "placement",
          });
        }
      }
    }

    // no_floating
    if (rules.no_floating) {
      totalChecks++;
      const m = metrics.find((x) => x.object_id === obj.id);
      if (m && m.support.support_valid) {
        passedChecks++;
      } else if (m) {
        errors.push({
          check: "no_floating",
          message: `"${obj.name}" is floating (gap=${m.support.contact_gap.toFixed(3)}m) — no_floating rule violated`,
          target_id: obj.id,
          category: "placement",
        });
      }
    }

    // upright_only
    if (rules.upright_only) {
      totalChecks++;
      const rot = obj.transform.rotation;
      if (Math.abs(rot[0]) < 5 && Math.abs(rot[2]) < 5) {
        passedChecks++;
      } else {
        warnings.push({
          check: "upright",
          message: `"${obj.name}" must be upright but rotation=[${rot.map(v => v.toFixed(1)).join(",")}]`,
          target_id: obj.id,
          category: "orientation",
        });
      }
    }

    // keep_within_bounds
    if (rules.keep_within_bounds) {
      totalChecks++;
      const surface = state.support_surfaces.get(rules.keep_within_bounds);
      if (surface) {
        const pos = obj.transform.position;
        const halfW = obj.transform.scale[0] / 2;
        const halfD = obj.transform.scale[2] / 2;
        const within =
          pos[0] - halfW >= surface.bounds.min[0] - 0.05 &&
          pos[0] + halfW <= surface.bounds.max[0] + 0.05 &&
          pos[2] - halfD >= surface.bounds.min[2] - 0.05 &&
          pos[2] + halfD <= surface.bounds.max[2] + 0.05;
        if (within) {
          passedChecks++;
        } else {
          warnings.push({
            check: "bounds",
            message: `"${obj.name}" exceeds bounds of surface "${surface.name}"`,
            target_id: obj.id,
            category: "placement",
          });
        }
      }
    }
  }

  return totalChecks > 0 ? passedChecks / totalChecks : 1;
}

// ─── Overlap Check (ONLY physical objects, NEVER regions) ───

function checkOverlaps(
  state: WorldState,
  errors: WorldValidationEntry[],
  warnings: WorldValidationEntry[],
): number {
  const objects = [...state.objects.values()];
  if (objects.length < 2) return 1;

  let overlapCount = 0;
  const totalPairs = (objects.length * (objects.length - 1)) / 2;

  for (let i = 0; i < objects.length; i++) {
    for (let j = i + 1; j < objects.length; j++) {
      const a = objects[i];
      const b = objects[j];

      const overlap = aabbOverlap(a, b);
      if (overlap > 0) {
        overlapCount++;

        const aForbids = a.placement_rules.no_overlap_with.some((n) => namesMatch(n, b.id) || namesMatch(n, b.name));
        const bForbids = b.placement_rules.no_overlap_with.some((n) => namesMatch(n, a.id) || namesMatch(n, a.name));

        if (aForbids || bForbids) {
          errors.push({
            check: "no_overlap",
            message: `"${a.name}" overlaps with "${b.name}" (${overlap.toFixed(3)}m) — forbidden by placement rules`,
            category: "overlap",
          });
        } else {
          warnings.push({
            check: "overlap",
            message: `"${a.name}" overlaps with "${b.name}" (${overlap.toFixed(3)}m)`,
            category: "overlap",
          });
        }
      }
    }
  }

  return totalPairs > 0 ? (totalPairs - overlapCount) / totalPairs : 1;
}

function aabbOverlap(a: WorldObject, b: WorldObject): number {
  let minOverlap = Infinity;
  for (let i = 0; i < 3; i++) {
    const halfA = a.transform.scale[i] / 2;
    const halfB = b.transform.scale[i] / 2;
    const dist = Math.abs(a.transform.position[i] - b.transform.position[i]);
    const overlap = (halfA + halfB) - dist;
    if (overlap <= 0) return 0;
    minOverlap = Math.min(minOverlap, overlap);
  }
  return minOverlap;
}

// ─── Semantic Completeness ──────────────────────────────────

function checkSemanticCompleteness(
  state: WorldState,
  requiredIds: string[],
  warnings: WorldValidationEntry[],
  info: WorldValidationEntry[],
): number {
  const objects = [...state.objects.values()];

  let valid = 0;
  for (const obj of objects) {
    if (state.regions.has(obj.region_id)) {
      valid++;
    } else {
      warnings.push({
        check: "orphan_object",
        message: `"${obj.name}" belongs to non-existent region "${obj.region_id}"`,
        target_id: obj.id,
        category: "semantic",
      });
    }
  }

  for (const rel of state.relations) {
    if (!state.objects.has(rel.source_id) && !state.support_surfaces.has(rel.source_id)) {
      warnings.push({ check: "dangling_relation", message: `Relation source "${rel.source_id}" not found`, category: "semantic" });
    }
    if (!state.objects.has(rel.target_id) && !state.support_surfaces.has(rel.target_id)) {
      warnings.push({ check: "dangling_relation", message: `Relation target "${rel.target_id}" not found`, category: "semantic" });
    }
  }

  const regionScore = objects.length > 0 ? valid / objects.length : 1;

  // Use normalized matching for coverage
  const coveredCount = requiredIds.filter((id) => {
    const canonical = canonicalObjectName(id);
    for (const [objId, obj] of state.objects) {
      if (canonicalObjectName(objId) === canonical || canonicalObjectName(obj.name) === canonical) {
        return true;
      }
    }
    return false;
  }).length;
  const coverageScore = requiredIds.length > 0 ? coveredCount / requiredIds.length : 1;

  return (regionScore + coverageScore) / 2;
}

// ─── Proportion Check ──────────────────────────────────────

function checkProportions(
  state: WorldState,
  warnings: WorldValidationEntry[],
  info: WorldValidationEntry[],
): number {
  const objects = [...state.objects.values()];
  if (objects.length === 0) return 1;

  let valid = 0;
  let checked = 0;

  for (const obj of objects) {
    const surface = obj.supported_by ? state.support_surfaces.get(obj.supported_by) : null;
    if (!surface) continue;

    checked++;
    const rules = obj.placement_rules.proportion;

    const surfaceW = surface.bounds.max[0] - surface.bounds.min[0];
    const surfaceD = surface.bounds.max[2] - surface.bounds.min[2];
    const surfaceArea = surfaceW * surfaceD;

    const objW = obj.transform.scale[0];
    const objD = obj.transform.scale[2];
    const objH = obj.transform.scale[1];
    const objArea = objW * objD;

    const areaRatio = surfaceArea > 0 ? objArea / surfaceArea : 0;
    const widthRatio = surfaceW > 0 ? objW / surfaceW : 0;
    const depthRatio = surfaceD > 0 ? objD / surfaceD : 0;

    let pass = true;

    if (areaRatio > rules.max_area_ratio) {
      warnings.push({
        check: "proportion_area",
        message: `"${obj.name}" area ratio ${areaRatio.toFixed(3)} exceeds max ${rules.max_area_ratio}`,
        target_id: obj.id,
        category: "proportion",
      });
      pass = false;
    }

    if (widthRatio < rules.preferred_width_ratio[0] || widthRatio > rules.preferred_width_ratio[1]) {
      warnings.push({
        check: "proportion_width",
        message: `"${obj.name}" width ratio ${widthRatio.toFixed(3)} outside [${rules.preferred_width_ratio.join(",")}]`,
        target_id: obj.id,
        category: "proportion",
      });
      pass = false;
    }

    if (depthRatio < rules.preferred_depth_ratio[0] || depthRatio > rules.preferred_depth_ratio[1]) {
      warnings.push({
        check: "proportion_depth",
        message: `"${obj.name}" depth ratio ${depthRatio.toFixed(3)} outside [${rules.preferred_depth_ratio.join(",")}]`,
        target_id: obj.id,
        category: "proportion",
      });
      pass = false;
    }

    if (objH < rules.preferred_height_range[0] || objH > rules.preferred_height_range[1]) {
      warnings.push({
        check: "proportion_height",
        message: `"${obj.name}" height ${objH.toFixed(3)}m outside [${rules.preferred_height_range.join(",")}]m`,
        target_id: obj.id,
        category: "proportion",
      });
      pass = false;
    }

    if (pass) {
      valid++;
      info.push({
        check: "proportion_ok",
        message: `"${obj.name}" proportions valid (area=${areaRatio.toFixed(3)}, w=${widthRatio.toFixed(3)}, d=${depthRatio.toFixed(3)}, h=${objH.toFixed(3)})`,
        target_id: obj.id,
        category: "proportion",
      });
    }
  }

  return checked > 0 ? valid / checked : 1;
}

// ─── Aggregate Orientation Score (FIX 5) ────────────────────

function computeAggregateOrientationScore(metrics: ObjectMetrics[]): number {
  if (metrics.length === 0) return 1;
  let total = 0;
  for (const m of metrics) {
    total += m.orientation.orientation_score;
  }
  return total / metrics.length;
}

// ─── Aggregate Zone Score (FIX 4) ──────────────────────────

function computeAggregateZoneScore(metrics: ObjectMetrics[]): number {
  const scored = metrics.filter((m) => m.zone.preferred_zone !== "anywhere");
  if (scored.length === 0) return 1;
  let total = 0;
  for (const m of scored) {
    total += m.zone.zone_score;
  }
  return total / scored.length;
}

// ─── FIX 3: Height Relation Checks ─────────────────────────

function checkHeightRelations(
  state: WorldState,
  metrics: ObjectMetrics[],
  warnings: WorldValidationEntry[],
  info: WorldValidationEntry[],
): number {
  if (metrics.length === 0) return 1;

  let checks = 0;
  let passed = 0;

  // For each object on a surface owned by another object, check height makes sense
  for (const m of metrics) {
    const obj = state.objects.get(m.object_id);
    if (!obj?.supported_by) continue;

    const surface = state.support_surfaces.get(obj.supported_by);
    if (!surface) continue;

    // If surface is owned by an object (e.g. tabletop), check object sits ON TOP
    if (surface.owner_object_id) {
      checks++;
      const ownerObj = state.objects.get(surface.owner_object_id);
      if (ownerObj) {
        const ownerTopY = ownerObj.transform.position[1] + ownerObj.transform.scale[1] / 2;
        const objBottomY = m.height.object_bottom_y;

        // Object bottom should be at or above owner top
        if (objBottomY >= ownerTopY - 0.05) {
          passed++;
          info.push({
            check: "height_relation_ok",
            message: `"${m.original_name}" bottom_y=${objBottomY.toFixed(3)} correctly above "${ownerObj.name}" top_y=${ownerTopY.toFixed(3)}`,
            target_id: m.object_id,
            category: "height_relation",
          });
        } else {
          warnings.push({
            check: "height_relation_bad",
            message: `"${m.original_name}" bottom_y=${objBottomY.toFixed(3)} is BELOW "${ownerObj.name}" top_y=${ownerTopY.toFixed(3)}`,
            target_id: m.object_id,
            category: "height_relation",
          });
        }
      }
    }

    // Check cabinet_height_to_desk_height_ratio for filing cabinets
    const canonical = canonicalObjectName(obj.name);
    if (canonical === "filing_cabinet") {
      const tableObj = findObjectByCanonical(state, "table");
      if (tableObj) {
        checks++;
        const ratio = obj.transform.scale[1] / tableObj.transform.scale[1];
        if (ratio >= 0.5 && ratio <= 1.2) {
          passed++;
          info.push({
            check: "cabinet_desk_ratio_ok",
            message: `Filing cabinet height ratio to table: ${ratio.toFixed(2)} (valid range 0.5-1.2)`,
            target_id: m.object_id,
            category: "height_relation",
          });
        } else {
          warnings.push({
            check: "cabinet_desk_ratio_bad",
            message: `Filing cabinet height ratio to table: ${ratio.toFixed(2)} (expected 0.5-1.2)`,
            target_id: m.object_id,
            category: "height_relation",
          });
        }
      }
    }
  }

  return checks > 0 ? passed / checks : 1;
}

// ─── Semantic Relation Checks ──────────────────────────────

function checkSemanticRelations(
  state: WorldState,
  warnings: WorldValidationEntry[],
  info: WorldValidationEntry[],
): number {
  let checks = 0;
  let passed = 0;

  for (const obj of state.objects.values()) {
    const rules = obj.placement_rules;

    // near_object check
    if (rules.near_object) {
      checks++;
      const targetObj = state.objects.get(rules.near_object)
        ?? findObjectByCanonical(state, canonicalObjectName(rules.near_object));

      if (targetObj) {
        const dist = euclideanDistanceXZ(obj.transform.position, targetObj.transform.position);
        const maxNear = 2.0; // within 2m is "near"
        if (dist <= maxNear) {
          passed++;
          info.push({
            check: "near_object_ok",
            message: `"${obj.name}" is ${dist.toFixed(2)}m from "${targetObj.name}" (max ${maxNear}m)`,
            target_id: obj.id,
            category: "semantic_relation",
          });
        } else {
          warnings.push({
            check: "near_object_far",
            message: `"${obj.name}" is ${dist.toFixed(2)}m from "${targetObj.name}" — expected within ${maxNear}m`,
            target_id: obj.id,
            category: "semantic_relation",
          });
        }
      }
    }
  }

  return checks > 0 ? passed / checks : 1;
}

// ─── Zone Helpers ──────────────────────────────────────────

function computeActualZone(obj: WorldObject, surface: SupportSurface): PlacementZoneType {
  const cx = (surface.bounds.min[0] + surface.bounds.max[0]) / 2;
  const cz = (surface.bounds.min[2] + surface.bounds.max[2]) / 2;
  const hw = (surface.bounds.max[0] - surface.bounds.min[0]) / 2;
  const hd = (surface.bounds.max[2] - surface.bounds.min[2]) / 2;

  const px = obj.transform.position[0];
  const pz = obj.transform.position[2];

  // Normalized position relative to surface center (-1 to +1)
  const nx = hw > 0 ? (px - cx) / hw : 0;
  const nz = hd > 0 ? (pz - cz) / hd : 0;

  const edgeThreshold = 0.6;

  const isLeft = nx < -edgeThreshold;
  const isRight = nx > edgeThreshold;
  const isFront = nz > edgeThreshold;
  const isBack = nz < -edgeThreshold;
  const isCenterX = !isLeft && !isRight;
  const isCenterZ = !isFront && !isBack;

  if (isCenterX && isCenterZ) return "center";
  if (isCenterX && isFront) return "center_front";
  if (isCenterX && isBack) return "center_back";
  if (isLeft && isFront) return "front_left";
  if (isRight && isFront) return "front_right";
  if (isLeft && isBack) return "back_left";
  if (isRight && isBack) return "back_right";
  if (isLeft) return "left_edge";
  if (isRight) return "right_edge";
  if (isFront) return "front_edge";
  if (isBack) return "back_edge";

  return "center";
}

function zoneMatches(preferred: PlacementZoneType, actual: PlacementZoneType): boolean {
  if (preferred === actual) return true;
  if (preferred === "anywhere") return true;

  if (preferred === "any_edge") {
    return ["left_edge", "right_edge", "front_edge", "back_edge",
            "front_left", "front_right", "back_left", "back_right"].includes(actual);
  }

  if (preferred === "any_corner") {
    return ["front_left", "front_right", "back_left", "back_right"].includes(actual);
  }

  // Allow adjacent zone matches (close enough)
  if (preferred === "back_right") return actual === "back_right" || actual === "right_edge" || actual === "back_edge";
  if (preferred === "back_left") return actual === "back_left" || actual === "left_edge" || actual === "back_edge";
  if (preferred === "front_right") return actual === "front_right" || actual === "right_edge" || actual === "front_edge";
  if (preferred === "front_left") return actual === "front_left" || actual === "left_edge" || actual === "front_edge";
  if (preferred === "center_front") return actual === "center_front" || actual === "center";
  if (preferred === "center_back") return actual === "center_back" || actual === "center";

  // right_adjacent / left_adjacent / under — no direct zone mapping, check proximity
  if (preferred === "right_adjacent" || preferred === "left_adjacent" || preferred === "under") {
    return true; // These are relation-based, not zone-based — handled by near_object
  }

  return false;
}

// ─── Utility Helpers ───────────────────────────────────────

function findObjectByCanonical(state: WorldState, canonical: string): WorldObject | null {
  for (const obj of state.objects.values()) {
    if (canonicalObjectName(obj.id) === canonical || canonicalObjectName(obj.name) === canonical) {
      return obj;
    }
  }
  return null;
}

function euclideanDistanceXZ(a: [number, number, number] | number[], b: [number, number, number] | number[]): number {
  const dx = a[0] - b[0];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dz * dz);
}

// ─── Extract Required Object IDs from User Prompt ───────────

const KNOWN_OBJECTS: Record<string, string> = {
  table: "table", tisch: "table", desk: "table",
  laptop: "laptop", notebook: "laptop",
  lamp: "lamp", lampe: "lamp", "desk lamp": "lamp",
  "filing cabinet": "filing_cabinet", aktenschrank: "filing_cabinet", cabinet: "filing_cabinet",
  "file cabinet": "filing_cabinet",
  chair: "chair", stuhl: "chair",
  printer: "printer", drucker: "printer",
  monitor: "monitor", bildschirm: "monitor", screen: "monitor",
  keyboard: "keyboard", tastatur: "keyboard",
  mouse: "mouse", maus: "mouse",
  phone: "phone", telefon: "phone",
  cup: "cup", tasse: "cup", mug: "cup",
  plant: "plant", pflanze: "plant",
  book: "book", buch: "book",
  shelf: "shelf", regal: "shelf",
};

export function extractRequiredObjects(userPrompt: string): string[] {
  const lower = userPrompt.toLowerCase();
  const found = new Set<string>();

  // Sort keys by length descending to match longer phrases first
  const sortedKeys = Object.keys(KNOWN_OBJECTS).sort((a, b) => b.length - a.length);

  for (const key of sortedKeys) {
    if (lower.includes(key)) {
      found.add(KNOWN_OBJECTS[key]);
    }
  }

  return [...found];
}

// Re-export for external use
export { computeActualZone, computeAllObjectMetrics };
