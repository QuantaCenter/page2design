import type { DesignNode, Rect, TransformMatrix } from '../model/design.js';
import {
  inverseTransform,
  multiplyTransforms,
  projectPoint,
  transformRect,
} from '../model/transform.js';
import { paintProjectedNode } from './projective.js';

const identity: TransformMatrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const clipId = (clip: DesignNode['clips'][number]) => clip.ownerId || JSON.stringify(clip);
function identityAt(matrix: TransformMatrix, box: Rect) {
  return [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x, box.y + box.height],
    [box.x + box.width, box.y + box.height],
  ].every(([x, y]) => {
    const p = projectPoint(matrix, { x, y });
    return Math.abs(p.x - x) + Math.abs(p.y - y) < 0.0001;
  });
}
export function changesFilterSpace(node: DesignNode) {
  const m = node.transform,
    box = node.localBox;
  if (!m || !box) return false;
  const translation: TransformMatrix = [1, 0, -m[2] / m[8], 0, 1, -m[5] / m[8], 0, 0, 1];
  return !identityAt(multiplyTransforms(translation, m), box);
}

/** Rebase editable descendants into an effect owner's original CSS coordinates.
 * Only drawing metadata is copied: source node IDs, text and assets remain intact. */
export function nodesInGroupSpace(
  nodes: readonly DesignNode[],
  owner: DesignNode,
  opacity: number,
  deferred: ReadonlySet<string>,
) {
  const inverse = inverseTransform(owner.transform!);
  if (!inverse) return null;
  const outer = new Set([...deferred, ...owner.clips.map(clipId)]);
  return nodes.map((source) => {
    const raster = source.kind === 'raster';
    const original = raster ? source.rasterBox || source.box : source.localBox || source.box;
    const matrix = multiplyTransforms(inverse, raster ? identity : source.transform || identity);
    const localVisual = raster ? original : source.localVisualBox || source.visualBox || original;
    const plain = identityAt(matrix, original);
    const groups = source.compositingGroups || source.opacityGroups || [];
    const index = groups.findIndex((group) => group.id === owner.id);
    const current = groups[index];
    return {
      ...source,
      ...(raster
        ? {
            kind: 'canvas' as const,
            radius: [0, 0, 0, 0],
            radiusY: undefined,
            imageBox: original,
            paintBox: original,
            skipBackground: false,
            skipBorders: true,
            style: {
              ...source.style,
              'background-color': 'transparent',
              'background-image': 'none',
              'box-shadow': 'none',
              'object-fit': 'fill',
              'object-position': '0% 0%',
            },
          }
        : {}),
      box: transformRect(matrix, original),
      visualBox: transformRect(matrix, localVisual),
      localBox: plain ? undefined : original,
      localVisualBox: plain ? undefined : localVisual,
      transform: plain ? undefined : matrix,
      opacity: source.opacity / opacity,
      compositingGroups:
        index < 0
          ? []
          : [{ ...current, opacity: 1, blendMode: undefined }, ...groups.slice(index + 1)],
      clips: source.clips
        .filter((clip) => !outer.has(clipId(clip)))
        .map((clip) => {
          const box = clip.localBox || clip,
            m = multiplyTransforms(inverse, clip.transform || identity);
          return {
            ...clip,
            ...transformRect(m, box),
            localBox: box,
            transform: identityAt(m, box) ? undefined : m,
          };
        }),
    } satisfies DesignNode;
  });
}

/** Draw existing native pixels through a homography, used only to bring an
 * already-painted backdrop into the filter owner's local coordinate system. */
export function drawBackdropInGroup(
  target: CanvasRenderingContext2D,
  source: CanvasRenderingContext2D,
  owner: DesignNode,
  bounds: Rect,
) {
  const inverse = inverseTransform(owner.transform!);
  if (!inverse) return;
  const t = source.getTransform(),
    camera: TransformMatrix = [t.a, t.c, t.e, t.b, t.d, t.f, 0, 0, 1];
  const inverseCamera = inverseTransform(camera);
  if (!inverseCamera) return;
  const world = transformRect(owner.transform!, bounds),
    device = transformRect(camera, world);
  const left = Math.max(0, Math.floor(device.x) - 2),
    top = Math.max(0, Math.floor(device.y) - 2);
  const width = Math.min(source.canvas.width - left, Math.ceil(device.x + device.width) + 2 - left),
    height = Math.min(source.canvas.height - top, Math.ceil(device.y + device.height) + 2 - top);
  if (width <= 0 || height <= 0) return;
  const matrix = multiplyTransforms(multiplyTransforms(inverse, inverseCamera), [
    1,
    0,
    left,
    0,
    1,
    top,
    0,
    0,
    1,
  ]);
  const original = { x: 0, y: 0, width, height };
  target.save();
  if (Math.abs(matrix[6]) + Math.abs(matrix[7]) < 1e-10) {
    target.transform(
      matrix[0] / matrix[8],
      matrix[3] / matrix[8],
      matrix[1] / matrix[8],
      matrix[4] / matrix[8],
      matrix[2] / matrix[8],
      matrix[5] / matrix[8],
    );
    target.drawImage(source.canvas, left, top, width, height, 0, 0, width, height);
  } else {
    const box = transformRect(matrix, original);
    const virtual: DesignNode = {
      ...owner,
      box,
      localBox: original,
      localVisualBox: original,
      visualBox: box,
      transform: matrix,
      clips: [],
      radius: [0, 0, 0, 0],
    };
    target.translate(box.x, box.y);
    paintProjectedNode(target, virtual, (context) =>
      context.drawImage(source.canvas, left, top, width, height, 0, 0, width, height),
    );
  }
  target.restore();
}
