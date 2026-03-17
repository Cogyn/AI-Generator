// Partitioner: Zerlegt eine Aufgabe in semantische Parts
// Jeder Builder bekommt sein eigenes lokales Koordinatensystem

import type {
  Scene,
  ScenePartition,
  WorkRegion,
  RegionAssignment,
  AABB,
  Primitive,
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
After building, a Combiner will scale and position the parts to form the complete object.

IMPORTANT: Think about the object's STRUCTURAL components, not spatial regions.

EXAMPLE: "Build an airplane"
Parts:
- "fuselage": The main body/tube of the airplane
- "wings": The two main wings (as a pair)
- "tail": Tail fins and horizontal stabilizer
- "landing-gear": The wheels/struts underneath

EXAMPLE: "Build a table"
Parts:
- "tabletop": The flat surface on top
- "legs": The four legs underneath

RULES:
- Each part should be a self-contained component that makes sense on its own.
- 2-5 parts for most objects. Don't over-split.
- Each part gets 3-10 primitives max.
- Give each part a clear, specific build goal.

Respond with ONLY valid JSON:
{
  "goal": "overall goal description",
  "colorPalette": ["#hex", ...],
  "styleTags": ["..."],
  "parts": [
    {"id": "part-id", "label": "Human Label", "goal": "what to build for this part", "maxPrimitives": N, "priority": 1},
    ...
  ]
}`;

  const raw = await callLLM(systemPrompt, `Decompose into parts: "${userPrompt}". Scene has ${scene.primitives.length} existing primitives.`);
  try {
    const parsed = JSON.parse(raw);
    if (validatePartition(parsed)) {
      return partsToPartition(parsed, userPrompt);
    }
    return heuristicPartition(userPrompt) ?? createSingleRegionPartition(userPrompt);
  } catch {
    return heuristicPartition(userPrompt) ?? createSingleRegionPartition(userPrompt);
  }
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

  return {
    regions,
    assignments,
    styleDirectives: {
      goal: parsed.goal ?? userPrompt,
      colorPalette: parsed.colorPalette,
      styleTags: parsed.styleTags,
    },
  };
}

// Keyword-basierte Heuristik
function heuristicPartition(userPrompt: string): ScenePartition | null {
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
    }, userPrompt);
  }

  if (lower.includes("tisch") || lower.includes("table") || lower.includes("desk")) {
    return partsToPartition({
      goal: userPrompt,
      colorPalette: ["#8B4513", "#A0522D", "#DEB887"],
      parts: [
        { id: "tabletop", label: "Tischplatte", goal: "Build a flat rectangular tabletop as a single wide, thin cube centered at origin.", maxPrimitives: 3, priority: 1 },
        { id: "legs", label: "Tischbeine", goal: "Build 4 table legs as thin vertical cylinders or cubes, positioned at the four corners. Build centered at origin.", maxPrimitives: 6, priority: 2 },
      ],
    }, userPrompt);
  }

  if (lower.includes("stuhl") || lower.includes("chair")) {
    return partsToPartition({
      goal: userPrompt,
      colorPalette: ["#8B4513", "#A0522D"],
      parts: [
        { id: "seat", label: "Sitzfläche", goal: "Build a flat square seat as a thin cube, and a tall thin backrest cube behind it. Build centered at origin.", maxPrimitives: 4, priority: 1 },
        { id: "legs", label: "Stuhlbeine", goal: "Build 4 chair legs as thin vertical cylinders positioned at corners. Build centered at origin.", maxPrimitives: 5, priority: 2 },
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
