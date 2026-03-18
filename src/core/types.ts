// ─── Vector & Geometry ───────────────────────────────────────

export type Vec3 = [number, number, number];

// Axis-aligned bounding box für Regionen und Collision
export interface AABB {
  min: Vec3;
  max: Vec3;
}

// ─── Primitives ──────────────────────────────────────────────
// Gemeinsame Basis für alle Primitive-Typen

export interface PrimitiveBase {
  id: string;
  type: string;
  position: Vec3;
  rotation: Vec3;
  color: string;
  tags: string[];
}

export interface CubePrimitive extends PrimitiveBase {
  type: "cube";
  size: Vec3; // [width, height, depth]
}

export interface SpherePrimitive extends PrimitiveBase {
  type: "sphere";
  radius: number;
}

export interface CylinderPrimitive extends PrimitiveBase {
  type: "cylinder";
  radiusTop: number;
  radiusBottom: number;
  height: number;
}

// Union type – erweiterbar für zukünftige Primitives
export type Primitive = CubePrimitive | SpherePrimitive | CylinderPrimitive;

// Hilfsfunktion um size-artige Daten aus jedem Primitive zu lesen
export function getPrimitiveExtents(p: Primitive): Vec3 {
  switch (p.type) {
    case "cube": return p.size;
    case "sphere": return [p.radius * 2, p.radius * 2, p.radius * 2];
    case "cylinder": {
      const r = Math.max(p.radiusTop, p.radiusBottom);
      return [r * 2, p.height, r * 2];
    }
  }
}

// ─── Scene ───────────────────────────────────────────────────

export interface Scene {
  id: string;
  name: string;
  primitives: Primitive[];
  metadata: {
    createdAt: string;
    updatedAt: string;
    stepCount: number;
  };
}

// Immutable Snapshot für Auditing / Undo
export interface SceneSnapshot {
  scene: Scene;
  timestamp: string;
  trigger: string; // was den Snapshot ausgelöst hat
}

// ─── Generation (linear pipeline, bestehend) ─────────────────

export interface GenerationStep {
  stepNumber: number;
  action: "add" | "remove" | "modify" | "clone";
  primitive: Primitive;          // für add
  targetId?: string;             // für remove / modify / clone
  changes?: Partial<PrimitiveChanges>; // für modify
  mirror?: "x" | "y" | "z";     // für clone: Spiegelachse
  reasoning: string;
}

// Felder die per modify geändert werden können
export interface PrimitiveChanges {
  position: Vec3;
  rotation: Vec3;
  color: string;
  // size-bezogene Felder
  size: Vec3;
  radius: number;
  radiusTop: number;
  radiusBottom: number;
  height: number;
}

export interface GenerationPlan {
  goal: string;
  estimatedSteps: number;
  steps: string[];
}

export interface PromptContext {
  userPrompt: string;
  currentScene: Scene;
  plan: GenerationPlan;
  currentStep: number;
  referenceImage?: string;
}

export interface PipelineConfig {
  maxSteps: number;
  autoRun: boolean;
}

// ─── Constraints ─────────────────────────────────────────────

export interface Constraint {
  name: string;
  check: (scene: Scene, newPrimitive: Primitive) => ConstraintResult;
}

export interface ConstraintResult {
  valid: boolean;
  message?: string;
}

// ─── AI Responses ────────────────────────────────────────────

export interface PlannerResponse {
  plan: GenerationPlan;
}

export interface BuilderResponse {
  step: GenerationStep;
}

export interface CriticResponse {
  approved: boolean;
  feedback: string;
  suggestNextAction?: string;
  isComplete: boolean;
}

// ─── Parallel / Collective Architecture ──────────────────────

// Globale Stil- und Zielvorgaben die alle Builder erhalten
export interface GlobalStyleDirectives {
  goal: string;
  colorPalette?: string[];
  styleTags?: string[];    // z.B. ["rustic", "minimal", "futuristic"]
  maxPrimitivesTotal?: number;
  constraints?: string[];  // textuelle Regeln
}

// Ein räumlich abgegrenzter Arbeitsbereich
export interface WorkRegion {
  id: string;
  label: string;            // z.B. "Tischplatte", "linke Seite"
  bounds: AABB;              // erlaubter Baubereich
  maxPrimitives: number;
  allowedTypes: Primitive["type"][];
}

// Kontext über angrenzende Regionen (was der Builder über Nachbarn wissen darf)
export interface BoundaryContext {
  regionId: string;          // Nachbar-Region
  sharedEdge: "x+" | "x-" | "y+" | "y-" | "z+" | "z-";
  edgePrimitives: Primitive[]; // Primitives nahe der Grenze
}

