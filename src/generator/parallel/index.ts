// Re-exports für die parallele Pipeline
export { runParallelPipeline, type ParallelPipelineConfig, type ParallelPipelineResult } from "./pipeline.js";
export { partitionWithAI, partitionByAxis, createSingleRegionPartition, partitionWithOps, makeExtendedRegion, heuristicPartition } from "./partitioner.js";
export { createBuilderTasks, executeBuilderTasks, createExtBuilderTasks, executeExtBuilderTasks } from "./coordinator.js";
export { combineParts, buildPartGroups } from "./combiner.js";
export { mergeResults, mergeResultsExt } from "./merger.js";
export { globalCritic, globalCriticWithStats } from "./global-critic.js";
export { regionBuilder, regionBuilderExt, regionBuilderWithPlan } from "./region-builder.js";
export { validateBoundaries, validateBoundariesExt } from "./boundary-validator.js";
export { repairLoop, repairRegion, postMergeRepairLoop, needsAICritic } from "./repair-loop.js";
export { resolveAssembly, generateDefaultAssemblyConfig, transformPrimitive } from "../../core/assembly-resolver.js";

// Neue Exports für PlanObject-System
export { generatePlanObject } from "../../plan/planner.js";
export { planObjectToPartition, buildEnhancedBuilderPrompt } from "../../communication/plan-to-builder.js";
export { enrichBuilderResult, summarizeBuilderResults } from "../../communication/builder-to-combiner.js";
export { buildCriticPrompt } from "../../communication/combiner-to-critic.js";
export { checkBoundaryConstraints } from "../../constraints/boundary-constraints.js";
export { deriveRepairRules, planRegionRepairs } from "../../repair/region-repair-rules.js";

// Constraint-Spec-System Exports
export { solveAllConstraints, type ConstraintEngineResult } from "../../constraints/constraint-engine.js";
export { solvePlacement } from "../../constraints/placement-solver.js";
export { generateObjectSpecs } from "../../builders/object-spec-builder.js";
export { validatePlacements } from "../../validators/placement-validator.js";
export type { ObjectConstraintSpec, PlacementResult, AnchorInfo } from "../../constraints/object-constraint-spec.js";
export type { AnchorRelation, PlacementZone, RepairStrategy } from "../../constraints/constraint-types.js";
