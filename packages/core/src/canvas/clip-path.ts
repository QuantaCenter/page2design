import type { Rect, ShapeClip } from '../model/design.js';
import { cssLength, splitCss } from './css-values.js';
import { imagePosition } from './images.js';
import { projectPoint, inverseTransform } from '../model/transform.js';
import { shapeData } from './shape.js';

interface CompiledShape {
  path: Path2D;
  data: string;
  rule: CanvasFillRule;
}
const shapes = new Map<string, CompiledShape>();
const spread = (values: string[]) => [
  values[0],
  values[1] || values[0],
  values[2] || values[0],
  values[3] || values[1] || values[0],
];
function rounded(x: number, y: number, width: number, height: number, rx: number[], ry: number[]) {
  if (width <= 0 || height <= 0) return '';
  const scale = Math.min(
    1,
    width / (rx[0] + rx[1] || 1),
    width / (rx[2] + rx[3] || 1),
    height / (ry[0] + ry[3] || 1),
    height / (ry[1] + ry[2] || 1),
  );
  rx = rx.map((value) => Math.max(0, value * scale));
  ry = ry.map((value) => Math.max(0, value * scale));
  const corner = (i: number, X: number, Y: number) =>
    rx[i] && ry[i] ? `A ${rx[i]} ${ry[i]} 0 0 1 ${X} ${Y}` : `L ${X} ${Y}`;
  return `M ${x + rx[0]} ${y} H ${x + width - rx[1]} ${corner(1, x + width, y + ry[1])} V ${y + height - ry[2]} ${corner(2, x + width - rx[2], y + height)} H ${x + rx[3]} ${corner(3, x, y + height - ry[3])} V ${y + ry[0]} ${corner(0, x + rx[0], y)} Z`;
}

/** Compile CSS geometry into a native vector path in its measured reference box.
 * The path is also used for pointer tests; no source-page bitmap is involved. */
