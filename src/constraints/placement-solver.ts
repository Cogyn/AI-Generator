// ─── Placement Solver: Berechnet konkrete Positionen aus Constraint-Specs ────
// Rein deterministisch, keine KI. Zentrale räumliche Logik.

import type { Vec3 } from "../core/types.js";
import type { AnchorRelation, PlacementZone } from "./constraint-types.js";
import type {
  ObjectConstraintSpec, PlacementResult, AnchorInfo,
  SolvedConstraint, FailedConstraint, RepairAction,
} from "./object-constraint-spec.js";

// ─── Hauptfunktion: Spec → PlacementResult ──────────────────

export function solvePlacement(
  spec: ObjectConstraintSpec,
  anchor: AnchorInfo,
  placedObjects: Map<string, { position: Vec3; size: Vec3 }>,
): PlacementResult {
  const solved: SolvedConstraint[] = [];
  const failed: FailedConstraint[] = [];
  const warnings: string[] = [];
  const repairs: RepairAction[] = [];

  // 1. Größe bestimmen (Size Constraints)
  let finalSize = resolveSize(spec, anchor, solved, failed, warnings);

  // 2. Position bestimmen (Anchor + Placement Constraints)
  let finalPosition = resolvePosition(spec, anchor, finalSize, solved, failed, warnings);

  // 3. Rotation bestimmen
  const finalRotation = resolveRotation(spec, solved, failed);

  // 4. Kollisionsprüfung + Reparatur
  const collisionResult = resolveCollisions(
    spec, finalPosition, finalSize, placedObjects, solved, failed, warnings, repairs,
  );
  finalPosition = collisionResult.position;
  finalSize = collisionResult.size;

  // 5. Bounds-Check: Liegt das Objekt innerhalb des Ankers?
  if (spec.placement_rules.keep_within_bounds) {
    const boundsResult = enforceBounds(finalPosition, finalSize, anchor, warnings, repairs);
    finalPosition = boundsResult;
    solved.push({ constraint_type: "placement", rule: "keep_within_bounds", status: "satisfied" });
  }

  // 6. Contact-Check: Berührt die Unterseite den Anker?
  if (spec.semantic_rules.must_be_on_surface) {
    const contactY = anchor.surface_y;
    if (Math.abs(finalPosition[1] - finalSize[1] / 2 - contactY) > 0.01) {
      finalPosition = [finalPosition[0], contactY + finalSize[1] / 2, finalPosition[2]];
      repairs.push({
        action: "reposition",
        description: `Y auf Ankerfläche korrigiert (y=${contactY})`,
        old_value: finalPosition[1],
        new_value: contactY + finalSize[1] / 2,
      });
    }
    solved.push({ constraint_type: "contact", rule: "must_touch_anchor_plane", status: "satisfied" });
  }

  // 7. Gravity: Nicht schweben
  if (spec.semantic_rules.gravity_bound && finalPosition[1] - finalSize[1] / 2 < -0.01) {
    finalPosition = [finalPosition[0], finalSize[1] / 2, finalPosition[2]];
    warnings.push("Objekt war unter dem Boden, auf Y=0 korrigiert");
  }

  const success = failed.filter((f) => f.severity === "error").length === 0;

  return {
    object_id: spec.object_id,
    success,
    final_position: finalPosition,
    final_rotation: finalRotation,
    final_scale: 1.0,
    final_size: finalSize,
    solved_constraints: solved,
    failed_constraints: failed,
    warnings,
    repair_actions: repairs,
  };
}

// ─── Größe bestimmen ─────────────────────────────────────────

function resolveSize(
  spec: ObjectConstraintSpec,
  anchor: AnchorInfo,
  solved: SolvedConstraint[],
  failed: FailedConstraint[],
  warnings: string[],
): Vec3 {
  let size: Vec3 = [...spec.size_rules.preferred_size];

  // Max Area Ratio: Objekt darf max X% der Ankerfläche einnehmen
  if (spec.size_rules.max_area_ratio_of_anchor != null) {
    const anchorArea = anchor.size[0] * anchor.size[2]; // X * Z
    const maxArea = anchorArea * spec.size_rules.max_area_ratio_of_anchor;
    const objectArea = size[0] * size[2];

    if (objectArea > maxArea) {
      const scaleFactor = Math.sqrt(maxArea / objectArea);
      size = [size[0] * scaleFactor, size[1], size[2] * scaleFactor];
      warnings.push(`Größe auf ${(spec.size_rules.max_area_ratio_of_anchor * 100).toFixed(0)}% der Ankerfläche skaliert`);
    }
    solved.push({ constraint_type: "size", rule: "max_area_ratio_of_anchor", status: "satisfied" });
  }

  // Min/Max Size Clamp
  if (spec.size_rules.min_size) {
    for (let i = 0; i < 3; i++) {
      if (size[i] < spec.size_rules.min_size[i]) {
        size[i] = spec.size_rules.min_size[i];
      }
    }
  }
  if (spec.size_rules.max_size) {
    for (let i = 0; i < 3; i++) {
      if (size[i] > spec.size_rules.max_size[i]) {
        size[i] = spec.size_rules.max_size[i];
      }
    }
  }

  solved.push({ constraint_type: "size", rule: "preferred_size_range", status: "satisfied" });
  return size;
}

