import type {
  PromptContext,
  PlannerResponse,
  BuilderResponse,
  CriticResponse,
  Scene,
  GenerationPlan,
} from "../core/types.js";
import { callLLM } from "./client.js";
import {
  buildPlannerSystemPrompt,
  buildBuilderSystemPrompt,
  buildCriticSystemPrompt,
} from "./prompt.js";

// JSON aus LLM-Antwort extrahieren (tolerant gegenüber Markdown-Wrapping)
function extractJSON(text: string): string {
  const cleaned = text.trim();
  // Codeblock
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  // Direktes JSON-Objekt
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) return jsonMatch[0];
  return cleaned;
}

function safeParse<T>(text: string, fallback: T, label: string): T {
  try {
    return JSON.parse(extractJSON(text)) as T;
  } catch (e) {
    console.error(`[${label}] JSON-Parse fehlgeschlagen:`, text);
    throw new Error(`${label}: Ungültige JSON-Antwort vom Modell. Versuche es nochmal oder wähle ein anderes Modell.`);
  }
}

export async function planner(context: PromptContext): Promise<PlannerResponse> {
  const systemPrompt = buildPlannerSystemPrompt(context.userPrompt, context.currentScene);
  const raw = await callLLM(systemPrompt, `Create a build plan for: ${context.userPrompt}`);
  const plan = safeParse<GenerationPlan>(raw, { goal: "", estimatedSteps: 0, steps: [] }, "Planner");

  // Sanitize
  if (!plan.steps || !Array.isArray(plan.steps) || plan.steps.length === 0) {
    throw new Error("Planner hat keinen gültigen Plan zurückgegeben.");
  }
  plan.estimatedSteps = plan.steps.length;

  return { plan };
}

export async function builder(context: PromptContext): Promise<BuilderResponse> {
  const systemPrompt = buildBuilderSystemPrompt(context);
  const stepDesc = context.plan.steps[context.currentStep] ?? "Next step";
  const raw = await callLLM(systemPrompt, `Build now: ${stepDesc}`);
  const step = safeParse<any>(raw, null, "Builder");

  // Validate & fix primitive
  if (!step?.primitive) {
    throw new Error("Builder hat kein Primitive zurückgegeben.");
  }
  const p = step.primitive;
  p.type = "cube";
  p.id = p.id || `cube-${context.currentStep + 1}`;
  p.position = ensureVec3(p.position, [0, 0, 0]);
  p.size = ensureVec3(p.size, [1, 1, 1]);
  p.rotation = ensureVec3(p.rotation, [0, 0, 0]);
  p.color = typeof p.color === "string" && p.color.startsWith("#") ? p.color : "#8B4513";
  p.tags = Array.isArray(p.tags) ? p.tags : [];

  return { step };
}

export async function critic(
  scene: Scene,
  plan: GenerationPlan,
  stepNumber: number,
): Promise<CriticResponse> {
  const systemPrompt = buildCriticSystemPrompt(scene, plan, stepNumber);
  const raw = await callLLM(systemPrompt, "Evaluate the current state.");
  try {
    return safeParse<CriticResponse>(raw, { approved: true, feedback: "", isComplete: false }, "Critic");
  } catch {
    // Wenn Critic fehlschlägt, einfach weitermachen
    return {
      approved: true,
      feedback: "",
      isComplete: stepNumber >= plan.estimatedSteps,
    };
  }
}

function ensureVec3(val: unknown, fallback: [number, number, number]): [number, number, number] {
  if (Array.isArray(val) && val.length >= 3 && val.every((v) => typeof v === "number")) {
    return [val[0], val[1], val[2]];
  }
  return fallback;
}
