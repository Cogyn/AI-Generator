// ─── Debug / Inspection ─────────────────────────────────────
// FIX 7: Enhanced debug output with per-object metrics
// Clear separation: Regions = logical, Objects = physical, Support Surfaces = planes

import type { WorldState, WorldValidationResult, ObjectMetrics } from "./types";
import { canonicalObjectName, computeAllObjectMetrics } from "./validation";

export function debugListAllObjects(state: WorldState): string {
  const objects = [...state.objects.values()];
  if (objects.length === 0) return "No objects in world.";

  const header = padRow(["ID", "Name", "Type", "Region", "Supported By", "Locked", "Editable", "AI"]);
  const sep = "-".repeat(header.length);
  const rows = objects.map((o) =>
    padRow([
      o.id,
      o.name,
      o.type,
      o.region_id,
      o.supported_by ?? "none",
      String(o.locked),
      String(o.editable),
      String(o.ai_allowed),
    ])
  );
  return [header, sep, ...rows].join("\n");
}

export function debugListRegions(state: WorldState): string {
  const regions = [...state.regions.values()];
  if (regions.length === 0) return "No regions in world.";

  const header = padRow(["ID", "Name", "Type", "Objects", "Locked", "Editable", "AI"]);
  const sep = "-".repeat(header.length);
  const rows = regions.map((r) =>
    padRow([
      r.region_id,
      r.name,
      r.type,
      String(r.object_ids.length),
      String(r.locked),
      String(r.editable),
      String(r.ai_allowed),
    ])
  );
  return [header, sep, ...rows].join("\n");
}

export function debugListSupportSurfaces(state: WorldState): string {
  const surfaces = [...state.support_surfaces.values()];
  if (surfaces.length === 0) return "No support surfaces in world.";

  const header = padRow(["ID", "Name", "Type", "Y", "Owner", "Region"]);
  const sep = "-".repeat(header.length);
  const rows = surfaces.map((s) =>
    padRow([
      s.surface_id,
      s.name,
      s.type,
      s.surface_y.toFixed(3),
      s.owner_object_id ?? "ground",
      s.region_id,
    ])
  );
  return [header, sep, ...rows].join("\n");
}

export function debugObjectsByRegion(state: WorldState, regionId: string): string {
  const region = state.regions.get(regionId);
  if (!region) return `Region '${regionId}' not found.`;

  const objects = [...state.objects.values()].filter((o) => o.region_id === regionId);
  if (objects.length === 0) return `Region '${region.name}' has no objects.`;

  const header = `Region: ${region.name} (${regionId}) [LOGICAL CONTAINER — no primitives]`;
  const rows = objects.map(
    (o) => `  ${o.id} | ${o.name} | ${o.type} | pos=[${o.transform.position.map(v => v.toFixed(2)).join(",")}] | supported_by=${o.supported_by ?? "none"}`
  );
  return [header, ...rows].join("\n");
}

export function debugLockStatus(state: WorldState): string {
  const lines: string[] = ["=== Lock Status ===", "", "Regions (LOGICAL — no primitives):"];

  for (const r of state.regions.values()) {
    lines.push(
      `  ${r.region_id} (${r.name}): locked=${r.locked} editable=${r.editable} ai=${r.ai_allowed}`
    );
  }

  lines.push("", "Objects (PHYSICAL):");
  for (const o of state.objects.values()) {
    lines.push(
      `  ${o.id} (${o.name}): locked=${o.locked} editable=${o.editable} ai=${o.ai_allowed} override=${o.manual_override}`
    );
  }

  return lines.join("\n");
}

export function debugRelations(state: WorldState): string {
  if (state.relations.length === 0) return "No relations.";

  const header = padRow(["Source", "Relation", "Target"]);
  const sep = "-".repeat(header.length);
  const rows = state.relations.map((r) => {
    const srcName = state.objects.get(r.source_id)?.name ?? r.source_id;
    const tgtName = state.objects.get(r.target_id)?.name
      ?? state.support_surfaces.get(r.target_id)?.name
      ?? r.target_id;
    return padRow([srcName, r.type, tgtName]);
  });
  return [header, sep, ...rows].join("\n");
}

export function debugSupportChain(state: WorldState): string {
  const lines: string[] = ["=== Support Chain ==="];

  for (const obj of state.objects.values()) {
    const surface = obj.supported_by ? state.support_surfaces.get(obj.supported_by) : null;
    const surfaceName = surface?.name ?? "NONE";
    const owner = surface?.owner_object_id
      ? state.objects.get(surface.owner_object_id)?.name ?? surface.owner_object_id
      : "ground";
    const bottomY = obj.transform.position[1] - obj.transform.scale[1] / 2;
    const gap = surface ? Math.abs(bottomY - surface.surface_y) : NaN;
    const grounded = gap <= 0.05 ? "OK" : `GAP=${gap.toFixed(3)}`;

    lines.push(
      `  ${obj.name} -> ${surfaceName} (owned by: ${owner}) [${grounded}]`
    );
  }

  return lines.join("\n");
}

