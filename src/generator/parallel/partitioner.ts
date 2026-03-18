// Partitioner: Zerlegt eine Aufgabe in semantische Parts
// Jeder Builder bekommt sein eigenes lokales Koordinatensystem

import type {
  Scene,
  ScenePartition,
  WorkRegion,
  WorkRegionExt,
  RegionAssignment,
  AABB,
  Primitive,
  MeshOperation,
  AssemblyConfig,
  AssemblyRule,
} from "../../core/types.js";
import { callLLM } from "../../ai/client.js";

// Lokale Bounds für einen Part-Builder (großzügig, zentriert um Ursprung)
const LOCAL_BOUNDS: AABB = { min: [-15, -15, -15], max: [15, 15, 15] };

// Einfache räumliche Aufteilung entlang einer Achse (Legacy, noch genutzt von boundary-validator)
export function partitionByAxis(
  bounds: AABB,
  count: number,
  axis: "x" | "y" | "z" = "x",
): AABB[] {
  const idx = axis === "x" ? 0 : axis === "y" ? 1 : 2;
  const min = bounds.min[idx];
  const max = bounds.max[idx];
  const step = (max - min) / count;

  const regions: AABB[] = [];
  for (let i = 0; i < count; i++) {
    const rMin: [number, number, number] = [...bounds.min];
    const rMax: [number, number, number] = [...bounds.max];
    rMin[idx] = min + step * i;
    rMax[idx] = min + step * (i + 1);
    regions.push({ min: rMin, max: rMax });
  }
  return regions;
}

// Ermittelt welche Primitives in einer Region liegen (Zentrum-basiert)
export function primitivesInRegion(primitives: Primitive[], region: AABB): Primitive[] {
  return primitives.filter((p) => {
    for (let i = 0; i < 3; i++) {
      if (p.position[i] < region.min[i] || p.position[i] > region.max[i]) return false;
    }
    return true;
  });
}

// Erstellt eine lokale WorkRegion für einen Part
function makeLocalRegion(id: string, label: string, maxPrimitives: number): WorkRegion {
  return {
    id,
    label,
    bounds: LOCAL_BOUNDS,
    maxPrimitives,
    allowedTypes: ["cube", "sphere", "cylinder"],
  };
}

// Validiert eine Partition auf Konsistenz
function validatePartition(parsed: any): boolean {
  if (!parsed.parts || !Array.isArray(parsed.parts) || parsed.parts.length === 0) return false;
  for (const p of parsed.parts) {
    if (!p.id || !p.label || !p.goal) return false;
  }
  return true;
}

// KI-gestützte semantische Partitionierung
export async function partitionWithAI(
  userPrompt: string,
  scene: Scene,
): Promise<ScenePartition> {
  const systemPrompt = `You are a 3D object decomposer. Given a build goal, split the object into 2-5 SEMANTIC parts.
Each part will be built INDEPENDENTLY by a separate builder in its own local coordinate space (centered at origin).
After building, an Assembly Resolver will algorithmically place parts using your assemblyRules.

IMPORTANT: Think about the object's STRUCTURAL components, not spatial regions.
IMPORTANT: You MUST provide assemblyRules that describe how parts connect spatially.

SPATIAL RELATIONS: "on_top_of", "below", "beside_left", "beside_right", "in_front_of", "behind", "inside", "attached_to", "surrounds"
ALIGNMENT ANCHORS: "center", "corner_nw", "corner_ne", "corner_sw", "corner_se", "edge_left", "edge_right", "edge_front", "edge_back"
MULTI-INSTANCE PATTERNS: "corners" (e.g. 4 table legs), "edges", "ring", "linear"

EXAMPLE: "Build a table"
Parts: tabletop, legs
assemblyRules:
- tabletop: parentPartId="ground", relation="on_top_of", alignment="center", priority=1
- legs: parentPartId="tabletop", relation="below", alignment="center", priority=2, multiInstance={count:4, pattern:"corners"}

RULES:
- Each part should be a self-contained component that makes sense on its own.
- 2-5 parts for most objects. Don't over-split.
- Each part gets 3-10 primitives max.
- Give each part a clear, specific build goal.
- The first rule (lowest priority number) is the ROOT part that anchors the whole assembly.
- contactRequired=true means the child MUST touch the parent (no floating).

Respond with ONLY valid JSON:
{
  "goal": "overall goal description",
  "colorPalette": ["#hex", ...],
  "styleTags": ["..."],
  "parts": [
    {"id": "part-id", "label": "Human Label", "goal": "what to build for this part", "maxPrimitives": N, "priority": 1},
    ...
  ],
  "assemblyRules": [
    {"partId": "part-id", "parentPartId": "other-part-id|ground", "relation": "on_top_of", "alignment": "center", "priority": 1, "contactRequired": true},
    ...
  ]
}`;

  try {
    const raw = await callLLM(systemPrompt, `Decompose into parts: "${userPrompt}". Scene has ${scene.primitives.length} existing primitives.`);
    const parsed = JSON.parse(raw);
    if (validatePartition(parsed)) {
      return partsToPartition(parsed, userPrompt);
    }
  } catch {
    // callLLM oder JSON-Parse fehlgeschlagen — weiter zu Heuristik
  }
  return heuristicPartition(userPrompt) ?? createSingleRegionPartition(userPrompt);
}

