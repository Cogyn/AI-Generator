// Erweiterter Planner: Erzeugt strukturierte PlanObjects statt nur Text-Beschreibungen
// KI wird für Planung/Struktur genutzt, Regelwerk ist fest kodiert

import type {
  PlanObject, PlanArea, PlanBuilder, AssemblyRule, Scene,
} from "../core/types.js";
import { callLLMTracked } from "../ai/client.js";
import {
  createPlanObject, createPlanArea, createPlanBuilder,
  DEFAULT_QUALITY_TARGETS, DEFAULT_COST_TARGETS, DEFAULT_BOUNDARY_CONSTRAINTS,
  validatePlanObject,
} from "./plan-object.js";

// ─── Haupt-Planner: User-Prompt → PlanObject ────────────────

export async function generatePlanObject(
  userPrompt: string,
  existingScene?: Scene,
  requirements: string[] = [],
  log: (msg: string, level?: "info" | "success" | "warn" | "error") => void = console.log,
): Promise<PlanObject> {
  // Versuche KI-basierte Planung
  try {
    const plan = await generatePlanWithAI(userPrompt, existingScene, requirements);
    const validation = validatePlanObject(plan);
    if (validation.valid) {
      log(`KI-Plan akzeptiert: ${plan.builders.length} Builder, ${plan.areas.length} Areas`, "success");
      return plan;
    }
    // Bei Validierungsfehlern: loggen, dann Heuristik
    for (const e of validation.errors) log(`Plan-Validierung: ${e}`, "warn");
    log("KI-Plan ungültig, prüfe Heuristik-Fallback...", "warn");
  } catch (e) {
    log(`KI-Planung fehlgeschlagen: ${(e as Error).message}`, "warn");
  }

  // Fallback: Heuristik-basierte Planung (nur für einfache Prompts)
  // Bei komplexen Prompts versuche KI nochmal mit vereinfachtem Prompt
  if (isComplexPrompt(userPrompt)) {
    log("Komplexer Prompt erkannt, versuche vereinfachte KI-Planung...", "info");
    try {
      const plan = await generatePlanWithAI(userPrompt, existingScene, [
        ...requirements,
        "Keep the plan simple but cover ALL items mentioned in the prompt",
        "Create one area/builder per distinct object mentioned",
      ]);
      const validation = validatePlanObject(plan);
      if (validation.valid) {
        log(`Vereinfachter KI-Plan akzeptiert: ${plan.builders.length} Builder`, "success");
        return plan;
      }
    } catch (e) {
      log(`Zweiter KI-Versuch fehlgeschlagen: ${(e as Error).message}`, "warn");
    }
  }

  log("Nutze Heuristik-Fallback", "info");
  return generateHeuristicPlan(userPrompt);
}

// ─── Prompt-Komplexität erkennen ─────────────────────────────

function isComplexPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  // Zähle wie viele verschiedene Objekte erwähnt werden
  const objectKeywords = [
    "tisch", "table", "stuhl", "chair", "lampe", "lamp", "laptop", "computer",
    "drucker", "printer", "stift", "pen", "becher", "cup", "schrank", "cabinet",
    "regal", "shelf", "auto", "car", "haus", "house", "sofa", "couch",
    "bett", "bed", "fenster", "window", "tür", "door", "buch", "book",
    "monitor", "keyboard", "tastatur", "maus", "mouse", "telefon", "phone",
    "pflanze", "plant", "uhr", "clock", "bild", "picture",
  ];
  const mentioned = objectKeywords.filter((kw) => lower.includes(kw));
  // 3+ verschiedene Objekte = komplex
  return mentioned.length >= 3;
}

// ─── KI-basierte Planung ─────────────────────────────────────

