import type { DesignDocument, DesignNode, Rect } from '../model/design.js';
import { ScenePainter } from './composite.js';

const TILE_PIXELS = 768;
// One device pixel of sampling support even at the minimum 1/8 preview scale.
const GUTTER = 8;
const MAX_BYTES = 64 * 1024 * 1024;
interface Tile {
  image: HTMLCanvasElement | ImageBitmap;
  box: Rect;
  bytes: number;
}
function release(tile: Tile) {
  if ('close' in tile.image) tile.image.close();
  else tile.image.width = tile.image.height = 0;
}

/** The document is immutable. Reuse its painted pixels while the camera moves,
 * keeping both tile dimensions and total retained bitmap memory bounded. */
export class PreviewCache {
  private tiles = new Map<string, Tile>();
  private bytes = 0;
  private painter: ScenePainter;

  constructor(
    private document: DesignDocument,
    nodes: DesignNode[],
    images: Map<string, HTMLImageElement>,
    private reference?: HTMLImageElement,
  ) {
    this.painter = new ScenePainter(nodes, images);
  }

  dispose() {
    for (const tile of this.tiles.values()) release(tile);
    this.tiles.clear();
    this.bytes = 0;
  }

  private tile(column: number, row: number, resolution: number): Tile {
    const key = `${resolution}:${column}:${row}`;
    const cached = this.tiles.get(key);
    if (cached) {
      this.tiles.delete(key);
      this.tiles.set(key, cached);
      return cached;
    }
    const span = TILE_PIXELS / resolution;
    const box = {
      x: column * span,
      y: row * span,
      width: Math.min(span, this.document.width - column * span),
      height: Math.min(span, this.document.height - row * span),
    };
    const image = window.document.createElement('canvas');
    image.width = Math.ceil(box.width * resolution) + GUTTER * 2;
    image.height = Math.ceil(box.height * resolution) + GUTTER * 2;
    const context = image.getContext('2d')!;
    context.setTransform(
      resolution,
      0,
      0,
      resolution,
      GUTTER - box.x * resolution,
      GUTTER - box.y * resolution,
    );
    context.beginPath();
    context.rect(0, 0, this.document.width, this.document.height);
    context.clip();
    // Blend modes and backdrop filters must see the same opaque artboard
    // backdrop here as in exports, rather than an otherwise transparent tile.
    context.fillStyle = this.document.background;
    context.fillRect(0, 0, this.document.width, this.document.height);
    const bleed = GUTTER / resolution;
    const bounds = {
      x: box.x - bleed,
      y: box.y - bleed,
      width: box.width + bleed * 2,
      height: box.height + bleed * 2,
    };
    if (this.reference)
      context.drawImage(this.reference, 0, 0, this.document.width, this.document.height);
    else this.painter.paint(context, bounds);
    let bitmap: HTMLCanvasElement | ImageBitmap = image;
    // A canvas can retain and replay its display list at the destination scale.
    // Transfer an immutable bitmap so cached CSS pixels keep one sampling phase.
    if (typeof OffscreenCanvas !== 'undefined') {
      const raster = new OffscreenCanvas(image.width, image.height);
      raster.getContext('2d')!.drawImage(image, 0, 0);
      bitmap = raster.transferToImageBitmap();
      raster.width = raster.height = 0;
      image.width = image.height = 0;
    }
    const tile = { image: bitmap, box, bytes: bitmap.width * bitmap.height * 4 };
    while (this.bytes + tile.bytes > MAX_BYTES && this.tiles.size) {
      const oldest = this.tiles.keys().next().value!;
      const removed = this.tiles.get(oldest)!;
      this.bytes -= removed.bytes;
      release(removed);
      this.tiles.delete(oldest);
    }
    this.tiles.set(key, tile);
    this.bytes += tile.bytes;
    return tile;
  }

  paint(context: CanvasRenderingContext2D, viewport: Rect) {
    const transform = context.getTransform();
    // Power-of-two levels avoid rebuilding every tile for each wheel event.
    // Retain CSS pixel sampling when zooming out. Repainting directly below 1x
    // changes bitmap mip phases and drops fine text/icon strokes. The working
    // set budget below can still lower this level for very large documents.
    let resolution = Math.min(8, Math.max(1, 2 ** Math.round(Math.log2(Math.abs(transform.a)))));
    const tileCount = (level: number) => {
      const span = TILE_PIXELS / level;
      const columns = Math.max(
        0,
        Math.min(
          Math.ceil(this.document.width / span) - 1,
          Math.floor((viewport.x + viewport.width) / span),
        ) -
          Math.max(0, Math.floor(viewport.x / span)) +
          1,
      );
      const rows = Math.max(
        0,
        Math.min(
          Math.ceil(this.document.height / span) - 1,
          Math.floor((viewport.y + viewport.height) / span),
        ) -
          Math.max(0, Math.floor(viewport.y / span)) +
          1,
      );
      return columns * rows;
    };
    // The visible working set must fit together, or an LRU would evict tiles
    // needed again on the next frame. Leave room for the previous zoom level.
    while (
      resolution > 0.125 &&
      tileCount(resolution) * (TILE_PIXELS + GUTTER * 2) ** 2 * 4 > MAX_BYTES * 0.75
    )
      resolution /= 2;
    const span = TILE_PIXELS / resolution;
    const left = Math.max(0, Math.floor(viewport.x / span));
    const top = Math.max(0, Math.floor(viewport.y / span));
    const right = Math.min(
      Math.ceil(this.document.width / span) - 1,
      Math.floor((viewport.x + viewport.width) / span),
    );
    const bottom = Math.min(
      Math.ceil(this.document.height / span) - 1,
      Math.floor((viewport.y + viewport.height) / span),
    );
    for (let row = top; row <= bottom; row++)
      for (let column = left; column <= right; column++) {
        const { image, box } = this.tile(column, row, resolution);
        // Partition at device-pixel boundaries, and sample the gutter outside
        // each tile. Fractional camera positions must not introduce tile seams.
        const x = (Math.round(box.x * transform.a + transform.e) - transform.e) / transform.a;
        const y = (Math.round(box.y * transform.d + transform.f) - transform.f) / transform.d;
        const farX =
          (Math.round((box.x + box.width) * transform.a + transform.e) - transform.e) / transform.a;
        const farY =
          (Math.round((box.y + box.height) * transform.d + transform.f) - transform.f) /
          transform.d;
        context.save();
        context.beginPath();
        context.rect(x, y, farX - x, farY - y);
        context.clip();
        // Tiles contain the complete artboard backdrop for native blends and
        // backdrop filters. Replace the caller's initial background here so a
        // translucent document background is not composited a second time.
        context.clearRect(x, y, farX - x, farY - y);
        context.drawImage(
          image,
          box.x - GUTTER / resolution,
          box.y - GUTTER / resolution,
          image.width / resolution,
          image.height / resolution,
        );
        context.restore();
      }
  }
}
