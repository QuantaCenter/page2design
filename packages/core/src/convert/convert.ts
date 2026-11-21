import type {
  Asset,
  CaptureWarning,
  CssImage,
  DesignDocument,
  DesignNode,
  FontAsset,
  LayerStructure,
} from '../model/design.js';
import type { TableSnapshot } from '../model/tables.js';
import { applyStackingOrder } from '../model/stacking.js';
import { applyTablePaint } from '../model/tables.js';
import { flattenDocument } from '../model/structure.js';
import { CAPTURE_REVISION } from '../model/protocol.js';
import { applyOpacityGroups } from '../model/opacity.js';

/** Already obtained layout data. The core never opens a URL or starts a browser. */
export interface LayoutSnapshot {
  title: string;
  viewport: { width: number; height: number };
  width: number;
  height: number;
  background: string;
  nodes: readonly DesignNode[];
  tables?: readonly TableSnapshot[];
  warnings?: readonly CaptureWarning[];
}

/** Asset bytes, screenshot and provenance are supplied by the host application. */
export interface SnapshotResources {
  id: string;
  capturedAt: string;
  assets: readonly Asset[];
  fonts?: readonly FontAsset[];
  referenceImage?: string;
  durationMs?: number;
}

export interface PageSnapshot extends LayoutSnapshot, SnapshotResources {}
export interface ConversionOptions {
  structure?: LayerStructure;
}
export interface ConversionPlan {
  kind: 'page-to-design/conversion-plan';
  captureRevision: number;
  title: string;
  viewport: { width: number; height: number };
  width: number;
  height: number;
  background: string;
  nodes: DesignNode[];
  warnings: CaptureWarning[];
}

function validateLayout(snapshot: LayoutSnapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.nodes))
    throw new TypeError('A structured page snapshot with layout nodes is required.');
  for (const value of [
    snapshot.width,
    snapshot.height,
    snapshot.viewport?.width,
    snapshot.viewport?.height,
  ]) {
    if (!Number.isFinite(value) || value <= 0)
      throw new RangeError('Snapshot and viewport dimensions must be positive numbers.');
  }
  const ids = new Set<string>();
  for (const node of snapshot.nodes) {
    if (!node.id || ids.has(node.id))
      throw new TypeError(`Duplicate or missing layout node ID: ${node.id}`);
    ids.add(node.id);
    if (
      !node.box ||
      ![node.box.x, node.box.y, node.box.width, node.box.height].every(Number.isFinite) ||
      node.box.width < 0 ||
      node.box.height < 0
    )
      throw new TypeError(`Invalid layout box: ${node.id}`);
  }
}

/** Produce drawing geometry before a host supplies local effect bitmaps. */
export function prepareConversion(snapshot: LayoutSnapshot): ConversionPlan {
  validateLayout(snapshot);
  const nodes = structuredClone([...snapshot.nodes]);
  applyStackingOrder(nodes);
  applyTablePaint(nodes, structuredClone([...(snapshot.tables || [])]));
  applyOpacityGroups(nodes);
  return {
    kind: 'page-to-design/conversion-plan',
    captureRevision: CAPTURE_REVISION,
    title: snapshot.title,
    viewport: { ...snapshot.viewport },
    width: snapshot.width,
    height: snapshot.height,
    background: snapshot.background,
    nodes,
    warnings: structuredClone([...(snapshot.warnings || [])]),
  };
}

function requireInline(value: string, label: string) {
  if (!value.startsWith('data:'))
    throw new TypeError(
      `${label} must contain inline data; resource acquisition belongs to the host.`,
    );
}

/** Finalize resolved information without I/O or mutation of the supplied plan. */
export function completeConversion(
  plan: ConversionPlan,
  resources: SnapshotResources,
  options: ConversionOptions = {},
): DesignDocument {
  if (plan.kind !== 'page-to-design/conversion-plan' || plan.captureRevision !== CAPTURE_REVISION)
    throw new TypeError('A compatible conversion plan is required.');
  if (!resources.id || !resources.capturedAt)
    throw new TypeError('Snapshot id and capturedAt are required.');
  const assetIds = new Set<string>();
  for (const asset of resources.assets) {
    if (!asset.id || assetIds.has(asset.id))
      throw new TypeError(`Duplicate or missing asset ID: ${asset.id}`);
    requireInline(asset.dataUrl, `Asset ${asset.id}`);
    assetIds.add(asset.id);
  }
  for (const font of resources.fonts || []) requireInline(font.dataUrl, `Font ${font.family}`);
  if (resources.referenceImage) requireInline(resources.referenceImage, 'Reference image');
  for (const node of plan.nodes) {
    if (
      (['image', 'svg', 'raster'].includes(node.kind) ||
        (node.kind === 'canvas' &&
          !(node.canvas && (!node.canvas.width || !node.canvas.height)))) &&
      !node.assetId
    )
      throw new TypeError(`The host must supply an asset for node ${node.id}.`);
    for (const id of [node.assetId, node.backgroundAssetId])
      if (id && !assetIds.has(id)) throw new TypeError(`Missing asset ${id} for node ${node.id}.`);
    const sources = (image: CssImage): CssImage[] => [
      image,
      ...(image.crossFade || []).flatMap((child) => sources(child.source)),
    ];
    if (node.kind !== 'raster')
      for (const layer of [...(node.backgroundLayers || []), ...(node.maskLayers || [])].flatMap(
        sources,
      )) {
        if (layer.url && !layer.assetId)
          throw new TypeError(`The host must supply a background asset for node ${node.id}.`);
        if (layer.assetId && !assetIds.has(layer.assetId))
          throw new TypeError(`Missing background asset ${layer.assetId} for node ${node.id}.`);
      }
  }
  if (options.structure && !['flat', 'hierarchical'].includes(options.structure))
    throw new TypeError('Unknown document structure.');
  const nodes = structuredClone(plan.nodes);
  const rasterNodes = nodes.filter((node) => node.kind === 'raster').length;
  const document: DesignDocument = {
    version: 1,
    captureRevision: CAPTURE_REVISION,
    id: resources.id,
    capturedAt: resources.capturedAt,
    title: plan.title,
    viewport: { ...plan.viewport },
    width: plan.width,
    height: plan.height,
    background: plan.background,
    structure: 'hierarchical',
    nodes,
    assets: structuredClone([...resources.assets]),
    fonts: structuredClone([...(resources.fonts || [])]),
    referenceImage: resources.referenceImage || '',
    warnings: structuredClone(plan.warnings),
    stats: {
      durationMs: resources.durationMs || 0,
      nativeNodes: nodes.length - rasterNodes,
      rasterNodes,
      textRuns: nodes.reduce((total, node) => total + (node.runs?.length || 0), 0),
    },
  };
  return options.structure === 'flat' ? flattenDocument(document) : document;
}

/** Convert a fully supplied snapshot. Identical input produces identical output. */
export function convertSnapshot(
  snapshot: PageSnapshot,
  options?: ConversionOptions,
): DesignDocument {
  return completeConversion(prepareConversion(snapshot), snapshot, options);
}
