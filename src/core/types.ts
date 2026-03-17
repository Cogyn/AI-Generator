export type Vec3 = [number, number, number];

export interface Cube {
  id: string;
  position: Vec3;
  size: Vec3;
  rotation: Vec3;
  color: string;
  tags: string[];
}

export type Primitive = Cube & { type: "cube" };

export interface Scene {
  id: string;
  name: string;
  primitives: Primitive[];
  metadata: {
    createdAt: string;
    updatedAt: string;
    stepCount: number;
  };
}

export interface GenerationStep {
  stepNumber: number;
  action: "add" | "modify" | "remove";
  primitive: Primitive;
  reasoning: string;
}

export interface GenerationPlan {
  goal: string;
  estimatedSteps: number;
  steps: string[];
}

export interface PromptContext {
  userPrompt: string;
  currentScene: Scene;
  plan: GenerationPlan;
  currentStep: number;
  referenceImage?: string;
}

export interface Constraint {
  name: string;
  check: (scene: Scene, newPrimitive: Primitive) => ConstraintResult;
}

export interface ConstraintResult {
  valid: boolean;
  message?: string;
}

export interface PlannerResponse {
  plan: GenerationPlan;
}

export interface BuilderResponse {
  step: GenerationStep;
}

export interface CriticResponse {
  approved: boolean;
  feedback: string;
  suggestNextAction?: string;
  isComplete: boolean;
}

export interface PipelineConfig {
  maxSteps: number;
  autoRun: boolean; // alle Schritte automatisch oder manuell?
}
