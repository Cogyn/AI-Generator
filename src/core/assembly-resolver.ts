// Assembly Resolver: Algorithmische Platzierung von Parts anhand von AssemblyRules
// Ersetzt den LLM-basierten Combiner — keine AI, rein mathematisch.

import type {
  Scene,
  Primitive,
  PartGroup,
  PartTransform,
  CombinerResult,
  AssemblyConfig,
  AssemblyRule,
  Vec3,
  AABB,
  GlobalStyleDirectives,
} from "./types.js";
import { createScene, addPrimitives } from "./scene.js";
import { getBBox } from "./constraints.js";
import { computeLocalBounds } from "../generator/parallel/combiner.js";

// ─── Transform Primitive ────────────────────────────────────

export function transformPrimitive(p: Primitive, transform: PartTransform): Primitive {
  const s = transform.scale;
  const off = transform.offset;
  const newPos: Vec3 = [
    p.position[0] * s + off[0],
    p.position[1] * s + off[1],
    p.position[2] * s + off[2],
  ];

  const newRot: Vec3 = transform.rotation
    ? [p.rotation[0] + transform.rotation[0], p.rotation[1] + transform.rotation[1], p.rotation[2] + transform.rotation[2]]
    : [...p.rotation];

  switch (p.type) {
    case "cube":
      return { ...p, position: newPos, rotation: newRot, size: [p.size[0] * s, p.size[1] * s, p.size[2] * s] };
    case "sphere":
      return { ...p, position: newPos, rotation: newRot, radius: p.radius * s };
    case "cylinder":
      return { ...p, position: newPos, rotation: newRot, radiusTop: p.radiusTop * s, radiusBottom: p.radiusBottom * s, height: p.height * s };
  }
}

// ─── AABB Helpers ───────────────────────────────────────────

function aabbDims(aabb: AABB): Vec3 {
  return [
    aabb.max[0] - aabb.min[0],
    aabb.max[1] - aabb.min[1],
    aabb.max[2] - aabb.min[2],
  ];
}

function aabbCenter(aabb: AABB): Vec3 {
  return [
    (aabb.min[0] + aabb.max[0]) / 2,
    (aabb.min[1] + aabb.max[1]) / 2,
    (aabb.min[2] + aabb.max[2]) / 2,
  ];
}

function offsetAABB(aabb: AABB, offset: Vec3): AABB {
  return {
    min: [aabb.min[0] + offset[0], aabb.min[1] + offset[1], aabb.min[2] + offset[2]],
    max: [aabb.max[0] + offset[0], aabb.max[1] + offset[1], aabb.max[2] + offset[2]],
  };
}

function scaleAABB(aabb: AABB, scale: number): AABB {
  const c = aabbCenter(aabb);
  return {
    min: [(aabb.min[0] - c[0]) * scale + c[0], (aabb.min[1] - c[1]) * scale + c[1], (aabb.min[2] - c[2]) * scale + c[2]],
    max: [(aabb.max[0] - c[0]) * scale + c[0], (aabb.max[1] - c[1]) * scale + c[1], (aabb.max[2] - c[2]) * scale + c[2]],
  };
}

// ─── Alignment Resolution ───────────────────────────────────

/** Compute the XZ position on the parent surface for a given alignment anchor */
function resolveAlignment(
  parentAABB: AABB,
  alignment: AssemblyRule["alignment"],
): { x: number; z: number } {
  const pc = aabbCenter(parentAABB);
  const pd = aabbDims(parentAABB);
  const hw = pd[0] / 2;
  const hd = pd[2] / 2;

  switch (alignment) {
    case "center":       return { x: pc[0], z: pc[2] };
    case "corner_nw":    return { x: pc[0] - hw, z: pc[2] - hd };
    case "corner_ne":    return { x: pc[0] + hw, z: pc[2] - hd };
    case "corner_sw":    return { x: pc[0] - hw, z: pc[2] + hd };
    case "corner_se":    return { x: pc[0] + hw, z: pc[2] + hd };
    case "edge_left":    return { x: pc[0] - hw, z: pc[2] };
    case "edge_right":   return { x: pc[0] + hw, z: pc[2] };
    case "edge_front":   return { x: pc[0], z: pc[2] + hd };
    case "edge_back":    return { x: pc[0], z: pc[2] - hd };
    default:             return { x: pc[0], z: pc[2] };
  }
}

// ─── Spatial Relation Resolution ────────────────────────────