async function generatePlanWithAI(
  userPrompt: string,
  existingScene?: Scene,
  requirements: string[] = [],
): Promise<PlanObject> {
  const requirementsStr = requirements.length > 0
    ? `\nADDITIONAL REQUIREMENTS:\n${requirements.map((r) => `- ${r}`).join("\n")}`
    : "";

  const existingStr = existingScene && existingScene.primitives.length > 0
    ? `\nEXISTING SCENE: ${existingScene.primitives.length} primitives already placed.`
    : "";

  const systemPrompt = `You are a 3D structure planner. Output a JSON plan for building a 3D scene from primitives (cube, sphere, cylinder).

CRITICAL: Create ONE area+builder for EACH distinct object the user mentions. "desk with laptop, printer, lamp" = 4 areas minimum (desk, laptop, printer, lamp).

JSON SCHEMA (output EXACTLY this structure):
{
  "goal": "short scene description",
  "style_tags": ["tag1"],
  "color_palette": ["#hex1","#hex2"],
  "areas": [{"id":"kebab-id","label":"Name","target_density":0.5,"detail_level":5,"sub_components":["part1"]}],
  "builders": [{"name":"same-as-area-id","area_id":"area-ref","target_density":0.5,"detail_level":5,"max_primitives":5,"description":"SHORT build instructions: types, sizes, colors","color_palette":["#hex"]}],
  "assembly_rules": [{"partId":"id","parentPartId":"other-id-or-ground","relation":"on_top_of","alignment":"center","priority":1,"contactRequired":true}],
  "boundary_pairs": [{"region_a":"id1","region_b":"id2","max_gap":0.5,"no_collision":true}]
}

RELATIONS: on_top_of, below, beside_left, beside_right, in_front_of, behind, attached_to
ALIGNMENT: center, corner_nw, corner_ne, corner_sw, corner_se, edge_left, edge_right, edge_front, edge_back
MULTI-INSTANCE: add "multiInstance":{"count":4,"pattern":"corners"} for repeated parts (table legs etc.)

RULES:
- Root part (priority=1) = largest/base object. Others placed relative to it.
- Objects ON a surface: relation="on_top_of", parentPartId=surface id.
- Objects BESIDE something: relation="beside_left"/"beside_right".
- Keep builder descriptions SHORT (1-2 sentences). Mention: primitive types, approximate sizes, colors.
- Max 8 primitives per builder. Think about dimensions: objects on a desk must be small enough to fit.
- DO NOT use markdown or code blocks. Output raw JSON only.
${requirementsStr}${existingStr}`;

  const raw = await callLLMTracked(
    systemPrompt,
    `Create a structured plan for: "${userPrompt}"`,
    "planner",
    2048,
  );

  const parsed = JSON.parse(repairTruncatedJSON(raw));
  return aiResponseToPlanObject(parsed, userPrompt);
}

// ─── JSON-Reparatur für abgeschnittene Antworten ─────────────

function repairTruncatedJSON(raw: string): string {
  let text = raw.trim();

  // Entferne Markdown-Codeblöcke falls vorhanden
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) text = codeBlockMatch[1].trim();

  // Versuche direkt zu parsen
  try {
    JSON.parse(text);
    return text;
  } catch {
    // Weiter mit Reparatur
  }

  // Versuche abgeschnittenes JSON zu reparieren:
  // Schließe offene Strings, Arrays, Objects
  let repaired = text;

  // Zähle offene Klammern/Anführungszeichen
  let inString = false;
  let escaped = false;
  const stack: string[] = [];

  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }

    if (inString) {
      if (ch === '"') inString = false;
    } else {
      if (ch === '"') inString = true;
      else if (ch === '{') stack.push('}');
      else if (ch === '[') stack.push(']');
      else if (ch === '}' || ch === ']') {
        if (stack.length > 0 && stack[stack.length - 1] === ch) stack.pop();
      }
    }
  }

  // Schließe offenen String
  if (inString) repaired += '"';

  // Entferne trailing comma vor dem Schließen
  repaired = repaired.replace(/,\s*$/, "");

  // Schließe offene Klammern
  while (stack.length > 0) {
    repaired += stack.pop();
  }

  // Versuche nochmal
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    // Letzter Versuch: schneide bis zum letzten vollständigen Element
    // Finde das letzte '}]' oder '"}' vor dem Ende
    const lastBrace = repaired.lastIndexOf("}");
    if (lastBrace > 0) {
      const truncated = repaired.slice(0, lastBrace + 1);
      // Schließe restliche offene Klammern
      let attempt = truncated;
      try {
        JSON.parse(attempt);
        return attempt;
      } catch {
        // Versuch mit aggressiverem Schließen
        attempt = truncated.replace(/,\s*$/, "") + "]}";
        try { JSON.parse(attempt); return attempt; } catch { /* weiter */ }
        attempt = truncated.replace(/,\s*$/, "") + '"]}';
        try { JSON.parse(attempt); return attempt; } catch { /* weiter */ }
      }
    }

    // Gib auf, wirf den Originalfehler
    throw new Error(`JSON repair failed for: ${text.slice(0, 100)}...`);
  }
}

