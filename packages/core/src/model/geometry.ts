import type { Camera, Rect } from './design.js';

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
export const round = (value: number, digits = 1) => Number(value.toFixed(digits));

export function screenToDocument(point: { x: number; y: number }, camera: Camera) {
  return { x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale };
}

export function zoomAt(camera: Camera, point: { x: number; y: number }, nextScale: number): Camera {
  const scale = clamp(nextScale, 0.1, 4);
  const anchor = screenToDocument(point, camera);
  return { x: point.x - anchor.x * scale, y: point.y - anchor.y * scale, scale };
}

export function fitCamera(
  document: { width: number; height: number },
  viewport: { width: number; height: number },
): Camera {
  const scale = clamp(
    Math.min((viewport.width - 120) / document.width, (viewport.height - 120) / document.height, 1),
    0.1,
    4,
  );
  return {
    x: (viewport.width - document.width * scale) / 2,
    y: Math.max(90, (viewport.height - document.height * scale) / 2),
    scale,
  };
}

export function intersects(a: Rect, b: Rect) {
  return (
    a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
  );
}

export function contains(outer: Rect, inner: Rect) {
  return (
    inner.x >= outer.x - 0.5 &&
    inner.y >= outer.y - 0.5 &&
    inner.x + inner.width <= outer.x + outer.width + 0.5 &&
    inner.y + inner.height <= outer.y + outer.height + 0.5
  );
}

export interface MeasureSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  value: number;
  axis: 'x' | 'y';
}

/** Edge-to-edge gaps, or the four inner distances for a contained rectangle. */
export function measureRects(a: Rect, b: Rect): MeasureSegment[] {
  if (contains(a, b) || contains(b, a)) {
    const outer = contains(a, b) ? a : b;
    const inner = outer === a ? b : a;
    const cx = inner.x + inner.width / 2;
    const cy = inner.y + inner.height / 2;
    return [
      { x1: outer.x, y1: cy, x2: inner.x, y2: cy, value: inner.x - outer.x, axis: 'x' },
      {
        x1: inner.x + inner.width,
        y1: cy,
        x2: outer.x + outer.width,
        y2: cy,
        value: outer.x + outer.width - inner.x - inner.width,
        axis: 'x',
      },
      { x1: cx, y1: outer.y, x2: cx, y2: inner.y, value: inner.y - outer.y, axis: 'y' },
      {
        x1: cx,
        y1: inner.y + inner.height,
        x2: cx,
        y2: outer.y + outer.height,
        value: outer.y + outer.height - inner.y - inner.height,
        axis: 'y',
      },
    ].filter((segment) => segment.value > 0.1) as MeasureSegment[];
  }
  const result: MeasureSegment[] = [];
  if (a.x + a.width <= b.x || b.x + b.width <= a.x) {
    const [left, right] = a.x < b.x ? [a, b] : [b, a];
    const y = (Math.max(a.y, b.y) + Math.min(a.y + a.height, b.y + b.height)) / 2;
    result.push({
      x1: left.x + left.width,
      y1: y,
      x2: right.x,
      y2: y,
      value: right.x - left.x - left.width,
      axis: 'x',
    });
  }
  if (a.y + a.height <= b.y || b.y + b.height <= a.y) {
    const [top, bottom] = a.y < b.y ? [a, b] : [b, a];
    const x = (Math.max(a.x, b.x) + Math.min(a.x + a.width, b.x + b.width)) / 2;
    result.push({
      x1: x,
      y1: top.y + top.height,
      x2: x,
      y2: bottom.y,
      value: bottom.y - top.y - top.height,
      axis: 'y',
    });
  }
  return result;
}