// Aufgabe die ein einzelner Builder bekommt
export interface BuilderTask {
  taskId: string;
  region: WorkRegion;
  localGoal: string;         // Was in dieser Region gebaut werden soll
  styleDirectives: GlobalStyleDirectives;
  boundaryContext: BoundaryContext[];
  existingPrimitives: Primitive[]; // bereits in dieser Region vorhanden
}

// Ergebnis eines Builders – regionale Änderungen, kein direkter globaler Write
export interface BuilderResult {
  taskId: string;
  regionId: string;
  addedPrimitives: Primitive[];
  reasoning: string;
}

// Aufteilung einer Szene in Regionen
export interface ScenePartition {
  regions: WorkRegion[];
  assignments: RegionAssignment[];
  styleDirectives: GlobalStyleDirectives;
  assemblyConfig?: AssemblyConfig;
}

// Zuordnung: welcher Builder-Task gehört zu welcher Region
export interface RegionAssignment {
  regionId: string;
  localGoal: string;
  priority: number; // Reihenfolge falls sequentiell
}

// Ergebnis des Merge-Schritts
export interface MergeResult {
  scene: Scene;
  conflicts: MergeConflict[];
  droppedPrimitives: Primitive[];
  resolved: boolean;
}

export interface MergeConflict {
  type: "overlap" | "boundary-gap" | "style-mismatch";
  regionA: string;
  regionB: string;
  description: string;
  affectedPrimitives: string[]; // IDs
}

// ─── Combiner (neues Parallel-Modell) ───────────────────────

// Ein Part-Gruppe: lokal gebaute Primitives eines Builders
export interface PartGroup {
  partId: string;
  label: string;
  primitives: Primitive[];    // in lokalen Koordinaten (Ursprung ~0,0,0)
  localBounds: AABB;          // auto-berechnet aus Primitives
}

// Wie ein Part-Gruppe in die Hauptszene transformiert wird
export interface PartTransform {
  partId: string;
  scale: number;              // uniformer Skalierungsfaktor
  offset: Vec3;               // Translation ins Hauptfenster
  rotation?: Vec3;            // optionale Rotation der ganzen Gruppe (Grad)
}

// Ergebnis des Combiners
export interface CombinerResult {
  scene: Scene;
  transforms: PartTransform[];
  issues: string[];
}

// ─── Mesh Operations (KI generiert nur Operationen, keine Vertices) ──

// Basis für alle Mesh-Operationen
export interface MeshOpBase {
  op: string;
  id?: string;                // optionale ID für Referenzen
  tags?: string[];
}

// Primitive hinzufügen (bestehende Logik, jetzt als Operation)
export interface AddPrimitiveOp extends MeshOpBase {
  op: "add_primitive";
  type: Primitive["type"];
  size?: Vec3;
  radius?: number;
  radiusTop?: number;
  radiusBottom?: number;
  height?: number;
  position: Vec3;
  rotation?: Vec3;
  color?: string;
}

// Terrain-Region: algorithmische Heightmap-Generierung
export interface AddTerrainRegionOp extends MeshOpBase {
  op: "add_terrain_region";
  bounds: [Vec3, Vec3];       // [min, max] Bereich
  type: "smooth" | "rocky" | "flat" | "hilly";
  density: number;            // Dichte der Vertices (1-50)
  smoothness: number;         // 0-1
  seed?: number;
  color?: string;
}

// Hügel/Erhebung: parametrische Generierung
export interface AddHillOp extends MeshOpBase {
  op: "add_hill";
  center: Vec3;
  radius: number;
  height: number;
  smoothness: number;         // 0-1, wie rund der Hügel ist
  color?: string;
}

// Mesh-Regel: Noise/Pattern anwenden
export interface AddMeshRuleOp extends MeshOpBase {
  op: "add_mesh_rule";
  pattern: "noise" | "wave" | "ripple" | "erosion";
  targetRegion?: string;      // Region-ID auf die angewendet wird
  strength: number;           // 0-1
  iterations: number;
  scale?: number;             // Noise-Skala
  seed?: number;
}

// Curve/Pfad-basierte Generierung
export interface AddCurveOp extends MeshOpBase {
  op: "add_curve";
  points: Vec3[];             // Kontrollpunkte
  radius: number;             // Rohr-Radius
  segments?: number;
  color?: string;
}

// Gruppe von Primitives in einem Raster
export interface AddGridOp extends MeshOpBase {
  op: "add_grid";
  type: Primitive["type"];
  bounds: [Vec3, Vec3];
  spacing: Vec3;              // Abstand zwischen Elementen
  size?: Vec3;
  radius?: number;
  color?: string;
  jitter?: number;            // Zufällige Verschiebung (0-1)
  seed?: number;
}

// Symmetrische Spiegelung
export interface MirrorOp extends MeshOpBase {
  op: "mirror";
  sourceId: string;           // ID des zu spiegelnden Objekts
  axis: "x" | "y" | "z";
}