// Konvertiert LLM-Parts-Format in ScenePartition
function partsToPartition(parsed: any, userPrompt: string): ScenePartition {
  const regions: WorkRegion[] = [];
  const assignments: RegionAssignment[] = [];

  for (const part of parsed.parts) {
    regions.push(makeLocalRegion(part.id, part.label, part.maxPrimitives ?? 8));
    assignments.push({
      regionId: part.id,
      localGoal: part.goal,
      priority: part.priority ?? 1,
    });
  }

  // Parse assemblyRules into AssemblyConfig
  let assemblyConfig: AssemblyConfig | undefined;
  if (parsed.assemblyRules && Array.isArray(parsed.assemblyRules) && parsed.assemblyRules.length > 0) {
    const rules: AssemblyRule[] = parsed.assemblyRules.map((r: any) => ({
      partId: r.partId,
      parentPartId: r.parentPartId ?? "ground",
      relation: r.relation ?? "on_top_of",
      alignment: r.alignment ?? "center",
      offset: r.offset,
      rotationHint: r.rotationHint,
      scaleFactor: r.scaleFactor,
      priority: r.priority ?? 1,
      contactRequired: r.contactRequired ?? true,
      multiInstance: r.multiInstance,
    }));
    // Root is the part with lowest priority
    const sorted = [...rules].sort((a, b) => a.priority - b.priority);
    assemblyConfig = {
      rootPartId: sorted[0].partId,
      rules,
      groundPlane: 0,
    };
  }

  return {
    regions,
    assignments,
    styleDirectives: {
      goal: parsed.goal ?? userPrompt,
      colorPalette: parsed.colorPalette,
      styleTags: parsed.styleTags,
    },
    assemblyConfig,
  };
}

