import type { Scene, PipelineConfig, GenerationPlan } from "../core/types.js";
import { createScene, addPrimitive, saveScene } from "../core/scene.js";
import { validateAll, defaultConstraints } from "../core/constraints.js";
import { buildPromptContext } from "../ai/prompt.js";
import { planner, builder, critic } from "../ai/roles.js";

export type LogFn = (msg: string, level?: "info" | "success" | "warn" | "error") => void;
export type OnStepFn = (scene: Scene, stepNum: number) => void;

const defaultConfig: PipelineConfig = {
  maxSteps: 10,
  autoRun: true,
};

export interface PipelineState {
  scene: Scene;
  plan: GenerationPlan;
  currentStep: number;
  isComplete: boolean;
  isRunning: boolean;
}

let state: PipelineState | null = null;

export function getPipelineState(): PipelineState | null {
  return state;
}

// Startet die Pipeline: erstellt Plan, führt optional alle Schritte aus
export async function startPipeline(
  userPrompt: string,
  config: Partial<PipelineConfig> = {},
  log: LogFn = console.log,
  onStep?: OnStepFn,
): Promise<PipelineState> {
  const cfg = { ...defaultConfig, ...config };

  let scene = createScene(userPrompt);
  log("Pipeline gestartet", "info");

  // Plan erstellen
  log("Erstelle Plan...", "info");
  const emptyPlan: GenerationPlan = { goal: "", estimatedSteps: 0, steps: [] };
  const context = buildPromptContext(userPrompt, scene, emptyPlan, 0);
  const { plan } = await planner(context);
  log(`Plan: ${plan.estimatedSteps} Schritte – ${plan.goal}`, "success");

  state = {
    scene,
    plan,
    currentStep: 0,
    isComplete: false,
    isRunning: false,
  };

  // Auto-Run: Alle Schritte nacheinander
  if (cfg.autoRun) {
    state.isRunning = true;
    const totalSteps = Math.min(plan.estimatedSteps, cfg.maxSteps);

    for (let step = 0; step < totalSteps; step++) {
      state = await executeStep(state, log);
      onStep?.(state.scene, state.currentStep);
      if (state.isComplete) break;
    }
    state.isRunning = false;
  }

  saveScene(state.scene);
  return state;
}

// Führt genau einen Schritt aus
export async function executeStep(
  pState: PipelineState,
  log: LogFn = console.log,
): Promise<PipelineState> {
  const { scene, plan, currentStep } = pState;
  const stepLabel = `Schritt ${currentStep + 1}/${plan.estimatedSteps}`;

  log(`${stepLabel}: ${plan.steps[currentStep] ?? "..."}`, "info");

  // Builder
  const context = buildPromptContext(plan.goal, scene, plan, currentStep);
  const { step: genStep } = await builder(context);

  // Validate
  const validation = validateAll(defaultConstraints, scene, genStep.primitive);
  if (!validation.valid) {
    log(`Constraint-Fehler: ${validation.messages.join(", ")}`, "warn");
    // Trotzdem weitermachen, Schritt überspringen
    return {
      ...pState,
      currentStep: currentStep + 1,
      isComplete: currentStep + 1 >= plan.estimatedSteps,
    };
  }

  // Add primitive
  const newScene = addPrimitive(scene, genStep.primitive);
  log(`+ ${genStep.primitive.id}: ${genStep.reasoning}`, "success");

  // Critic
  const review = await critic(newScene, plan, currentStep + 1);
  if (review.feedback) {
    log(`Critic: ${review.feedback}`, "info");
  }

  const nextStep = currentStep + 1;
  const isComplete = review.isComplete || nextStep >= plan.estimatedSteps;

  if (isComplete) {
    log("Generierung abgeschlossen!", "success");
  }

  const newState: PipelineState = {
    scene: newScene,
    plan,
    currentStep: nextStep,
    isComplete,
    isRunning: pState.isRunning,
  };

  saveScene(newScene);
  state = newState;
  return newState;
}

// Nächster manueller Schritt
export async function nextStep(
  log: LogFn = console.log,
  onStep?: OnStepFn,
): Promise<PipelineState | null> {
  if (!state || state.isComplete) return state;
  state = await executeStep(state, log);
  onStep?.(state.scene, state.currentStep);
  saveScene(state.scene);
  return state;
}
