// Parallele Pipeline: Partitionieren → lokale Builder → Combiner → Validate → Repair → Critic
// Erweitert: PlanObject-basiert, strukturierte Kommunikation, Token-Tracking

import type {
  Scene, ScenePartition, CombinerResult, SceneExt, WorkRegionExt,
  BuilderResultExt, MeshOperation, SceneStatistics, QualityRule, PlanObject,
} from "../../core/types.js";
import { createScene, saveScene, createSceneExt, logMeshOps, computeSceneStatistics } from "../../core/scene.js";
import { partitionWithAI, createSingleRegionPartition, partitionWithOps, heuristicPartition } from "./partitioner.js";
import {
  createBuilderTasks, executeBuilderTasks,
  createExtBuilderTasks, executeExtBuilderTasks,
} from "./coordinator.js";
import { buildPartGroups, combineParts } from "./combiner.js";
import { globalCritic, globalCriticWithStats } from "./global-critic.js";
import { validateBoundaries, validateBoundariesExt } from "./boundary-validator.js";
import { mergeResultsExt } from "./merger.js";
import { validateScene, DEFAULT_RULES } from "../../core/quality-rules.js";
import { postMergeRepairLoop, needsAICritic } from "./repair-loop.js";
import type { LogFn, OnStepFn } from "../pipeline.js";

// Neue Imports für PlanObject-System
import { generatePlanObject } from "../../plan/planner.js";
import { planObjectToPartition, buildEnhancedBuilderPrompt } from "../../communication/plan-to-builder.js";
import { enrichBuilderResult, summarizeBuilderResults } from "../../communication/builder-to-combiner.js";
import { buildCriticPrompt } from "../../communication/combiner-to-critic.js";
import { checkBoundaryConstraints } from "../../constraints/boundary-constraints.js";
import { deriveRepairRules, planRegionRepairs } from "../../repair/region-repair-rules.js";
import { resetTokenTracker, getTokenTracker, callLLMTracked } from "../../ai/client.js";
import { validatePlanObject, planToCompactJSON } from "../../plan/plan-object.js";

// Constraint-Spec-System Imports
import { generateObjectSpecs } from "../../builders/object-spec-builder.js";
import { solveAllConstraints } from "../../constraints/constraint-engine.js";
import type { ConstraintEngineResult } from "../../constraints/constraint-engine.js";
import { validatePlacements } from "../../validators/placement-validator.js";
import { extractRequiredObjects } from "../../world/validation.js";

export interface ParallelPipelineConfig {
  maxPrimitivesPerRegion: number;
  parallel: boolean;
  maxRegions: number;
  useMeshOps: boolean;
  // Repair-Loop Konfiguration
  enableRepairLoop: boolean;
  maxRepairIterations: number;
  minQualityScore: number;
  qualityRules: QualityRule[];
  // NEU: PlanObject-Modus
  usePlanObject: boolean;
  // NEU: Constraint-Engine-Modus (KI→Specs→deterministisches Placement)
  useConstraintEngine: boolean;
}

const defaultConfig: ParallelPipelineConfig = {
  maxPrimitivesPerRegion: 10,
  parallel: true,
  maxRegions: 5,
  useMeshOps: false,
  enableRepairLoop: true,
  maxRepairIterations: 3,
  minQualityScore: 0.7,
  qualityRules: DEFAULT_RULES,
  usePlanObject: true,
  useConstraintEngine: true,
};

export interface ParallelPipelineResult {
  scene: Scene;
  partition: ScenePartition;
  combinerResult: CombinerResult;
  qualityScore: number;
  stats?: SceneStatistics;
  meshOpsCount?: number;
  repairIterations?: number;
  repairsApplied?: number;
  // NEU: PlanObject, Constraint-Engine und Token-Tracking
  planObject?: PlanObject;
  constraintEngineResult?: ConstraintEngineResult;
  tokenUsage?: {
    total_tokens: number;
    total_prompt_tokens: number;
    total_completion_tokens: number;
    estimated_cost_usd: number;
    call_count: number;
  };
}

// ─── Standard Pipeline ──────────────────────────────────────

