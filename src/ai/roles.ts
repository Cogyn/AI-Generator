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
  // Versuche JSON aus Codeblock zu extrahieren
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  // Versuche direktes JSON
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return jsonMatch[0];
  return text;
}

export async function planner(context: PromptContext): Promise<PlannerResponse> {
  const systemPrompt = buildPlannerSystemPrompt(context.userPrompt, context.currentScene);
  const raw = await callLLM(systemPrompt, context.userPrompt);
  const plan = JSON.parse(extractJSON(raw));
  return { plan };
}

export async function builder(context: PromptContext): Promise<BuilderResponse> {
  const systemPrompt = buildBuilderSystemPrompt(context);
  const stepDesc = context.plan.steps[context.currentStep] ?? "Nächster Schritt";
  const raw = await callLLM(systemPrompt, `Erzeuge jetzt: ${stepDesc}`);
  const step = JSON.parse(extractJSON(raw));
  if (step.primitive) step.primitive.type = "cube";
  return { step };
}

export async function critic(
  scene: Scene,
  plan: GenerationPlan,
  stepNumber: number,
): Promise<CriticResponse> {
  const systemPrompt = buildCriticSystemPrompt(scene, plan, stepNumber);
  const raw = await callLLM(systemPrompt, "Bewerte den aktuellen Zustand.");
  return JSON.parse(extractJSON(raw));
}
