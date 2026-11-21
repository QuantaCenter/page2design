import type { DesignNode } from '../model/design.js';
import { splitArguments } from './gradient.js';

type ShadowBitmap = { image: OffscreenCanvas; x: number; y: number };
const cache = new Map<string, ShadowBitmap>();

/** Build box shadows in CSS pixels, then scale with the scene. Canvas shadowBlur
 * and shadowOffset themselves are device-space values and cannot be used on a
 * zoomed Konva context directly. The element remains an independent frame. */
export function paintShadows(ctx: CanvasRenderingContext2D, node: DesignNode, inset = false) {
  const css = node.style['box-shadow'];
  if (!css || css === 'none') return;
  const { width, height } = node.box;
  const key = JSON.stringify([width, height, node.radius, node.radiusY, node.border, css, inset]);
  let bitmap = cache.get(key);
  if (!bitmap) {
    const shadows = splitArguments(css)
      .filter((value) => value.includes('inset') === inset)
      .map((value) => {
        const sizes = Array.from(value.matchAll(/(-?[\d.]+)px/g), (match) => Number(match[1]));
        return {
          x: sizes[0] || 0,
          y: sizes[1] || 0,
          blur: sizes[2] || 0,
          spread: sizes[3] || 0,
          color: value.replace(/-?[\d.]+px\s*|\binset\b/g, '').trim() || 'black',
        };
      });
    if (!shadows.length) return;
    if (inset) {
      const image = new OffscreenCanvas(
        Math.max(1, Math.ceil(width)),
        Math.max(1, Math.ceil(height)),
      );
      const context = image.getContext('2d')!;
      const { top, right, bottom, left } = node.border;
      const innerWidth = Math.max(0, width - left - right),
        innerHeight = Math.max(0, height - top - bottom);
      const rx = node.radius.map((r, i) => Math.max(0, r - (i === 0 || i === 3 ? left : right)));
      const ry = (node.radiusY || node.radius).map((r, i) =>
        Math.max(0, r - (i < 2 ? top : bottom)),
      );
      context.beginPath();
      context.roundRect(
        left,
        top,
        innerWidth,
        innerHeight,
        rx.map((x, i) => ({ x, y: ry[i] })),
      );
      context.clip();
      for (const shadow of [...shadows].reverse()) {
        const margin = Math.ceil(
          Math.max(Math.abs(shadow.x), Math.abs(shadow.y)) +
            shadow.blur * 2 +
            Math.abs(shadow.spread) +
            8,
        );
        context.shadowColor = shadow.color;
        context.shadowBlur = shadow.blur;
        context.shadowOffsetX = 10000 + shadow.x;
        context.shadowOffsetY = shadow.y;
        context.fillStyle = '#000';
        context.beginPath();
        context.rect(-10000 - margin, -margin, width + margin * 2, height + margin * 2);
        const w = innerWidth - shadow.spread * 2,
          h = innerHeight - shadow.spread * 2;
        if (w > 0 && h > 0)
          context.roundRect(
            -10000 + left + shadow.spread,
            top + shadow.spread,
            w,
            h,
            rx.map((x, i) => ({
              x: Math.max(0, x - shadow.spread),
              y: Math.max(0, ry[i] - shadow.spread),
            })),
          );
        context.fill('evenodd');
      }
      bitmap = { image, x: 0, y: 0 };
      if (cache.size >= 128) cache.delete(cache.keys().next().value!);
      cache.set(key, bitmap);
    } else {
      const marginX = Math.ceil(
        Math.max(
          ...shadows.map(
            (shadow) => Math.abs(shadow.x) + shadow.blur * 1.5 + Math.max(0, shadow.spread),
          ),
        ) + 3,
      );
      const marginY = Math.ceil(
        Math.max(
          ...shadows.map(
            (shadow) => Math.abs(shadow.y) + shadow.blur * 1.5 + Math.max(0, shadow.spread),
          ),
        ) + 3,
      );
      const image = new OffscreenCanvas(
        Math.ceil(width + marginX * 2),
        Math.ceil(height + marginY * 2),
      );
      const context = image.getContext('2d')!;
      context.translate(marginX, marginY);
      context.beginPath();
      context.rect(-marginX, -marginY, image.width, image.height);
      context.roundRect(
        0,
        0,
        width,
        height,
        node.radiusY ? node.radius.map((x, i) => ({ x, y: node.radiusY![i] })) : node.radius,
      );
      context.clip('evenodd');
      // First listed CSS shadow is closest to the viewer. Clip out the original
      // border box even for a transparent fill, without cutting off the spread.
      for (const shadow of shadows.reverse()) {
        if (width + 2 * shadow.spread <= 0 || height + 2 * shadow.spread <= 0) continue;
        context.shadowColor = shadow.color;
        context.shadowBlur = shadow.blur;
        context.shadowOffsetX = shadow.x + 10000;
        context.shadowOffsetY = shadow.y;
        context.fillStyle = '#000';
        const spreadRadius = (radius: number) =>
          Math.max(
            0,
            radius +
              shadow.spread *
                (shadow.spread > radius && radius > 0
                  ? 1 + (radius / shadow.spread - 1) ** 3
                  : radius === 0
                    ? 0
                    : 1),
          );
        const radii = node.radiusY
          ? node.radius.map((radius, index) => ({
              x: spreadRadius(radius),
              y: spreadRadius(node.radiusY![index]),
            }))
          : node.radius.map(spreadRadius);
        context.beginPath();
        context.roundRect(
          -10000 - shadow.spread,
          -shadow.spread,
          width + 2 * shadow.spread,
          height + 2 * shadow.spread,
          radii,
        );
        context.fill();
      }
      bitmap = { image, x: -marginX, y: -marginY };
      if (cache.size >= 128) cache.delete(cache.keys().next().value!);
      cache.set(key, bitmap);
    }
  }
  ctx.drawImage(bitmap.image, bitmap.x, bitmap.y);
}
