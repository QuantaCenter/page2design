import type { DesignNode, TextRun } from '../model/design.js';
import { splitArguments } from './gradient.js';

interface ShadowBitmap {
  image: OffscreenCanvas;
  x: number;
  y: number;
  bytes: number;
}
const cache = new Map<string, ShadowBitmap>();
const MAX_BYTES = 16 * 1024 * 1024;
let bytes = 0;

function styleRun(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  run: TextRun,
) {
  context.font = `${run.fontStyle} ${run.fontWeight} ${run.fontSize}px ${run.fontFamily}`;
  context.textBaseline = 'alphabetic';
  context.fillStyle = run.color;
  context.letterSpacing = `${run.letterSpacing}px`;
  context.fontKerning = run.fontKerning || 'auto';
  if ('lang' in context) context.lang = run.language || 'inherit';
}

function drawRun(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  run: TextRun,
  x: number,
  baseline: number,
) {
  context.fillText(run.text, x, baseline);
  context.strokeStyle = run.color;
  context.lineWidth = Math.max(1, run.fontSize / 16);
  for (const decoration of ['underline', 'line-through']) {
    if (!run.decoration.includes(decoration)) continue;
    const y =
      decoration === 'line-through'
        ? baseline - run.fontSize * 0.3
        : baseline + run.fontSize * 0.12;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + run.width, y);
    context.stroke();
  }
}

/** Shadows are generated from native glyphs at CSS resolution, independently
 * of the camera. Glyphs themselves remain vector text at the final resolution. */
export function paintText(context: CanvasRenderingContext2D, node: DesignNode) {
  const runs = node.runs || [];
  const local = runs.map((run) => ({
    ...run,
    x: run.x - node.box.x,
    y: run.y - node.box.y,
    baseline: run.baseline - node.box.y,
  }));
  const shadows = local.map((run) =>
    splitArguments(run.textShadow || node.style['text-shadow'] || 'none')
      .filter((value) => value !== 'none')
      .map((value) => {
        const sizes = Array.from(value.matchAll(/(-?[\d.]+)px/g), (match) => Number(match[1]));
        return {
          x: sizes[0] || 0,
          y: sizes[1] || 0,
          blur: sizes[2] || 0,
          color: value.replace(/-?[\d.]+px\s*/g, '').trim() || run.color,
        };
      }),
  );
  if (shadows.some((values) => values.length)) {
    const key = JSON.stringify([local, shadows]);
    let bitmap = cache.get(key);
    if (!bitmap) {
      const margin = Math.ceil(
        Math.max(
          ...shadows
            .flat()
            .map((shadow) => Math.max(Math.abs(shadow.x), Math.abs(shadow.y)) + shadow.blur * 1.5),
        ) + 3,
      );
      const x = Math.floor(Math.min(0, ...local.map((run) => run.x)) - margin),
        y = Math.floor(Math.min(0, ...local.map((run) => run.y)) - margin);
      const width = Math.ceil(
        Math.max(node.box.width, ...local.map((run) => run.x + run.width)) - x + margin,
      );
      const height = Math.ceil(
        Math.max(node.box.height, ...local.map((run) => run.y + run.height)) - y + margin,
      );
      const image = new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
      const layer = image.getContext('2d')!;
      layer.translate(-x, -y);
      local.forEach((run, index) => {
        styleRun(layer, { ...run, color: '#000' });
        for (const shadow of [...shadows[index]].reverse()) {
          layer.shadowColor = shadow.color;
          layer.shadowBlur = shadow.blur;
          layer.shadowOffsetX = shadow.x + 10000;
          layer.shadowOffsetY = shadow.y;
          drawRun(layer, { ...run, color: '#000' }, run.x - 10000, run.baseline);
        }
      });
      bitmap = { image, x, y, bytes: image.width * image.height * 4 };
      if (bitmap.bytes <= MAX_BYTES) {
        while (bytes + bitmap.bytes > MAX_BYTES && cache.size) {
          const first = cache.keys().next().value!;
          const removed = cache.get(first)!;
          bytes -= removed.bytes;
          removed.image.width = removed.image.height = 0;
          cache.delete(first);
        }
        cache.set(key, bitmap);
        bytes += bitmap.bytes;
      }
    }
    context.drawImage(bitmap.image, bitmap.x, bitmap.y);
  }
  for (const run of local) {
    styleRun(context, run);
    drawRun(context, run, run.x, run.baseline);
  }
}