export function clipShape(clip: ShapeClip): CompiledShape {
  const { width: w, height: h } = clip.box,
    key = JSON.stringify([clip.value, w, h, clip.box.radius, clip.box.radiusY]);
  const cached = shapes.get(key);
  if (cached) return cached;
  let data = '',
    rule: CanvasFillRule = 'nonzero';
  const match = /^(\w+)\((.*)\)$/.exec(clip.value),
    name = match?.[1],
    body = match?.[2] || '';
  if (!clip.value) data = rounded(0, 0, w, h, clip.box.radius, clip.box.radiusY || clip.box.radius);
  else if (name === 'path') {
    const parts = splitCss(body);
    if (parts[0] === 'evenodd' || parts[0] === 'nonzero') rule = parts.shift()! as CanvasFillRule;
    const text = parts.join(',').trim();
    data = text.slice(1, -1).replace(/\\([\\"'])/g, '$1');
  } else if (name === 'shape') ({ data, rule } = shapeData(body, w, h));
  else if (name === 'polygon') {
    const parts = splitCss(body);
    let radius = 0;
    if (/\b(?:evenodd|nonzero|round)\b/.test(parts[0])) {
      const header = splitCss(parts.shift()!, true);
      if (header.includes('evenodd')) rule = 'evenodd';
      const index = header.indexOf('round');
      if (index >= 0) radius = cssLength(header[index + 1], Math.hypot(w, h) / Math.SQRT2);
    }
    const points = parts.map((point) => {
      const [x, y] = splitCss(point, true);
      return { x: cssLength(x, w), y: cssLength(y, h) };
    });
    if (radius > 0) {
      data =
        points
          .map((p, index) => {
            const previous = points[(index + points.length - 1) % points.length],
              next = points[(index + 1) % points.length],
              a = Math.hypot(previous.x - p.x, previous.y - p.y),
              b = Math.hypot(next.x - p.x, next.y - p.y);
            if (!a || !b) return `${index ? 'L' : 'M'} ${p.x} ${p.y}`;
            const ux = (previous.x - p.x) / a,
              uy = (previous.y - p.y) / a,
              vx = (next.x - p.x) / b,
              vy = (next.y - p.y) / b,
              tan = Math.tan(Math.acos(Math.max(-1, Math.min(1, ux * vx + uy * vy))) / 2),
              distance = Math.min(radius / tan, a / 2, b / 2),
              r = distance * tan;
            const start = { x: p.x + ux * distance, y: p.y + uy * distance },
              end = { x: p.x + vx * distance, y: p.y + vy * distance };
            const cross = (p.x - previous.x) * (next.y - p.y) - (p.y - previous.y) * (next.x - p.x);
            return `${index ? 'L' : 'M'} ${start.x} ${start.y} ${r > 1e-8 ? `A ${r} ${r} 0 0 ${cross > 0 ? 1 : 0} ${end.x} ${end.y}` : `L ${end.x} ${end.y}`}`;
          })
          .join(' ') + ' Z';
    } else data = points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ') + ' Z';
  } else if (name === 'circle' || name === 'ellipse') {
    const tokens = splitCss(body, true),
      at = tokens.indexOf('at'),
      radii = at < 0 ? tokens : tokens.slice(0, at),
      position = at < 0 ? '50% 50%' : tokens.slice(at + 1).join(' '),
      center = imagePosition(position, w, h);
    const radius = (value: string | undefined, axis: number, basis: number) =>
      value === 'farthest-side'
        ? Math.max(Math.abs(axis), Math.abs(basis - axis))
        : !value || value === 'closest-side'
          ? Math.min(Math.abs(axis), Math.abs(basis - axis))
          : cssLength(value, basis);
    let rx: number, ry: number;
    if (name === 'circle') {
      const value = radii[0] || 'closest-side';
      rx = ry =
        value === 'closest-side' || value === 'farthest-side'
          ? (value === 'closest-side' ? Math.min : Math.max)(
              Math.abs(center.x),
              Math.abs(w - center.x),
              Math.abs(center.y),
              Math.abs(h - center.y),
            )
          : cssLength(value, Math.hypot(w, h) / Math.SQRT2);
    } else {
      rx = radius(radii[0], center.x, w);
      ry = radius(radii[1], center.y, h);
    }
    if (rx > 0 && ry > 0)
      data = `M ${center.x - rx} ${center.y} A ${rx} ${ry} 0 1 0 ${center.x + rx} ${center.y} A ${rx} ${ry} 0 1 0 ${center.x - rx} ${center.y} Z`;
  } else if (['inset', 'rect', 'xywh'].includes(name || '')) {
    const tokens = splitCss(body, true),
      round = tokens.indexOf('round'),
      coords = round < 0 ? tokens : tokens.slice(0, round),
      radii = round < 0 ? [] : tokens.slice(round + 1),
      slash = radii.indexOf('/');
    let x: number, y: number, width: number, height: number;
    if (name === 'xywh') {
      x = cssLength(coords[0], w);
      y = cssLength(coords[1], h);
      width = cssLength(coords[2], w);
      height = cssLength(coords[3], h);
    } else {
      const values = name === 'inset' ? spread(coords) : coords;
      const top = values[0] === 'auto' ? 0 : cssLength(values[0], h),
        right = values[1] === 'auto' ? w : cssLength(values[1], w),
        bottom = values[2] === 'auto' ? h : cssLength(values[2], h),
        left = values[3] === 'auto' ? 0 : cssLength(values[3], w);
      x = left;
      y = top;
      width = name === 'inset' ? w - left - right : right - left;
      height = name === 'inset' ? h - top - bottom : bottom - top;
    }
    const xs = spread(slash < 0 ? radii : radii.slice(0, slash)),
      ys = spread(slash < 0 ? radii : radii.slice(slash + 1));
    data = rounded(
      x,
      y,
      width,
      height,
      xs.map((value) => cssLength(value || '0px', w)),
      ys.map((value) => cssLength(value || '0px', h)),
    );
  }
  const result = { data, path: new Path2D(data), rule };
  if (shapes.size >= 256) shapes.delete(shapes.keys().next().value!);
  shapes.set(key, result);
  return result;
}

/** Separate SVG contours while retaining relative path commands. Native SVG
 * geometry supplies curve sampling only for the perspective hit-mask adapter. */
function contours(data: string) {
  const tokens =
    data.match(/[MmZzLlHhVvCcSsQqTtAa]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi) || [];
  const paths: string[] = [];
  let command = '',
    path = '',
    x = 0,
    y = 0,
    startX = 0,
    startY = 0,
    index = 0;
  const sizes: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7 };
  while (index < tokens.length) {
    if (/^[a-z]$/i.test(tokens[index])) command = tokens[index++];
    const lower = command.toLowerCase(),
      relative = command === lower;
    if (lower === 'z') {
      path += ' Z';
      x = startX;
      y = startY;
      command = '';
      continue;
    }
    const count = sizes[lower];
    if (!count || index + count > tokens.length) break;
    const values = tokens.slice(index, index + count).map(Number);
    index += count;
    if (lower === 'h') x = values[0] + (relative ? x : 0);
    else if (lower === 'v') y = values[0] + (relative ? y : 0);
    else {
      x = values.at(-2)! + (relative ? x : 0);
      y = values.at(-1)! + (relative ? y : 0);
    }
    if (lower === 'm') {
      if (path) paths.push(path);
      path = `M ${x} ${y}`;
      startX = x;
      startY = y;
      command = relative ? 'l' : 'L';
    } else path += ` ${command} ${values.join(' ')}`;
  }
  if (path) paths.push(path);
  return paths;
}

export function shapeClipPath(clip: ShapeClip, origin: Pick<Rect, 'x' | 'y'>, density = 1) {
  const shape = clipShape(clip),
    path = new Path2D(),
    m = clip.transform,
    box = clip.box;
  if (!m || Math.abs(m[6]) + Math.abs(m[7]) < 1e-10) {
    const matrix = m
      ? new DOMMatrix([
          m[0] / m[8],
          m[3] / m[8],
          m[1] / m[8],
          m[4] / m[8],
          (m[0] * box.x + m[1] * box.y + m[2]) / m[8] - origin.x,
          (m[3] * box.x + m[4] * box.y + m[5]) / m[8] - origin.y,
        ])
      : new DOMMatrix().translate(box.x - origin.x, box.y - origin.y);
    path.addPath(shape.path, matrix);
  } else
    for (const contour of contours(shape.data)) {
      const element = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      element.setAttribute('d', contour);
      const length = element.getTotalLength(),
        steps = Math.min(8192, Math.max(8, Math.ceil(length * Math.max(1, density) * 2)));
      for (let i = 0; i <= steps; i++) {
        const p = element.getPointAtLength((length * i) / steps),
          point = projectPoint(m, { x: p.x + box.x, y: p.y + box.y });
        if (i) path.lineTo(point.x - origin.x, point.y - origin.y);
        else path.moveTo(point.x - origin.x, point.y - origin.y);
      }
      path.closePath();
    }
  return { path, rule: shape.rule };
}

export function inShapeClip(
  context: CanvasRenderingContext2D,
  clip: ShapeClip,
  point: { x: number; y: number },
) {
  const matrix = clip.transform && inverseTransform(clip.transform);
  if (clip.transform && !matrix) return false;
  const local = matrix ? projectPoint(matrix, point) : point,
    shape = clipShape(clip);
  return context.isPointInPath(shape.path, local.x - clip.box.x, local.y - clip.box.y, shape.rule);
}
