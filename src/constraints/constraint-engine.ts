// ─── Constraint Engine: Orchestriert alle ObjectConstraintSpecs → PlacementResults ──
// Nimmt alle Specs + Szene-Zustand, löst Placement deterministisch in richtiger Reihenfolge.

import type { Vec3, Primitive, Scene } from "../core/types.js";
import type {
  ObjectConstraintSpec, PlacementResult, AnchorInfo, PrimitiveIntent,
} from "./object-constraint-spec.js";
import { solvePlacement } from "./placement-solver.js";

// ─── Engine Result ──────────────────────────────────────────

export interface ConstraintEngineResult {
  placements: PlacementResult[];
  primitives: Primitive[];
  warnings: string[];
  stats: {
    total_specs: number;
    successful: number;
    failed: number;
    total_repairs: number;
    total_collisions_resolved: number;
  };
}

// ─── Hauptfunktion: Alle Specs → PlacementResults + Primitives ──

export function solveAllConstraints(
  specs: ObjectConstraintSpec[],
  anchorSpecs: ObjectConstraintSpec[],
): ConstraintEngineResult {
  const placements: PlacementResult[] = [];
  const allPrimitives: Primitive[] = [];
  const warnings: string[] = [];
  const placedObjects = new Map<string, { position: Vec3; size: Vec3 }>();

  // 1. Topologische Sortierung: Anker zuerst, dann abhängige Objekte
  const ordered = topologicalSort([...anchorSpecs, ...specs]);

  // 2. Anker-Objekte zuerst platzieren (haben feste Positionen)
  for (const spec of ordered) {
    const isAnchor = anchorSpecs.some((a) => a.object_id === spec.object_id);

    if (isAnchor) {
      // Anker-Objekte: Position ist vorgegeben, direkt platzieren
      const anchorInfo = createSelfAnchor(spec);
      const result = solvePlacement(spec, anchorInfo, placedObjects);
      placements.push(result);

      if (result.success) {
        placedObjects.set(spec.object_id, {
          position: result.final_position,
          size: result.final_size,
        });
        const prims = buildPrimitivesFromSpec(spec, result);
        allPrimitives.push(...prims);
      } else {
        warnings.push(`Anker "${spec.object_id}" konnte nicht platziert werden`);
      }
    } else {
      // Abhängige Objekte: Anchor-Info aus bereits platzierten Objekten
      const anchorInfo = getAnchorInfo(spec.anchor_target, placedObjects);
      if (!anchorInfo) {
        warnings.push(
          `Anker "${spec.anchor_target}" für "${spec.object_id}" nicht gefunden – übersprungen`,
        );
        placements.push({
          object_id: spec.object_id,
          success: false,
          final_position: [0, 0, 0],
          final_rotation: [0, 0, 0],
          final_scale: 1,
          final_size: spec.size_rules.preferred_size,
          solved_constraints: [],
          failed_constraints: [{
            constraint_type: "anchor",
            rule: "anchor_exists",
            status: "violated",
            message: `Anker "${spec.anchor_target}" nicht in platzierten Objekten gefunden`,
            severity: "error",
          }],
          warnings: [],
          repair_actions: [],
        });
        continue;
      }

      const result = solvePlacement(spec, anchorInfo, placedObjects);
      placements.push(result);

      if (result.success) {
        placedObjects.set(spec.object_id, {
          position: result.final_position,
          size: result.final_size,
        });
        const prims = buildPrimitivesFromSpec(spec, result);
        allPrimitives.push(...prims);
      } else {
        warnings.push(`"${spec.object_id}" Platzierung fehlgeschlagen: ${
          result.failed_constraints.map((f) => f.message).join("; ")
        }`);
      }
    }
  }

  // 3. Statistiken berechnen
  const successful = placements.filter((p) => p.success).length;
  const totalRepairs = placements.reduce((s, p) => s + p.repair_actions.length, 0);
  const collisionsResolved = placements.reduce((s, p) =>
    s + p.repair_actions.filter((r) => r.description.includes("Kollision")).length, 0,
  );

  return {
    placements,
    primitives: allPrimitives,
    warnings,
    stats: {
      total_specs: ordered.length,
      successful,
      failed: ordered.length - successful,
      total_repairs: totalRepairs,
      total_collisions_resolved: collisionsResolved,
    },
  };
}

// ─── Topologische Sortierung nach Anker-Abhängigkeiten ──────

