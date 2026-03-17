// Parallele Pipeline: Partitionieren → lokale Builder → Combiner → Critic

import type { Scene, ScenePartition, CombinerResult } from "../../core/types.js";
import { createScene, saveScene } from "../../core/scene.js";
import { partitionWithAI, createSingleRegionPartition } from "./partitioner.js";
import { createBuilderTasks, executeBuilderTasks } from "./coordinator.js";
import { buildPartGroups, combineParts } from "./combiner.js";
import { globalCritic } from "./global-critic.js";
import type { LogFn, OnStepFn } from "../pipeline.js";

export interface ParallelPipelineConfig {
  maxPrimitivesPerRegion: number;
  parallel: boolean;
  maxRegions: number;
}

const defaultConfig: ParallelPipelineConfig = {
  maxPrimitivesPerRegion: 10,
  parallel: true,
  maxRegions: 5,
};

export interface ParallelPipelineResult {
  scene: Scene;
  partition: ScenePartition;
  combinerResult: CombinerResult;
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
  const pipelineStart = performance.now();
  log("=== Parallele Pipeline gestartet ===", "info");

  // 1. Semantische Partitionierung
  log("Zerlege Aufgabe in Parts...", "info");
  let partition: ScenePartition;
  try {
    partition = await partitionWithAI(userPrompt, existingScene ?? createScene(userPrompt));
    log(`${partition.regions.length} Parts erstellt`, "success");
  } catch {
    log("Partitionierung fehlgeschlagen, nutze Fallback", "warn");
    partition = createSingleRegionPartition(userPrompt);
  }

  // Log Parts
  for (const r of partition.regions) {
    const a = partition.assignments.find((a) => a.regionId === r.id);
    log(`  Part "${r.label}": ${a?.localGoal ?? "–"}`, "info");
  }

  // 2. Builder-Tasks erstellen (lokal, ohne Bounds)
  const tasks = createBuilderTasks(partition);

  // 3. Builder parallel ausführen (jeder in eigenem lokalen Raum)
  log("Builder arbeiten in lokalen Räumen...", "info");
  const results = await executeBuilderTasks(tasks, log, cfg.parallel);

  const totalPrimitives = results.reduce((sum, r) => sum + r.addedPrimitives.length, 0);
  log(`${totalPrimitives} Primitives insgesamt erzeugt`, "success");

  // 4. Part-Gruppen erstellen
  const labels = new Map(partition.regions.map((r) => [r.id, r.label]));
  const partGroups = buildPartGroups(results, labels);

  // 5. Combiner: skaliert und positioniert Parts
  log("Combiner: Assembliere Parts...", "info");
  const combinerResult = await combineParts(partGroups, partition.styleDirectives, existingScene);

  if (combinerResult.issues.length > 0) {
    for (const issue of combinerResult.issues) {
      log(`  Combiner: ${issue}`, "warn");
    }
  }
  log(`Combiner: ${combinerResult.scene.primitives.length} Primitives in Hauptszene`, "success");

  onStep?.(combinerResult.scene, combinerResult.scene.primitives.length);

  // 6. Global Critic
  log("Globale Bewertung...", "info");
  const criticResult = await globalCritic(combinerResult.scene, partition.styleDirectives, []);
  log(`Qualität: ${(criticResult.qualityScore * 100).toFixed(0)}% – ${criticResult.feedback}`, "success");

  if (criticResult.issues.length > 0) {
    for (const issue of criticResult.issues) {
      log(`  Issue: ${issue}`, "warn");
    }
  }

  // 7. Speichern
  saveScene(combinerResult.scene);
  const pipelineElapsed = performance.now() - pipelineStart;
  log(`=== Pipeline abgeschlossen in ${(pipelineElapsed / 1000).toFixed(1)}s ===`, "success");

  return {
    scene: combinerResult.scene,
    partition,
    combinerResult,
    qualityScore: criticResult.qualityScore,
  };
}