// Union aller Mesh-Operationen
export type MeshOperation =
  | AddPrimitiveOp
  | AddTerrainRegionOp
  | AddHillOp
  | AddMeshRuleOp
  | AddCurveOp
  | AddGridOp
  | MirrorOp;

// ─── Erweiterte Region mit Mesh-Operationen ──────────────────

// Erweiterte WorkRegion mit eigenen Mesh-Operationen
export interface WorkRegionExt extends WorkRegion {
  meshOps: MeshOperation[];           // Operationen für diese Region
  densityLevel: number;               // 1-10
  styleConstraint?: string;           // z.B. "nur Würfel", "nur kugelig"
  seedOffset?: number;                // Zufalls-Seed für Reproduzierbarkeit
}

// Erweiterter BuilderTask mit Mesh-Operation-Support
export interface BuilderTaskExt extends BuilderTask {
  densityLevel: number;
  styleConstraint?: string;
  seedOffset?: number;
  allowedOps: MeshOperation["op"][];  // erlaubte Operationstypen
}

// Erweitertes BuilderResult mit Mesh-Operationen
export interface BuilderResultExt extends BuilderResult {
  meshOps: MeshOperation[];           // generierte Operationen (statt raw Primitives)
}

// ─── Erweiterte Scene mit Operations-Log ─────────────────────

export interface SceneExt extends Scene {
  regions: WorkRegionExt[];           // aktive Regionen
  meshOpsLog: MeshOperation[];        // alle ausgeführten Operationen
  tokenMetrics: TokenMetrics;         // Kosten-Tracking
  globalSeed?: number;
  styleTags?: string[];
}

export interface TokenMetrics {
  totalTokensIn: number;
  totalTokensOut: number;
  stepsCompleted: number;
  avgTokensPerStep: number;
}

// ─── Compact Scene Statistics (für Critic, keine raw Vertices) ──

export interface SceneStatistics {
  primitiveCount: number;
  regionCount: number;
  operationCount: number;
  densityAvg: number;
  heightRange: [number, number];      // [min, max] y-Wert
  variationScore: number;             // 0-1, wie abwechslungsreich
  collisionIndicators: number;        // Anzahl potentieller Kollisionen
  boundingBox: AABB;
  typeDistribution: Record<string, number>;
}

// ─── Quality Rules (feste, algorithmische Regeln) ────────────

export type QualityRuleType =
  | "no_overlap"
  | "density"
  | "height_diff"
  | "smoothness"
  | "detail_level"
  | "bounds_check"
  | "connectivity"
  | "type_allowed";

export interface QualityRule {
  type: QualityRuleType;
  enabled: boolean;
  params: Record<string, number | boolean | string[]>;
}

// Vordefinierte Regel-Parameter
export interface NoOverlapParams        { tolerance: number }
export interface DensityParams          { min: number; max: number }
export interface HeightDiffParams       { maxDelta: number }
export interface SmoothnessParams       { maxDiff: number }
export interface DetailLevelParams      { objectsPer100Units: number }
export interface BoundsCheckParams      { limit: number }
export interface ConnectivityParams     { maxGap: number }
export interface TypeAllowedParams      { allowed: string[] }

// ─── Scene Quality (Ergebnis einer Prüfung) ─────────────────

export interface QualityMetrics {
  collisions: number;                 // Anzahl Überlappungen
  density: number;                    // Primitives / Volumen
  heightDiff: number;                 // Max Höhen-Differenz zwischen Regionen
  smoothness: number;                 // Laplacian-Glättungs-Differenz (0=perfekt)
  detailLevel: number;                // Objekte pro 100 Units²
  outOfBounds: number;                // Primitives außerhalb Bounds
  disconnected: number;               // Freischwebende Primitives
}

export interface QualityViolation {
  rule: QualityRuleType;
  severity: "error" | "warning";
  message: string;
  affectedIds: string[];              // betroffene Primitive-IDs
  regionId?: string;                  // betroffene Region
  measured: number;                   // gemessener Wert
  threshold: number;                  // erlaubter Grenzwert
}

export interface SceneQuality {
  valid: boolean;
  score: number;                      // 0-1 Gesamtbewertung
  metrics: QualityMetrics;
  violations: QualityViolation[];
  regionQualities: RegionQuality[];
  timestamp: string;
}

export interface RegionQuality {
  regionId: string;
  valid: boolean;
  metrics: QualityMetrics;
  violations: QualityViolation[];
}

// ─── Repair Plan (strukturierter Reparatur-Auftrag) ──────────

export type RepairAction = "reset_region" | "remove_objects" | "reposition" | "tune_density" | "smooth_heights";

export interface RepairPlan {
  regionId: string;
  action: RepairAction;
  reason: string;
  priority: number;                   // 1=höchste
  parameters: RepairParameters;
}

