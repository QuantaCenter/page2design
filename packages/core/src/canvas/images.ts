import type { Rect } from '../model/design.js';
import {
  backgroundVectorImage,
  imageDimensions,
  isVectorImage,
  type ImageDimensions,
} from './vector-images.js';
import { cssLength, splitCss } from './css-values.js';
import { rasterImage, paintRasterImage } from './raster-images.js';

const tokens = (value: string) => splitCss(value, true);
function offset(value: string | undefined, available: number) {
  if (!value || value === 'center') return available / 2;
  if (value === 'right' || value === 'bottom') return available;
  if (value === 'left' || value === 'top') return 0;
  // Computed positions contain px, %, or calc(% +/- px); never evaluate CSS as JS.
  return cssLength(value, available) || 0;
}

export function imagePosition(position: string, availableWidth: number, availableHeight: number) {
  const values = tokens(position);
  let x: string | undefined;
  let y: string | undefined;
  if (values.length >= 3) {
    for (let index = 0; index < values.length; index++) {
      const edge = values[index];
      if (['left', 'right', 'top', 'bottom'].includes(edge)) {
        const distance =
          values[index + 1] && !/^(left|right|top|bottom|center)$/.test(values[index + 1])
            ? values[++index]
            : '0px';
        const value = edge === 'right' || edge === 'bottom' ? `calc(100% - ${distance})` : distance;
        if (edge === 'left' || edge === 'right') x = value;
        else y = value;
      } else if (!x) x = edge;
      else y = edge;
    }
  } else {
    [x, y] = values;
    if (x === 'top' || x === 'bottom' || y === 'left' || y === 'right') [x, y] = [y, x];
  }
  return { x: offset(x, availableWidth), y: offset(y, availableHeight) };
}

export function fittedImageSize(image: HTMLImageElement, box: Rect, fit: string) {
  const iw = image.naturalWidth || image.width;
  const ih = image.naturalHeight || image.height;
  let width = box.width;
  let height = box.height;
  if (fit === 'cover' || fit === 'contain' || fit === 'scale-down') {
    let scale =
      iw && ih
        ? fit === 'cover'
          ? Math.max(width / iw, height / ih)
          : Math.min(width / iw, height / ih)
        : 0;
    if (fit === 'scale-down') scale = Math.min(scale, 1);
    width = iw * scale;
    height = ih * scale;
  } else if (fit === 'none') {
    width = iw;
    height = ih;
  }
  return { width, height };
}

export function imageFit(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  box: Rect,
  fit: string,
  position: string,
  quality?: ImageSmoothingQuality,
  clipped = false,
) {
  if (!image.naturalWidth || !image.naturalHeight || !box.width || !box.height) return;
  const { width, height } = fittedImageSize(image, box, fit);
  // CSS gives an SVG its concrete viewport before object-fit/position. Scaling
  // the intrinsic SVG image instead can reveal adjacent sprite views or squash
  // geometry when its intrinsic and concrete aspect ratios differ.
  const drawable =
    (quality && rasterImage(image, width, height, ctx)) ||
    backgroundVectorImage(image, width, height);
  if (quality) ctx.imageSmoothingQuality = quality;
  const point = imagePosition(position, box.width - width, box.height - height);
  const x = fit === 'cover' ? box.x + point.x : Math.round(box.x + point.x),
    y = fit === 'cover' ? box.y + point.y : Math.round(box.y + point.y),
    destination = {
      x,
      y,
      width: fit === 'cover' ? width : Math.round(box.x + point.x + width) - x,
      height: fit === 'cover' ? height : Math.round(box.y + point.y + height) - y,
    };
  if (
    quality &&
    paintRasterImage(ctx, image, width, height, destination, clipped ? box : undefined)
  )
    return;
  ctx.drawImage(drawable, x, y, destination.width, destination.height);
}

/** CSS Images default sizing, with missing dimensions kept distinct from the
 * browser image decoder's synthetic viewport. */
export function concreteImageSize(
  intrinsic: ImageDimensions,
  area: Pick<Rect, 'width' | 'height'>,
  w?: number,
  h?: number,
) {
  const ratio = intrinsic.ratio;
  if (w !== undefined && h !== undefined) return { width: w, height: h };
  if (w !== undefined)
    return { width: w, height: ratio ? w / ratio : (intrinsic.height ?? area.height) };
  if (h !== undefined)
    return { width: ratio ? h * ratio : (intrinsic.width ?? area.width), height: h };
  if (intrinsic.width !== undefined)
    return {
      width: intrinsic.width,
      height: intrinsic.height ?? (ratio ? intrinsic.width / ratio : area.height),
    };
  if (intrinsic.height !== undefined)
    return { width: ratio ? intrinsic.height * ratio : area.width, height: intrinsic.height };
  if (ratio) {
    const height = Math.min(area.height, area.width / ratio);
    return { width: height * ratio, height };
  }
  return { width: area.width, height: area.height };
}

