// ─── Object Constraint Spec: Strukturiertes Regel-Spec pro Objekt ────────────
// KI erzeugt dieses Spec, Constraint Engine löst es deterministisch.

import type { Vec3 } from "../core/types.js";
import type {
  AnchorRelation, PlacementZone, RepairStrategy, Constraint,
} from "./constraint-types.js";

// ─── Das Hauptschema: ObjectConstraintSpec ───────────────────

export interface ObjectConstraintSpec {
  object_id: string;                // Eindeutige ID (z.B. "laptop-1")
  object_type: string;              // Typ (z.B. "laptop", "printer", "lamp")
  label: string;                    // Anzeigename

  // Anker-Beziehung
  anchor_target: string;            // ID des Anker-Objekts (z.B. "desk-surface")
  relation_to_anchor: AnchorRelation;

  // Erlaubte Stützflächen
  allowed_support_surfaces: string[]; // z.B. ["desk-surface", "ground"]

  // Größenregeln
  size_rules: {
    preferred_size: Vec3;           // Bevorzugte Größe [w, h, d]
    min_size?: Vec3;
    max_size?: Vec3;
    max_area_ratio_of_anchor?: number;  // z.B. 0.18 = max 18% der Ankerfläche
    max_volume_ratio_of_anchor?: number;
  };

  // Platzierungsregeln
  placement_rules: {
    preferred_zone: PlacementZone;
    min_edge_clearance: number;     // Mindestabstand zum Rand (Units)
    keep_within_bounds: boolean;    // Muss innerhalb des Ankers bleiben
  };

  // Kollisionsregeln
  collision_rules: {
    no_overlap: boolean;            // Darf sich nicht überlappen
    min_spacing: number;            // Mindestabstand zu anderen Objekten
    avoid_ids?: string[];           // Spezifische Objekte meiden
  };

  // Rotationsregeln
  rotation_rules: {
    upright_only: boolean;          // Nur aufrecht
    allowed_y_rotations?: number[]; // Erlaubte Y-Rotationen (Grad), z.B. [0, 90, 180, 270]
    fixed_rotation?: Vec3;          // Feste Rotation
    align_with_anchor: boolean;     // Am Anker ausrichten
  };

  // Semantische Regeln
  semantic_rules: {
    must_be_on_surface: boolean;
    must_be_accessible: boolean;
    must_not_block: string[];       // IDs von Objekten die nicht blockiert werden dürfen
    gravity_bound: boolean;
  };

  // Reparatur-Konfiguration
  repair_priority: number;         // 1=höchste, wird zuerst repariert
  repair_strategy: RepairStrategy;
  max_reposition_attempts: number;
  allow_rescale: boolean;

  // Primitive-Beschreibung (was gebaut werden soll)
  primitive_spec: PrimitiveSpec;
}

// ─── Primitive Spec: Was genau gebaut wird ──────────────────

export interface PrimitiveSpec {
  description: string;              // z.B. "Laptop: flache Box mit dünnem Screen-Teil"
  primitives: PrimitiveIntent[];    // Absicht pro Primitive
  color_palette: string[];
}

export interface PrimitiveIntent {
  id: string;
  type: "cube" | "sphere" | "cylinder";
  role: string;                     // z.B. "base", "screen", "body"
  relative_size: Vec3;              // Größe relativ zur Gesamtgröße [0-1, 0-1, 0-1]
  relative_position: Vec3;          // Position relativ zum Objektzentrum [-1 bis 1]
  local_rotation?: Vec3;            // Lokale Rotation in Grad
  color?: string;
}

// ─── Placement Result: Was die Engine berechnet ─────────────

export interface PlacementResult {
  object_id: string;
  success: boolean;

  // Berechnete finale Werte
  final_position: Vec3;
  final_rotation: Vec3;
  final_scale: number;
  final_size: Vec3;                 // Skalierte Größe

  // Constraint-Ergebnisse
  solved_constraints: SolvedConstraint[];
  failed_constraints: FailedConstraint[];
  warnings: string[];
  repair_actions: RepairAction[];
}

export interface SolvedConstraint {
  constraint_type: string;
  rule: string;
  status: "satisfied";
}

export interface FailedConstraint {
  constraint_type: string;
  rule: string;
  status: "violated" | "partially_satisfied";
  message: string;
  severity: "error" | "warning";
}

export interface RepairAction {
  action: "reposition" | "rescale" | "rotate" | "remove";
  description: string;
  old_value: Vec3 | number;
  new_value: Vec3 | number;
}

// ─── Anchor Info: Informationen über platzierte Anker ───────

export interface AnchorInfo {
  id: string;
  position: Vec3;
  size: Vec3;
  surface_y: number;                // Y-Koordinate der Oberfläche
  surface_bounds: {                 // XZ-Grenzen der Oberfläche
    min_x: number; max_x: number;
    min_z: number; max_z: number;
  };
}
