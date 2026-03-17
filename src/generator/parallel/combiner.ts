// Combiner: Nimmt lokal gebaute Part-Gruppen, skaliert und positioniert sie
// im Hauptfenster so dass ein kohärentes Gesamtobjekt entsteht.

import type {
  Scene,
  Primitive,
  PartGroup,
  PartTransform,
  CombinerResult,
  Vec3,
  AABB,
  GlobalStyleDirectives,
} from "../../core/types.js";
import { createScene, addPrimitives } from "../../core/scene.js";
import { getPrimitiveExtents } from "../../core/types.js";
import { getBBox } from "../../core/constraints.js";
import { callLLM } from "../../ai/client.js";

// Berechnet die lokale AABB einer Gruppe von Primitives
export function computeLocalBounds(primitives: Primitive[]): AABB {
  if (primitives.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of primitives) {
    const bb = getBBox(p);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], bb.min[i]);
      max[i] = Math.max(max[i], bb.max[i]);
    }
  }
  return { min, max };
}

// Erstellt PartGroups aus BuilderResults
export function buildPartGroups(
  results: Array<{ taskId: string; regionId: string; addedPrimitives: Primitive[]; reasoning: string }>,
  labels: Map<string, string>,
): PartGroup[] {
  return results
    .filter((r) => r.addedPrimitives.length > 0)
    .map((r) => ({
      partId: r.regionId,
      label: labels.get(r.regionId) ?? r.regionId,
      primitives: r.addedPrimitives,
      localBounds: computeLocalBounds(r.addedPrimitives),
    }));
}

// Wende eine Transform auf ein Primitive an
function transformPrimitive(p: Primitive, transform: PartTransform): Primitive {
  const s = transform.scale;
  const off = transform.offset;
  const newPos: Vec3 = [
    p.position[0] * s + off[0],
    p.position[1] * s + off[1],
    p.position[2] * s + off[2],
  ];

  // Rotation der Gruppe addieren (falls vorhanden)
  const newRot: Vec3 = transform.rotation
    ? [p.rotation[0] + transform.rotation[0], p.rotation[1] + transform.rotation[1], p.rotation[2] + transform.rotation[2]]
    : [...p.rotation];

  // Typ-spezifisch skalieren
  switch (p.type) {
    case "cube":
      return { ...p, position: newPos, rotation: newRot, size: [p.size[0] * s, p.size[1] * s, p.size[2] * s] };
    case "sphere":
      return { ...p, position: newPos, rotation: newRot, radius: p.radius * s };
    case "cylinder":
      return { ...p, position: newPos, rotation: newRot, radiusTop: p.radiusTop * s, radiusBottom: p.radiusBottom * s, height: p.height * s };
  }
}

// LLM-gestützter Combiner: entscheidet wie Parts zusammengesetzt werden
export async function combineParts(
  partGroups: PartGroup[],
  styleDirectives: GlobalStyleDirectives,
  existingScene?: Scene,
): Promise<CombinerResult> {
  const scene = existingScene ?? createScene(styleDirectives.goal);

  if (partGroups.length === 0) {
    return { scene, transforms: [], issues: ["Keine Parts zum Kombinieren"] };
  }

  // Beschreibe die Parts für das LLM
  const partsDescription = partGroups.map((g) => {
    const b = g.localBounds;
    const dims: Vec3 = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
    return {
      partId: g.partId,
      label: g.label,
      primitiveCount: g.primitives.length,
      localDimensions: { width: +dims[0].toFixed(2), height: +dims[1].toFixed(2), depth: +dims[2].toFixed(2) },
      localCenter: [
        +((b.min[0] + b.max[0]) / 2).toFixed(2),
        +((b.min[1] + b.max[1]) / 2).toFixed(2),
        +((b.min[2] + b.max[2]) / 2).toFixed(2),
      ],
      primitiveTypes: [...new Set(g.primitives.map((p) => p.type))],
    };
  });

  const systemPrompt = `You are a 3D assembly combiner. Multiple builders have independently created parts of an object in their own local coordinate space. Your job: decide how to SCALE and POSITION each part so they form a coherent whole.

GOAL: ${styleDirectives.goal}

PARTS (each built independently around origin [0,0,0]):
${JSON.stringify(partsDescription, null, 1)}

${existingScene && existingScene.primitives.length > 0 ? `EXISTING SCENE has ${existingScene.primitives.length} primitives already placed.` : "EMPTY SCENE — building from scratch."}

COORDINATE SYSTEM:
- x = left/right, y = up (height), z = forward/back
- y=0 is the ground. Objects should sit ON the ground (y >= 0).

YOUR TASK:
For each part, decide:
1. "scale": uniform scale factor (1.0 = keep original size). Use this to make parts proportional to each other.
2. "offset": [x, y, z] — where to place the center of this part in the main scene.
3. "rotation": [rx, ry, rz] in degrees — optional rotation of the entire part group (default [0,0,0]).

RULES:
- Parts must CONNECT — no floating groups. Adjacent parts should touch or nearly touch.
- Parts must NOT overlap significantly after placement.
- The result should sit on the ground (lowest point at y ≈ 0).
- Scale parts so they are proportional (e.g., airplane wings wider than fuselage, table legs thinner than tabletop).
- Place parts logically: e.g., wings on sides of fuselage, legs below tabletop, head on top of body.

Respond with ONLY valid JSON:
{"transforms": [{"partId": "...", "scale": 1.0, "offset": [x, y, z], "rotation": [0, 0, 0]}, ...], "reasoning": "how you assembled the parts"}`;

  try {
    const raw = await callLLM(systemPrompt, `Assemble these ${partGroups.length} parts into: ${styleDirectives.goal}`);
    const parsed = JSON.parse(raw);
    const transforms: PartTransform[] = parsed.transforms ?? [];
    const issues: string[] = [];

    // Validiere und wende Transforms an
    const allTransformed: Primitive[] = [];
    for (const group of partGroups) {
      const transform = transforms.find((t) => t.partId === group.partId);
      if (!transform) {
        // Fallback: unverändert bei [0,0,0]
        issues.push(`Kein Transform für Part "${group.label}" — nutze Default`);
        allTransformed.push(...group.primitives);
        continue;
      }

      // Validiere Transform-Werte
      transform.scale = typeof transform.scale === "number" && transform.scale > 0 ? transform.scale : 1;
      transform.offset = Array.isArray(transform.offset) && transform.offset.length >= 3
        ? transform.offset as Vec3 : [0, 0, 0];
      if (transform.rotation && (!Array.isArray(transform.rotation) || transform.rotation.length < 3)) {
        transform.rotation = [0, 0, 0];
      }

      for (const p of group.primitives) {
        allTransformed.push(transformPrimitive(p, transform));
      }
    }

    const finalScene = addPrimitives(scene, allTransformed);

    return {
      scene: finalScene,
      transforms,
      issues,
    };
  } catch (err) {
    // Fallback: alle Parts unverändert einfügen
    const allPrimitives = partGroups.flatMap((g) => g.primitives);
    const fallbackScene = addPrimitives(scene, allPrimitives);
    return {
      scene: fallbackScene,
      transforms: [],
      issues: [`Combiner fehlgeschlagen: ${(err as Error).message}. Parts unverändert eingefügt.`],
    };
  }
}
