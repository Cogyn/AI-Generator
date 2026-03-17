import type { PromptContext, Scene, GenerationPlan } from "../core/types.js";

export function buildPromptContext(
  userPrompt: string,
  scene: Scene,
  plan: GenerationPlan,
  currentStep: number,
): PromptContext {
  return { userPrompt, currentScene: scene, plan, currentStep };
}

export function buildPlannerSystemPrompt(userPrompt: string, scene: Scene): string {
  const n = scene.primitives.length;
  return `Du bist ein 3D-Struktur-Planer. Du erstellst einen schrittweisen Plan, um ein Objekt aus einfachen Cubes aufzubauen.
Jeder Schritt soll genau ein Cube-Primitive hinzufügen.

Aktueller Zustand: ${n} Primitives in der Szene.
User-Wunsch: "${userPrompt}"

Antworte NUR mit validem JSON (kein Markdown, kein Codeblock):
{"goal": "...", "estimatedSteps": N, "steps": ["Schritt 1 Beschreibung", ...]}`;
}

export function buildBuilderSystemPrompt(context: PromptContext): string {
  const stepDesc = context.plan.steps[context.currentStep] ?? "Nächster logischer Schritt";
  const existing = context.currentScene.primitives.map((p) => ({
    id: p.id, position: p.position, size: p.size, tags: p.tags,
  }));

  return `Du bist ein 3D-Builder. Erzeuge genau ein Cube-Primitive als nächsten Bauschritt.

Ziel: ${context.plan.goal}
Aktueller Schritt (${context.currentStep + 1}/${context.plan.estimatedSteps}): ${stepDesc}
Vorhandene Primitives: ${JSON.stringify(existing)}

Regeln:
- position: [x, y, z] – y ist nach oben
- size: [breite, höhe, tiefe]
- rotation: [rx, ry, rz] in Grad
- id: kurzer, beschreibender Name (keine Leerzeichen)
- tags: relevante Labels
- color: Hex-Farbe passend zum Objekt

Antworte NUR mit validem JSON (kein Markdown, kein Codeblock):
{"stepNumber": N, "action": "add", "reasoning": "...", "primitive": {"id": "...", "type": "cube", "position": [x,y,z], "size": [w,h,d], "rotation": [0,0,0], "color": "#hex", "tags": ["..."]}}`;
}

export function buildCriticSystemPrompt(scene: Scene, plan: GenerationPlan, stepNumber: number): string {
  const primitives = scene.primitives.map((p) => ({
    id: p.id, position: p.position, size: p.size, tags: p.tags,
  }));

  return `Du bist ein 3D-Kritiker. Bewerte den aktuellen Zustand der Szene.

Ziel: ${plan.goal}
Schritt ${stepNumber} von ${plan.estimatedSteps}
Primitives: ${JSON.stringify(primitives)}

Bewerte: Passt das bisherige Ergebnis zum Ziel? Ist der nächste Schritt sinnvoll?

Antworte NUR mit validem JSON (kein Markdown, kein Codeblock):
{"approved": true/false, "feedback": "...", "isComplete": true/false}`;
}