/** Compute the offset to place childAABB relative to parentAABB based on spatial relation */
function resolveRelation(
  parentAABB: AABB,
  childAABB: AABB,
  relation: AssemblyRule["relation"],
  alignment: AssemblyRule["alignment"],
): Vec3 {
  const childCenter = aabbCenter(childAABB);
  const childDims = aabbDims(childAABB);
  const parentDims = aabbDims(parentAABB);
  const align = resolveAlignment(parentAABB, alignment);

  // Base XZ from alignment
  let x = align.x - childCenter[0];
  let y = 0;
  let z = align.z - childCenter[2];

  switch (relation) {
    case "on_top_of":
      // child bottom sits on parent top
      y = parentAABB.max[1] - (childAABB.min[1]);
      break;
    case "below":
      // child top sits at parent bottom
      y = parentAABB.min[1] - (childAABB.max[1]);
      break;
    case "beside_left":
      x = parentAABB.min[0] - childDims[0] / 2 - childCenter[0];
      y = parentAABB.min[1] - childAABB.min[1]; // align bottoms
      break;
    case "beside_right":
      x = parentAABB.max[0] + childDims[0] / 2 - childCenter[0];
      y = parentAABB.min[1] - childAABB.min[1];
      break;
    case "in_front_of":
      z = parentAABB.max[2] + childDims[2] / 2 - childCenter[2];
      y = parentAABB.min[1] - childAABB.min[1];
      break;
    case "behind":
      z = parentAABB.min[2] - childDims[2] / 2 - childCenter[2];
      y = parentAABB.min[1] - childAABB.min[1];
      break;
    case "inside":
      // center child inside parent
      y = aabbCenter(parentAABB)[1] - childCenter[1];
      break;
    case "attached_to":
      // same as on_top_of but no alignment override
      y = parentAABB.max[1] - childAABB.min[1];
      break;
    case "surrounds":
      // center child around parent center
      y = aabbCenter(parentAABB)[1] - childCenter[1];
      break;
  }

  return [x, y, z];
}

// ─── Multi-Instance Patterns ────────────────────────────────

function generateMultiInstanceOffsets(
  parentAABB: AABB,
  multi: NonNullable<AssemblyRule["multiInstance"]>,
): Vec3[] {
  const pc = aabbCenter(parentAABB);
  const pd = aabbDims(parentAABB);
  const hw = pd[0] / 2;
  const hd = pd[2] / 2;
  const offsets: Vec3[] = [];

  switch (multi.pattern) {
    case "corners":
      // 4 corners on the XZ plane of the parent
      offsets.push(
        [pc[0] - hw, 0, pc[2] - hd],
        [pc[0] + hw, 0, pc[2] - hd],
        [pc[0] - hw, 0, pc[2] + hd],
        [pc[0] + hw, 0, pc[2] + hd],
      );
      // If count > 4, add midpoints
      if (multi.count > 4) {
        offsets.push([pc[0], 0, pc[2] - hd]);
        offsets.push([pc[0], 0, pc[2] + hd]);
      }
      break;

    case "edges": {
      const perSide = Math.ceil(multi.count / 4);
      for (let side = 0; side < 4; side++) {
        for (let i = 0; i < perSide && offsets.length < multi.count; i++) {
          const t = perSide === 1 ? 0.5 : i / (perSide - 1);
          switch (side) {
            case 0: offsets.push([pc[0] - hw + t * pd[0], 0, pc[2] - hd]); break;
            case 1: offsets.push([pc[0] + hw, 0, pc[2] - hd + t * pd[2]]); break;
            case 2: offsets.push([pc[0] + hw - t * pd[0], 0, pc[2] + hd]); break;
            case 3: offsets.push([pc[0] - hw, 0, pc[2] + hd - t * pd[2]]); break;
          }
        }
      }
      break;
    }

    case "ring": {
      const radius = Math.max(hw, hd);
      for (let i = 0; i < multi.count; i++) {
        const angle = (2 * Math.PI * i) / multi.count;
        offsets.push([
          pc[0] + Math.cos(angle) * radius,
          0,
          pc[2] + Math.sin(angle) * radius,
        ]);
      }
      break;
    }

    case "linear": {
      const spacing = multi.spacing ?? pd[0] / (multi.count - 1 || 1);
      const totalWidth = spacing * (multi.count - 1);
      const startX = pc[0] - totalWidth / 2;
      for (let i = 0; i < multi.count; i++) {
        offsets.push([startX + i * spacing, 0, pc[2]]);
      }
      break;
    }
  }

  return offsets.slice(0, multi.count);
}

