// MultiBuilderCoordinator: Orchestriert mehrere Builder-Tasks
// MVP: Sequentielle Ausführung, Architektur bereit für Promise.all()

import type {
  Scene,
  ScenePartition,
  BuilderTask,
  BuilderResult,
  BoundaryContext,
  Primitive,
  WorkRegion,
} from "../../core/types.js";
import { primitivesInRegion } from "./partitioner.js";
import { regionBuilder } from "./region-builder.js";
import type { LogFn } from "../pipeline.js";

const BOUNDARY_MARGIN = 1.0; // Wie weit über die Grenze hinaus Nachbar-Primitives sichtbar sind

// Erzeugt BoundaryContext für eine Region aus ihren Nachbarn
function buildBoundaryContexts(
  region: WorkRegion,
  allRegions: WorkRegion[],
  scenePrimitives: Primitive[],
): BoundaryContext[] {
  const contexts: BoundaryContext[] = [];

  for (const other of allRegions) {
    if (other.id === region.id) continue;

    // Prüfe ob Regionen benachbart sind (teilen eine Fläche)
    const sharedEdge = findSharedEdge(region.bounds, other.bounds);
    if (!sharedEdge) continue;

    // Sammle Primitives nahe der Grenze
    const expandedBounds = expandBoundsToward(region.bounds, sharedEdge, BOUNDARY_MARGIN);
    const edgePrimitives = primitivesInRegion(scenePrimitives, expandedBounds)
      .filter((p) => !primitivesInRegion([p], region.bounds).length); // nur die außerhalb

    contexts.push({
      regionId: other.id,
      sharedEdge,
      edgePrimitives,
    });
  }

  return contexts;
}

function findSharedEdge(
  a: { min: [number, number, number]; max: [number, number, number] },
  b: { min: [number, number, number]; max: [number, number, number] },
): BoundaryContext["sharedEdge"] | null {
  const axes = ["x", "y", "z"] as const;
  const signs = ["+", "-"] as const;

  for (let i = 0; i < 3; i++) {
    if (Math.abs(a.max[i] - b.min[i]) < 0.01) return `${axes[i]}+` as BoundaryContext["sharedEdge"];
    if (Math.abs(a.min[i] - b.max[i]) < 0.01) return `${axes[i]}-` as BoundaryContext["sharedEdge"];
  }
  return null;
}

function expandBoundsToward(
  bounds: { min: [number, number, number]; max: [number, number, number] },
  edge: BoundaryContext["sharedEdge"],
  margin: number,
): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [...bounds.min];
  const max: [number, number, number] = [...bounds.max];
  const axis = edge[0] === "x" ? 0 : edge[0] === "y" ? 1 : 2;
  if (edge[1] === "+") max[axis] += margin;
  else min[axis] -= margin;
  return { min, max };
}

// Erstellt BuilderTasks aus einer Partition
export function createBuilderTasks(
  partition: ScenePartition,
  scenePrimitives: Primitive[],
): BuilderTask[] {
  return partition.assignments
    .sort((a, b) => a.priority - b.priority)
    .map((assignment) => {
      const region = partition.regions.find((r) => r.id === assignment.regionId);
      if (!region) throw new Error(`Region ${assignment.regionId} nicht gefunden`);

      const existing = primitivesInRegion(scenePrimitives, region.bounds);
      const boundaryContext = buildBoundaryContexts(region, partition.regions, scenePrimitives);

      return {
        taskId: `task-${region.id}`,
        region,
        localGoal: assignment.localGoal,
        styleDirectives: partition.styleDirectives,
        boundaryContext,
        existingPrimitives: existing,
      };
    });
}

// Führt alle Builder-Tasks aus
// MVP: sequentiell. Für echte Parallelität → Promise.all(tasks.map(...))
export async function executeBuilderTasks(
  tasks: BuilderTask[],
  log: LogFn,
  parallel = false,
): Promise<BuilderResult[]> {
  if (parallel) {
    log(`Starte ${tasks.length} Builder parallel...`, "info");
    return Promise.all(tasks.map((task) => runSingleBuilder(task, log)));
  }

  log(`Starte ${tasks.length} Builder sequentiell...`, "info");
  const results: BuilderResult[] = [];
  for (const task of tasks) {
    const result = await runSingleBuilder(task, log);
    results.push(result);
  }
  return results;
}

async function runSingleBuilder(task: BuilderTask, log: LogFn): Promise<BuilderResult> {
  log(`Builder [${task.region.label}]: ${task.localGoal}`, "info");
  const result = await regionBuilder(task);
  log(`Builder [${task.region.label}]: ${result.addedPrimitives.length} Primitives erzeugt`, "success");
  return result;
}