export function backgroundImageSize(
  image: HTMLImageElement,
  area: Pick<Rect, 'width' | 'height'>,
  style: Record<string, string>,
  resolution = 1,
) {
  const dimensions = imageDimensions(image);
  if (isVectorImage(image)) resolution = 1;
  return backgroundSize(
    {
      ...dimensions,
      width: dimensions.width === undefined ? undefined : dimensions.width / resolution,
      height: dimensions.height === undefined ? undefined : dimensions.height / resolution,
    },
    area,
    style,
  );
}
export function backgroundSize(
  intrinsic: ImageDimensions,
  area: Pick<Rect, 'width' | 'height'>,
  style: Record<string, string>,
) {
  const size = tokens(style['background-size'] || 'auto');
  const length = (value: string | undefined, available: number) =>
    !value || value === 'auto' ? undefined : offset(value, available);
  let width: number;
  let height: number;
  if (size[0] === 'cover' || size[0] === 'contain') {
    const ratio = intrinsic.ratio;
    height = ratio
      ? (size[0] === 'cover' ? Math.max : Math.min)(area.width / ratio, area.height)
      : area.height;
    width = ratio ? height * ratio : area.width;
  } else {
    const w = length(size[0], area.width);
    const h = length(size[1], area.height);
    ({ width, height } = concreteImageSize(intrinsic, area, w, h));
  }
  // Chromium positions the tile using its specified size, before round repeat
  // rescales it to an integer tile count. Preserve that positioning geometry.
  const positionWidth = width,
    positionHeight = height;
  let [repeatX, repeatY] = (style['background-repeat'] || 'repeat').split(/\s+/);
  if (repeatX === 'repeat-x') {
    repeatX = 'repeat';
    repeatY = 'no-repeat';
  } else if (repeatX === 'repeat-y') {
    repeatX = 'no-repeat';
    repeatY = 'repeat';
  } else repeatY ||= repeatX;
  if (repeatX === 'round') {
    const old = width;
    width = area.width / Math.max(1, Math.round(area.width / width));
    if ((!size[1] || size[1] === 'auto') && repeatY !== 'round') height *= width / old;
  }
  if (repeatY === 'round') {
    const old = height;
    height = area.height / Math.max(1, Math.round(area.height / height));
    if (size[0] === 'auto' && repeatX !== 'round') width *= height / old;
  }
  return { width, height, repeatX, repeatY, positionWidth, positionHeight };
}

export function paintBackgroundImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  area: Rect,
  clip: Rect,
  style: Record<string, string>,
  resolution = 1,
) {
  const size = backgroundImageSize(image, area, style, resolution),
    { width, height } = size;
  if (!(width > 0 && height > 0)) return;
  const source =
    rasterImage(image, width, height, ctx) || backgroundVectorImage(image, width, height);
  const iw = 'naturalWidth' in source ? source.naturalWidth : source.width,
    ih = 'naturalHeight' in source ? source.naturalHeight : source.height;
  ctx.save();
  // CSS raster images use mipmapped minification. Canvas's default low
  // sampling drops thin strokes in large logos displayed as small icons.
  ctx.imageSmoothingQuality = 'medium';
  paintBackgroundSurface(ctx, source, iw, ih, area, clip, style, size);
  ctx.restore();
}
export function paintBackgroundSurface(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  iw: number,
  ih: number,
  area: Rect,
  clip: Rect,
  style: Record<string, string>,
  size: {
    width: number;
    height: number;
    repeatX: string;
    repeatY: string;
    positionWidth?: number;
    positionHeight?: number;
  },
) {
  const { width, height, repeatX, repeatY } = size;
  const position = imagePosition(
    style['background-position'] || '0% 0%',
    area.width - (size.positionWidth ?? width),
    area.height - (size.positionHeight ?? height),
  );
  if (repeatX === 'no-repeat' && repeatY === 'no-repeat') {
    ctx.drawImage(source, area.x + position.x, area.y + position.y, width, height);
    return;
  }
  const positions = (
    mode: string,
    origin: number,
    extent: number,
    tile: number,
    point: number,
    min: number,
    max: number,
  ) => {
    if (mode === 'no-repeat') return [origin + point];
    let stride = tile;
    let start = origin + point;
    if (mode === 'space') {
      const count = Math.floor(extent / tile);
      if (count < 2) return [start];
      stride = (extent - tile) / (count - 1);
      start = origin;
    }
    const first = Math.floor((min - start) / stride);
    const last = Math.ceil((max - start) / stride);
    return Array.from(
      { length: Math.min(2048, last - first + 1) },
      (_, index) => start + (first + index) * stride,
    );
  };
  const xs =
    repeatX === 'space'
      ? positions(repeatX, area.x, area.width, width, position.x, clip.x, clip.x + clip.width)
      : [repeatX === 'round' ? area.x + position.x : Math.round(area.x + position.x)];
  const ys =
    repeatY === 'space'
      ? positions(repeatY, area.y, area.height, height, position.y, clip.y, clip.y + clip.height)
      : [repeatY === 'round' ? area.y + position.y : Math.round(area.y + position.y)];
  const rx = repeatX !== 'space' && repeatX !== 'no-repeat';
  const ry = repeatY !== 'space' && repeatY !== 'no-repeat';
  const pattern = ctx.createPattern(
    source,
    rx ? (ry ? 'repeat' : 'repeat-x') : ry ? 'repeat-y' : 'no-repeat',
  );
  if (!pattern) return;
  // Snap the initial tile origin as CSS background painting does, while keeping
  // fractional tile sizes and spacing. A continuous pattern avoids seams and
  // preserves the sampling phase across repeated tiles.
  for (const y of ys)
    for (const x of xs) {
      pattern.setTransform(new DOMMatrix([width / iw, 0, 0, height / ih, x, y]));
      ctx.fillStyle = pattern;
      ctx.fillRect(clip.x, clip.y, clip.width, clip.height);
    }
}