// ─── Position bestimmen ──────────────────────────────────────

function resolvePosition(
  spec: ObjectConstraintSpec,
  anchor: AnchorInfo,
  size: Vec3,
  solved: SolvedConstraint[],
  failed: FailedConstraint[],
  warnings: string[],
): Vec3 {
  // Basis-Y aus Anchor-Relation
  let y = resolveAnchorY(spec.relation_to_anchor, anchor, size);

  // XZ aus Placement-Zone
  const { x, z } = resolveZone(
    spec.placement_rules.preferred_zone,
    anchor,
    size,
    spec.placement_rules.min_edge_clearance,
  );

  solved.push({ constraint_type: "anchor", rule: spec.relation_to_anchor, status: "satisfied" });
  solved.push({ constraint_type: "placement", rule: "preferred_zone", status: "satisfied" });

  return [x, y, z];
}

function resolveAnchorY(
  relation: AnchorRelation,
  anchor: AnchorInfo,
  size: Vec3,
): number {
  switch (relation) {
    case "on_top_of":
    case "supported_by":
      return anchor.surface_y + size[1] / 2;  // Unterseite auf Oberfläche
    case "under":
      return anchor.position[1] - anchor.size[1] / 2 - size[1] / 2;
    case "beside_left":
    case "beside_right":
    case "in_front_of":
    case "behind":
      return anchor.position[1] - anchor.size[1] / 2 + size[1] / 2; // Gleiche Bodenhöhe
    case "attached_to":
      return anchor.surface_y + size[1] / 2;
    case "inside_bounds_of":
      return anchor.position[1]; // Zentriert im Anker
    default:
      return anchor.surface_y + size[1] / 2;
  }
}

function resolveZone(
  zone: PlacementZone,
  anchor: AnchorInfo,
  size: Vec3,
  clearance: number,
): { x: number; z: number } {
  const sb = anchor.surface_bounds;
  const cx = (sb.min_x + sb.max_x) / 2;
  const cz = (sb.min_z + sb.max_z) / 2;
  const hw = (sb.max_x - sb.min_x) / 2;
  const hd = (sb.max_z - sb.min_z) / 2;

  // Verfügbarer Bereich (mit Clearance)
  const avail_hw = Math.max(0, hw - clearance - size[0] / 2);
  const avail_hd = Math.max(0, hd - clearance - size[2] / 2);

  switch (zone) {
    case "center":        return { x: cx, z: cz };
    case "front_center":  return { x: cx, z: cz + avail_hd * 0.7 };
    case "back_center":   return { x: cx, z: cz - avail_hd * 0.7 };
    case "back_left":     return { x: cx - avail_hw * 0.7, z: cz - avail_hd * 0.7 };
    case "back_right":    return { x: cx + avail_hw * 0.7, z: cz - avail_hd * 0.7 };
    case "front_left":    return { x: cx - avail_hw * 0.7, z: cz + avail_hd * 0.7 };
    case "front_right":   return { x: cx + avail_hw * 0.7, z: cz + avail_hd * 0.7 };
    case "left_edge":     return { x: cx - avail_hw * 0.8, z: cz };
    case "right_edge":    return { x: cx + avail_hw * 0.8, z: cz };
    case "any_edge":      return { x: cx + avail_hw * 0.8, z: cz }; // Default: rechts
    case "any_corner":    return { x: cx + avail_hw * 0.7, z: cz - avail_hd * 0.7 }; // Default: hinten rechts
    case "anywhere":      return { x: cx, z: cz };
    default:              return { x: cx, z: cz };
  }
}

// ─── Rotation bestimmen ──────────────────────────────────────

function resolveRotation(
  spec: ObjectConstraintSpec,
  solved: SolvedConstraint[],
  failed: FailedConstraint[],
): Vec3 {
  if (spec.rotation_rules.fixed_rotation) {
    solved.push({ constraint_type: "rotation", rule: "fixed_rotation", status: "satisfied" });
    return [...spec.rotation_rules.fixed_rotation];
  }

  if (spec.rotation_rules.upright_only) {
    solved.push({ constraint_type: "rotation", rule: "upright_only", status: "satisfied" });

    // Nur Y-Rotation erlaubt
    if (spec.rotation_rules.allowed_y_rotations && spec.rotation_rules.allowed_y_rotations.length > 0) {
      return [0, spec.rotation_rules.allowed_y_rotations[0], 0];
    }
    return [0, 0, 0];
  }

  return [0, 0, 0];
}

