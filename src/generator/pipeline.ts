import type { Scene, PipelineConfig, GenerationPlan, Primitive } from "../core/types.js";
import { getPrimitiveExtents } from "../core/types.js";
import { createScene, addPrimitive, saveScene } from "../core/scene.js";
import { validateAll, defaultConstraints, findOverlaps, getBBox } from "../core/constraints.js";
import { buildPromptContext } from "../ai/prompt.js";
import { planner, builder, critic } from "../ai/roles.js";

export type LogFn = (msg: string, level?: "info" | "success" | "warn" | "error") => void;
export type OnStepFn = (scene: Scene, stepNum: number) => void;

const MAX_RETRIES = 2;

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

export async function startPipeline(
  userPrompt: string,
  config: Partial<PipelineConfig> = {},
  log: LogFn = console.log,
  onStep?: OnStepFn,
): Promise<PipelineState> {
  const cfg = { ...defaultConfig, ...config };

  let scene = createScene(userPrompt);
  log("Pipeline gestartet", "info");

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

// Erweitert eine bestehende Scene mit einem neuen Prompt
export async function extendPipeline(
  userPrompt: string,
  existingScene: Scene,
  config: Partial<PipelineConfig> = {},
  log: LogFn = console.log,
  onStep?: OnStepFn,
): Promise<PipelineState> {
  const cfg = { ...defaultConfig, ...config };

  log(`Erweitere bestehende Scene (${existingScene.primitives.length} Primitives)...`, "info");

  log("Erstelle Erweiterungsplan...", "info");
  const emptyPlan: GenerationPlan = { goal: "", estimatedSteps: 0, steps: [] };
  const context = buildPromptContext(userPrompt, existingScene, emptyPlan, 0);
  const { plan } = await planner(context);
  log(`Plan: ${plan.estimatedSteps} neue Schritte – ${plan.goal}`, "success");

  state = {
    scene: existingScene,
    plan,
    currentStep: 0,
    isComplete: false,
    isRunning: false,
  };

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

// Baut eine detaillierte Fehlerbeschreibung für den Retry
function buildCorrectionContext(primitive: Primitive, scene: Scene): string {
  const overlaps = findOverlaps(scene, primitive);
  const newBox = getBBox(primitive);

  const lines: string[] = [
    `Your primitive "${primitive.id}" at position [${primitive.position}] with extents [${getPrimitiveExtents(primitive)}] OVERLAPS with existing primitives:`,
    `Your cube's edges: x=[${newBox.min[0].toFixed(2)}, ${newBox.max[0].toFixed(2)}], y=[${newBox.min[1].toFixed(2)}, ${newBox.max[1].toFixed(2)}], z=[${newBox.min[2].toFixed(2)}, ${newBox.max[2].toFixed(2)}]`,
  ];

  for (const o of overlaps) {
    const axis = ["x", "y", "z"] as const;
    const depthStr = o.depth.map((d, i) => `${axis[i]}: ${d.toFixed(2)} units`).join(", ");
    lines.push(
      `- "${o.existingId}": edges x=[${o.existingBBox.min[0].toFixed(2)}, ${o.existingBBox.max[0].toFixed(2)}], y=[${o.existingBBox.min[1].toFixed(2)}, ${o.existingBBox.max[1].toFixed(2)}], z=[${o.existingBBox.min[2].toFixed(2)}, ${o.existingBBox.max[2].toFixed(2)}] — penetration: ${depthStr}`,
    );
  }

  lines.push("", "Fix: adjust position so your cube's edges do NOT overlap on all 3 axes with any existing cube.");
  return lines.join("\n");
}

export async function executeStep(
  pState: PipelineState,
  log: LogFn = console.log,
): Promise<PipelineState> {
  const { scene, plan, currentStep } = pState;
  const stepLabel = `Schritt ${currentStep + 1}/${plan.estimatedSteps}`;

  log(`${stepLabel}: ${plan.steps[currentStep] ?? "..."}`, "info");

  let correctionContext: string | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Builder aufrufen (mit oder ohne Korrekturkontext)
    const context = buildPromptContext(plan.goal, scene, plan, currentStep);
    const { step: genStep } = await builder(context, correctionContext);

    // Validate
    const validation = validateAll(defaultConstraints, scene, genStep.primitive);

    if (validation.valid) {
      // Erfolgreich – Primitive hinzufügen
      const newScene = addPrimitive(scene, genStep.primitive);
      log(`+ ${genStep.primitive.id}: ${genStep.reasoning}`, "success");

      // Critic
      const review = await critic(newScene, plan, currentStep + 1);
      if (review.feedback) {
        log(`Critic: ${review.feedback}`, "info");
      }

      const nextStep = currentStep + 1;
      const isComplete = review.isComplete || nextStep >= plan.estimatedSteps;
      if (isComplete) log("Generierung abgeschlossen!", "success");

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

    // Fehlgeschlagen – Retry vorbereiten
    if (attempt < MAX_RETRIES) {
      correctionContext = buildCorrectionContext(genStep.primitive, scene);
      log(`Overlap erkannt, Retry ${attempt + 1}/${MAX_RETRIES}...`, "warn");
    } else {
      log(`Schritt übersprungen nach ${MAX_RETRIES} Retries: ${validation.messages.join(", ")}`, "error");
    }
  }

  // Alle Retries fehlgeschlagen – Schritt überspringen
  return {
    ...pState,
    currentStep: currentStep + 1,
    isComplete: currentStep + 1 >= plan.estimatedSteps,
  };
}

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
