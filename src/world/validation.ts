// ─── World Validation ───────────────────────────────────────
// Validates WorldState: support, placement, overlaps, required objects.
// NEVER validates regions as physical objects.

import type {
  WorldState,
  WorldValidationResult,
  WorldScoreBreakdown,
  WorldValidationEntry,
  WorldObject,
  SupportSurface,
  PlacementZoneType,
} from "./types";

// ─── Main Validation ────────────────────────────────────────

export function validateWorldState(
  state: WorldState,
  requiredObjectIds: string[] = [],
): WorldValidationResult {
  const errors: WorldValidationEntry[] = [];
  const warnings: WorldValidationEntry[] = [];
  const info: WorldValidationEntry[] = [];

  // 1. Required object coverage
  const coverageScore = checkRequiredObjects(state, requiredObjectIds, errors, info);

  // 2. Support validity (every object must have valid support)
  const supportScore = checkSupportValidity(state, errors, warnings, info);

  // 3. Placement validity (objects touch their anchor plane, upright, etc.)
  const placementScore = checkPlacementRules(state, errors, warnings, info);

  // 4. Overlap check (between physical objects ONLY, not regions)
  const overlapScore = checkOverlaps(state, errors, warnings);

  // 5. Semantic completeness
  const semanticScore = checkSemanticCompleteness(state, requiredObjectIds, warnings, info);

  // 6. Proportion validity
  const proportionScore = checkProportions(state, warnings, info);

  // 7. Orientation validity
  const orientationScore = checkOrientation(state, warnings, info);

  // 8. Zone placement validity
  const zoneScore = checkZonePlacement(state, warnings, info);

  const scores: WorldScoreBreakdown = {
    required_object_coverage: coverageScore,
    support_validity: supportScore,
    placement_validity: placementScore,
    overlap_score: overlapScore,
    semantic_completeness: semanticScore,
    proportion_score: proportionScore,
    orientation_score: orientationScore,
    zone_placement_score: zoneScore,
  };

  // Weighted overall score
  const score =
    coverageScore * 0.20 +
    supportScore * 0.20 +
    placementScore * 0.15 +
    overlapScore * 0.10 +
    semanticScore * 0.05 +
    proportionScore * 0.10 +
    orientationScore * 0.10 +
    zoneScore * 0.10;

  return {
    valid: errors.length === 0,
    score,
    scores,
    errors,
    warnings,
    info,
  };
}

// ─── Required Objects ───────────────────────────────────────

function checkRequiredObjects(
  state: WorldState,
  requiredIds: string[],
  errors: WorldValidationEntry[],
  info: WorldValidationEntry[],
): number {
  if (requiredIds.length === 0) return 1;

  let found = 0;
  for (const reqId of requiredIds) {
    const exists = state.objects.has(reqId);
    if (exists) {
      found++;
      info.push({ check: "required_object", message: `Required object "${reqId}" present`, target_id: reqId });
    } else {
      errors.push({ check: "required_object_missing", message: `Required object "${reqId}" is MISSING`, target_id: reqId });
    }
  }
  return found / requiredIds.length;
}

// ─── Support Validity ───────────────────────────────────────

function checkSupportValidity(
  state: WorldState,
  errors: WorldValidationEntry[],
  warnings: WorldValidationEntry[],
  info: WorldValidationEntry[],
): number {
  const objects = [...state.objects.values()];
  if (objects.length === 0) return 1;

  let validCount = 0;
  for (const obj of objects) {
    if (!obj.supported_by) {
      warnings.push({
        check: "no_support",
        message: `"${obj.name}" (${obj.id}) has no support surface assigned`,
        target_id: obj.id,
      });
      continue;
    }

    const surface = state.support_surfaces.get(obj.supported_by);
    if (!surface) {
      errors.push({
        check: "invalid_support",
        message: `"${obj.name}" references non-existent support surface "${obj.supported_by}"`,
        target_id: obj.id,
      });
      continue;
    }

    // Check grounding (bottom touches surface)
    const bottomY = obj.transform.position[1] - obj.transform.scale[1] / 2;
    const gap = Math.abs(bottomY - surface.surface_y);
    if (gap > 0.05) {
      warnings.push({
        check: "floating",
        message: `"${obj.name}" bottom (y=${bottomY.toFixed(3)}) does not touch surface "${surface.name}" (y=${surface.surface_y.toFixed(3)}), gap=${gap.toFixed(3)}`,
        target_id: obj.id,
      });
    } else {
      validCount++;
      info.push({
        check: "support_ok",
        message: `"${obj.name}" supported by "${surface.name}" (y=${surface.surface_y.toFixed(3)})`,
        target_id: obj.id,
      });
    }
  }

  return objects.length > 0 ? validCount / objects.length : 1;
}