function topologicalSort(specs: ObjectConstraintSpec[]): ObjectConstraintSpec[] {
  const byId = new Map(specs.map((s) => [s.object_id, s]));
  const visited = new Set<string>();
  const result: ObjectConstraintSpec[] = [];

  function visit(id: string) {
    if (visited.has(id)) return;
    visited.add(id);

    const spec = byId.get(id);
    if (!spec) return;

    // Erst den Anker besuchen (wenn er in unserer Spec-Liste ist)
    if (spec.anchor_target && byId.has(spec.anchor_target)) {
      visit(spec.anchor_target);
    }

    result.push(spec);
  }

  for (const spec of specs) {
    visit(spec.object_id);
  }

  return result;
}

// ─── Self-Anchor: Anker-Objekt erzeugt eigene AnchorInfo ────

function createSelfAnchor(spec: ObjectConstraintSpec): AnchorInfo {
  const size = spec.size_rules.preferred_size;
  // Anker sitzt auf Y=0 (Boden)
  const position: Vec3 = [0, size[1] / 2, 0];
  const surfaceY = size[1]; // Oberfläche = oben

  return {
    id: spec.object_id,
    position,
    size,
    surface_y: surfaceY,
    surface_bounds: {
      min_x: position[0] - size[0] / 2,
      max_x: position[0] + size[0] / 2,
      min_z: position[2] - size[2] / 2,
      max_z: position[2] + size[2] / 2,
    },
  };
}

// ─── AnchorInfo aus platzierten Objekten extrahieren ─────────

function getAnchorInfo(
  anchorId: string,
  placedObjects: Map<string, { position: Vec3; size: Vec3 }>,
): AnchorInfo | null {
  const placed = placedObjects.get(anchorId);
  if (!placed) return null;

  const { position, size } = placed;
  const surfaceY = position[1] + size[1] / 2; // Oberkante

  return {
    id: anchorId,
    position,
    size,
    surface_y: surfaceY,
    surface_bounds: {
      min_x: position[0] - size[0] / 2,
      max_x: position[0] + size[0] / 2,
      min_z: position[2] - size[2] / 2,
      max_z: position[2] + size[2] / 2,
    },
  };
}

// ─── Primitives aus Spec + PlacementResult erzeugen ─────────

function buildPrimitivesFromSpec(
  spec: ObjectConstraintSpec,
  result: PlacementResult,
): Primitive[] {
  const primitives: Primitive[] = [];
  const { final_position: pos, final_size: size, final_rotation: rot } = result;

  for (const intent of spec.primitive_spec.primitives) {
    const prim = intentToPrimitive(intent, spec.object_id, pos, size, rot, spec.primitive_spec.color_palette);
    primitives.push(prim);
  }

  return primitives;
}

function intentToPrimitive(
  intent: PrimitiveIntent,
  objectId: string,
  objPos: Vec3,
  objSize: Vec3,
  objRot: Vec3,
  palette: string[],
): Primitive {
  // Absolute Größe aus relativer Größe berechnen
  const absSize: Vec3 = [
    intent.relative_size[0] * objSize[0],
    intent.relative_size[1] * objSize[1],
    intent.relative_size[2] * objSize[2],
  ];

  // Absolute Position aus relativer Position berechnen
  const absPos: Vec3 = [
    objPos[0] + intent.relative_position[0] * objSize[0] / 2,
    objPos[1] + intent.relative_position[1] * objSize[1] / 2,
    objPos[2] + intent.relative_position[2] * objSize[2] / 2,
  ];

  const color = intent.color ?? palette[0] ?? "#888888";
  const rotation: Vec3 = intent.local_rotation
    ? [
        objRot[0] + intent.local_rotation[0],
        objRot[1] + intent.local_rotation[1],
        objRot[2] + intent.local_rotation[2],
      ]
    : [...objRot];

  const id = `${objectId}_${intent.id}`;
  const tags = [objectId, intent.role];

  switch (intent.type) {
    case "cube":
      return {
        id,
        type: "cube",
        position: absPos,
        rotation,
        size: absSize,
        color,
        tags,
      };
    case "sphere":
      return {
        id,
        type: "sphere",
        position: absPos,
        rotation,
        radius: Math.max(absSize[0], absSize[1], absSize[2]) / 2,
        color,
        tags,
      };
    case "cylinder":
      return {
        id,
        type: "cylinder",
        position: absPos,
        rotation,
        radiusTop: absSize[0] / 2,
        radiusBottom: absSize[0] / 2,
        height: absSize[1],
        color,
        tags,
      };
  }
}
