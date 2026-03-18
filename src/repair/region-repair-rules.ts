// Region Repair Rules: Regelt wie Regionen repariert werden
// Berücksichtigt Sub-Components und PlanObject-Regeln

import type {
  PlanObject, RegionRepairRule, Scene, Primitive,
  RepairPlan, SceneQuality, QualityViolation,
} from "../core/types.js";

// ─── Repair-Rules aus PlanObject ableiten ────────────────────

export function deriveRepairRules(plan: PlanObject): RegionRepairRule[] {
  return plan.areas.map((area) => ({
    region_id: area.id,
    sub_components: area.sub_components,
    repair_strategy: area.sub_components.length > 1 ? "rebuild_together" : "reposition",
    priority: plan.assembly_rules.find((r) => r.partId === area.id)?.priority ?? 5,
  }));
}

// ─── Standard Region-Repair-Rules ────────────────────────────

export const CAR_REPAIR_RULES: RegionRepairRule[] = [
  { region_id: "body", sub_components: ["main-chassis", "cabin", "hood", "trunk"], repair_strategy: "rebuild_together", priority: 1 },
  { region_id: "wheels", sub_components: ["tire", "rim"], repair_strategy: "rebuild_together", priority: 2 },
  { region_id: "windows", sub_components: ["windshield", "side-windows", "rear-window"], repair_strategy: "rebuild_together", priority: 3 },
  { region_id: "details", sub_components: ["front-lights", "rear-lights", "grille"], repair_strategy: "reposition", priority: 4 },
];

// ─── Region-spezifische Reparatur-Pläne ──────────────────────

export function planRegionRepairs(
  quality: SceneQuality,
  repairRules: RegionRepairRule[],
  scene: Scene,
): RepairPlan[] {
  const repairs: RepairPlan[] = [];

  // Gruppiere Violations nach Region
  const violationsByRegion = groupViolationsByRegion(quality.violations, scene);

  for (const rule of repairRules.sort((a, b) => a.priority - b.priority)) {
    const regionViolations = violationsByRegion.get(rule.region_id) ?? [];
    if (regionViolations.length === 0) continue;

    const errors = regionViolations.filter((v) => v.severity === "error");
    const warnings = regionViolations.filter((v) => v.severity === "warning");

    // Schwere Fehler: Strategie aus Rule
    if (errors.length > 0) {
      switch (rule.repair_strategy) {
        case "rebuild_together":
          // Alle Sub-Components der Region zusammen neu bauen
          repairs.push({
            regionId: rule.region_id,
            action: "reset_region",
            reason: `${errors.length} errors in ${rule.region_id} (sub-components: ${rule.sub_components.join(", ")}). Rebuilding together.`,
            priority: rule.priority,
            parameters: { newSeed: Date.now() },
          });
          break;
        case "reposition":
          // Betroffene Primitives verschieben
          for (const v of errors) {
            if (v.rule === "no_overlap" && v.affectedIds.length > 0) {
              repairs.push({
                regionId: rule.region_id,
                action: "reposition",
                reason: `Collision: ${v.message}`,
                priority: rule.priority,
                parameters: {
                  targetIds: v.affectedIds,
                  displacement: [0, 0.5, 0],
                },
              });
            }
          }
          break;
        case "remove_excess":
          repairs.push({
            regionId: rule.region_id,
            action: "remove_objects",
            reason: `${errors.length} errors in ${rule.region_id}, removing excess objects`,
            priority: rule.priority,
            parameters: {
              targetIds: errors.flatMap((v) => v.affectedIds).slice(0, 3),
            },
          });
          break;
      }
    }

    // Warnungen: Dichte/Höhe anpassen
    for (const w of warnings) {
      if (w.rule === "density") {
        repairs.push({
          regionId: rule.region_id,
          action: "tune_density",
          reason: `Density warning in ${rule.region_id}: ${w.message}`,
          priority: rule.priority + 10,
          parameters: { targetDensity: w.threshold },
        });
      }
      if (w.rule === "height_diff") {
        repairs.push({
          regionId: rule.region_id,
          action: "smooth_heights",
          reason: `Height warning in ${rule.region_id}: ${w.message}`,
          priority: rule.priority + 10,
          parameters: { maxHeight: w.threshold },
        });
      }
    }
  }

  return repairs.sort((a, b) => a.priority - b.priority);
}

// ─── Hilfsfunktionen ─────────────────────────────────────────

function groupViolationsByRegion(
  violations: QualityViolation[],
  scene: Scene,
): Map<string, QualityViolation[]> {
  const groups = new Map<string, QualityViolation[]>();

  for (const v of violations) {
    // Direkte Region-Zuordnung
    if (v.regionId) {
      if (!groups.has(v.regionId)) groups.set(v.regionId, []);
      groups.get(v.regionId)!.push(v);
      continue;
    }

    // Indirekte Zuordnung über betroffene Primitive-IDs
    for (const pid of v.affectedIds) {
      const prim = scene.primitives.find((p) => p.id === pid);
      if (prim) {
        const regionTag = prim.tags.find((t) => t.startsWith("part:"));
        const regionId = regionTag ? regionTag.slice(5) : "unknown";
        if (!groups.has(regionId)) groups.set(regionId, []);
        groups.get(regionId)!.push(v);
        break;
      }
    }
  }

  return groups;
}