export async function runParallelPipeline(
  userPrompt: string,
  existingScene?: Scene,
  config: Partial<ParallelPipelineConfig> = {},
  log: LogFn = console.log,
  onStep?: OnStepFn,
): Promise<ParallelPipelineResult> {
  const cfg = { ...defaultConfig, ...config };

  if (cfg.useMeshOps) {
    return runMeshOpsPipeline(userPrompt, existingScene, cfg, log, onStep);
  }

  // Token-Tracker zurücksetzen für neuen Run
  resetTokenTracker();

  const pipelineStart = performance.now();
  log("=== Parallele Pipeline gestartet ===", "info");

  let planObject: PlanObject | undefined;
  let partition: ScenePartition;

  // 1. Planung: PlanObject oder Legacy
  if (cfg.usePlanObject) {
    log("Erstelle strukturierten Plan (PlanObject)...", "info");
    try {
      planObject = await generatePlanObject(userPrompt, existingScene, [], log);
      const validation = validatePlanObject(planObject);
      if (!validation.valid) {
        for (const e of validation.errors) log(`  Plan-Fehler: ${e}`, "warn");
      }
      for (const w of validation.warnings) log(`  Plan-Warnung: ${w}`, "warn");

      // FIX 3: No silent builder capping. Required objects must be preserved.
      // If there are more builders than maxRegions, log it but do NOT truncate.
      // All required objects from the user prompt must remain in the plan.
      if (planObject.builders.length > cfg.maxRegions) {
        log(`  Plan hat ${planObject.builders.length} Builder (maxRegions=${cfg.maxRegions}). Alle werden behalten.`, "info");
      }

      // Validate required objects are covered in the plan
      const requiredObjects = extractRequiredObjects(userPrompt);
      if (requiredObjects.length > 0) {
        const builderNames = new Set(planObject.builders.map((b) => b.name.toLowerCase()));
        const builderDescs = planObject.builders.map((b) => b.description.toLowerCase()).join(" ");
        const missing = requiredObjects.filter((req) =>
          !builderNames.has(req) && !builderDescs.includes(req.replace("_", " "))
        );
        if (missing.length > 0) {
          log(`  WARNUNG: Pflichtobjekte nicht im Plan: ${missing.join(", ")}`, "warn");
          log(`  Plan wird als ungueltig markiert — required objects missing`, "warn");
        } else {
          log(`  Alle ${requiredObjects.length} Pflichtobjekte im Plan vorhanden`, "success");
        }
      }

      log(`Plan erstellt: ${planObject.builders.length} Builder, ${planObject.areas.length} Areas`, "success");
      for (const b of planObject.builders) {
        log(`  Builder "${b.name}": ${b.description.slice(0, 80)}...`, "info");
      }
      log(`  Quality-Targets: max ${planObject.global_quality_targets.errors_max} Errors, max ${planObject.global_quality_targets.warnings_max} Warnings, min ${(planObject.global_quality_targets.min_score * 100).toFixed(0)}%`, "info");
      log(`  Cost-Targets: max ${planObject.cost_targets.max_primitives_total} Primitives total, max ${planObject.cost_targets.max_llm_calls} LLM-Calls`, "info");

      // PlanObject → ScenePartition konvertieren
      partition = planObjectToPartition(planObject);
    } catch (e) {
      log("PlanObject-Erstellung fehlgeschlagen, nutze Legacy-Planung", "warn");
      planObject = undefined;
      partition = await legacyPartition(userPrompt, existingScene, log);
    }
  } else {
    partition = await legacyPartition(userPrompt, existingScene, log);
  }

  for (const r of partition.regions) {
    const a = partition.assignments.find((a) => a.regionId === r.id);
    log(`  Part "${r.label}": ${a?.localGoal?.slice(0, 60) ?? "–"}...`, "info");
  }

  // ─── Constraint-Engine-Modus: KI→Specs→deterministisches Placement ───
  let constraintEngineResult: ConstraintEngineResult | undefined;

  if (cfg.useConstraintEngine && planObject) {
    log("=== Constraint-Engine-Modus ===", "info");
    try {
      // 2a. KI generiert ObjectConstraintSpecs
      log("ObjectSpecBuilder: KI erzeugt Constraint-Specs...", "info");
      const { anchorSpecs, objectSpecs } = await generateObjectSpecs(planObject, log);

      // 2b. Constraint Engine löst Platzierung deterministisch
      log("Constraint Engine: Löse Platzierung deterministisch...", "info");
      constraintEngineResult = solveAllConstraints(objectSpecs, anchorSpecs);

      const { stats } = constraintEngineResult;
      log(`  ${stats.successful}/${stats.total_specs} Objekte erfolgreich platziert`, stats.failed > 0 ? "warn" : "success");
      log(`  ${stats.total_repairs} Reparaturen, ${stats.total_collisions_resolved} Kollisionen gelöst`, "info");

      for (const w of constraintEngineResult.warnings) {
        log(`  ⚠ ${w}`, "warn");
      }

      // 2c. Validierung
      const validation = validatePlacements(constraintEngineResult);
      log(`  Validierung: ${validation.summary}`, validation.valid ? "success" : "warn");

      if (constraintEngineResult.primitives.length > 0) {
        // Constraint-Engine hat Primitives erzeugt → direkt als Szene verwenden
        log(`  ${constraintEngineResult.primitives.length} Primitives aus Constraint-Engine`, "success");

        // Erstelle Szene direkt aus den Engine-Primitives
        const engineScene = createScene(userPrompt);
        engineScene.primitives = constraintEngineResult.primitives;
        onStep?.(engineScene, engineScene.primitives.length);

        // Token-Usage loggen
        const tracker = getTokenTracker();
        if (tracker.calls.length > 0) {
          log(`Token-Verbrauch: ${tracker.total_tokens} Tokens (${tracker.calls.length} Calls, ~$${tracker.estimated_cost_usd.toFixed(4)})`, "info");
        }

        saveScene(engineScene);
        const elapsed = performance.now() - pipelineStart;
        log(`=== Constraint-Engine Pipeline abgeschlossen in ${(elapsed / 1000).toFixed(1)}s ===`, "success");

        return {
          scene: engineScene,
          partition,
          combinerResult: { scene: engineScene, transforms: [], issues: [] },
          qualityScore: validation.score,
          stats: computeSceneStatistics(engineScene, partition.regions.length, 0),
          repairIterations: 0,
          repairsApplied: stats.total_repairs,
          planObject,
          constraintEngineResult,
          tokenUsage: tracker.calls.length > 0 ? {
            total_tokens: tracker.total_tokens,
            total_prompt_tokens: tracker.total_prompt_tokens,
            total_completion_tokens: tracker.total_completion_tokens,
            estimated_cost_usd: tracker.estimated_cost_usd,
            call_count: tracker.calls.length,
          } : undefined,
        };
      }

      log("Constraint-Engine hat keine Primitives erzeugt, Fallback auf Builder...", "warn");
    } catch (e) {
      log(`Constraint-Engine fehlgeschlagen: ${e}. Fallback auf Builder-Modus.`, "warn");
    }
  }

  // ─── Standard Builder-Modus (Fallback oder wenn Constraint-Engine deaktiviert) ───

  // 2. Builder-Tasks erstellen
  const tasks = createBuilderTasks(partition);

  // 3. Builder parallel ausführen (mit erweitertem Prompt wenn PlanObject vorhanden)
  log("Builder arbeiten in lokalen Räumen...", "info");
  const results = await executeBuilderTasks(tasks, log, cfg.parallel, planObject);

  const totalPrimitives = results.reduce((sum, r) => sum + r.addedPrimitives.length, 0);
  log(`${totalPrimitives} Primitives insgesamt erzeugt`, "success");

  // Builder-Metriken berechnen
  if (planObject) {
    const enriched = results.map((r) => enrichBuilderResult(r, planObject!));
    const summary = summarizeBuilderResults(enriched);
    log("Builder-Metriken:", "info");
    for (const line of summary.split("\n")) log(`  ${line}`, "info");
  }

  // 4. Part-Gruppen + Combiner
  const labels = new Map(partition.regions.map((r) => [r.id, r.label]));
  const partGroups = buildPartGroups(results, labels);

  log("Combiner: Assembliere Parts (algorithmisch)...", "info");
  const combinerResult = await combineParts(partGroups, partition.assemblyConfig, partition.styleDirectives, existingScene);

  if (combinerResult.issues.length > 0) {
    for (const issue of combinerResult.issues) log(`  Combiner: ${issue}`, "warn");
  }
  log(`Combiner: ${combinerResult.scene.primitives.length} Primitives in Hauptszene`, "success");
  onStep?.(combinerResult.scene, combinerResult.scene.primitives.length);

  // 5. Quality-Gate: Algorithmische Prüfung + Repair-Loop (erweitert)
  let finalScene = combinerResult.scene;
  let repairIterations = 0;
  let repairsApplied = 0;

  if (cfg.enableRepairLoop) {
    log("Quality-Gate: Algorithmische Prüfung...", "info");
    const preQuality = validateScene(finalScene, cfg.qualityRules);
    const preErrors = preQuality.violations.filter((v) => v.severity === "error").length;
    const preWarnings = preQuality.violations.filter((v) => v.severity === "warning").length;
    log(`  Pre-Repair Score: ${(preQuality.score * 100).toFixed(0)}%, Errors: ${preErrors}, Warnings: ${preWarnings}`, "info");

    // Erweiterte Quality-Target-Prüfung mit PlanObject
    const qualityTargetMet = planObject
      ? preErrors <= planObject.global_quality_targets.errors_max &&
        preWarnings <= planObject.global_quality_targets.warnings_max &&
        preQuality.score >= planObject.global_quality_targets.min_score
      : preQuality.valid;

    if (!qualityTargetMet) {
      // Erweiterte Repair-Konfiguration aus PlanObject
      const maxIter = planObject
        ? Math.max(cfg.maxRepairIterations, 3)
        : cfg.maxRepairIterations;
      const minScore = planObject
        ? planObject.global_quality_targets.min_score
        : cfg.minQualityScore;

      // Region-spezifische Repair-Rules anwenden
      if (planObject) {
        const repairRules = deriveRepairRules(planObject);
        const regionRepairs = planRegionRepairs(preQuality, repairRules, finalScene);
        if (regionRepairs.length > 0) {
          log(`  ${regionRepairs.length} region-spezifische Reparaturen geplant`, "info");
          for (const r of regionRepairs) {
            log(`    [${r.action}] ${r.regionId}: ${r.reason}`, "info");
          }
        }
      }

      const repairResult = await postMergeRepairLoop(
        finalScene, partition,
        { maxIterations: maxIter, minQualityScore: minScore, rules: cfg.qualityRules },
        log,
      );
      finalScene = repairResult.finalScene;
      repairIterations = repairResult.iterations;
      repairsApplied = repairResult.repairsApplied.length;

      onStep?.(finalScene, finalScene.primitives.length);
    } else {
      log("  Quality-Targets erreicht — keine Reparatur nötig", "success");
    }
  }

  // 6. Boundary Validation (erweitert mit PlanObject-Constraints)
  log("Prüfe Regionen-Übergänge...", "info");
  const boundaryResult = validateBoundaries(finalScene, partition);
  if (!boundaryResult.valid) {
    for (const c of boundaryResult.conflicts) log(`  Boundary: ${c.description}`, "warn");
  } else {
    log("Boundary-Checks bestanden", "success");
  }

  // Erweiterte Boundary-Constraints aus PlanObject
  if (planObject) {
    const constraintResult = checkBoundaryConstraints(finalScene, planObject);
    if (!constraintResult.valid) {
      log(`  ${constraintResult.violations.length} Boundary-Constraint-Verletzungen:`, "warn");
      for (const v of constraintResult.violations) {
        log(`    [${v.type}] ${v.description}`, "warn");
      }
    } else {
      log("  PlanObject Boundary-Constraints bestanden", "success");
    }
  }

  // 7. Global Critic (nur bei Bedarf — Token sparen)
  const postQuality = validateScene(finalScene, cfg.qualityRules);
  let criticScore = postQuality.score;

  if (needsAICritic(postQuality)) {
    log("KI-Critic: Bewertung (selektiv, Score unklar)...", "info");

    if (planObject) {
      // Erweiterter Critic mit PlanObject-Kontext
      const stats = computeSceneStatistics(finalScene, partition.regions.length, 0);
      const enriched = results.map((r) => enrichBuilderResult(r, planObject!));
      const criticPrompt = buildCriticPrompt({
        planObject,
        sceneStats: stats,
        quality: postQuality,
        mergeConflicts: boundaryResult.conflicts,
        builderMetrics: enriched,
        iteration: repairIterations,
        isRepairPass: repairIterations > 0,
      });

      const raw = await callLLMTracked(criticPrompt, "Evaluate the complete scene.", "critic");
      try {
        const parsed = JSON.parse(raw);
        criticScore = parsed.qualityScore ?? postQuality.score;
        log(`KI-Critic: ${(criticScore * 100).toFixed(0)}% – ${parsed.feedback ?? ""}`, "success");
      } catch {
        log("KI-Critic: Antwort konnte nicht geparst werden", "warn");
      }
    } else {
      const criticResult = await globalCritic(finalScene, partition.styleDirectives, boundaryResult.conflicts);
      criticScore = criticResult.qualityScore;
      log(`KI-Critic: ${(criticScore * 100).toFixed(0)}% – ${criticResult.feedback}`, "success");
    }
  } else {
    log(`Algorithmischer Score: ${(criticScore * 100).toFixed(0)}% — KI-Critic übersprungen`, "success");
  }

  // 8. Token-Usage loggen
  const tracker = getTokenTracker();
  if (tracker.calls.length > 0) {
    log(`Token-Verbrauch: ${tracker.total_tokens} Tokens (${tracker.calls.length} Calls, ~$${tracker.estimated_cost_usd.toFixed(4)})`, "info");
    log(`  Input: ${tracker.total_prompt_tokens} | Output: ${tracker.total_completion_tokens}`, "info");
  }

  // 9. Speichern
  saveScene(finalScene);
  const pipelineElapsed = performance.now() - pipelineStart;
  log(`=== Pipeline abgeschlossen in ${(pipelineElapsed / 1000).toFixed(1)}s (${repairIterations} Repairs) ===`, "success");

  return {
    scene: finalScene,
    partition,
    combinerResult,
    qualityScore: criticScore,
    stats: computeSceneStatistics(finalScene, partition.regions.length, 0),
    repairIterations,
    repairsApplied,
    planObject,
    constraintEngineResult,
    tokenUsage: tracker.calls.length > 0 ? {
      total_tokens: tracker.total_tokens,
      total_prompt_tokens: tracker.total_prompt_tokens,
      total_completion_tokens: tracker.total_completion_tokens,
      estimated_cost_usd: tracker.estimated_cost_usd,
      call_count: tracker.calls.length,
    } : undefined,
  };
}

