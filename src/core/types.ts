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
  action: "add" | "modify" | "remove";
  primitive: Primitive;
  reasoning: string;
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
  resolved: boolean;
}

export interface MergeConflict {
  type: "overlap" | "boundary-gap" | "style-mismatch";
  regionA: string;
  regionB: string;
  description: string;
  affectedPrimitives: string[]; // IDs
}