// ─── Contact Check ──────────────────────────────────────────

function checkContact(aabbA: AABB, aabbB: AABB, maxGap: number): boolean {
  // Check if two AABBs are within maxGap distance
  for (let i = 0; i < 3; i++) {
    const gap = Math.max(0, aabbA.min[i] - aabbB.max[i], aabbB.min[i] - aabbA.max[i]);
    if (gap > maxGap) return false;
  }
  return true;
}

// ─── Overlap Resolution ─────────────────────────────────────

function resolveOverlaps(placedGroups: Array<{ aabb: AABB; offset: Vec3 }>): void {
  const maxIterations = 10;
  for (let iter = 0; iter < maxIterations; iter++) {
    let anyOverlap = false;
    for (let i = 0; i < placedGroups.length; i++) {
      for (let j = i + 1; j < placedGroups.length; j++) {
        const a = placedGroups[i].aabb;
        const b = placedGroups[j].aabb;
        // Check overlap on all axes
        const overlapX = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
        const overlapY = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
        const overlapZ = Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]);

        if (overlapX > 0.1 && overlapY > 0.1 && overlapZ > 0.1) {
          anyOverlap = true;
          // Push apart on the axis with minimal overlap
          const minOverlap = Math.min(overlapX, overlapY, overlapZ);
          const shift = minOverlap / 2 + 0.05;
          if (minOverlap === overlapX) {
            const dir = aabbCenter(a)[0] < aabbCenter(b)[0] ? -1 : 1;
            placedGroups[i].offset[0] += dir * shift;
            placedGroups[j].offset[0] -= dir * shift;
          } else if (minOverlap === overlapZ) {
            const dir = aabbCenter(a)[2] < aabbCenter(b)[2] ? -1 : 1;
            placedGroups[i].offset[2] += dir * shift;
            placedGroups[j].offset[2] -= dir * shift;
          }
          // Recalculate AABBs
          // (simplified — we just shift the stored AABBs)
          placedGroups[i].aabb = offsetAABB(placedGroups[i].aabb, [
            minOverlap === overlapX ? (aabbCenter(a)[0] < aabbCenter(b)[0] ? -shift : shift) : 0,
            0,
            minOverlap === overlapZ ? (aabbCenter(a)[2] < aabbCenter(b)[2] ? -shift : shift) : 0,
          ]);
          placedGroups[j].aabb = offsetAABB(placedGroups[j].aabb, [
            minOverlap === overlapX ? (aabbCenter(a)[0] < aabbCenter(b)[0] ? shift : -shift) : 0,
            0,
            minOverlap === overlapZ ? (aabbCenter(a)[2] < aabbCenter(b)[2] ? shift : -shift) : 0,
          ]);
        }
      }
    }
    if (!anyOverlap) break;
  }
}

// ─── Main Resolver ──────────────────────────────────────────

