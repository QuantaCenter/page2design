export type * from './model/design.js';
export { CAPTURE_REVISION } from './model/protocol.js';
export {
  clamp,
  round,
  screenToDocument,
  zoomAt,
  fitCamera,
  intersects,
  contains,
  measureRects,
} from './model/geometry.js';
export type { MeasureSegment } from './model/geometry.js';
export { flattenDocument } from './model/structure.js';
export { nodeCss } from './model/css.js';
export {
  matrixFromQuad,
  projectPoint,
  inverseTransform,
  transformRect,
  applyNativeTransforms,
} from './model/transform.js';
export { prepareConversion, completeConversion, convertSnapshot } from './convert/convert.js';
export type {
  LayoutSnapshot,
  PageSnapshot,
  SnapshotResources,
  ConversionPlan,
  ConversionOptions,
} from './convert/convert.js';
export type { TableSnapshot, TableCell, TablePart } from './model/tables.js';
