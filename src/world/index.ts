// ─── World Module – Public API ──────────────────────────────

// Types
export type {
  WorldState,
  WorldMetadata,
  GlobalSettings,
  Region,
  CreateRegionOpts,
  SupportSurface,
  SupportSurfaceType,
  CreateSupportSurfaceOpts,
  WorldObject,
  ObjectTransform,
  ObjectState,
  PlacementRules,
  PlacementZoneType,
  ProportionConstraints,
  OrientationRules,
  CreateObjectOpts,
  RelationType,
  ObjectRelation,
  HistoryEntry,
  LockStateSummary,
  SerializedWorldState,
  WorldValidationResult,
  WorldScoreBreakdown,
  WorldValidationEntry,
  ObjectMetrics,
  HeightMetrics,
  SupportMetrics,
  ZoneMetrics,
  OrientationMetrics,
  RequiredObjectMatch,
} from "./types";

// WorldState Manager
export {
  createWorldState,
  getWorldState,
  setWorldState,
  addRegion,
  removeRegion,
  addObject,
  removeObject,
  addSupportSurface,
  removeSupportSurface,
  addRelation,
  removeRelation,
  getLockStateSummary,
} from "./world-state";

// Region Manager
export {
  createRegion,
  getRegion,
  listRegions,
  getChildRegions,
  getObjectsInRegion,
  setRegionLock,
  setRegionEditable,
  setRegionAiAllowed,
} from "./region-manager";

// Object Registry
export {
  createObject,
  getObject,
  listObjects,
  filterByRegion,
  filterByType,
  filterByCategory,
  getRelationsFor,
  setObjectLock,
  setObjectEditable,
  setObjectAiAllowed,
  updateObjectTransform,
} from "./object-registry";

// Support Surface Manager
export {
  createSupportSurface,
  getSupportSurface,
  listSupportSurfaces,
  getSurfacesInRegion,
  getSurfaceForObject,
  getObjectsOnSurface,
  isObjectGrounded,
  isObjectWithinSurfaceBounds,
  snapToSurface,
} from "./support-surface";

// Validation
export {
  validateWorldState,
  extractRequiredObjects,
  normalizeObjectName,
  canonicalObjectName,
  namesMatch,
  computeActualZone,
  computeAllObjectMetrics,
} from "./validation";

// Serialization
export {
  exportWorldState,
  importWorldState,
  validateSerializedWorldState,
} from "./serialization";

// Debug
export {
  debugListAllObjects,
  debugListRegions,
  debugListSupportSurfaces,
  debugObjectsByRegion,
  debugLockStatus,
  debugRelations,
  debugSupportChain,
  debugFullReport,
  debugPlacementRules,
  debugObjectMetrics,
} from "./debug";

// Seed
export { createSeedWorld } from "./seed";