export function resolveAssembly(
  partGroups: PartGroup[],
  config: AssemblyConfig,
  existingScene?: Scene,
): CombinerResult {
  const scene = existingScene ?? createScene("assembled");
  const issues: string[] = [];
  const transforms: PartTransform[] = [];

  if (partGroups.length === 0) {
    return { scene, transforms: [], issues: ["Keine Parts zum Kombinieren"] };
  }

  // Build lookup: partId → PartGroup
  const groupMap = new Map<string, PartGroup>();
  for (const g of partGroups) {
    groupMap.set(g.partId, g);
  }

  // Sort rules by priority
  const sortedRules = [...config.rules].sort((a, b) => a.priority - b.priority);

  // Track placed parts: partId → { transform, worldAABB }
  const placed = new Map<string, { transform: PartTransform; worldAABB: AABB }>();

  // Place root part first
  const rootGroup = groupMap.get(config.rootPartId);
  if (!rootGroup) {
    issues.push(`Root-Part "${config.rootPartId}" nicht gefunden`);
    // Fallback: use first group as root
    const firstGroup = partGroups[0];
    const bounds = firstGroup.localBounds;
    const center = aabbCenter(bounds);
    // Place so bottom is at groundPlane
    const yOffset = config.groundPlane - bounds.min[1];
    const rootTransform: PartTransform = {
      partId: firstGroup.partId,
      scale: 1,
      offset: [-center[0], yOffset, -center[2]],
    };
    transforms.push(rootTransform);
    const worldAABB = offsetAABB(bounds, rootTransform.offset);
    placed.set(firstGroup.partId, { transform: rootTransform, worldAABB });
  } else {
    const bounds = rootGroup.localBounds;
    const center = aabbCenter(bounds);

    // Find the root rule (if any) to get scaleFactor
    const rootRule = sortedRules.find(r => r.partId === config.rootPartId);
    const scale = rootRule?.scaleFactor ?? 1;
    const scaledBounds = scale !== 1 ? scaleAABB(bounds, scale) : bounds;

    // Center at origin XZ, bottom at groundPlane
    const yOffset = config.groundPlane - scaledBounds.min[1];
    const rootTransform: PartTransform = {
      partId: config.rootPartId,
      scale,
      offset: [-center[0] * scale, yOffset, -center[2] * scale],
      rotation: rootRule?.rotationHint,
    };
    transforms.push(rootTransform);

    const worldAABB = offsetAABB(scaledBounds, [
      -center[0] * scale,
      yOffset,
      -center[2] * scale,
    ]);
    placed.set(config.rootPartId, { transform: rootTransform, worldAABB });
  }

  // Process remaining rules
  for (const rule of sortedRules) {
    // Skip if this is the root (already placed via its own rule or default)
    if (rule.partId === config.rootPartId && placed.has(config.rootPartId)) continue;

    const childGroup = groupMap.get(rule.partId);
    if (!childGroup) {
      issues.push(`Part "${rule.partId}" nicht gefunden — übersprungen`);
      continue;
    }

    // Determine parent AABB
    let parentAABB: AABB;
    if (rule.parentPartId === "ground") {
      // Ground is a flat plane at groundPlane
      parentAABB = {
        min: [-50, config.groundPlane - 0.01, -50],
        max: [50, config.groundPlane, 50],
      };
    } else {
      const parent = placed.get(rule.parentPartId);
      if (!parent) {
        issues.push(`Parent "${rule.parentPartId}" für "${rule.partId}" noch nicht platziert — übersprungen`);
        continue;
      }
      parentAABB = parent.worldAABB;
    }

    const scale = rule.scaleFactor ?? 1;
    const childBounds = scale !== 1
      ? scaleAABB(childGroup.localBounds, scale)
      : childGroup.localBounds;

    if (rule.multiInstance) {
      // Multi-instance: place N copies at pattern positions
      const patternPositions = generateMultiInstanceOffsets(parentAABB, rule.multiInstance);

      for (let i = 0; i < patternPositions.length; i++) {
        const instanceId = `${rule.partId}_${i}`;
        const patternPos = patternPositions[i];

        // Resolve Y from relation
        const relOffset = resolveRelation(parentAABB, childBounds, rule.relation, "center");

        // Combine: pattern gives XZ, relation gives Y
        const childCenter = aabbCenter(childBounds);
        const finalOffset: Vec3 = [
          patternPos[0] - childCenter[0] * scale,
          relOffset[1],
          patternPos[2] - childCenter[2] * scale,
        ];

        // Add user offset
        if (rule.offset) {
          finalOffset[0] += rule.offset[0];
          finalOffset[1] += rule.offset[1];
          finalOffset[2] += rule.offset[2];
        }

        const instanceTransform: PartTransform = {
          partId: instanceId,
          scale,
          offset: finalOffset,
          rotation: rule.rotationHint,
        };
        transforms.push(instanceTransform);

        const worldAABB = offsetAABB(childBounds, finalOffset);
        placed.set(instanceId, { transform: instanceTransform, worldAABB });
      }
    } else {
      // Single instance
      const relOffset = resolveRelation(parentAABB, childBounds, rule.relation, rule.alignment);

      const finalOffset: Vec3 = [...relOffset];
      if (rule.offset) {
        finalOffset[0] += rule.offset[0];
        finalOffset[1] += rule.offset[1];
        finalOffset[2] += rule.offset[2];
      }

      const childTransform: PartTransform = {
        partId: rule.partId,
        scale,
        offset: finalOffset,
        rotation: rule.rotationHint,
      };
      transforms.push(childTransform);

      const worldAABB = offsetAABB(childBounds, finalOffset);
      placed.set(rule.partId, { transform: childTransform, worldAABB });
    }
  }

  // Handle any unplaced parts (no rule defined) — place beside last part
  for (const group of partGroups) {
    if (placed.has(group.partId)) continue;
    // Check if it was placed as multi-instance
    const isMulti = [...placed.keys()].some(k => k.startsWith(group.partId + "_"));
    if (isMulti) continue;

    issues.push(`Part "${group.label}" hat keine AssemblyRule — Default-Platzierung`);
    const allPlacedAABBs = [...placed.values()].map(p => p.worldAABB);
    const maxX = allPlacedAABBs.length > 0
      ? Math.max(...allPlacedAABBs.map(a => a.max[0]))
      : 0;

    const bounds = group.localBounds;
    const center = aabbCenter(bounds);
    const fallbackTransform: PartTransform = {
      partId: group.partId,
      scale: 1,
      offset: [maxX + 2 - center[0], config.groundPlane - bounds.min[1], -center[2]],
    };
    transforms.push(fallbackTransform);
    placed.set(group.partId, {
      transform: fallbackTransform,
      worldAABB: offsetAABB(bounds, fallbackTransform.offset),
    });
  }

  // Post-placement: Ground settle — ensure nothing is below groundPlane
  let minY = Infinity;
  for (const { worldAABB } of placed.values()) {
    minY = Math.min(minY, worldAABB.min[1]);
  }
  const groundShift = minY < config.groundPlane ? config.groundPlane - minY : 0;

  if (groundShift > 0.01) {
    for (const t of transforms) {
      t.offset[1] += groundShift;
    }
    // Update placed AABBs
    for (const [key, val] of placed) {
      placed.set(key, {
        ...val,
        worldAABB: offsetAABB(val.worldAABB, [0, groundShift, 0]),
      });
    }
  }

  // Contact check
  let contactsVerified = true;
  for (const rule of sortedRules) {
    if (!rule.contactRequired) continue;
    if (rule.parentPartId === "ground") continue;

    const parent = placed.get(rule.parentPartId);
    if (!parent) continue;

    if (rule.multiInstance) {
      for (let i = 0; i < rule.multiInstance.count; i++) {
        const child = placed.get(`${rule.partId}_${i}`);
        if (child && !checkContact(parent.worldAABB, child.worldAABB, 0.5)) {
          contactsVerified = false;
          issues.push(`Kontakt-Check fehlgeschlagen: ${rule.partId}_${i} ↔ ${rule.parentPartId}`);
        }
      }
    } else {
      const child = placed.get(rule.partId);
      if (child && !checkContact(parent.worldAABB, child.worldAABB, 0.5)) {
        contactsVerified = false;
        issues.push(`Kontakt-Check fehlgeschlagen: ${rule.partId} ↔ ${rule.parentPartId}`);
      }
    }
  }

  // Apply transforms to primitives
  const allTransformed: Primitive[] = [];
  for (const group of partGroups) {
    // Find all transforms for this group (including multi-instance)
    const groupTransforms = transforms.filter(
      t => t.partId === group.partId || t.partId.startsWith(group.partId + "_"),
    );

    if (groupTransforms.length === 0) {
      // Shouldn't happen, but safety fallback
      allTransformed.push(...group.primitives);
      continue;
    }

    for (const t of groupTransforms) {
      for (const p of group.primitives) {
        const transformed = transformPrimitive(p, t);
        // For multi-instance, give unique IDs
        if (t.partId !== group.partId) {
          allTransformed.push({
            ...transformed,
            id: `${transformed.id}_${t.partId}`,
          });
        } else {
          allTransformed.push(transformed);
        }
      }
    }
  }

  const finalScene = addPrimitives(scene, allTransformed);

  return {
    scene: finalScene,
    transforms,
    issues,
  };
}

// ─── Default Config Generator ───────────────────────────────

/** Generate a default AssemblyConfig that places all parts side by side */
export function generateDefaultAssemblyConfig(partGroups: PartGroup[]): AssemblyConfig {
  if (partGroups.length === 0) {
    return { rootPartId: "main", rules: [], groundPlane: 0 };
  }

  const rootId = partGroups[0].partId;
  const rules: AssemblyRule[] = [];

  // Root gets on_top_of ground
  rules.push({
    partId: rootId,
    parentPartId: "ground",
    relation: "on_top_of",
    alignment: "center",
    priority: 1,
    contactRequired: true,
  });

  // Remaining parts placed beside each other
  for (let i = 1; i < partGroups.length; i++) {
    rules.push({
      partId: partGroups[i].partId,
      parentPartId: partGroups[i - 1].partId,
      relation: "beside_right",
      alignment: "center",
      priority: i + 1,
      contactRequired: false,
    });
  }

  return {
    rootPartId: rootId,
    rules,
    groundPlane: 0,
  };
}
