import type { DesignNode, Rect } from '../model/design.js';
import { linearGradient } from './gradient.js';
import { imageFit, paintBackgroundImage } from './images.js';
import { paintShadows } from './shadows.js';
import { paintText } from './text.js';
import { localDrawingNode, projectedClipPath } from './transform.js';
import { paintProjectedNode } from './projective.js';
import { paintControl } from './controls.js';
import { paintBackgroundLayers } from './backgrounds.js';

export function roundPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number[],
  radiusY?: number[],
) {
  ctx.beginPath();
  const r = radiusY
    ? radius.map((value, index) => ({ x: Math.max(0, value), y: Math.max(0, radiusY[index]) }))
    : radius.map((value) => Math.max(0, value));
  ctx.roundRect(x, y, Math.max(0, width), Math.max(0, height), r);
}

export function clipNode(ctx: CanvasRenderingContext2D, node: DesignNode) {
  for (const clip of node.clips) {
    if (clip.transform) {
      projectedClipPath(ctx, clip, node.box);
      ctx.clip();
      continue;
    }
    const box = cssPixelBox(clip);
    roundPath(
      ctx,
      box.x - node.box.x,
      box.y - node.box.y,
      box.width,
      box.height,
      clip.radius,
      clip.radiusY,
    );
    ctx.clip();
  }
}

// Chromium snaps axis-aligned CSS box edges at capture DPR 1. Keep measured
// coordinates unchanged and apply the same snapping only when painting.
function cssPixelBox(box: Rect): Rect {
  const x = Math.round(box.x);
  const y = Math.round(box.y);
  return {
    x,
    y,
    width: Math.round(box.x + box.width) - x,
    height: Math.round(box.y + box.height) - y,
  };
}