// ─── FIX 7: Enhanced Per-Object Debug ──────────────────────

export function debugObjectMetrics(state: WorldState): string {
  const metrics = computeAllObjectMetrics(state);
  if (metrics.length === 0) return "  No objects.";

  const lines: string[] = [];

  for (const m of metrics) {
    lines.push(`  ${m.original_name} (${m.object_id}):`);
    lines.push(`    canonical_name:    ${m.canonical_name}`);
    lines.push(`    object_type:       ${m.object_type}`);
    lines.push(`    --- Height ---`);
    lines.push(`    object_bottom_y:   ${m.height.object_bottom_y.toFixed(4)}`);
    lines.push(`    object_top_y:      ${m.height.object_top_y.toFixed(4)}`);
    lines.push(`    object_height:     ${m.height.object_height.toFixed(4)}m`);
    lines.push(`    support_plane_y:   ${m.height.support_plane_y.toFixed(4)}`);
    lines.push(`    contact_gap:       ${m.height.contact_gap.toFixed(4)}m`);
    lines.push(`    grounded:          ${m.height.grounded}`);
    lines.push(`    --- Support ---`);
    lines.push(`    support_surface:   ${m.support.support_surface_name} (${m.support.support_surface_id ?? "none"})`);
    lines.push(`    support_valid:     ${m.support.support_valid}`);
    lines.push(`    within_bounds:     ${m.support.within_bounds}`);
    lines.push(`    support_score:     ${(m.support.support_score * 100).toFixed(0)}%`);
    lines.push(`    --- Zone ---`);
    lines.push(`    preferred_zone:    ${m.zone.preferred_zone}`);
    lines.push(`    actual_zone:       ${m.zone.actual_zone}`);
    lines.push(`    zone_match:        ${m.zone.zone_match}`);
    lines.push(`    zone_distance:     ${m.zone.zone_distance.toFixed(3)}`);
    lines.push(`    zone_score:        ${(m.zone.zone_score * 100).toFixed(0)}%`);
    lines.push(`    --- Orientation ---`);
    lines.push(`    rotation:          [${m.orientation.rotation.map(v => v.toFixed(1)).join(", ")}]`);
    lines.push(`    snap_valid:        ${m.orientation.snap_valid}`);
    lines.push(`    allowed_rot_valid: ${m.orientation.allowed_rotation_valid}`);
    lines.push(`    upright:           ${m.orientation.upright}`);
    lines.push(`    orientation_score: ${(m.orientation.orientation_score * 100).toFixed(0)}%`);
    lines.push("");
  }

  return lines.join("\n");
}

// ─── FIX 7: Enhanced Full Report ───────────────────────────