// ─── Kollisionsprüfung + Reparatur ───────────────────────────

function resolveCollisions(
  spec: ObjectConstraintSpec,
  position: Vec3,
  size: Vec3,
  placedObjects: Map<string, { position: Vec3; size: Vec3 }>,
  solved: SolvedConstraint[],
  failed: FailedConstraint[],
  warnings: string[],
  repairs: RepairAction[],
): { position: Vec3; size: Vec3 } {
  if (!spec.collision_rules.no_overlap) {
    return { position, size };
  }

  let pos: Vec3 = [...position];
  let sz: Vec3 = [...size];
  let attempts = 0;
  const maxAttempts = spec.max_reposition_attempts;

  while (attempts < maxAttempts) {
    let hasCollision = false;

    for (const [otherId, other] of placedObjects) {
      if (otherId === spec.object_id) continue;
      if (spec.collision_rules.avoid_ids && !spec.collision_rules.avoid_ids.includes(otherId)) {
        // Wenn avoid_ids gesetzt ist, nur diese prüfen
      }

      const overlap = computeOverlap(pos, sz, other.position, other.size, spec.collision_rules.min_spacing);
      if (overlap) {
        hasCollision = true;
        // Verschiebe weg von der Kollision
        const pushDir = computePushDirection(pos, other.position);
        const pushDist = overlap + spec.collision_rules.min_spacing + 0.1;
        const oldPos: Vec3 = [...pos];
        pos = [
          pos[0] + pushDir[0] * pushDist,
          pos[1],
          pos[2] + pushDir[2] * pushDist,
        ];
        repairs.push({
          action: "reposition",
          description: `Kollision mit "${otherId}" aufgelöst`,
          old_value: oldPos,
          new_value: [...pos],
        });
        break; // Neustart der Schleife
      }
    }

    if (!hasCollision) {
      solved.push({ constraint_type: "collision", rule: "no_overlap_any", status: "satisfied" });
      return { position: pos, size: sz };
    }

    attempts++;
  }

  // Nach max Attempts: Warnung
  if (attempts >= maxAttempts) {
    failed.push({
      constraint_type: "collision",
      rule: "no_overlap_any",
      status: "partially_satisfied",
      message: `Kollision nach ${maxAttempts} Versuchen nicht vollständig gelöst`,
      severity: "warning",
    });
  }

  return { position: pos, size: sz };
}

function computeOverlap(
  posA: Vec3, sizeA: Vec3,
  posB: Vec3, sizeB: Vec3,
  spacing: number,
): number | null {
  const halfA: Vec3 = [sizeA[0] / 2 + spacing / 2, sizeA[1] / 2, sizeA[2] / 2 + spacing / 2];
  const halfB: Vec3 = [sizeB[0] / 2 + spacing / 2, sizeB[1] / 2, sizeB[2] / 2 + spacing / 2];

  let minOverlap = Infinity;
  let anyNonOverlap = false;

  for (let i = 0; i < 3; i++) {
    const overlap = (halfA[i] + halfB[i]) - Math.abs(posA[i] - posB[i]);
    if (overlap <= 0) {
      anyNonOverlap = true;
      break;
    }
    minOverlap = Math.min(minOverlap, overlap);
  }

  return anyNonOverlap ? null : minOverlap;
}

function computePushDirection(posA: Vec3, posB: Vec3): Vec3 {
  const dx = posA[0] - posB[0];
  const dz = posA[2] - posB[2];
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < 0.001) return [1, 0, 0]; // Default: nach rechts
  return [dx / len, 0, dz / len];
}

// ─── Bounds enforcing ────────────────────────────────────────

function enforceBounds(
  position: Vec3,
  size: Vec3,
  anchor: AnchorInfo,
  warnings: string[],
  repairs: RepairAction[],
): Vec3 {
  const pos: Vec3 = [...position];
  const sb = anchor.surface_bounds;
  const halfW = size[0] / 2;
  const halfD = size[2] / 2;

  let clamped = false;
  if (pos[0] - halfW < sb.min_x) { pos[0] = sb.min_x + halfW; clamped = true; }
  if (pos[0] + halfW > sb.max_x) { pos[0] = sb.max_x - halfW; clamped = true; }
  if (pos[2] - halfD < sb.min_z) { pos[2] = sb.min_z + halfD; clamped = true; }
  if (pos[2] + halfD > sb.max_z) { pos[2] = sb.max_z - halfD; clamped = true; }

  if (clamped) {
    warnings.push("Position auf Anker-Grenzen korrigiert");
    repairs.push({
      action: "reposition",
      description: "Bounds-Clamp: Objekt innerhalb des Ankers verschoben",
      old_value: position,
      new_value: [...pos],
    });
  }

  return pos;
}
