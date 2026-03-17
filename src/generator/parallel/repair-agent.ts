// RepairAgent: Versucht verworfene Primitives durch Repositionierung zu retten
// Max 1 Repair-Versuch pro Pipeline-Run

import type { Scene, Primitive, MergeConflict } from "../../core/types.js";
import { callLLM } from "../../ai/client.js";
import { findOverlaps } from "../../core/constraints.js";
import { getPrimitiveExtents } from "../../core/types.js";

export interface RepairResult {
  repairedPrimitives: Primitive[];
  failedIds: string[];
}

export async function repairAgent(
  scene: Scene,
  conflicts: MergeConflict[],
  droppedPrimitives: Primitive[],
): Promise<RepairResult> {
  if (droppedPrimitives.length === 0) {
    return { repairedPrimitives: [], failedIds: [] };
  }

  const existingInfo = scene.primitives.map((p) => {
    const ext = getPrimitiveExtents(p);
    return {
      id: p.id,
      type: p.type,
      position: p.position,
      extents: ext,
    };
  });

  const droppedInfo = droppedPrimitives.map((p) => {
    const ext = getPrimitiveExtents(p);
    return { id: p.id, type: p.type, position: p.position, extents: ext, color: p.color, tags: p.tags };
  });

  const conflictDesc = conflicts.map((c) => c.description).join("; ");

  const systemPrompt = `You are a 3D repair agent. Some primitives were dropped during merge because they overlapped with other primitives.
Your job: adjust ONLY the position of each dropped primitive so it no longer overlaps with any existing primitive.

EXISTING SCENE PRIMITIVES (do NOT modify these):
${JSON.stringify(existingInfo)}

DROPPED PRIMITIVES (fix these by adjusting position):
${JSON.stringify(droppedInfo)}

CONFLICTS: ${conflictDesc}

RULES:
- Only change the "position" field. Keep type, size/radius, color, tags unchanged.
- The repaired primitive must not overlap with ANY existing primitive.
- Two primitives overlap when their bounding boxes intersect on ALL three axes.
- Try to keep the repaired position close to the original — move the minimum needed.
- For each primitive, return the full object with the corrected position.

Respond with ONLY valid JSON:
{"repaired": [{"id": "...", "type": "...", "position": [x, y, z], ...all other original fields}]}`;

  try {
    const raw = await callLLM(systemPrompt, "Fix the positions of dropped primitives.");
    const parsed = JSON.parse(raw);
    const repaired: Primitive[] = [];
    const failedIds: string[] = [];

    for (const rp of parsed.repaired ?? []) {
      // Find the original dropped primitive to preserve all fields
      const original = droppedPrimitives.find((d) => d.id === rp.id);
      if (!original) continue;

      // Create repaired version with new position
      const fixed: Primitive = { ...original, position: rp.position ?? original.position } as Primitive;

      // Validate: check no overlaps with current scene
      const overlaps = findOverlaps(scene, fixed);
      if (overlaps.length === 0) {
        repaired.push(fixed);
      } else {
        failedIds.push(fixed.id);
      }
    }

    // Any dropped primitives not in the repaired list
    for (const d of droppedPrimitives) {
      if (!repaired.some((r) => r.id === d.id) && !failedIds.includes(d.id)) {
        failedIds.push(d.id);
      }
    }

    return { repairedPrimitives: repaired, failedIds };
  } catch {
    return {
      repairedPrimitives: [],
      failedIds: droppedPrimitives.map((p) => p.id),
    };
  }
}
