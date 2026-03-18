// ─── Constraint-Typen: Strukturiertes Regelsystem für Objektplatzierung ──────
// KI beschreibt Absicht und Regeln, Code berechnet konkrete Koordinaten.

import type { Vec3 } from "../core/types.js";

// ─── 1. Anchor Constraints ──────────────────────────────────

export type AnchorRelation =
  | "on_top_of"        // Unterseite berührt Oberseite des Ankers
  | "under"            // Oberseite berührt Unterseite des Ankers
  | "beside_left"      // Links neben dem Anker
  | "beside_right"     // Rechts neben dem Anker
  | "in_front_of"      // Vor dem Anker (Z+)
  | "behind"           // Hinter dem Anker (Z-)
  | "attached_to"      // Direkt am Anker befestigt
  | "inside_bounds_of" // Innerhalb der Grenzen des Ankers
  | "supported_by";    // Ruht auf dem Anker (Schwerkraft-orientiert)

export interface AnchorConstraint {
  type: "anchor";
  target_id: string;            // ID des Anker-Objekts (z.B. "desk-top")
  relation: AnchorRelation;
}

// ─── 2. Contact Constraints ─────────────────────────────────

export interface ContactConstraint {
  type: "contact";
  rule: "must_touch_anchor_plane"   // Objekt-Unterseite muss Anker-Oberseite berühren
    | "min_contact_area_ratio"      // Mindest-Kontaktfläche als Anteil
    | "no_floating";                // Darf nicht schweben
  value?: number;                   // z.B. 0.5 für 50% Kontaktfläche
}

// ─── 3. Size Constraints ────────────────────────────────────

export interface SizeConstraint {
  type: "size";
  rule: "max_area_ratio_of_anchor"    // Max X*Z-Fläche relativ zum Anker
    | "max_volume_ratio_of_anchor"    // Max Volumen relativ zum Anker
    | "min_size"                      // Absolute Mindestgröße
    | "max_size"                      // Absolute Maximalgröße
    | "preferred_size_range"          // Bevorzugter Größenbereich
    | "absolute_size";                // Exakte Größenvorgabe
  value?: number;                     // Ratio (0-1) oder absolute Einheit
  size_range?: [Vec3, Vec3];          // [min_size, max_size] für preferred_size_range
  absolute?: Vec3;                    // Für absolute_size
}

// ─── 4. Placement Constraints ───────────────────────────────

export type PlacementZone =
  | "center"           // Mittig auf dem Anker
  | "front_center"     // Vorne mittig
  | "back_center"      // Hinten mittig
  | "back_left"        // Hinten links
  | "back_right"       // Hinten rechts
  | "front_left"       // Vorne links
  | "front_right"      // Vorne rechts
  | "left_edge"        // Am linken Rand
  | "right_edge"       // Am rechten Rand
  | "any_edge"         // An irgendeinem Rand
  | "any_corner"       // In irgendeiner Ecke
  | "anywhere";        // Freie Platzierung

export interface PlacementConstraint {
  type: "placement";
  rule: "preferred_zone"        // Bevorzugte Zone auf dem Anker
    | "min_edge_clearance"      // Mindestabstand zum Rand
    | "keep_within_bounds"      // Muss innerhalb des Ankers bleiben
    | "keep_centered"           // Zentriert halten
    | "prefer_corner"           // Ecke bevorzugen
    | "avoid_center";           // Mitte meiden
  zone?: PlacementZone;
  value?: number;               // z.B. clearance in Units
}

// ─── 5. Collision Constraints ───────────────────────────────

export interface CollisionConstraint {
  type: "collision";
  rule: "no_overlap_with"       // Darf sich nicht mit bestimmtem Objekt überlappen
    | "min_distance_to"         // Mindestabstand zu bestimmtem Objekt
    | "soft_spacing_to"         // Weicher Abstandswunsch
    | "no_overlap_any";         // Darf sich mit keinem Objekt überlappen
  target_id?: string;           // Spezifisches Objekt (optional)
  value?: number;               // Abstand in Units
}

// ─── 6. Rotation Constraints ────────────────────────────────

export interface RotationConstraint {
  type: "rotation";
  rule: "upright_only"          // Nur aufrecht stehend
    | "allowed_axes"            // Nur bestimmte Rotationsachsen
    | "snap_rotation"           // Rotation auf Vielfache einrasten
    | "align_with_anchor"       // Rotation am Anker ausrichten
    | "fixed_rotation";         // Feste Rotation
  allowed?: ("x" | "y" | "z")[];    // Für allowed_axes
  snap_degrees?: number;              // Für snap_rotation (z.B. 90)
  fixed?: Vec3;                       // Für fixed_rotation [rx, ry, rz]
}

// ─── 7. Semantic Constraints ────────────────────────────────

export interface SemanticConstraint {
  type: "semantic";
  rule: "must_be_on_surface"     // Muss auf einer Fläche stehen
    | "must_be_under_support"    // Muss unter einer Stütze sein
    | "must_be_accessible"       // Muss erreichbar/sichtbar sein
    | "must_not_block"           // Darf nichts blockieren
    | "gravity_bound";           // Unterliegt Schwerkraft
  target_id?: string;
}

// ─── 8. Repair Constraints ──────────────────────────────────

export type RepairStrategy =
  | "reposition"          // Neu positionieren
  | "rescale"             // Skalieren
  | "rotate_fix"          // Rotation anpassen
  | "remove"              // Entfernen wenn nicht lösbar
  | "skip";               // Überspringen

export interface RepairConstraint {
  type: "repair";
  repair_strategy: RepairStrategy;
  max_reposition_attempts: number;
  allow_rescale: boolean;
  allow_rotation_fix: boolean;
  priority: number;             // 1=höchste Priorität bei Reparatur
}

// ─── Union Type ─────────────────────────────────────────────

export type Constraint =
  | AnchorConstraint
  | ContactConstraint
  | SizeConstraint
  | PlacementConstraint
  | CollisionConstraint
  | RotationConstraint
  | SemanticConstraint
  | RepairConstraint;
