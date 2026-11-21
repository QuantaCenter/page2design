// CSS Images 3: gradient-line geometry and color-stop fixup.
// https://www.w3.org/TR/css-images-3/#linear-gradients
import { splitCss, cssLength } from './css-values.js';
import { imagePosition } from './images.js';
export const splitArguments = (value: string) => splitCss(value);
const interpolationPattern =
  /\bin\s+([\w-]+(?:\s+(?:shorter|longer|increasing|decreasing)\s+hue)?)/;
const interpolation = (pieces: string[]) => {
  if (/^(?:rgb|hsl|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/.test(pieces[0]))
    return undefined;
  const match = interpolationPattern.exec(pieces[0]);
  if (match) {
    pieces[0] = pieces[0].replace(match[0], '').trim();
    if (!pieces[0]) pieces.shift();
  }
  return match?.[1];
};

export function linearGradient(
  ctx: CanvasRenderingContext2D,
  css: string,
  width: number,
  height: number,
) {
  const match = /^(repeating-)?linear-gradient\((.*)\)$/.exec(css);
  if (!match) return undefined;
  const pieces = splitArguments(match[2]);
  const space = interpolation(pieces);
  let angle = Math.PI;
  if (Number.isFinite(cssLength(pieces[0], Math.PI * 2, true))) {
    angle = cssLength(pieces.shift()!, Math.PI * 2, true);
  } else if (pieces[0].startsWith('to ')) {
    const direction = pieces.shift()!;
    const dx = direction.includes('right') ? 1 : direction.includes('left') ? -1 : 0;
    const dy = direction.includes('bottom') ? 1 : direction.includes('top') ? -1 : 0;
    angle = Math.atan2(dx * (dy ? height : 1), -dy * (dx ? width : 1));
  }
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  const length = Math.abs(width * dx) + Math.abs(height * dy);
  const stops = interpolateStops(stopsFor(pieces, length), space);
  if (stops.length < 2) return undefined;
  let expanded = stops;
  const first = stops[0].offset!;
  const last = stops.at(-1)!.offset!;
  if (match[1] && last > first) {
    const period = last - first;
    const from = Math.floor(-first / period) - 1;
    const to = Math.ceil((length - first) / period) + 1;
    if ((to - from) * stops.length > 65536) return undefined;
    expanded = [];
    for (let cycle = from; cycle <= to; cycle++)
      for (const stop of stops)
        expanded.push({ color: stop.color, offset: stop.offset! + period * cycle });
  }
  const start = expanded[0].offset!;
  const end = expanded.at(-1)!.offset!;
  const origin = { x: width / 2 - (dx * length) / 2, y: height / 2 - (dy * length) / 2 };
  const extent = end > start ? end : start + 1;
  const gradient = ctx.createLinearGradient(
    origin.x + dx * start,
    origin.y + dy * start,
    origin.x + dx * extent,
    origin.y + dy * extent,
  );
  try {
    if (end <= start) {
      gradient.addColorStop(0, expanded.at(-1)!.color);
      gradient.addColorStop(1, expanded.at(-1)!.color);
    } else
      for (const stop of expanded)
        gradient.addColorStop(
          Math.min(1, Math.max(0, (stop.offset! - start) / (end - start))),
          stop.color,
        );
  } catch {
    return undefined;
  }
  return gradient;
}

type Stop = { color: string; offset?: number; hint?: number };
function stopsFor(pieces: string[], length: number, angular = false) {
  const stops: Stop[] = [];
  for (const piece of pieces) {
    const hint = cssLength(piece, length, angular);
    if (stops.length && Number.isFinite(hint)) {
      stops.at(-1)!.hint = hint;
      continue;
    }
    const tokens = splitCss(piece, true),
      offsets: number[] = [];
    for (let count = 0; count < 2 && tokens.length > 1; count++) {
      const value = cssLength(tokens.at(-1)!, length, angular);
      if (!Number.isFinite(value)) break;
      offsets.unshift(value);
      tokens.pop();
    }
    if (offsets.length)
      for (const offset of offsets) stops.push({ color: tokens.join(' '), offset });
    else stops.push({ color: piece });
  }
  if (stops.length < 2) return [];
  stops[0].offset ??= 0;
  stops.at(-1)!.offset ??= length;
  let previous = -Infinity;
  for (const stop of stops)
    if (stop.offset !== undefined) {
      stop.offset = Math.max(previous, stop.offset);
      previous = stop.offset;
    }
  for (let i = 1; i < stops.length - 1; i++) {
    if (stops[i].offset !== undefined) continue;
    const from = i - 1;
    let end = i;
    while (stops[end].offset === undefined) end++;
    for (; i < end; i++)
      stops[i].offset =
        stops[from].offset! +
        ((stops[end].offset! - stops[from].offset!) * (i - from)) / (end - from);
  }
  return stops as (Stop & { offset: number })[];
}
function repeatingStops(stops: { color: string; offset: number }[], extent: number) {
  const first = stops[0].offset,
    last = stops.at(-1)!.offset,
    period = last - first;
  if (period <= 0)
    return [
      { color: stops.at(-1)!.color, offset: 0 },
      { color: stops.at(-1)!.color, offset: extent },
    ];
  const from = Math.floor(-first / period) - 1,
    to = Math.ceil((extent - first) / period) + 1;
  if ((to - from) * stops.length > 65536) return [];
  return Array.from({ length: to - from + 1 }, (_, index) =>
    stops.map((stop) => ({ ...stop, offset: stop.offset + (index + from) * period })),
  ).flat();
}
let sample: OffscreenCanvasRenderingContext2D | undefined;
const mixedColors = new Map<string, string[]>();
const alphas = new Map<string, number>();
function pixelColor(color: string) {
  sample ||= new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })!;
  sample.clearRect(0, 0, 1, 1);
  sample.fillStyle = color;
  sample.fillRect(0, 0, 1, 1);
  return sample.getImageData(0, 0, 1, 1).data;
}
function mixColor(a: string, b: string, weight: number, space = 'srgb') {
  if (weight <= 0) return a;
  if (weight >= 1) return b;
  const rgba = pixelColor(
    `color-mix(in ${space}, ${a} ${(1 - weight) * 100}%, ${b} ${weight * 100}%)`,
  );
  return `rgba(${rgba[0]},${rgba[1]},${rgba[2]},${rgba[3] / 255})`;
}
/** Canvas interpolates straight RGBA; CSS gradients interpolate premultiplied
 * colors. Native CSS color-mix supplies both that rule and explicit color spaces. */
