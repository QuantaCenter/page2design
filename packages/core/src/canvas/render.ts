import type { Camera, DesignDocument, DesignNode, Rect } from '../model/design.js';
import { screenToDocument } from '../model/geometry.js';
import { ScenePainter } from './composite.js';
import { hitTestNodes } from './hit.js';
import { PreviewCache } from './preview.js';
import type { DocumentResources } from './resources.js';

export type RenderResources = Pick<DocumentResources, 'images' | 'reference'>;
export interface RenderOptions {
  width?: number;
  height?: number;
  pixelRatio?: number;
  camera?: Camera;
  referenceView?: boolean;
}
export interface ExportOptions {
  pixelRatio?: number;
  document?: Document;
}

/** Paint at the caller's current transform, without allocating a viewer or loading data. */
export function paintDocument(
  context: CanvasRenderingContext2D,
  document: DesignDocument,
  images: Map<string, HTMLImageElement>,
) {
  context.save();
  context.beginPath();
  context.rect(0, 0, document.width, document.height);
  context.clip();
  context.fillStyle = document.background;
  context.fillRect(0, 0, document.width, document.height);
  new ScenePainter(
    [...document.nodes].sort((a, b) => a.paintOrder - b.paintOrder || a.order - b.order),
    images,
  ).paint(context, { x: 0, y: 0, width: document.width, height: document.height });
  context.restore();
}

export function renderToCanvas(
  document: DesignDocument,
  resources: Pick<DocumentResources, 'images'>,
  options: ExportOptions = {},
): HTMLCanvasElement {
  const owner = options.document || globalThis.document;
  if (!owner) throw new TypeError('Rendering requires a browser Document.');
  const ratio = options.pixelRatio ?? 1;
  if (!Number.isFinite(ratio) || ratio <= 0) throw new RangeError('Pixel ratio must be positive.');
  const canvas = owner.createElement('canvas');
  canvas.width = Math.round(document.width * ratio);
  canvas.height = Math.round(document.height * ratio);
  const context = canvas.getContext('2d')!;
  context.scale(ratio, ratio);
  paintDocument(context, document, resources.images);
  return canvas;
}

/** Framework-free renderer for an immutable document and already decoded resources. */
export class CanvasRenderer {
  private nodes: DesignNode[];
  private cache: PreviewCache;
  private referenceCache?: PreviewCache;
  private referenceActive = false;
  private hitCanvas: HTMLCanvasElement | null = null;
  private disposed = false;

  constructor(
    private document: DesignDocument,
    private resources: RenderResources,
  ) {
    this.nodes = [...document.nodes].sort(
      (a, b) => a.paintOrder - b.paintOrder || a.order - b.order,
    );
    this.cache = new PreviewCache(document, this.nodes, resources.images);
  }

  render(canvas: HTMLCanvasElement, options: RenderOptions = {}) {
    this.assertActive();
    const width = options.width ?? this.document.width,
      height = options.height ?? this.document.height;
    const ratio = options.pixelRatio ?? 1,
      camera = options.camera || { x: 0, y: 0, scale: 1 };
    if (![width, height, ratio, camera.scale].every((value) => Number.isFinite(value) && value > 0))
      throw new RangeError('Render dimensions, pixel ratio and camera scale must be positive.');
    const w = Math.round(width * ratio),
      h = Math.round(height * ratio);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const context = canvas.getContext('2d')!;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, w, h);
    context.save();
    context.setTransform(
      ratio * camera.scale,
      0,
      0,
      ratio * camera.scale,
      camera.x * ratio,
      camera.y * ratio,
    );
    context.beginPath();
    context.rect(0, 0, this.document.width, this.document.height);
    context.clip();
    context.fillStyle = this.document.background;
    context.fillRect(0, 0, this.document.width, this.document.height);
    const reference = !!(options.referenceView && this.resources.reference);
    if (reference !== this.referenceActive) {
      // Keep the two views within one retained tile budget. The native display
      // list remains available; only inactive bitmap tiles are released.
      if (reference) this.cache.dispose();
      else this.referenceCache?.dispose();
      this.referenceActive = reference;
    }
    let cache = this.cache;
    if (reference)
      cache =
        this.referenceCache ||
        (this.referenceCache = new PreviewCache(
          this.document,
          [],
          this.resources.images,
          this.resources.reference!,
        ));
    cache.paint(context, {
      ...screenToDocument({ x: 0, y: 0 }, camera),
      width: width / camera.scale,
      height: height / camera.scale,
    });
    context.restore();
  }

  /** Test CSS viewport coordinates; pass the same camera used for render. */
  hitTest(
    point: Pick<Rect, 'x' | 'y'>,
    camera: Camera = { x: 0, y: 0, scale: 1 },
  ): DesignNode | null {
    this.assertActive();
    const position = screenToDocument(point, camera);
    if (
      position.x < 0 ||
      position.y < 0 ||
      position.x >= this.document.width ||
      position.y >= this.document.height
    )
      return null;
    if (!this.hitCanvas) {
      this.hitCanvas = globalThis.document.createElement('canvas');
      this.hitCanvas.width = this.hitCanvas.height = 1;
    }
    return hitTestNodes(
      this.hitCanvas.getContext('2d', { willReadFrequently: true })!,
      this.nodes,
      this.resources.images,
      position,
    );
  }

  toCanvas(options?: ExportOptions) {
    this.assertActive();
    return renderToCanvas(this.document, this.resources, options);
  }
  dispose() {
    this.cache.dispose();
    this.referenceCache?.dispose();
    if (this.hitCanvas) this.hitCanvas.width = this.hitCanvas.height = 0;
    this.hitCanvas = null;
    this.disposed = true;
  }
  private assertActive() {
    if (this.disposed) throw new Error('The renderer has been disposed.');
  }
}