// ─── Legacy Partition (bestehend) ────────────────────────────

async function legacyPartition(
  userPrompt: string,
  existingScene: Scene | undefined,
  log: LogFn,
): Promise<ScenePartition> {
  log("Zerlege Aufgabe in Parts (Legacy)...", "info");
  let partition: ScenePartition;
  try {
    partition = await partitionWithAI(userPrompt, existingScene ?? createScene(userPrompt));
    log(`${partition.regions.length} Parts erstellt`, "success");
  } catch {
    log("AI-Partitionierung fehlgeschlagen, nutze Heuristik/Fallback", "warn");
    partition = heuristicPartition(userPrompt) ?? createSingleRegionPartition(userPrompt);
  }
  return partition;
}

// ─── Mesh-Operations Pipeline ───────────────────────────────

async function runMeshOpsPipeline(
  userPrompt: string,
  existingScene: Scene | undefined,
  cfg: ParallelPipelineConfig,
  log: LogFn,
  onStep?: OnStepFn,
): Promise<ParallelPipelineResult> {
  resetTokenTracker();
  const pipelineStart = performance.now();
  log("=== Mesh-Ops Pipeline gestartet ===", "info");

  // 1. Partitionierung
  log("Zerlege Aufgabe in Parts (Mesh-Ops)...", "info");
  let partition: ScenePartition;
  let extRegions: WorkRegionExt[];
  try {
    const result = await partitionWithOps(userPrompt, existingScene ?? createScene(userPrompt));
    partition = result.partition;
    extRegions = result.extRegions;
    log(`${partition.regions.length} Parts erstellt (Mesh-Ops-Modus)`, "success");
  } catch {
    log("Mesh-Ops-Partitionierung fehlgeschlagen, nutze Heuristik/Fallback", "warn");
    partition = heuristicPartition(userPrompt) ?? createSingleRegionPartition(userPrompt);
    extRegions = partition.regions.map((r, i) => ({
      ...r, meshOps: [], densityLevel: 5, seedOffset: i * 1000,
    }));
  }

  for (const r of partition.regions) {
    const a = partition.assignments.find((a) => a.regionId === r.id);
    log(`  Part "${r.label}": ${a?.localGoal ?? "–"}`, "info");
  }

  // 2. Erweiterte Builder-Tasks
  const tasks = createExtBuilderTasks(partition, extRegions);

  // 3. Mesh-Ops Builder
  log("Mesh-Ops Builder arbeiten...", "info");
  const results = await executeExtBuilderTasks(tasks, log, cfg.parallel);

  const totalOps = results.reduce((sum, r) => sum + r.meshOps.length, 0);
  const totalPrimitives = results.reduce((sum, r) => sum + r.addedPrimitives.length, 0);
  log(`${totalOps} Operationen → ${totalPrimitives} Primitives erzeugt`, "success");

  // 4. Combiner
  const labels = new Map(partition.regions.map((r) => [r.id, r.label]));
  const partGroups = buildPartGroups(results, labels);

  log("Combiner: Assembliere Parts (algorithmisch)...", "info");
  const combinerResult = await combineParts(partGroups, partition.assemblyConfig, partition.styleDirectives, existingScene);

  if (combinerResult.issues.length > 0) {
    for (const issue of combinerResult.issues) log(`  Combiner: ${issue}`, "warn");
  }
  log(`Combiner: ${combinerResult.scene.primitives.length} Primitives in Hauptszene`, "success");
  onStep?.(combinerResult.scene, combinerResult.scene.primitives.length);

  // 5. Quality-Gate + Repair-Loop
  let finalScene = combinerResult.scene;
  let repairIterations = 0;
  let repairsApplied = 0;

  if (cfg.enableRepairLoop) {
    log("Quality-Gate: Algorithmische Prüfung...", "info");
    const preQuality = validateScene(finalScene, cfg.qualityRules);
    log(`  Pre-Repair Score: ${(preQuality.score * 100).toFixed(0)}%, Errors: ${preQuality.violations.filter((v) => v.severity === "error").length}, Warnings: ${preQuality.violations.filter((v) => v.severity === "warning").length}`, "info");

    if (!preQuality.valid) {
      const repairResult = await postMergeRepairLoop(
        finalScene, partition,
        { maxIterations: cfg.maxRepairIterations, minQualityScore: cfg.minQualityScore, rules: cfg.qualityRules },
        log,
      );
      finalScene = repairResult.finalScene;
      repairIterations = repairResult.iterations;
      repairsApplied = repairResult.repairsApplied.length;
      onStep?.(finalScene, finalScene.primitives.length);
    } else {
      log("  Alle Regeln bestanden — keine Reparatur nötig", "success");
    }
  }

  // 6. Erweiterte Boundary Validation
  log("Prüfe Regionen-Übergänge (erweitert)...", "info");
  const boundaryResult = validateBoundariesExt(finalScene, partition, extRegions);
  if (!boundaryResult.valid) {
    for (const c of boundaryResult.conflicts) log(`  Boundary: ${c.description}`, "warn");
    for (const h of boundaryResult.heightJumps) log(`  Höhensprung: ${h.regionA}↔${h.regionB} Δ${h.delta}`, "warn");
    for (const d of boundaryResult.densityMismatches) log(`  Dichte: ${d.regionA}↔${d.regionB} ratio ${d.ratio}x`, "warn");
  } else {
    log("Boundary-Checks bestanden", "success");
  }

  // 7. Global Critic (selektiv)
  const postQuality = validateScene(finalScene, cfg.qualityRules);
  let criticScore = postQuality.score;

  if (needsAICritic(postQuality)) {
    log("KI-Critic: Bewertung (selektiv)...", "info");
    const stats = computeSceneStatistics(finalScene, partition.regions.length, totalOps);
    const criticResult = await globalCriticWithStats(stats, partition.styleDirectives, boundaryResult.conflicts);
    criticScore = criticResult.qualityScore;
    log(`KI-Critic: ${(criticScore * 100).toFixed(0)}% – ${criticResult.feedback}`, "success");
  } else {
    log(`Algorithmischer Score: ${(criticScore * 100).toFixed(0)}% — KI-Critic übersprungen`, "success");
  }

  // 8. Token-Usage loggen
  const tracker = getTokenTracker();
  if (tracker.calls.length > 0) {
    log(`Token-Verbrauch: ${tracker.total_tokens} Tokens (${tracker.calls.length} Calls, ~$${tracker.estimated_cost_usd.toFixed(4)})`, "info");
  }

  // 9. Speichern
  saveScene(finalScene);
  const pipelineElapsed = performance.now() - pipelineStart;
  log(`=== Mesh-Ops Pipeline abgeschlossen in ${(pipelineElapsed / 1000).toFixed(1)}s (${repairIterations} Repairs) ===`, "success");

  return {
    scene: finalScene,
    partition,
    combinerResult,
    qualityScore: criticScore,
    stats: computeSceneStatistics(finalScene, partition.regions.length, totalOps),
    meshOpsCount: totalOps,
    repairIterations,
    repairsApplied,
    tokenUsage: tracker.calls.length > 0 ? {
      total_tokens: tracker.total_tokens,
      total_prompt_tokens: tracker.total_prompt_tokens,
      total_completion_tokens: tracker.total_completion_tokens,
      estimated_cost_usd: tracker.estimated_cost_usd,
      call_count: tracker.calls.length,
    } : undefined,
  };
}
