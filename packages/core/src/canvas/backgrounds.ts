import type { BackgroundLayer, CssImage, DesignNode, Rect } from '../model/design.js';
import { backgroundSize, paintBackgroundImage, paintBackgroundSurface } from './images.js';
import { cssImageDimensions, paintCssImage } from './css-images.js';

const tiles = new Map<string, OffscreenCanvas>();
let bytes = 0;
const maximum = 16 * 1024 * 1024;
const snap = (box: Rect) => ({
  x: Math.round(box.x),
  y: Math.round(box.y),
  width: Math.round(box.x + box.width) - Math.round(box.x),
  height: Math.round(box.y + box.height) - Math.round(box.y),
});
function imageTile(
  source: CssImage,
  width: number,
  height: number,
  density: number,
  images: Map<string, HTMLImageElement>,
) {
  const key = JSON.stringify([
    source.image,
    source.assetId,
    source.resolution,
    source.crossFade,
    width,
    height,
    density,
  ]);
  const cached = tiles.get(key);
  if (cached) return cached;
  const scale = Math.min(
    density,
    8192 / width,
    8192 / height,
    Math.sqrt((16 * 1024 * 1024) / (width * height)),
  );
  const image = new OffscreenCanvas(
    Math.max(1, Math.ceil(width * scale)),
    Math.max(1, Math.ceil(height * scale)),
  );
  const context = image.getContext('2d')!;
  context.scale(image.width / width, image.height / height);
  if (!paintCssImage(context as unknown as CanvasRenderingContext2D, source, width, height, images))
    return undefined;
  const cost = image.width * image.height * 4;
  if (cost <= maximum) {
    while (bytes + cost > maximum && tiles.size) {
      const key = tiles.keys().next().value!,
        old = tiles.get(key)!;
      bytes -= old.width * old.height * 4;
      old.width = old.height = 0;
      tiles.delete(key);
    }
    tiles.set(key, image);
    bytes += cost;
  }
  return image;
}
export function paintImageLayer(
  target: CanvasRenderingContext2D,
  layer: BackgroundLayer,
  origin: Rect,
  images: Map<string, HTMLImageElement>,
  unclipped?: Rect,
) {
  target.save();
  if (!unclipped) {
    clip(target, layer.clip, origin);
    if (layer.scrollClip) clip(target, layer.scrollClip, origin);
  }
  if (layer.imageClip) {
    const box = layer.imageClip;
    target.beginPath();
    target.rect(box.x - origin.x, box.y - origin.y, box.width, box.height);
    target.clip();
  }
  const box = snap(layer.box),
    cut = unclipped || snap(layer.clip),
    matrix = target.getTransform();
  const density = Math.max(0.25, Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
  const area = { ...box, x: box.x - origin.x, y: box.y - origin.y },
    clipping = { ...cut, x: cut.x - origin.x, y: cut.y - origin.y };
  const image = layer.assetId && images.get(layer.assetId);
  if (image) paintBackgroundImage(target, image, area, clipping, layer.style, layer.resolution);
  else if (layer.image !== 'none' && !layer.url) {
    const size = backgroundSize(cssImageDimensions(layer, images, area), area, layer.style);
    if (size.width > 0 && size.height > 0) {
      const tile = imageTile(layer, size.width, size.height, density, images);
      if (tile)
        paintBackgroundSurface(
          target,
          tile,
          tile.width,
          tile.height,
          area,
          clipping,
          layer.style,
          size,
        );
    }
  }
  target.restore();
}
function clip(context: CanvasRenderingContext2D, box: BackgroundLayer['clip'], origin: Rect) {
  box = { ...box, ...snap(box) };
  context.beginPath();
  context.roundRect(
    box.x - origin.x,
    box.y - origin.y,
    box.width,
    box.height,
    box.radius.map((x, i) => ({ x, y: (box.radiusY || box.radius)[i] })),
  );
  context.clip();
}
/** Every layer retains its own positioning, clip and repeat area. Text, borders
 * and image contents are painted separately from these native backgrounds. */
export function paintBackgroundLayers(
  context: CanvasRenderingContext2D,
  node: DesignNode,
  origin: Rect,
  images: Map<string, HTMLImageElement>,
) {
  const layers = node.backgroundLayers!;
  const matrix = context.getTransform();
  const density = Math.max(0.25, Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
  const paint = (target: CanvasRenderingContext2D) => {
    target.save();
    const bottom = layers.at(-1)!;
    clip(target, bottom.clip, origin);
    if (bottom.scrollClip) clip(target, bottom.scrollClip, origin);
    target.fillStyle = node.style['background-color'] || 'transparent';
    target.fillRect(
      bottom.clip.x - origin.x,
      bottom.clip.y - origin.y,
      bottom.clip.width,
      bottom.clip.height,
    );
    target.restore();
    for (const layer of [...layers].reverse()) {
      target.save();
      const mode = layer.style['background-blend-mode'];
      if (mode && mode !== 'normal')
        target.globalCompositeOperation = (
          mode === 'plus-lighter' ? 'lighter' : mode
        ) as GlobalCompositeOperation;
      paintImageLayer(target, layer, origin, images);
      target.restore();
    }
  };
  if (
    layers.some(
      (layer) =>
        layer.style['background-blend-mode'] && layer.style['background-blend-mode'] !== 'normal',
    )
  ) {
    let box = { x: 0, y: 0, width: origin.width, height: origin.height };
    if (node.canvasBackground) {
      // The document canvas extends beyond the HTML border box. Isolate all
      // visible background pixels, while limiting the surface to this paint
      // target (a preview tile or the current effect surface).
      const area = node.backgroundClip || node.canvasBackground.area;
      const inverse = context.getTransform().inverse();
      const points = [
        [0, 0],
        [context.canvas.width, 0],
        [context.canvas.width, context.canvas.height],
        [0, context.canvas.height],
      ].map(([x, y]) => inverse.transformPoint({ x, y }));
      const left = Math.max(area.x - origin.x, Math.min(...points.map((p) => p.x))),
        top = Math.max(area.y - origin.y, Math.min(...points.map((p) => p.y))),
        right = Math.min(area.x + area.width - origin.x, Math.max(...points.map((p) => p.x))),
        bottom = Math.min(area.y + area.height - origin.y, Math.max(...points.map((p) => p.y)));
      if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top)
        return;
      box = {
        x: Math.floor(left * density) / density,
        y: Math.floor(top * density) / density,
        width: (Math.ceil(right * density) - Math.floor(left * density)) / density,
        height: (Math.ceil(bottom * density) - Math.floor(top * density)) / density,
      };
    }
    const canvas = context.canvas.ownerDocument.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(box.width * density));
    canvas.height = Math.max(1, Math.ceil(box.height * density));
    const target = canvas.getContext('2d')!;
    target.scale(canvas.width / box.width, canvas.height / box.height);
    target.translate(-box.x, -box.y);
    paint(target);
    context.drawImage(canvas, box.x, box.y, box.width, box.height);
    canvas.width = canvas.height = 0;
  } else paint(context);
}
