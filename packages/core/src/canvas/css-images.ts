import type { CssImage, Rect } from '../model/design.js';
import { concreteImageSize } from './images.js';
import {
  imageDimensions,
  backgroundVectorImage,
  isVectorImage,
  hasScalableViewport,
  type ImageDimensions,
} from './vector-images.js';
import { paintCssGradient } from './gradient.js';
import { rasterImage } from './raster-images.js';

/** Natural dimensions belong to the selected CSS image, including image-set's
 * resolution and cross-fade's weighted dimensions, rather than its decoder. */
export function cssImageDimensions(
  source: CssImage,
  images: Map<string, HTMLImageElement>,
  area?: Pick<Rect, 'width' | 'height'>,
): ImageDimensions {
  const image = source.assetId && images.get(source.assetId);
  let size: ImageDimensions = image ? imageDimensions(image) : {};
  if (source.crossFade?.length) {
    const entries = source.crossFade.map((value) => {
      const natural = cssImageDimensions(value.source, images, area);
      const size: ImageDimensions = area ? concreteImageSize(natural, area) : natural;
      return { ...value, size };
    });
    const total = entries.reduce((sum, value) => sum + value.weight, 0);
    const dimension = (key: 'width' | 'height') =>
      total && entries.some((value) => value.size[key] !== undefined)
        ? entries.reduce((sum, value) => sum + (value.size[key] || 0) * value.weight, 0) / total
        : undefined;
    const width = dimension('width'),
      height = dimension('height');
    size = entries.every(
      (value) =>
        value.size.width === entries[0].size.width &&
        value.size.height === entries[0].size.height &&
        value.size.ratio === entries[0].size.ratio,
    )
      ? entries[0].size
      : { width, height, ratio: width && height ? width / height : undefined };
  }
  const resolution = image && isVectorImage(image) ? 1 : source.resolution || 1;
  return {
    ...size,
    width: size.width === undefined ? undefined : size.width / resolution,
    height: size.height === undefined ? undefined : size.height / resolution,
  };
}

/** Draw a CSS image at its concrete size using native image, gradient and
 * additive premultiplied compositing commands. No source-page bitmap is used. */
export function paintCssImage(
  context: CanvasRenderingContext2D,
  source: CssImage,
  width: number,
  height: number,
  images: Map<string, HTMLImageElement>,
): boolean {
  const image = source.assetId && images.get(source.assetId);
  if (image) {
    // Cross-fade stretches each intrinsically sized input into the mixed image.
    // Changing a fixed SVG's viewport here would move its drawing commands
    // instead of stretching them. Ratio-only SVGs still need a concrete viewport.
    const natural = imageDimensions(image);
    const quality = context.imageSmoothingQuality;
    context.imageSmoothingQuality = 'medium';
    context.drawImage(
      rasterImage(image, width, height, context) ||
        (!hasScalableViewport(image) &&
        (natural.width !== undefined || natural.height !== undefined)
          ? image
          : backgroundVectorImage(image, width, height)),
      0,
      0,
      width,
      height,
    );
    context.imageSmoothingQuality = quality;
    return true;
  }
  if (source.crossFade) {
    const matrix = context.getTransform(),
      density = Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
    for (const child of source.crossFade) {
      if (!child.weight) continue;
      const surface = new OffscreenCanvas(
        Math.max(1, Math.ceil(width * density)),
        Math.max(1, Math.ceil(height * density)),
      );
      const target = surface.getContext('2d')!;
      target.scale(surface.width / width, surface.height / height);
      paintCssImage(
        target as unknown as CanvasRenderingContext2D,
        child.source,
        width,
        height,
        images,
      );
      context.save();
      context.globalCompositeOperation = 'lighter';
      context.globalAlpha *= child.weight;
      context.drawImage(surface, 0, 0, width, height);
      context.restore();
      surface.width = surface.height = 0;
    }
    return true;
  }
  if (source.image === 'none') return true;
  if (paintCssGradient(context, source.image, width, height)) return true;
  if (CSS.supports('color', source.image)) {
    context.fillStyle = source.image;
    context.fillRect(0, 0, width, height);
    return true;
  }
  return false;
}
