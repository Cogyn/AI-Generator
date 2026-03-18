// MultiBuilderCoordinator: Erstellt Tasks und orchestriert parallele Builder
// Erweitert: Unterstützt PlanObject-basierte Builder-Prompts und Token-Tracking

import type {
  ScenePartition,
  BuilderTask,
  BuilderResult,
  BuilderTaskExt,
  BuilderResultExt,
  WorkRegionExt,
  MeshOperation,
  PlanObject,
} from "../../core/types.js";
import { regionBuilder, regionBuilderExt, regionBuilderWithPlan } from "./region-builder.js";
import type { LogFn } from "../pipeline.js";

// ─── Standard Tasks (bestehend) ─────────────────────────────

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
        boundaryContext: [],
        existingPrimitives: [],
      };
    });
}

// ─── Erweiterte Tasks (Mesh-Ops) ────────────────────────────

export function createExtBuilderTasks(
  partition: ScenePartition,
  extRegions: WorkRegionExt[],
  defaultAllowedOps: MeshOperation["op"][] = [
    "add_primitive", "add_terrain_region", "add_hill",
    "add_mesh_rule", "add_curve", "add_grid", "mirror",
  ],
): BuilderTaskExt[] {
  return partition.assignments
    .sort((a, b) => a.priority - b.priority)
    .map((assignment) => {
      const region = partition.regions.find((r) => r.id === assignment.regionId);
      const extRegion = extRegions.find((r) => r.id === assignment.regionId);
      if (!region) throw new Error(`Region ${assignment.regionId} nicht gefunden`);

      return {
        taskId: `task-${region.id}`,
        region,
        localGoal: assignment.localGoal,
        styleDirectives: partition.styleDirectives,
        boundaryContext: [],
        existingPrimitives: [],
        densityLevel: extRegion?.densityLevel ?? 5,
        styleConstraint: extRegion?.styleConstraint,
        seedOffset: extRegion?.seedOffset,
        allowedOps: defaultAllowedOps,
      };
    });
}

// ─── Ausführung ─────────────────────────────────────────────

// Standard Builder-Tasks ausführen (erweitert mit PlanObject-Support)
export async function executeBuilderTasks(
  tasks: BuilderTask[],
  log: LogFn,
  parallel = true,
  planObject?: PlanObject,
): Promise<BuilderResult[]> {
  if (parallel) {
    log(`Starte ${tasks.length} Builder parallel...`, "info");
    const t0 = performance.now();
    const results = await Promise.all(
      tasks.map((task) => runSingleBuilder(task, log, planObject)),
    );
    const elapsed = performance.now() - t0;
    log(`Alle ${tasks.length} Builder fertig in ${elapsed.toFixed(0)}ms (parallel)`, "success");
    return results;
  }

  log(`Starte ${tasks.length} Builder sequentiell...`, "info");
  const t0 = performance.now();
  const results: BuilderResult[] = [];
  for (const task of tasks) {
    const result = await runSingleBuilder(task, log, planObject);
    results.push(result);
  }
  const elapsed = performance.now() - t0;
  log(`Alle ${tasks.length} Builder fertig in ${elapsed.toFixed(0)}ms (sequentiell)`, "success");
  return results;
}

// Erweiterte Builder-Tasks (Mesh-Ops) ausführen
export async function executeExtBuilderTasks(
  tasks: BuilderTaskExt[],
  log: LogFn,
  parallel = true,
): Promise<BuilderResultExt[]> {
  if (parallel) {
    log(`Starte ${tasks.length} Mesh-Ops-Builder parallel...`, "info");
    const t0 = performance.now();
    const results = await Promise.all(tasks.map((task) => runExtBuilder(task, log)));
    const elapsed = performance.now() - t0;
    log(`Alle ${tasks.length} Mesh-Ops-Builder fertig in ${elapsed.toFixed(0)}ms (parallel)`, "success");
    return results;
  }

  log(`Starte ${tasks.length} Mesh-Ops-Builder sequentiell...`, "info");
  const t0 = performance.now();
  const results: BuilderResultExt[] = [];
  for (const task of tasks) {
    const result = await runExtBuilder(task, log);
    results.push(result);
  }
  const elapsed = performance.now() - t0;
  log(`Alle ${tasks.length} Mesh-Ops-Builder fertig in ${elapsed.toFixed(0)}ms (sequentiell)`, "success");
  return results;
}

// ─── Einzelne Runner ────────────────────────────────────────

async function runSingleBuilder(
  task: BuilderTask,
  log: LogFn,
  planObject?: PlanObject,
): Promise<BuilderResult> {
  log(`Builder [${task.region.label}]: ${task.localGoal.slice(0, 60)}...`, "info");
  const t0 = performance.now();

  // PlanObject-basierter Builder wenn verfügbar
  const result = planObject
    ? await regionBuilderWithPlan(task, planObject)
    : await regionBuilder(task);

  const elapsed = performance.now() - t0;
  log(`Builder [${task.region.label}]: ${result.addedPrimitives.length} Primitives in ${elapsed.toFixed(0)}ms`, "success");
  return result;
}

async function runExtBuilder(task: BuilderTaskExt, log: LogFn): Promise<BuilderResultExt> {
  log(`MeshOps-Builder [${task.region.label}]: ${task.localGoal}`, "info");
  const t0 = performance.now();
  const result = await regionBuilderExt(task);
  const elapsed = performance.now() - t0;
  log(`MeshOps-Builder [${task.region.label}]: ${result.meshOps.length} Ops → ${result.addedPrimitives.length} Primitives in ${elapsed.toFixed(0)}ms`, "success");
  return result;
}