// ─── Placement Rules ────────────────────────────────────────

function checkPlacementRules(
  state: WorldState,
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
        if (Math.abs(bottomY - surface.surface_y) <= 0.05) {
          passedChecks++;
        } else {
          warnings.push({
            check: "anchor_plane",
            message: `"${obj.name}" must touch anchor plane but gap detected`,
            target_id: obj.id,
          });
        }
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
          message: `"${obj.name}" must be upright but rotation=[${rot.join(",")}]`,
          target_id: obj.id,
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

        // Check if overlap is in no_overlap_with rules
        const aForbids = a.placement_rules.no_overlap_with.includes(b.id);
        const bForbids = b.placement_rules.no_overlap_with.includes(a.id);

        if (aForbids || bForbids) {
          errors.push({
            check: "no_overlap",
            message: `"${a.name}" overlaps with "${b.name}" (${overlap.toFixed(3)}m) — forbidden by placement rules`,
          });
        } else {
          warnings.push({
            check: "overlap",
            message: `"${a.name}" overlaps with "${b.name}" (${overlap.toFixed(3)}m)`,
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

  // Check that all objects have a region
  let valid = 0;
  for (const obj of objects) {
    if (state.regions.has(obj.region_id)) {
      valid++;
    } else {
      warnings.push({
        check: "orphan_object",
        message: `"${obj.name}" belongs to non-existent region "${obj.region_id}"`,
        target_id: obj.id,
      });
    }
  }

  // Check relations reference valid objects or support surfaces
  for (const rel of state.relations) {
    if (!state.objects.has(rel.source_id) && !state.support_surfaces.has(rel.source_id)) {
      warnings.push({ check: "dangling_relation", message: `Relation source "${rel.source_id}" not found` });
    }
    if (!state.objects.has(rel.target_id) && !state.support_surfaces.has(rel.target_id)) {
      warnings.push({ check: "dangling_relation", message: `Relation target "${rel.target_id}" not found` });
    }
  }

  const regionScore = objects.length > 0 ? valid / objects.length : 1;
  const coverageScore = requiredIds.length > 0
    ? requiredIds.filter((id) => state.objects.has(id)).length / requiredIds.length
    : 1;

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
      });
      pass = false;
    }

    if (widthRatio < rules.preferred_width_ratio[0] || widthRatio > rules.preferred_width_ratio[1]) {
      warnings.push({
        check: "proportion_width",
        message: `"${obj.name}" width ratio ${widthRatio.toFixed(3)} outside [${rules.preferred_width_ratio.join(",")}]`,
        target_id: obj.id,
      });
      pass = false;
    }

    if (depthRatio < rules.preferred_depth_ratio[0] || depthRatio > rules.preferred_depth_ratio[1]) {
      warnings.push({
        check: "proportion_depth",
        message: `"${obj.name}" depth ratio ${depthRatio.toFixed(3)} outside [${rules.preferred_depth_ratio.join(",")}]`,
        target_id: obj.id,
      });
      pass = false;
    }

    if (objH < rules.preferred_height_range[0] || objH > rules.preferred_height_range[1]) {
      warnings.push({
        check: "proportion_height",
        message: `"${obj.name}" height ${objH.toFixed(3)}m outside [${rules.preferred_height_range.join(",")}]m`,
        target_id: obj.id,
      });
      pass = false;
    }

    if (pass) {
      valid++;
      info.push({
        check: "proportion_ok",
        message: `"${obj.name}" proportions valid (area=${areaRatio.toFixed(3)}, w=${widthRatio.toFixed(3)}, d=${depthRatio.toFixed(3)}, h=${objH.toFixed(3)})`,
        target_id: obj.id,
      });
    }
  }

  return checked > 0 ? valid / checked : 1;
}

// ─── Orientation Check ─────────────────────────────────────