// Keyword-basierte Heuristik
export function heuristicPartition(userPrompt: string): ScenePartition | null {
  const lower = userPrompt.toLowerCase();

  if (lower.includes("flugzeug") || lower.includes("airplane") || lower.includes("plane") || lower.includes("jet")) {
    return partsToPartition({
      goal: userPrompt,
      colorPalette: ["#C0C0C0", "#808080", "#1E3A5F", "#FF0000", "#333333"],
      styleTags: ["aircraft", "streamlined"],
      parts: [
        { id: "fuselage", label: "Rumpf", goal: "Build an airplane fuselage: a horizontal cylinder (rotation [90,0,0]) as the main body tube, centered at origin. Add a nose cone (sphere or cone) at one end.", maxPrimitives: 5, priority: 1 },
        { id: "wings", label: "Tragflächen", goal: "Build a pair of airplane wings: two flat wide cubes extending left and right from center, slightly angled. Build them centered at origin.", maxPrimitives: 5, priority: 2 },
        { id: "tail", label: "Leitwerk", goal: "Build the tail section: a vertical tail fin (thin tall cube) and horizontal stabilizers (thin flat cubes). Build centered at origin.", maxPrimitives: 5, priority: 3 },
        { id: "landing-gear", label: "Fahrwerk", goal: "Build landing gear: 2-3 thin vertical cylinders as struts with small spheres or cylinders as wheels. Build centered at origin.", maxPrimitives: 6, priority: 4 },
      ],
      assemblyRules: [
        { partId: "fuselage", parentPartId: "ground", relation: "on_top_of", alignment: "center", priority: 1, contactRequired: true },
        { partId: "wings", parentPartId: "fuselage", relation: "attached_to", alignment: "center", priority: 2, contactRequired: true },
        { partId: "tail", parentPartId: "fuselage", relation: "behind", alignment: "center", priority: 3, contactRequired: true },
        { partId: "landing-gear", parentPartId: "fuselage", relation: "below", alignment: "center", priority: 4, contactRequired: true, multiInstance: { count: 2, pattern: "linear", spacing: 4 } },
      ],
    }, userPrompt);
  }

  if (lower.includes("tisch") || lower.includes("table") || lower.includes("desk")) {
    return partsToPartition({
      goal: userPrompt,
      colorPalette: ["#8B4513", "#A0522D", "#DEB887"],
      parts: [
        { id: "tabletop", label: "Tischplatte", goal: "Build a flat rectangular tabletop as a single wide, thin cube centered at origin.", maxPrimitives: 3, priority: 1 },
        { id: "legs", label: "Tischbeine", goal: "Build a single table leg as a thin vertical cylinder or cube, centered at origin.", maxPrimitives: 2, priority: 2 },
      ],
      assemblyRules: [
        { partId: "tabletop", parentPartId: "ground", relation: "on_top_of", alignment: "center", priority: 1, contactRequired: true },
        { partId: "legs", parentPartId: "tabletop", relation: "below", alignment: "center", priority: 2, contactRequired: true, multiInstance: { count: 4, pattern: "corners" } },
      ],
    }, userPrompt);
  }

  if (lower.includes("stuhl") || lower.includes("chair")) {
    return partsToPartition({
      goal: userPrompt,
      colorPalette: ["#8B4513", "#A0522D"],
      parts: [
        { id: "seat", label: "Sitzfläche", goal: "Build a flat square seat as a thin cube, and a tall thin backrest cube behind it. Build centered at origin.", maxPrimitives: 4, priority: 1 },
        { id: "legs", label: "Stuhlbeine", goal: "Build a single chair leg as a thin vertical cylinder, centered at origin.", maxPrimitives: 2, priority: 2 },
      ],
      assemblyRules: [
        { partId: "seat", parentPartId: "ground", relation: "on_top_of", alignment: "center", priority: 1, contactRequired: true },
        { partId: "legs", parentPartId: "seat", relation: "below", alignment: "center", priority: 2, contactRequired: true, multiInstance: { count: 4, pattern: "corners" } },
      ],
    }, userPrompt);
  }

  if (lower.includes("schneemann") || lower.includes("snowman")) {
    return partsToPartition({
      goal: userPrompt,
      colorPalette: ["#FFFFFF", "#FF6600", "#000000", "#8B4513"],
      parts: [
        { id: "body", label: "Körper", goal: "Build three stacked spheres (large bottom, medium middle, small top) centered at origin, each touching the one above/below.", maxPrimitives: 4, priority: 1 },
        { id: "details", label: "Details", goal: "Build snowman details: two stick arms (thin cylinders angled outward), a carrot nose (small orange cylinder/cone), and a hat (cylinder + cube on top). Build centered at origin.", maxPrimitives: 8, priority: 2 },
      ],
      assemblyRules: [
        { partId: "body", parentPartId: "ground", relation: "on_top_of", alignment: "center", priority: 1, contactRequired: true },
        { partId: "details", parentPartId: "body", relation: "attached_to", alignment: "center", priority: 2, contactRequired: true },
      ],
    }, userPrompt);
  }

  if (lower.includes("haus") || lower.includes("house") || lower.includes("gebäude") || lower.includes("building")) {
    return partsToPartition({
      goal: userPrompt,
      colorPalette: ["#D2B48C", "#8B0000", "#808080", "#4682B4"],
      parts: [
        { id: "structure", label: "Struktur", goal: "Build the main house walls as a box (4 wall cubes or one large cube), with a door opening and window openings. Build centered at origin.", maxPrimitives: 8, priority: 1 },
        { id: "roof", label: "Dach", goal: "Build a pitched roof using two angled cubes (rotated ~25-30 degrees) forming an A-shape, or a flat roof. Build centered at origin.", maxPrimitives: 4, priority: 2 },
      ],
      assemblyRules: [
        { partId: "structure", parentPartId: "ground", relation: "on_top_of", alignment: "center", priority: 1, contactRequired: true },
        { partId: "roof", parentPartId: "structure", relation: "on_top_of", alignment: "center", priority: 2, contactRequired: true },
      ],
    }, userPrompt);
  }

  return null;
}

// Fallback: alles in einem Part
export function createSingleRegionPartition(goal: string): ScenePartition {
  return {
    regions: [makeLocalRegion("main", "Gesamtes Objekt", 20)],
    assignments: [{ regionId: "main", localGoal: goal, priority: 1 }],
    styleDirectives: { goal },
  };
}

// ─── Erweiterte Partitionierung mit Mesh-Ops-Support ────────

// Erstellt eine erweiterte WorkRegion mit Mesh-Ops-Metadaten
export function makeExtendedRegion(
  id: string,
  label: string,
  maxPrimitives: number,
  opts: {
    densityLevel?: number;
    styleConstraint?: string;
    seedOffset?: number;
    meshOps?: MeshOperation[];
  } = {},
): WorkRegionExt {
  return {
    ...makeLocalRegion(id, label, maxPrimitives),
    meshOps: opts.meshOps ?? [],
    densityLevel: opts.densityLevel ?? 5,
    styleConstraint: opts.styleConstraint,
    seedOffset: opts.seedOffset,
  };
}

// KI-gestützte Partitionierung mit Mesh-Operations-Plan
export async function partitionWithOps(
  userPrompt: string,
  scene: Scene,
): Promise<{ partition: ScenePartition; extRegions: WorkRegionExt[] }> {
  const partition = await partitionWithAI(userPrompt, scene);

  // Erweitere Regionen mit Default Mesh-Ops-Metadaten
  const extRegions: WorkRegionExt[] = partition.regions.map((r, i) => ({
    ...r,
    meshOps: [],
    densityLevel: 5,
    seedOffset: i * 1000,
  }));

  return { partition, extRegions };
}