// ─── KI-Response → PlanObject konvertieren ───────────────────

function aiResponseToPlanObject(parsed: any, userPrompt: string): PlanObject {
  const areas: PlanArea[] = (parsed.areas ?? []).map((a: any) =>
    createPlanArea({
      id: a.id,
      label: a.label,
      target_density: a.target_density,
      detail_level: a.detail_level,
      sub_components: a.sub_components,
    }),
  );

  const builders: PlanBuilder[] = (parsed.builders ?? []).map((b: any) =>
    createPlanBuilder({
      name: b.name,
      area_id: b.area_id,
      description: b.description,
      target_density: b.target_density,
      detail_level: b.detail_level,
      max_primitives: b.max_primitives,
      color_palette: b.color_palette,
    }),
  );

  const assemblyRules: AssemblyRule[] = (parsed.assembly_rules ?? []).map((r: any) => ({
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

  const boundaryPairs = (parsed.boundary_pairs ?? []).map((bp: any) => ({
    region_a: bp.region_a,
    region_b: bp.region_b,
    max_gap: bp.max_gap ?? 0.5,
    no_collision: bp.no_collision ?? true,
  }));

  // Dynamische Cost-Targets basierend auf Anzahl der Builder
  const totalMaxPrims = builders.reduce((s, b) => s + b.max_primitives, 0);

  return createPlanObject({
    goal: parsed.goal ?? userPrompt,
    user_prompt: userPrompt,
    areas,
    builders,
    assembly_rules: assemblyRules,
    style_tags: parsed.style_tags,
    color_palette: parsed.color_palette,
    boundary_constraints: {
      ...DEFAULT_BOUNDARY_CONSTRAINTS,
      boundary_pairs: boundaryPairs,
    },
    cost_targets: {
      max_primitives_total: Math.max(40, totalMaxPrims),
      max_primitives_per_area: 10,
      max_llm_calls: builders.length + 5,
    },
  });
}

// ─── Heuristik-basierte Planung ──────────────────────────────

function generateHeuristicPlan(userPrompt: string): PlanObject {
  const lower = userPrompt.toLowerCase();

  // NUR für einfache, eindeutige Prompts die Heuristik nutzen
  // Komplexe Prompts (mehrere Objekte) -> generischer Plan

  // Auto/Car — nur wenn kein zusätzlicher Kontext
  if ((lower.includes("auto") || lower.includes("car") || lower.includes("fahrzeug")) && !isComplexPrompt(userPrompt)) {
    return createCarPlan(userPrompt);
  }

  // Flugzeug
  if ((lower.includes("flugzeug") || lower.includes("airplane") || lower.includes("plane") || lower.includes("jet")) && !isComplexPrompt(userPrompt)) {
    return createAirplanePlan(userPrompt);
  }

  // Tisch (OHNE Extras)
  if ((lower.includes("tisch") || lower.includes("table") || lower.includes("desk")) && !isComplexPrompt(userPrompt)) {
    return createTablePlan(userPrompt);
  }

  // Haus
  if ((lower.includes("haus") || lower.includes("house") || lower.includes("building") || lower.includes("gebäude")) && !isComplexPrompt(userPrompt)) {
    return createHousePlan(userPrompt);
  }

  // Generic Fallback
  return createGenericPlan(userPrompt);
}

// ─── Spezifische Heuristik-Pläne ────────────────────────────

function createCarPlan(userPrompt: string): PlanObject {
  return createPlanObject({
    goal: userPrompt,
    user_prompt: userPrompt,
    style_tags: ["vehicle", "car", "automotive"],
    color_palette: ["#CC0000", "#333333", "#888888", "#111111", "#FFFFFF", "#FFCC00"],
    areas: [
      createPlanArea({ id: "body", label: "Car Body", target_density: 0.6, detail_level: 7, sub_components: ["main-chassis", "cabin", "hood", "trunk"] }),
      createPlanArea({ id: "wheels", label: "Wheels", target_density: 0.5, detail_level: 5, sub_components: ["tire", "rim"] }),
      createPlanArea({ id: "windows", label: "Windows", target_density: 0.3, detail_level: 4, sub_components: ["windshield", "side-windows", "rear-window"] }),
      createPlanArea({ id: "details", label: "Car Details", target_density: 0.4, detail_level: 6, sub_components: ["front-lights", "rear-lights", "grille"] }),
    ],
    builders: [
      createPlanBuilder({
        name: "body", area_id: "body", max_primitives: 8, target_density: 0.6, detail_level: 7,
        description: "Build the car body: 1) Main chassis as a wide flat cube (size ~[4,0.8,2]) at y=0.4. 2) Cabin as a smaller cube (size ~[2.5,1,1.8]) on top centered. 3) Hood as a low flat cube in front. 4) Trunk as a low flat cube in back. Use red/dark colors.",
        color_palette: ["#CC0000", "#AA0000", "#880000"],
      }),
      createPlanBuilder({
        name: "wheels", area_id: "wheels", max_primitives: 4, target_density: 0.5, detail_level: 5,
        description: "Build ONE wheel: 1) Tire as a cylinder (radiusTop=0.4, radiusBottom=0.4, height=0.3) rotated [0,0,90] for horizontal. 2) Rim as a smaller cylinder inside. Use dark gray/silver. The assembly will replicate to 4 corners.",
        color_palette: ["#333333", "#888888"],
      }),
      createPlanBuilder({
        name: "windows", area_id: "windows", max_primitives: 5, target_density: 0.3, detail_level: 4,
        description: "Build window assembly: 1) Windshield as a thin flat cube (size ~[2.2,0.8,0.05]) slightly tilted. 2) Two side windows as thin cubes. 3) Rear window. Use light blue/transparent color.",
        color_palette: ["#87CEEB", "#ADD8E6"],
      }),
      createPlanBuilder({
        name: "details", area_id: "details", max_primitives: 6, target_density: 0.4, detail_level: 6,
        description: "Build car details: 1) Two front headlights as small spheres or cubes. 2) Two rear tail lights as small red cubes. 3) Front grille as a thin flat cube. Use yellow for headlights, red for taillights, dark gray for grille.",
        color_palette: ["#FFCC00", "#FF0000", "#444444"],
      }),
    ],
    assembly_rules: [
      { partId: "body", parentPartId: "ground", relation: "on_top_of", alignment: "center", priority: 1, contactRequired: true },
      { partId: "wheels", parentPartId: "body", relation: "below", alignment: "center", priority: 2, contactRequired: true, multiInstance: { count: 4, pattern: "corners" } },
      { partId: "windows", parentPartId: "body", relation: "on_top_of", alignment: "center", priority: 3, contactRequired: true },
      { partId: "details", parentPartId: "body", relation: "attached_to", alignment: "center", priority: 4, contactRequired: true },
    ],
    boundary_constraints: {
      no_cross_region_collision: true,
      max_cross_region_gap: 0.3,
      boundary_pairs: [
        { region_a: "windows", region_b: "details", max_gap: 0.5, no_collision: true },
        { region_a: "body", region_b: "wheels", max_gap: 0.2, no_collision: false },
      ],
    },
  });
}

function createAirplanePlan(userPrompt: string): PlanObject {
  return createPlanObject({
    goal: userPrompt,
    user_prompt: userPrompt,
    style_tags: ["aircraft", "streamlined"],
    color_palette: ["#C0C0C0", "#808080", "#1E3A5F", "#FF0000", "#333333"],
    areas: [
      createPlanArea({ id: "fuselage", label: "Fuselage", target_density: 0.5, detail_level: 6, sub_components: ["body-tube", "nose-cone"] }),
      createPlanArea({ id: "wings", label: "Wings", target_density: 0.4, detail_level: 5, sub_components: ["left-wing", "right-wing"] }),
      createPlanArea({ id: "tail", label: "Tail Section", target_density: 0.4, detail_level: 5, sub_components: ["vertical-fin", "horizontal-stabilizers"] }),
      createPlanArea({ id: "landing-gear", label: "Landing Gear", target_density: 0.3, detail_level: 4, sub_components: ["struts", "wheels"] }),
    ],
    builders: [
      createPlanBuilder({
        name: "fuselage", area_id: "fuselage", max_primitives: 5, target_density: 0.5, detail_level: 6,
        description: "Build fuselage: 1) Main body as a cylinder (radiusTop=1, radiusBottom=1, height=8) rotated [90,0,0] for horizontal along Z. 2) Nose cone as a sphere at front end. Use silver/gray.",
        color_palette: ["#C0C0C0", "#808080"],
      }),
      createPlanBuilder({
        name: "wings", area_id: "wings", max_primitives: 5, target_density: 0.4, detail_level: 5,
        description: "Build wings: Two flat wide cubes extending left and right (size ~[6,0.2,2]). Build centered, assembly will position them. Use silver.",
        color_palette: ["#C0C0C0", "#A0A0A0"],
      }),
      createPlanBuilder({
        name: "tail", area_id: "tail", max_primitives: 5, target_density: 0.4, detail_level: 5,
        description: "Build tail: 1) Vertical tail fin as a thin tall cube. 2) Two horizontal stabilizers as thin flat cubes. Use silver/dark blue.",
        color_palette: ["#1E3A5F", "#C0C0C0"],
      }),
      createPlanBuilder({
        name: "landing-gear", area_id: "landing-gear", max_primitives: 6, target_density: 0.3, detail_level: 4,
        description: "Build landing gear: 2-3 thin vertical cylinders as struts with small spheres as wheels. Use dark gray.",
        color_palette: ["#333333", "#555555"],
      }),
    ],
    assembly_rules: [
      { partId: "fuselage", parentPartId: "ground", relation: "on_top_of", alignment: "center", priority: 1, contactRequired: true },
      { partId: "wings", parentPartId: "fuselage", relation: "attached_to", alignment: "center", priority: 2, contactRequired: true },
      { partId: "tail", parentPartId: "fuselage", relation: "behind", alignment: "center", priority: 3, contactRequired: true },
      { partId: "landing-gear", parentPartId: "fuselage", relation: "below", alignment: "center", priority: 4, contactRequired: true, multiInstance: { count: 2, pattern: "linear", spacing: 4 } },
    ],
  });
}

function createTablePlan(userPrompt: string): PlanObject {
  return createPlanObject({
    goal: userPrompt,
    user_prompt: userPrompt,
    style_tags: ["furniture", "table"],
    color_palette: ["#8B4513", "#A0522D", "#DEB887"],
    areas: [
      createPlanArea({ id: "tabletop", label: "Tabletop", target_density: 0.4, detail_level: 3, sub_components: ["surface"] }),
      createPlanArea({ id: "legs", label: "Table Legs", target_density: 0.3, detail_level: 3, sub_components: ["leg"] }),
    ],
    builders: [
      createPlanBuilder({
        name: "tabletop", area_id: "tabletop", max_primitives: 3, target_density: 0.4, detail_level: 3,
        description: "Build a flat rectangular tabletop as a single wide thin cube (size ~[4,0.3,2]) centered at origin. Use brown wood color.",
        color_palette: ["#8B4513", "#A0522D"],
      }),
      createPlanBuilder({
        name: "legs", area_id: "legs", max_primitives: 2, target_density: 0.3, detail_level: 3,
        description: "Build a single table leg as a thin vertical cylinder (radiusTop=0.15, radiusBottom=0.15, height=2.5) centered at origin. Assembly will replicate to 4 corners.",
        color_palette: ["#8B4513"],
      }),
    ],
    assembly_rules: [
      { partId: "tabletop", parentPartId: "ground", relation: "on_top_of", alignment: "center", priority: 1, contactRequired: true },
      { partId: "legs", parentPartId: "tabletop", relation: "below", alignment: "center", priority: 2, contactRequired: true, multiInstance: { count: 4, pattern: "corners" } },
    ],
  });
}

function createHousePlan(userPrompt: string): PlanObject {
  return createPlanObject({
    goal: userPrompt,
    user_prompt: userPrompt,
    style_tags: ["building", "house", "architecture"],
    color_palette: ["#D2B48C", "#8B0000", "#808080", "#4682B4", "#FFFFFF"],
    areas: [
      createPlanArea({ id: "structure", label: "House Structure", target_density: 0.5, detail_level: 6, sub_components: ["walls", "door-frame"] }),
      createPlanArea({ id: "roof", label: "Roof", target_density: 0.4, detail_level: 4, sub_components: ["roof-panels"] }),
    ],
    builders: [
      createPlanBuilder({
        name: "structure", area_id: "structure", max_primitives: 8, target_density: 0.5, detail_level: 6,
        description: "Build house walls: One large cube (size ~[5,3,4]) as the main structure. Add a door opening by leaving space or adding a door frame. Use tan/beige colors.",
        color_palette: ["#D2B48C", "#C4A882"],
      }),
      createPlanBuilder({
        name: "roof", area_id: "roof", max_primitives: 4, target_density: 0.4, detail_level: 4,
        description: "Build a pitched roof: Two angled cubes (rotated ~25 degrees) forming an A-shape on top of the structure. Use dark red color.",
        color_palette: ["#8B0000", "#A52A2A"],
      }),
    ],
    assembly_rules: [
      { partId: "structure", parentPartId: "ground", relation: "on_top_of", alignment: "center", priority: 1, contactRequired: true },
      { partId: "roof", parentPartId: "structure", relation: "on_top_of", alignment: "center", priority: 2, contactRequired: true },
    ],
  });
}

function createGenericPlan(userPrompt: string): PlanObject {
  return createPlanObject({
    goal: userPrompt,
    user_prompt: userPrompt,
    style_tags: ["generic"],
    color_palette: ["#888888", "#666666", "#AAAAAA", "#444444"],
    areas: [
      createPlanArea({ id: "main", label: "Main Structure", target_density: 0.5, detail_level: 5, sub_components: ["base", "body"] }),
    ],
    builders: [
      createPlanBuilder({
        name: "main", area_id: "main", max_primitives: 10, target_density: 0.5, detail_level: 5,
        description: `Build the complete object: "${userPrompt}". Use cubes, spheres, and cylinders. Place the main structural element first, then add details. Build centered at origin.`,
        color_palette: ["#888888", "#666666", "#AAAAAA"],
      }),
    ],
    assembly_rules: [
      { partId: "main", parentPartId: "ground", relation: "on_top_of", alignment: "center", priority: 1, contactRequired: true },
    ],
  });
}