function paintBorders(ctx: CanvasRenderingContext2D, node: DesignNode) {
  const widths = Object.values(node.border);
  if (!widths.some(Boolean)) return;
  const sides = ['top', 'right', 'bottom', 'left'];
  const colors = sides.map((side) => node.style[`border-${side}-color`]);
  const styles = sides.map((side) => node.style[`border-${side}-style`]);
  const { width, height } = node.box;
  if (
    widths.every((value) => value === widths[0]) &&
    colors.every((color) => color === colors[0]) &&
    styles.every((style) => style === styles[0])
  ) {
    const lineWidth = widths[0];
    ctx.strokeStyle = colors[0];
    ctx.lineWidth = lineWidth;
    if (styles[0] === 'dashed') ctx.setLineDash([lineWidth * 3, lineWidth * 2]);
    if (styles[0] === 'dotted') ctx.setLineDash([lineWidth, lineWidth]);
    roundPath(
      ctx,
      lineWidth / 2,
      lineWidth / 2,
      width - lineWidth,
      height - lineWidth,
      node.radius.map((value) => Math.max(0, value - lineWidth / 2)),
      node.radiusY?.map((value) => Math.max(0, value - lineWidth / 2)),
    );
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  const { top, right, bottom, left } = node.border;
  const polygons = [
    [0, 0, width, 0, width - right, top, left, top],
    [width, 0, width, height, width - right, height - bottom, width - right, top],
    [0, height, width, height, width - right, height - bottom, left, height - bottom],
    [0, 0, left, top, left, height - bottom, 0, height],
  ];
  roundPath(ctx, 0, 0, width, height, node.radius, node.radiusY);
  ctx.save();
  ctx.clip();
  polygons.forEach((points, index) => {
    if (!widths[index] || ['none', 'hidden'].includes(styles[index])) return;
    ctx.fillStyle = colors[index];
    ctx.beginPath();
    ctx.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
    ctx.closePath();
    ctx.fill();
  });
  ctx.restore();
}

export function paintNode(
  ctx: CanvasRenderingContext2D,
  node: DesignNode,
  images: Map<string, HTMLImageElement>,
  opacity = node.opacity,
) {
  ctx.save();
  // Local screenshots already contain the ancestor masks, including edge AA.
  if (node.kind !== 'raster' || !node.rasterMode) clipNode(ctx, node);
  if (node.transform && node.localBox && node.kind !== 'raster') {
    const matrix = node.transform;
    if (Math.abs(matrix[6]) + Math.abs(matrix[7]) > 1e-10) {
      ctx.globalAlpha *= opacity;
      paintProjectedNode(ctx, node, (context, local) => paintNode(context, local, images, 1));
      ctx.restore();
      return;
    }
    ctx.translate(-node.box.x, -node.box.y);
    ctx.transform(
      matrix[0] / matrix[8],
      matrix[3] / matrix[8],
      matrix[1] / matrix[8],
      matrix[4] / matrix[8],
      matrix[2] / matrix[8],
      matrix[5] / matrix[8],
    );
    ctx.translate(node.localBox.x, node.localBox.y);
    node = localDrawingNode(node);
  }
  ctx.globalAlpha *= node.kind === 'raster' ? 1 : opacity;
  const paintBox = node.paintBox || cssPixelBox(node.box);
  const { width, height } = paintBox;
  if (node.kind === 'text') {
    paintText(ctx, node);
    ctx.restore();
    return;
  }
  if (node.kind === 'raster') {
    const image = node.assetId && images.get(node.assetId);
    const crop = node.rasterBox || node.box;
    if (image)
      ctx.drawImage(image, crop.x - node.box.x, crop.y - node.box.y, crop.width, crop.height);
    ctx.restore();
    return;
  }
  if (node.lines) {
    for (const line of node.lines) {
      ctx.fillStyle = line.color;
      if (line.style === 'dashed' || line.style === 'dotted') {
        ctx.strokeStyle = line.color;
        ctx.lineWidth = line.width;
        ctx.setLineDash(
          line.style === 'dashed' ? [line.width * 3, line.width * 2] : [line.width, line.width],
        );
        ctx.beginPath();
        ctx.moveTo(line.x1 - node.box.x, line.y1 - node.box.y);
        ctx.lineTo(line.x2 - node.box.x, line.y2 - node.box.y);
        ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      const vertical = line.x1 === line.x2;
      const x = Math.round(line.x1 - line.width / 2) - node.box.x;
      const y = Math.round(line.y1 - line.width / 2) - node.box.y;
      const w = vertical
        ? line.width
        : Math.round(line.x2 + line.width / 2) - Math.round(line.x1 - line.width / 2);
      const h = vertical
        ? Math.round(line.y2 + line.width / 2) - Math.round(line.y1 - line.width / 2)
        : line.width;
      if (line.style === 'double' && line.width >= 3) {
        const stripe = Math.max(1, Math.round(line.width / 3));
        if (vertical) {
          ctx.fillRect(x, y, stripe, h);
          ctx.fillRect(x + w - stripe, y, stripe, h);
        } else {
          ctx.fillRect(x, y, w, stripe);
          ctx.fillRect(x, y + h - stripe, w, stripe);
        }
      } else ctx.fillRect(x, y, w, h);
    }
    ctx.restore();
    return;
  }
  ctx.translate(paintBox.x - node.box.x, paintBox.y - node.box.y);
  if (!node.skipBackground) {
    ctx.save();
    if (node.backgroundAreas) {
      ctx.beginPath();
      for (const area of node.backgroundAreas)
        ctx.roundRect(
          area.x - paintBox.x,
          area.y - paintBox.y,
          area.width,
          area.height,
          area.radius,
        );
      ctx.clip();
    }
    paintShadows(ctx, paintBox === node.box ? node : { ...node, box: paintBox });
    if (!node.skipBoxBackground && node.backgroundLayers?.length)
      paintBackgroundLayers(ctx, node, paintBox, images);
    else if (!node.skipBoxBackground) {
      ctx.save();
      const clip = node.backgroundClip;
      const clipBox = clip ? cssPixelBox(clip) : paintBox;
      const clipArea = { ...clipBox, x: clipBox.x - paintBox.x, y: clipBox.y - paintBox.y };
      roundPath(
        ctx,
        clipArea.x,
        clipArea.y,
        clipArea.width,
        clipArea.height,
        clip?.radius || node.radius,
        clip?.radiusY || node.radiusY,
      );
      ctx.clip();
      const backgroundColor = node.style['background-color'];
      if (
        backgroundColor &&
        backgroundColor !== 'rgba(0, 0, 0, 0)' &&
        backgroundColor !== 'transparent'
      ) {
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(clipArea.x, clipArea.y, clipArea.width, clipArea.height);
      }
      const backgroundBox = node.backgroundBox ? cssPixelBox(node.backgroundBox) : paintBox;
      const area = {
        ...backgroundBox,
        x: backgroundBox.x - paintBox.x,
        y: backgroundBox.y - paintBox.y,
      };
      ctx.save();
      ctx.translate(area.x, area.y);
      const gradient = linearGradient(
        ctx,
        node.style['background-image'] || '',
        area.width,
        area.height,
      );
      if (gradient) {
        ctx.fillStyle = gradient;
        ctx.fillRect(clipArea.x - area.x, clipArea.y - area.y, clipArea.width, clipArea.height);
      }
      ctx.restore();
      const backgroundImage = node.backgroundAssetId && images.get(node.backgroundAssetId);
      if (backgroundImage) paintBackgroundImage(ctx, backgroundImage, area, clipArea, node.style);
      ctx.restore();
    }
    paintShadows(ctx, paintBox === node.box ? node : { ...node, box: paintBox }, true);
    ctx.save();
    roundPath(ctx, 0, 0, width, height, node.radius, node.radiusY);
    ctx.clip();
    const image = node.assetId && images.get(node.assetId);
    if (image) {
      const originalImageBox = node.imageBox || node.contentBox;
      const fixedImageBox =
        node.style['object-fit'] === 'cover' ? cssPixelBox(originalImageBox) : originalImageBox;
      const contentBox = {
        ...fixedImageBox,
        x: fixedImageBox.x - paintBox.x,
        y: fixedImageBox.y - paintBox.y,
      };
      ctx.save();
      // Replaced content follows the content-edge curve, including padding.
      // Flattened layout clears padding but retains the original image box.
      const left = contentBox.x,
        top = contentBox.y,
        right = width - contentBox.x - contentBox.width,
        bottom = height - contentBox.y - contentBox.height;
      const radius = node.radius.map((r, i) => Math.max(0, r - [left, right, right, left][i])),
        radiusY = (node.radiusY || node.radius).map((r, i) =>
          Math.max(0, r - [top, top, bottom, bottom][i]),
        ),
        rounded = radius.some((r, i) => r > 0 && radiusY[i] > 0),
        sameBox =
          originalImageBox.x === node.box.x &&
          originalImageBox.y === node.box.y &&
          originalImageBox.width === node.box.width &&
          originalImageBox.height === node.box.height;
      if (!sameBox && (rounded || ['cover', 'none'].includes(node.style['object-fit']))) {
        roundPath(
          ctx,
          left,
          top,
          Math.max(0, width - left - right),
          Math.max(0, height - top - bottom),
          radius,
          radiusY,
        );
        ctx.clip();
      }
      imageFit(
        ctx,
        image,
        contentBox,
        node.style['object-fit'] || 'fill',
        node.style['object-position'] || '50% 50%',
        node.kind === 'image' || node.control?.type === 'image' ? 'medium' : undefined,
        rounded,
      );
      ctx.restore();
    }
    ctx.restore();
    ctx.restore();
  }
  if (!node.skipBorders && !(node.control?.type === 'color' && node.style.appearance !== 'none'))
    paintBorders(ctx, paintBox === node.box ? node : { ...node, box: paintBox });
  if (node.control) paintControl(ctx, { ...node, box: paintBox });
  ctx.restore();
}
