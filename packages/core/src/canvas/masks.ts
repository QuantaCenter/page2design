import type { DesignNode, Rect } from '../model/design.js';
import { paintImageLayer } from './backgrounds.js';
import { inverseTransform, transformRect } from '../model/transform.js';
import { paintProjectedNode } from './projective.js';

/** Mask layers are isolated from both content and backdrop. Filtering the
 * content precedes this step; group opacity is applied after it. */
export function applyMasks(
  context: CanvasRenderingContext2D,
  owner: DesignNode,
  images: Map<string, HTMLImageElement>,
  matrix: DOMMatrix,
) {
  const { width, height } = context.canvas,
    document = context.canvas.ownerDocument;
  const combined = document.createElement('canvas');
  combined.width = width;
  combined.height = height;
  const merged = combined.getContext('2d')!;
  const bounds: Rect = {
    x: -matrix.e / matrix.a,
    y: -matrix.f / matrix.d,
    width: width / matrix.a,
    height: height / matrix.d,
  };
  const origin = { x: 0, y: 0, width: 0, height: 0 };
  const operators: Record<string, GlobalCompositeOperation> = {
    add: 'source-over',
    subtract: 'source-out',
    intersect: 'source-in',
    exclude: 'xor',
  };
  for (const [index, layer] of [...owner.maskLayers!].reverse().entries()) {
    const surface = document.createElement('canvas');
    surface.width = width;
    surface.height = height;
    const target = surface.getContext('2d', { willReadFrequently: layer.mode === 'luminance' })!;
    target.setTransform(matrix);
    const m = owner.transform,
      inverse = m && inverseTransform(m);
    const localBounds = inverse ? transformRect(inverse, bounds) : bounds;
    if (m && owner.localBox && Math.abs(m[6]) + Math.abs(m[7]) >= 1e-10) {
      const local = layer.noClip ? localBounds : layer.clip;
      const projection = { ...owner, localVisualBox: local, visualBox: transformRect(m, local) };
      target.translate(owner.box.x, owner.box.y);
      paintProjectedNode(target, projection, (context) => {
        context.translate(-owner.localBox!.x, -owner.localBox!.y);
        paintImageLayer(context, layer, origin, images, layer.noClip ? localBounds : undefined);
      });
    } else {
      if (m)
        target.transform(
          m[0] / m[8],
          m[3] / m[8],
          m[1] / m[8],
          m[4] / m[8],
          m[2] / m[8],
          m[5] / m[8],
        );
      paintImageLayer(target, layer, origin, images, layer.noClip ? localBounds : undefined);
    }
    if (layer.mode === 'luminance') {
      const pixels = target.getImageData(0, 0, width, height),
        values = pixels.data;
      for (let offset = 0; offset < values.length; offset += 4)
        values[offset + 3] = Math.round(
          (values[offset + 3] *
            (values[offset] * 0.2126 + values[offset + 1] * 0.7152 + values[offset + 2] * 0.0722)) /
            255,
        );
      target.putImageData(pixels, 0, 0);
    }
    merged.globalCompositeOperation = index
      ? operators[layer.composite] || 'source-over'
      : 'source-over';
    merged.drawImage(surface, 0, 0);
    surface.width = surface.height = 0;
  }
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(combined, 0, 0);
  context.restore();
  combined.width = combined.height = 0;
}
