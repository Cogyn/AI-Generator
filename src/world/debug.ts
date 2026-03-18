// ─── Debug / Inspection ─────────────────────────────────────
// Clear separation: Regions = logical, Objects = physical, Support Surfaces = planes

import type { WorldState, WorldValidationResult } from "./types";

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

  const header = `Region: ${region.name} (${regionId}) [LOGICAL CONTAINER]`;
  const rows = objects.map(
    (o) => `  ${o.id} | ${o.name} | ${o.type} | pos=[${o.transform.position.map(v => v.toFixed(2)).join(",")}] | supported_by=${o.supported_by ?? "none"}`
  );
  return [header, ...rows].join("\n");
}

export function debugLockStatus(state: WorldState): string {
  const lines: string[] = ["=== Lock Status ===", "", "Regions (LOGICAL):"];

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
    "─── REGIONS (Logical Containers) ───",
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
      const exists = state.objects.has(id);
      lines.push(`  ${id}: ${exists ? "PRESENT" : "MISSING"}`);
    }
    const missing = requiredObjectIds.filter(id => !state.objects.has(id));
    if (missing.length > 0) {
      lines.push(`  MISSING REQUIRED: ${missing.join(", ")}`);
    }
  }

  if (validationResult) {
    lines.push("", "─── VALIDATION RESULTS ───");
    lines.push(`  Valid: ${validationResult.valid}`);
    lines.push(`  Score: ${(validationResult.score * 100).toFixed(1)}%`);
    lines.push("");
    lines.push("  Score Breakdown:");
    lines.push(`    Required Object Coverage: ${(validationResult.scores.required_object_coverage * 100).toFixed(0)}%`);
    lines.push(`    Support Validity:         ${(validationResult.scores.support_validity * 100).toFixed(0)}%`);
    lines.push(`    Placement Validity:       ${(validationResult.scores.placement_validity * 100).toFixed(0)}%`);
    lines.push(`    Overlap Score:            ${(validationResult.scores.overlap_score * 100).toFixed(0)}%`);
    lines.push(`    Semantic Completeness:    ${(validationResult.scores.semantic_completeness * 100).toFixed(0)}%`);
    lines.push(`    Proportion Score:         ${(validationResult.scores.proportion_score * 100).toFixed(0)}%`);
    lines.push(`    Orientation Score:        ${(validationResult.scores.orientation_score * 100).toFixed(0)}%`);
    lines.push(`    Zone Placement Score:     ${(validationResult.scores.zone_placement_score * 100).toFixed(0)}%`);

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
    lines.push(`    Proportion: max_area=${p.max_area_ratio} w_ratio=[${p.preferred_width_ratio.join(",")}] d_ratio=[${p.preferred_depth_ratio.join(",")}] h_range=[${p.preferred_height_range.join(",")}]m`);
    lines.push(`    Orientation: axis=${o.primary_axis} front=[${o.front_direction.join(",")}] snap=${o.snap_rotation_deg}° allowed=${o.allowed_y_rotations ? `[${o.allowed_y_rotations.join(",")}]` : "any"}`);
  }
  return lines.join("\n");
}

// ─── Helpers ────────────────────────────────────────────────

function padRow(cols: string[], width = 20): string {
  return cols.map((c) => c.padEnd(width)).join(" | ");
}