function checkOrientation(
  state: WorldState,
  warnings: WorldValidationEntry[],
  info: WorldValidationEntry[],
): number {
  const objects = [...state.objects.values()];
  if (objects.length === 0) return 1;

  let valid = 0;
  let checked = 0;

  for (const obj of objects) {
    const rules = obj.placement_rules.orientation;
    const yRot = obj.transform.rotation[1];

    // Check snap rotation
    if (rules.snap_rotation_deg > 0) {
      checked++;
      const remainder = Math.abs(yRot % rules.snap_rotation_deg);
      const snapped = remainder < 1 || Math.abs(remainder - rules.snap_rotation_deg) < 1;
      if (snapped) {
        valid++;
        info.push({
          check: "orientation_snap",
          message: `"${obj.name}" Y-rotation ${yRot}° snaps to ${rules.snap_rotation_deg}° increments`,
          target_id: obj.id,
        });
      } else {
        warnings.push({
          check: "orientation_snap",
          message: `"${obj.name}" Y-rotation ${yRot}° does not snap to ${rules.snap_rotation_deg}° increments`,
          target_id: obj.id,
        });
      }
    }

    // Check allowed rotations
    if (rules.allowed_y_rotations) {
      checked++;
      const normalizedRot = ((yRot % 360) + 360) % 360;
      const allowed = rules.allowed_y_rotations.some((r) => Math.abs(((r % 360 + 360) % 360) - normalizedRot) < 1);
      if (allowed) {
        valid++;
        info.push({
          check: "orientation_allowed",
          message: `"${obj.name}" Y-rotation ${yRot}° is in allowed set [${rules.allowed_y_rotations.join(",")}]`,
          target_id: obj.id,
        });
      } else {
        warnings.push({
          check: "orientation_allowed",
          message: `"${obj.name}" Y-rotation ${yRot}° not in allowed set [${rules.allowed_y_rotations.join(",")}]`,
          target_id: obj.id,
        });
      }
    }
  }

  return checked > 0 ? valid / checked : 1;
}

// ─── Zone Placement Check ──────────────────────────────────

function checkZonePlacement(
  state: WorldState,
  warnings: WorldValidationEntry[],
  info: WorldValidationEntry[],
): number {
  const objects = [...state.objects.values()];
  if (objects.length === 0) return 1;

  let valid = 0;
  let checked = 0;

  for (const obj of objects) {
    const zone = obj.placement_rules.preferred_zone;
    if (zone === "anywhere") continue;

    const surface = obj.supported_by ? state.support_surfaces.get(obj.supported_by) : null;
    if (!surface) continue;

    checked++;
    const actualZone = computeActualZone(obj, surface);
    const match = zoneMatches(zone, actualZone);

    if (match) {
      valid++;
      info.push({
        check: "zone_ok",
        message: `"${obj.name}" in zone "${actualZone}" matches preferred "${zone}"`,
        target_id: obj.id,
      });
    } else {
      warnings.push({
        check: "zone_mismatch",
        message: `"${obj.name}" in zone "${actualZone}" but preferred "${zone}"`,
        target_id: obj.id,
      });
    }
  }

  return checked > 0 ? valid / checked : 1;
}

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

  // any_edge matches all edge/corner positions
  if (preferred === "any_edge") {
    return ["left_edge", "right_edge", "front_edge", "back_edge",
            "front_left", "front_right", "back_left", "back_right"].includes(actual);
  }

  // any_corner matches corner positions
  if (preferred === "any_corner") {
    return ["front_left", "front_right", "back_left", "back_right"].includes(actual);
  }

  // back_right also matches right_edge or back_edge (close enough)
  if (preferred === "back_right") return actual === "back_right" || actual === "right_edge" || actual === "back_edge";
  if (preferred === "back_left") return actual === "back_left" || actual === "left_edge" || actual === "back_edge";
  if (preferred === "front_right") return actual === "front_right" || actual === "right_edge" || actual === "front_edge";
  if (preferred === "front_left") return actual === "front_left" || actual === "left_edge" || actual === "front_edge";

  return false;
}

// ─── Extract Required Object IDs from User Prompt ───────────

const KNOWN_OBJECTS: Record<string, string> = {
  table: "table", tisch: "table", desk: "table",
  laptop: "laptop", notebook: "laptop",
  lamp: "lamp", lampe: "lamp", "desk lamp": "lamp",
  "filing cabinet": "filing_cabinet", aktenschrank: "filing_cabinet", cabinet: "filing_cabinet",
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
