import type { DesignNode } from '../model/design.js';
import { clipNode, roundPath } from './paint.js';
import { projectedClipPath } from './transform.js';
import { inverseTransform, projectPoint } from '../model/transform.js';
import { shapeClipPath, inShapeClip } from './clip-path.js';

interface HitMask {
  path: Path2D;
  width: number;
  height: number;
}
interface Span {
  x: number;
  y: number;
  width: number;
  height: number;
}
const masks = new WeakMap<HTMLImageElement, HitMask>();
const MIN_ALPHA = 8;

/** Cache only painted hit geometry, not a coloured bitmap per Konva Shape.
 * Merging equal runs across rows keeps a sparse full-screen overlay small. */
function imageMask(image: HTMLImageElement): HitMask {
  const cached = masks.get(image);
  if (cached) return cached;
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const path = new Path2D();
  if (!width || !height) return { path, width: 1, height: 1 };
  const surface = new OffscreenCanvas(width, height);
  const ctx = surface.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const spans: Span[] = [];
  let previous = new Map<string, Span>();
  for (let y = 0; y < height; y++) {
    const current = new Map<string, Span>();
    let x = 0;
    while (x < width) {
      while (x < width && pixels[(y * width + x) * 4 + 3] < MIN_ALPHA) x++;
      const start = x;
      while (x < width && pixels[(y * width + x) * 4 + 3] >= MIN_ALPHA) x++;
      if (x === start) continue;
      const key = `${start}:${x}`;
      let span = previous.get(key);
      if (span) span.height++;
      else {
        span = { x: start, y, width: x - start, height: 1 };
        spans.push(span);
      }
      current.set(key, span);
    }
    previous = current;
  }
  for (const span of spans) path.rect(span.x, span.y, span.width, span.height);
  const mask = { path, width, height };
  masks.set(image, mask);
  return mask;
}

/** Paint into Konva's hit canvas with its unique shape colour. Transparent
 * screenshot pixels remain empty, so they cannot steal hover or selection. */
export function paintRasterHit(
  ctx: CanvasRenderingContext2D,
  node: DesignNode,
  image: HTMLImageElement | undefined,
  color: string,
) {
  if (!image) return;
  const mask = imageMask(image);
  const box = node.rasterBox || node.box;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, node.box.width, node.box.height);
  ctx.clip();
  ctx.translate(box.x - node.box.x, box.y - node.box.y);
  ctx.scale(box.width / mask.width, box.height / mask.height);
  ctx.fillStyle = color;
  ctx.globalAlpha = 1;
  ctx.fill(mask.path);
  ctx.restore();
}

/** Adapter-neutral colour mask for canvas scene libraries. */
export function paintNodeHit(
  ctx: CanvasRenderingContext2D,
  node: DesignNode,
  images: Map<string, HTMLImageElement>,
  color: string,
) {
  if (
    node.canvasBackground ||
    !node.opacity ||
    (!node.hasVisual &&
      (node.style['pointer-events'] === 'none' ||
        (node.compositingGroups || node.opacityGroups)?.some((group) => group.id === node.id)))
  )
    return;
  ctx.save();
  clipNode(ctx, node);
  for (const clip of node.clipPaths || []) {
    const shape = shapeClipPath(clip, node.box, Math.abs(ctx.getTransform().a));
    ctx.clip(shape.path, shape.rule);
  }
  if (node.kind === 'raster')
    paintRasterHit(ctx, node, node.assetId ? images.get(node.assetId) : undefined, color);
  else if (node.transform && node.localBox) {
    for (const area of node.backgroundAreas || [{ ...node.localBox, radius: [0, 0, 0, 0] }]) {
      projectedClipPath(ctx, { ...area, localBox: area, transform: node.transform }, node.box);
      ctx.fillStyle = color;
      ctx.fill();
    }
  } else {
    ctx.beginPath();
    if (node.backgroundAreas)
      for (const area of node.backgroundAreas)
        ctx.roundRect(
          area.x - node.box.x,
          area.y - node.box.y,
          area.width,
          area.height,
          area.radius,
        );
    else ctx.rect(0, 0, node.box.width, node.box.height);
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.restore();
}

/** Nodes must be in painting order; point is in document coordinates. */
export function hitTestNodes(
  ctx: CanvasRenderingContext2D,
  nodes: readonly DesignNode[],
  images: Map<string, HTMLImageElement>,
  point: { x: number; y: number },
): DesignNode | null {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  try {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i],
        x = point.x - node.box.x,
        y = point.y - node.box.y;
      if (
        node.canvasBackground ||
        !node.opacity ||
        (!node.hasVisual &&
          (node.style['pointer-events'] === 'none' ||
            (node.compositingGroups || node.opacityGroups)?.some((group) => group.id === node.id)))
      )
        continue;
      if (
        node.tag === '#table-borders' ||
        x < 0 ||
        y < 0 ||
        x >= node.box.width ||
        y >= node.box.height
      )
        continue;
      if (
        !node.clips.every((clip) => {
          if (clip.transform) {
            projectedClipPath(ctx, clip, node.box);
            return ctx.isPointInPath(x, y);
          }
          roundPath(
            ctx,
            clip.x - node.box.x,
            clip.y - node.box.y,
            clip.width,
            clip.height,
            clip.radius,
            clip.radiusY,
          );
          return ctx.isPointInPath(x, y);
        })
      )
        continue;
      if (!node.clipPaths?.every((clip) => inShapeClip(ctx, clip, point)) && node.clipPaths?.length)
        continue;
      if (node.kind === 'raster') {
        const image = node.assetId && images.get(node.assetId);
        if (!image) continue;
        const mask = imageMask(image),
          box = node.rasterBox || node.box;
        if (
          ctx.isPointInPath(
            mask.path,
            ((point.x - box.x) / box.width) * mask.width,
            ((point.y - box.y) / box.height) * mask.height,
          )
        )
          return node;
      } else if (node.transform && node.localBox) {
        const inverse = inverseTransform(node.transform);
        if (!inverse) continue;
        const local = projectPoint(inverse, point);
        if (
          local.x < node.localBox.x ||
          local.y < node.localBox.y ||
          local.x >= node.localBox.x + node.localBox.width ||
          local.y >= node.localBox.y + node.localBox.height
        )
          continue;
        if (
          !node.backgroundAreas ||
          node.backgroundAreas.some((area) => {
            roundPath(ctx, area.x, area.y, area.width, area.height, area.radius, area.radiusY);
            return ctx.isPointInPath(local.x, local.y);
          })
        )
          return node;
      } else if (
        !node.backgroundAreas ||
        node.backgroundAreas.some((area) => {
          roundPath(
            ctx,
            area.x - node.box.x,
            area.y - node.box.y,
            area.width,
            area.height,
            area.radius,
          );
          return ctx.isPointInPath(x, y);
        })
      )
        return node;
    }
    return null;
  } finally {
    ctx.restore();
  }
}
