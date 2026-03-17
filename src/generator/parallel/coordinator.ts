// MultiBuilderCoordinator: Erstellt Tasks und orchestriert parallele Builder

import type {
  ScenePartition,
  BuilderTask,
  BuilderResult,
} from "../../core/types.js";
import { regionBuilder } from "./region-builder.js";
import type { LogFn } from "../pipeline.js";

// Erstellt BuilderTasks aus einer Partition (jeder Builder bekommt lokalen Raum)
export function createBuilderTasks(partition: ScenePartition): BuilderTask[] {
  return partition.assignments
    .sort((a, b) => a.priority - b.priority)
    .map((assignment) => {
      const region = partition.regions.find((r) => r.id === assignment.regionId);
      if (!region) throw new Error(`Region ${assignment.regionId} nicht gefunden`);

      return {
        taskId: `task-${region.id}`,
        region,
        localGoal: assignment.localGoal,
        styleDirectives: partition.styleDirectives,
        boundaryContext: [],       // keine Nachbarn im lokalen Modus
        existingPrimitives: [],    // leerer lokaler Raum
      };
    });
}

// Führt alle Builder-Tasks aus
export async function executeBuilderTasks(
  tasks: BuilderTask[],
  log: LogFn,
  parallel = true,
): Promise<BuilderResult[]> {
  if (parallel) {
    log(`Starte ${tasks.length} Builder parallel...`, "info");
    const t0 = performance.now();
    const results = await Promise.all(tasks.map((task) => runSingleBuilder(task, log)));
    const elapsed = performance.now() - t0;
    log(`Alle ${tasks.length} Builder fertig in ${elapsed.toFixed(0)}ms (parallel)`, "success");
    return results;
  }

  log(`Starte ${tasks.length} Builder sequentiell...`, "info");
  const t0 = performance.now();
  const results: BuilderResult[] = [];
  for (const task of tasks) {
    const result = await runSingleBuilder(task, log);
    results.push(result);
  }
  const elapsed = performance.now() - t0;
  log(`Alle ${tasks.length} Builder fertig in ${elapsed.toFixed(0)}ms (sequentiell)`, "success");
  return results;
}

async function runSingleBuilder(task: BuilderTask, log: LogFn): Promise<BuilderResult> {
  log(`Builder [${task.region.label}]: ${task.localGoal}`, "info");
  const t0 = performance.now();
  const result = await regionBuilder(task);
  const elapsed = performance.now() - t0;
  log(`Builder [${task.region.label}]: ${result.addedPrimitives.length} Primitives in ${elapsed.toFixed(0)}ms`, "success");
  return result;
}
