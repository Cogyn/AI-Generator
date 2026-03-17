// Parallele Pipeline: Partitionieren → Builder pro Region → Merge → Validate → Critic
// MVP: Sequentiell ausgeführt, Architektur bereit für echte Parallelität

import type { Scene, ScenePartition, MergeResult } from "../../core/types.js";
import { createScene, saveScene } from "../../core/scene.js";
import { partitionWithAI, createSingleRegionPartition } from "./partitioner.js";
import { createBuilderTasks, executeBuilderTasks } from "./coordinator.js";
import { mergeResults } from "./merger.js";
import { validateBoundaries } from "./boundary-validator.js";
import { globalCritic } from "./global-critic.js";
import type { LogFn, OnStepFn } from "../pipeline.js";

export interface ParallelPipelineConfig {
  maxPrimitivesPerRegion: number;
  parallel: boolean; // echte Parallelität oder sequentiell
  maxRegions: number;
}

const defaultConfig: ParallelPipelineConfig = {
  maxPrimitivesPerRegion: 10,
  parallel: false, // MVP: sequentiell
  maxRegions: 4,
};

export interface ParallelPipelineResult {
  scene: Scene;
  partition: ScenePartition;
  mergeResult: MergeResult;
  qualityScore: number;
}

export async function runParallelPipeline(
  userPrompt: string,
  existingScene?: Scene,
  config: Partial<ParallelPipelineConfig> = {},
  log: LogFn = console.log,
  onStep?: OnStepFn,
): Promise<ParallelPipelineResult> {
  const cfg = { ...defaultConfig, ...config };

  const scene = existingScene ?? createScene(userPrompt);
  log("=== Parallele Pipeline gestartet ===", "info");

  // 1. Partitionieren
  log("Partitioniere Aufgabe...", "info");
  let partition: ScenePartition;
  try {
    partition = await partitionWithAI(userPrompt, scene);
    log(`${partition.regions.length} Regionen erstellt`, "success");
  } catch {
    log("Partitionierung fehlgeschlagen, nutze Fallback", "warn");
    partition = createSingleRegionPartition(userPrompt);
  }

  // Log Regionen
  for (const r of partition.regions) {
    const a = partition.assignments.find((a) => a.regionId === r.id);
    log(`  Region "${r.label}": ${a?.localGoal ?? "–"}`, "info");
  }

  // 2. Builder-Tasks erstellen
  const tasks = createBuilderTasks(partition, scene.primitives);

  // 3. Builder ausführen
  const results = await executeBuilderTasks(tasks, log, cfg.parallel);

  // 4. Ergebnisse mergen
  log("Merge der Ergebnisse...", "info");
  const mergeResult = mergeResults(scene, results);

  if (mergeResult.conflicts.length > 0) {
    log(`${mergeResult.conflicts.length} Merge-Konflikte erkannt`, "warn");
    for (const c of mergeResult.conflicts) {
      log(`  ${c.type}: ${c.description}`, "warn");
    }
  } else {
    log("Merge konfliktfrei", "success");
  }

  onStep?.(mergeResult.scene, mergeResult.scene.primitives.length);

  // 5. Boundary-Validierung
  log("Prüfe Boundary-Übergänge...", "info");
  const boundaryResult = validateBoundaries(mergeResult.scene, partition);
  if (!boundaryResult.valid) {
    for (const c of boundaryResult.conflicts) {
      log(`  Boundary: ${c.description}`, "warn");
    }
  } else {
    log("Boundaries OK", "success");
  }

  // 6. Global Critic
  log("Globale Bewertung...", "info");
  const allConflicts = [...mergeResult.conflicts, ...boundaryResult.conflicts];
  const criticResult = await globalCritic(mergeResult.scene, partition.styleDirectives, allConflicts);
  log(`Qualität: ${(criticResult.qualityScore * 100).toFixed(0)}% – ${criticResult.feedback}`, "success");

  if (criticResult.issues.length > 0) {
    for (const issue of criticResult.issues) {
      log(`  Issue: ${issue}`, "warn");
    }
  }

  // 7. Speichern
  saveScene(mergeResult.scene);
  log("=== Parallele Pipeline abgeschlossen ===", "success");

  return {
    scene: mergeResult.scene,
    partition,
    mergeResult,
    qualityScore: criticResult.qualityScore,
  };
}