function interpolateStops(stops: (Stop & { offset: number })[], space?: string) {
  if (stops.length < 2) return stops;
  const result: { color: string; offset: number }[] = [];
  for (let index = 0; index < stops.length - 1; index++) {
    const a = stops[index],
      b = stops[index + 1],
      length = b.offset - a.offset;
    const alpha = (color: string) => {
      let value = alphas.get(color);
      if (value === undefined) {
        value = pixelColor(color)[3];
        if (alphas.size > 512) alphas.clear();
        alphas.set(color, value);
      }
      return value;
    };
    if (length <= 0 || (!space && a.hint === undefined && alpha(a.color) === alpha(b.color))) {
      result.push({ color: a.color, offset: a.offset });
      continue;
    }
    const hint =
      a.hint === undefined ? 0.5 : Math.max(0, Math.min(1, (a.hint - a.offset) / length));
    if (hint === 0) {
      result.push({ color: a.color, offset: a.offset }, { color: b.color, offset: a.offset });
      continue;
    }
    if (hint === 1) {
      result.push({ color: a.color, offset: a.offset }, { color: a.color, offset: b.offset });
      continue;
    }
    const exponent = Math.log(0.5) / Math.log(hint),
      key = JSON.stringify([a.color, b.color, space || 'srgb']);
    let colors = mixedColors.get(key);
    if (!colors) {
      colors = Array.from({ length: 257 }, (_, i) => mixColor(a.color, b.color, i / 256, space));
      if (mixedColors.size >= 128) mixedColors.delete(mixedColors.keys().next().value!);
      mixedColors.set(key, colors);
    }
    const positions = new Set<number>([0]);
    for (let i = 1; i < 256; i++) {
      positions.add(i / 256);
      positions.add((i / 256) ** (1 / exponent));
    }
    for (const t of [...positions].sort((a, b) => a - b)) {
      const weight = t ** exponent,
        position = weight * 256,
        lower = Math.floor(position),
        fraction = position - lower;
      const color =
        fraction < 1e-8
          ? colors[lower]
          : mixColor(colors[lower], colors[Math.min(256, lower + 1)], fraction);
      result.push({ color, offset: a.offset + length * t });
    }
  }
  result.push({ color: stops.at(-1)!.color, offset: stops.at(-1)!.offset });
  return result;
}
function colorAt(stops: { color: string; offset: number }[], offset: number) {
  const right = stops.findIndex((stop) => stop.offset > offset);
  if (right < 0) return stops.at(-1)!.color;
  if (right === 0) return stops[0].color;
  const a = stops[right - 1],
    b = stops[right];
  return mixColor(a.color, b.color, (offset - a.offset) / (b.offset - a.offset));
}
function boundedStops(stops: { color: string; offset: number }[], end: number) {
  return [
    { color: colorAt(stops, 0), offset: 0 },
    ...stops.filter((stop) => stop.offset >= 0 && stop.offset <= end),
    { color: colorAt(stops, end), offset: end },
  ];
}
/** Gradients are generated from CSS parameters with native Canvas primitives. */
export function paintCssGradient(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  css: string,
  width: number,
  height: number,
) {
  if (/^(repeating-)?linear-gradient\(/.test(css)) {
    const gradient = linearGradient(context as CanvasRenderingContext2D, css, width, height);
    if (!gradient) return false;
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    return true;
  }
  const match = /^(repeating-)?(radial|conic)-gradient\((.*)\)$/.exec(css);
  if (!match) return false;
  const pieces = splitCss(match[3]);
  const space = interpolation(pieces);
  let header = '';
  if (
    !/^(?:rgb|hsl|hwb|lab|lch|oklab|oklch|color)\(/.test(pieces[0]) &&
    /\b(?:at|circle|ellipse|closest-side|closest-corner|farthest-side|farthest-corner|from)\b|^(?:\d|\.|calc\()/.test(
      pieces[0],
    ) &&
    pieces[0]
      .trim()
      .split(/\s+/)
      .some((token) => /^(?:at|from|circle|ellipse|closest-|farthest-|calc\(|[\d.]+px)/.test(token))
  )
    header = pieces.shift()!;
  const position = /\bat\s+(.+)$/.exec(header)?.[1] || '50% 50%';
  const center = imagePosition(position, width, height);
  let stops, gradient: CanvasGradient;
  context.save();
  try {
    if (match[2] === 'conic') {
      stops = interpolateStops(stopsFor(pieces, Math.PI * 2, true), space);
      if (!stops.length) return false;
      if (match[1]) stops = repeatingStops(stops, Math.PI * 2);
      if (!stops.length) return false;
      stops = boundedStops(stops, Math.PI * 2);
      const headerTokens = splitCss(header, true),
        fromIndex = headerTokens.indexOf('from');
      const from = fromIndex >= 0 ? headerTokens[fromIndex + 1] : '0deg';
      gradient = context.createConicGradient(
        cssLength(from, Math.PI * 2, true) - Math.PI / 2,
        center.x,
        center.y,
      );
      for (const stop of stops)
        gradient.addColorStop(Math.min(1, Math.max(0, stop.offset / (Math.PI * 2))), stop.color);
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
    } else {
      const geometry = header.split(/\bat\b/)[0].trim(),
        shape = /\bcircle\b/.test(geometry) ? 'circle' : 'ellipse';
      const extent =
        /\b(?:closest|farthest)-(?:side|corner)\b/.exec(geometry)?.[0] || 'farthest-corner';
      const lengths = splitCss(
        geometry.replace(
          /\b(?:circle|ellipse|closest-side|closest-corner|farthest-side|farthest-corner)\b/g,
          '',
        ),
        true,
      );
      const xs = [Math.abs(center.x), Math.abs(width - center.x)],
        ys = [Math.abs(center.y), Math.abs(height - center.y)];
      let rx: number, ry: number;
      if (lengths.length) {
        rx = cssLength(lengths[0], width);
        ry = shape === 'circle' || lengths.length === 1 ? rx : cssLength(lengths[1], height);
      } else if (shape === 'circle') {
        const distances = extent.endsWith('corner')
          ? xs.flatMap((x) => ys.map((y) => Math.hypot(x, y)))
          : [...xs, ...ys];
        rx = (extent.startsWith('closest') ? Math.min : Math.max)(...distances);
        ry = rx;
      } else {
        rx = (extent.startsWith('closest') ? Math.min : Math.max)(...xs);
        ry = (extent.startsWith('closest') ? Math.min : Math.max)(...ys);
        if (extent.endsWith('corner')) {
          const factor = (extent.startsWith('closest') ? Math.min : Math.max)(
            ...xs.flatMap((x) => ys.map((y) => Math.hypot(x / rx, y / ry))),
          );
          rx *= factor;
          ry *= factor;
        }
      }
      stops = interpolateStops(stopsFor(pieces, rx), space);
      if (!stops.length) return false;
      if (!(rx > 0 && ry > 0)) {
        context.fillStyle = stops.at(-1)!.color;
        context.fillRect(0, 0, width, height);
        return true;
      }
      const maximum = Math.max(
        ...xs.flatMap((x) => ys.map((y) => Math.hypot(x / rx, y / ry) * rx)),
      );
      if (match[1]) stops = repeatingStops(stops, maximum);
      if (!stops.length) return false;
      const end = Math.max(0, stops.at(-1)!.offset);
      if (!end) {
        context.fillStyle = stops.at(-1)!.color;
        context.fillRect(0, 0, width, height);
        return true;
      }
      stops = boundedStops(stops, end);
      context.translate(center.x, center.y);
      context.scale(rx, ry);
      gradient = context.createRadialGradient(0, 0, 0, 0, 0, end / rx);
      for (const stop of stops)
        gradient.addColorStop(Math.min(1, Math.max(0, stop.offset / end)), stop.color);
      context.fillStyle = gradient;
      context.fillRect(-center.x / rx, -center.y / ry, width / rx, height / ry);
    }
    return true;
  } catch {
    return false;
  } finally {
    context.restore();
  }
}