export interface RepairParameters {
  targetIds?: string[];               // für remove_objects / reposition
  targetDensity?: number;             // für tune_density
  maxHeight?: number;                 // für smooth_heights
  displacement?: Vec3;                // für reposition
  newSeed?: number;                   // für reset_region
}

// ─── Repair Result ───────────────────────────────────────────

export interface RepairLoopResult {
  finalScene: Scene;
  finalQuality: SceneQuality;
  iterations: number;
  repairsApplied: RepairPlan[];
  fullyResolved: boolean;
}

// ─── Assembly Rules (AI schreibt Regeln, Programm löst auf) ─

export type SpatialRelation =
  | "on_top_of" | "below" | "beside_left" | "beside_right"
  | "in_front_of" | "behind" | "inside" | "attached_to" | "surrounds";

export type AlignmentAnchor =
  | "center" | "corner_nw" | "corner_ne" | "corner_sw" | "corner_se"
  | "edge_left" | "edge_right" | "edge_front" | "edge_back";

export interface AssemblyRule {
  partId: string;
  parentPartId: string | "ground";
  relation: SpatialRelation;
  alignment: AlignmentAnchor;
  offset?: Vec3;                    // Fein-Offset nach Platzierung
  rotationHint?: Vec3;              // Rotation in Grad
  scaleFactor?: number;             // 1.0 = original
  priority: number;                 // niedrig = zuerst
  contactRequired: boolean;         // muss Parent berühren
  multiInstance?: {                  // z.B. 4 Tischbeine
    count: number;
    pattern: "corners" | "edges" | "ring" | "linear";
    spacing?: number;
  };
}

export interface AssemblyConfig {
  rootPartId: string;
  rules: AssemblyRule[];
  groundPlane: number;              // normalerweise 0
}

export interface AssemblyResult {
  scene: Scene;
  transforms: PartTransform[];
  contactsVerified: boolean;
  issues: string[];
}

// ─── KI-Regel-Konfiguration ─────────────────────────────────

export interface AIRuleConfig {
  plannerRules: QualityRuleType[];    // Regeln die der Planner beachtet
  builderRules: QualityRuleType[];    // Regeln die der Builder beachtet
  criticRules: QualityRuleType[];     // Regeln die der Critic prüft
  repairActions: RepairAction[];      // erlaubte Reparatur-Aktionen
}

// ─── PlanObject Schema (strukturierte Planentwicklung) ───────

export interface PlanAreaRules {
  no_collision: boolean;
  no_gap: boolean;
  smooth: number;                     // 0-1, Glättungsziel
}

export interface PlanQualityTargets {
  errors_max: number;
  warnings_max: number;
  min_score: number;                  // 0-1
}

export interface PlanArea {
  id: string;
  label: string;
  area_bounds: [Vec3, Vec3];          // [min, max]
  target_density: number;             // Primitives / Volumen (0-1)
  detail_level: number;               // 1-10
  rules: PlanAreaRules;
  quality_targets: PlanQualityTargets;
  sub_components: string[];           // z.B. ["main-chassis", "cabin"] für body
}

export interface PlanBuilder {
  name: string;                       // z.B. "body", "wheels", "windows"
  area_id: string;                    // Referenz auf PlanArea
  target_density: number;
  detail_level: number;
  max_primitives: number;
  description: string;                // Detaillierte Bau-Beschreibung
  color_palette: string[];
}

export interface PlanObject {
  id: string;
  goal: string;
  user_prompt: string;
  areas: PlanArea[];
  builders: PlanBuilder[];
  assembly_rules: AssemblyRule[];
  global_rules: PlanAreaRules;
  global_quality_targets: PlanQualityTargets;
  cost_targets: PlanCostTargets;
  boundary_constraints: PlanBoundaryConstraints;
  style_tags: string[];
  color_palette: string[];
}

export interface PlanCostTargets {
  max_primitives_total: number;
  max_primitives_per_area: number;
  max_llm_calls: number;
}

export interface PlanBoundaryConstraints {
  no_cross_region_collision: boolean;
  max_cross_region_gap: number;       // max erlaubter Abstand zwischen Regionen
  boundary_pairs: BoundaryPair[];     // explizite Paar-Regeln
}

export interface BoundaryPair {
  region_a: string;
  region_b: string;
  max_gap: number;
  no_collision: boolean;
}

// ─── Region Repair Rules ─────────────────────────────────────

export interface RegionRepairRule {
  region_id: string;
  sub_components: string[];           // z.B. ["tire", "rim"] für wheels
  repair_strategy: "rebuild_together" | "reposition" | "remove_excess";
  priority: number;
}

// ─── Token Tracking ──────────────────────────────────────────

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  call_name: string;                  // z.B. "planner", "builder:body"
  timestamp: number;
}

export interface TokenTracker {
  calls: TokenUsage[];
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
}
