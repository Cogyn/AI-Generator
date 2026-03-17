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

function extractJSON(text: string): string {
  const cleaned = text.trim();
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) return jsonMatch[0];
  return cleaned;
}

function safeParse<T>(text: string, label: string): T {
  try {
    return JSON.parse(extractJSON(text)) as T;
  } catch {
    console.error(`[${label}] JSON-Parse fehlgeschlagen:`, text);
    throw new Error(`${label}: Ungültige JSON-Antwort vom Modell.`);
  }
}

export async function planner(context: PromptContext): Promise<PlannerResponse> {
  const systemPrompt = buildPlannerSystemPrompt(context.userPrompt, context.currentScene);
  const raw = await callLLM(systemPrompt, `Create a build plan for: ${context.userPrompt}`);
  const plan = safeParse<GenerationPlan>(raw, "Planner");

  if (!plan.steps || !Array.isArray(plan.steps) || plan.steps.length === 0) {
    throw new Error("Planner hat keinen gültigen Plan zurückgegeben.");
  }
  plan.estimatedSteps = plan.steps.length;
  return { plan };
}

// correctionContext ist optional – wird beim Retry mit Overlap-Details befüllt
export async function builder(context: PromptContext, correctionContext?: string): Promise<BuilderResponse> {
  const systemPrompt = buildBuilderSystemPrompt(context, correctionContext);
  const stepDesc = context.plan.steps[context.currentStep] ?? "Next step";
  const raw = await callLLM(systemPrompt, `Build now: ${stepDesc}`);
  const step = safeParse<any>(raw, "Builder");

  const action = (["add", "remove", "modify", "clone"].includes(step?.action)) ? step.action : "add";

  // Remove: nur targetId + reasoning nötig
  if (action === "remove") {
    return {
      step: {
        stepNumber: context.currentStep + 1,
        action: "remove",
        targetId: step.targetId ?? step.primitive?.id,
        primitive: null as any, // wird nicht gebraucht
        reasoning: step.reasoning ?? "",
      },
    };
  }

  // Clone: targetId + mirror
  if (action === "clone") {
    return {
      step: {
        stepNumber: context.currentStep + 1,
        action: "clone",
        targetId: step.targetId,
        primitive: null as any,
        mirror: (["x", "y", "z"].includes(step.mirror)) ? step.mirror : undefined,
        reasoning: step.reasoning ?? "",
      },
    };
  }

  // Modify: targetId + changes
  if (action === "modify") {
    return {
      step: {
        stepNumber: context.currentStep + 1,
        action: "modify",
        targetId: step.targetId,
        changes: step.changes ?? {},
        primitive: null as any,
        reasoning: step.reasoning ?? "",
      },
    };
  }

  // Add: das bisherige Verhalten
  if (!step?.primitive) {
    throw new Error("Builder hat kein Primitive zurückgegeben.");
  }
  const p = step.primitive;
  p.type = sanitizePrimitiveType(p);
  p.id = p.id || `${p.type}-${context.currentStep + 1}`;
  p.position = ensureVec3(p.position, [0, 0, 0]);
  p.rotation = ensureVec3(p.rotation, [0, 0, 0]);
  p.color = typeof p.color === "string" && p.color.startsWith("#") ? p.color : "#8B4513";
  p.tags = Array.isArray(p.tags) ? p.tags : [];

  // Type-aware field sanitization
  switch (p.type) {
    case "sphere":
      p.radius = ensureNumber(p.radius, p.size ? ensureVec3(p.size, [1, 1, 1])[0] / 2 : 1);
      delete p.size;
      delete p.radiusTop;
      delete p.radiusBottom;
      delete p.height;
      break;
    case "cylinder":
      p.radiusTop = ensureNumber(p.radiusTop, p.radius ?? (p.size ? ensureVec3(p.size, [1, 1, 1])[0] / 2 : 0.5));
      p.radiusBottom = ensureNumber(p.radiusBottom, p.radiusTop);
      p.height = ensureNumber(p.height, p.size ? ensureVec3(p.size, [1, 1, 1])[1] : 1);
      delete p.size;
      delete p.radius;
      break;
    default: // cube
      p.size = ensureVec3(p.size, [1, 1, 1]);
      delete p.radius;
      delete p.radiusTop;
      delete p.radiusBottom;
      delete p.height;
      break;
  }

  return { step: { ...step, action: "add" } };
}

export async function critic(
  scene: Scene,
  plan: GenerationPlan,
  stepNumber: number,
): Promise<CriticResponse> {
  const systemPrompt = buildCriticSystemPrompt(scene, plan, stepNumber);
  const raw = await callLLM(systemPrompt, "Evaluate the current state.");
  try {
    return safeParse<CriticResponse>(raw, "Critic");
  } catch {
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

function ensureNumber(val: unknown, fallback: number): number {
  if (typeof val === "number" && isFinite(val) && val > 0) return val;
  return fallback;
}

const VALID_TYPES = new Set(["cube", "sphere", "cylinder"]);
function sanitizePrimitiveType(p: any): "cube" | "sphere" | "cylinder" {
  if (typeof p.type === "string" && VALID_TYPES.has(p.type)) return p.type as "cube" | "sphere" | "cylinder";
  return "cube";
}