export function debugFullReport(
  state: WorldState,
  requiredObjectIds: string[],
  validationResult?: WorldValidationResult,
): string {
  const lines: string[] = [
    "╔══════════════════════════════════════════════════════════════╗",
    "║                    WORLD STATE REPORT                      ║",
    "╚══════════════════════════════════════════════════════════════╝",
    "",
    "─── REGIONS (Logical Containers — NO primitives) ───",
    debugListRegions(state),
    "",
    "─── SUPPORT SURFACES (Physical Planes) ───",
    debugListSupportSurfaces(state),
    "",
    "─── OBJECTS (Physical Things) ───",
    debugListAllObjects(state),
    "",
    "─── SUPPORT CHAIN ───",
    debugSupportChain(state),
    "",
    "─── PER-OBJECT METRICS (height / support / zone / orientation) ───",
    debugObjectMetrics(state),
    "",
    "─── PLACEMENT RULES (Zone / Proportion / Orientation) ───",
    debugPlacementRules(state),
    "",
    "─── RELATIONS ───",
    debugRelations(state),
    "",
    "─── REQUIRED OBJECTS ───",
  ];

  if (requiredObjectIds.length === 0) {
    lines.push("  (none specified)");
  } else {
    for (const id of requiredObjectIds) {
      const canonical = canonicalObjectName(id);
      // Check by canonical match against all objects
      let matchedObj: string | null = null;
      for (const [objId, obj] of state.objects) {
        if (canonicalObjectName(objId) === canonical || canonicalObjectName(obj.name) === canonical) {
          matchedObj = objId;
          break;
        }
      }
      const status = matchedObj ? `PRESENT (matched: ${matchedObj})` : "MISSING";
      lines.push(`  ${id} (canonical: ${canonical}): ${status}`);
    }

    const missing = requiredObjectIds.filter((id) => {
      const canonical = canonicalObjectName(id);
      for (const [objId, obj] of state.objects) {
        if (canonicalObjectName(objId) === canonical || canonicalObjectName(obj.name) === canonical) {
          return false;
        }
      }
      return true;
    });
    if (missing.length > 0) {
      lines.push(`  MISSING REQUIRED: ${missing.join(", ")}`);
    } else {
      lines.push(`  ALL REQUIRED OBJECTS PRESENT`);
    }
  }

  if (validationResult) {
    lines.push("", "─── VALIDATION RESULTS ───");
    lines.push(`  Valid: ${validationResult.valid}`);
    lines.push(`  Overall Score: ${(validationResult.score * 100).toFixed(1)}%`);
    lines.push("");
    lines.push("  Score Breakdown:");
    lines.push(`    Required Object Coverage:  ${(validationResult.scores.required_object_coverage * 100).toFixed(0)}%`);
    lines.push(`    Support Validity:          ${(validationResult.scores.support_validity * 100).toFixed(0)}%`);
    lines.push(`    Placement Validity:        ${(validationResult.scores.placement_validity * 100).toFixed(0)}%`);
    lines.push(`    Overlap Score:             ${(validationResult.scores.overlap_score * 100).toFixed(0)}%`);
    lines.push(`    Semantic Completeness:     ${(validationResult.scores.semantic_completeness * 100).toFixed(0)}%`);
    lines.push(`    Proportion Score:          ${(validationResult.scores.proportion_score * 100).toFixed(0)}%`);
    lines.push(`    Orientation Score:         ${(validationResult.scores.orientation_score * 100).toFixed(0)}%`);
    lines.push(`    Zone Placement Score:      ${(validationResult.scores.zone_placement_score * 100).toFixed(0)}%`);
    lines.push(`    Height Relation Score:     ${(validationResult.scores.height_relation_score * 100).toFixed(0)}%`);
    lines.push(`    Semantic Relation Score:   ${(validationResult.scores.semantic_relation_score * 100).toFixed(0)}%`);

    // Required object matches
    if (validationResult.required_object_matches.length > 0) {
      lines.push("");
      lines.push("  Required Object Matches:");
      for (const m of validationResult.required_object_matches) {
        const status = m.found ? `FOUND -> ${m.matched_object_id}` : "MISSING";
        lines.push(`    "${m.required_name}" (canonical: "${m.canonical_name}"): ${status}`);
      }
    }

    // Violations by category
    if (Object.keys(validationResult.violations_by_category).length > 0) {
      lines.push("");
      lines.push("  Violations by Category:");
      for (const [cat, count] of Object.entries(validationResult.violations_by_category).sort((a, b) => b[1] - a[1])) {
        lines.push(`    ${cat}: ${count}`);
      }
    }

    if (validationResult.errors.length > 0) {
      lines.push("");
      lines.push("  ERRORS:");
      for (const e of validationResult.errors) {
        lines.push(`    [${e.check}] ${e.message}`);
      }
    }

    if (validationResult.warnings.length > 0) {
      lines.push("");
      lines.push("  WARNINGS:");
      for (const w of validationResult.warnings) {
        lines.push(`    [${w.check}] ${w.message}`);
      }
    }

    if (validationResult.info.length > 0) {
      lines.push("");
      lines.push("  INFO:");
      for (const i of validationResult.info) {
        lines.push(`    [${i.check}] ${i.message}`);
      }
    }
  }

  return lines.join("\n");
}

export function debugPlacementRules(state: WorldState): string {
  const objects = [...state.objects.values()];
  if (objects.length === 0) return "  No objects.";

  const lines: string[] = [];
  for (const obj of objects) {
    const r = obj.placement_rules;
    const p = r.proportion;
    const o = r.orientation;
    lines.push(`  ${obj.name} (${obj.id}):`);
    lines.push(`    Zone: preferred=${r.preferred_zone} avoid_center=${r.avoid_center}`);
    lines.push(`    Support: must_touch=${r.must_touch_anchor_plane} no_floating=${r.no_floating} upright=${r.upright_only}`);
    lines.push(`    Bounds: keep_within=${r.keep_within_bounds ?? "none"}`);
    lines.push(`    Proportion: max_area=${p.max_area_ratio} w_ratio=[${p.preferred_width_ratio.join(",")}] d_ratio=[${p.preferred_depth_ratio.join(",")}] h_range=[${p.preferred_height_range.join(",")}]m`);
    lines.push(`    Orientation: axis=${o.primary_axis} front=[${o.front_direction.join(",")}] snap=${o.snap_rotation_deg}deg allowed=${o.allowed_y_rotations ? `[${o.allowed_y_rotations.join(",")}]` : "any"}`);
    lines.push(`    Near: ${r.near_object ?? "none"} | No-overlap: [${r.no_overlap_with.join(", ")}]`);
  }
  return lines.join("\n");
}

// ─── Helpers ────────────────────────────────────────────────

function padRow(cols: string[], width = 20): string {
  return cols.map((c) => c.padEnd(width)).join(" | ");
}
