import type { CompositingGroup, DesignNode, Rect } from '../model/design.js';
import { intersects } from '../model/geometry.js';
import { paintNode, clipNode, roundPath } from './paint.js';
import { projectedClipPath } from './transform.js';
import { paintProjectedNode } from './projective.js';
import { transformRect } from '../model/transform.js';
import { shapeClipPath } from './clip-path.js';
import { applyMasks } from './masks.js';
import { splitCss } from './css-values.js';
import {
  changesFilterSpace,
  clipId,
  drawBackdropInGroup,
  nodesInGroupSpace,
} from './group-space.js';

interface PaintGroup extends CompositingGroup {
  children: (PaintGroup | DesignNode)[];
  bounds?: Rect;
  owner?: DesignNode;
  local?: ScenePainter;
}
const isGroup = (item: PaintGroup | DesignNode): item is PaintGroup => !('kind' in item);
const union = (a: Rect | undefined, b: Rect): Rect =>
  a
    ? {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x),
        height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y),
      }
    : { ...b };
const expand = (box: Rect, margin: number): Rect => ({
  x: box.x - margin,
  y: box.y - margin,
  width: box.width + margin * 2,
  height: box.height + margin * 2,
});

/** The filter input needs pixels outside a preview tile, including drop-shadow
 * offsets. Canvas filter lengths are device pixels, so scale them at composition. */
function filterMargin(css = '') {
  let margin = 0;
  for (const part of splitCss(css, true)) {
    const match = /^(blur|drop-shadow)\((.*)\)$/.exec(part);
    if (!match) continue;
    const values = [...match[2].matchAll(/(-?[\d.]+)px/g)].map((value) => Number(value[1]));
    margin +=
      match[1] === 'blur'
        ? (values[0] || 0) * 3 + 2
        : Math.max(Math.abs(values[0] || 0), Math.abs(values[1] || 0)) + (values[2] || 0) * 3 + 2;
  }
  return Math.ceil(margin);
}
const scaledFilter = (css: string, scale: number) =>
  css.replace(/(-?[\d.]+)px/g, (_, value: string) => `${Number(value) * scale}px`);
const clipKey = clipId;

/** Native display list. Effect groups survive flattening, while all editable
 * descendants remain separate nodes instead of becoming page screenshots. */
export class ScenePainter {
  private root: PaintGroup = { id: '', opacity: 1, children: [] };
  constructor(
    nodes: readonly DesignNode[],
    private images: Map<string, HTMLImageElement>,
    private backdrop?: { id: string; paint(context: CanvasRenderingContext2D): void },
  ) {
    const groups = new Map<string, PaintGroup>(),
      lookup = new Map(nodes.map((node) => [node.id, node]));
    for (const node of nodes) {
      let parent = this.root;
      for (const info of node.compositingGroups || node.opacityGroups || []) {
        let group = groups.get(info.id);
        if (!group) {
          group = { ...info, children: [], owner: lookup.get(info.id) };
          groups.set(info.id, group);
          parent.children.push(group);
        }
        parent = group;
      }
      parent.children.push(node);
    }
    const bounds = (group: PaintGroup): Rect | undefined => {
      let result: Rect | undefined;
      for (const child of group.children) {
        const box = isGroup(child)
          ? bounds(child)
          : child.visualBox || child.rasterBox || child.paintBox || child.box;
        if (box) result = union(result, box);
      }
      group.bounds =
        result && expand(result, filterMargin(group.filter) + filterMargin(group.backdropFilter));
      return group.bounds;
    };
    bounds(this.root);
  }
  paint(context: CanvasRenderingContext2D, bounds: Rect) {
    this.paintGroup(context, this.root, bounds, 1, new Set());
  }

  private paintTransformedGroup(
    context: CanvasRenderingContext2D,
    item: PaintGroup,
    inheritedOpacity: number,
    deferred: ReadonlySet<string>,
  ) {
    const owner = item.owner!;
    const collect = (group: PaintGroup): DesignNode[] =>
      group.children.flatMap((child) => (isGroup(child) ? collect(child) : [child]));
    const local = nodesInGroupSpace(
      collect(item),
      owner,
      inheritedOpacity * item.opacity,
      deferred,
    );
    if (!local) return;
    const painter = item.local || (item.local = new ScenePainter(local, this.images));
    const bounds = painter.root.bounds;
    if (!bounds) return;
    // A backdrop is sampled anew for each tile/viewport; editable geometry is cached.
    painter.backdrop = {
      id: item.id,
      paint: (target) => drawBackdropInGroup(target, context, owner, bounds),
    };
    context.save();
    context.translate(owner.box.x, owner.box.y);
    clipNode(context, {
      ...owner,
      clips: owner.clips.filter((clip) => !deferred.has(clipId(clip))),
    });
    context.translate(-owner.box.x, -owner.box.y);
    context.globalAlpha *= item.opacity;
    if (item.blendMode)
      context.globalCompositeOperation = (
        item.blendMode === 'plus-lighter' ? 'lighter' : item.blendMode
      ) as GlobalCompositeOperation;
    const matrix = owner.transform!;
    if (Math.abs(matrix[6]) + Math.abs(matrix[7]) < 1e-10) {
      const camera = context.getTransform();
      const stretch =
        Math.max(Math.hypot(matrix[0], matrix[3]), Math.hypot(matrix[1], matrix[4])) /
        Math.abs(matrix[8]);
      const density = Math.min(
        8,
        Math.max(0.25, Math.abs(camera.a) * stretch),
        8192 / bounds.width,
        8192 / bounds.height,
        Math.sqrt((16 * 1024 * 1024) / (bounds.width * bounds.height)),
      );
      const surface = context.canvas.ownerDocument.createElement('canvas');
      surface.width = Math.max(1, Math.ceil(bounds.width * density));
      surface.height = Math.max(1, Math.ceil(bounds.height * density));
      const layer = surface.getContext('2d')!;
      layer.scale(density, density);
      layer.translate(-bounds.x, -bounds.y);
      painter.paint(layer, bounds);
      context.transform(
        matrix[0] / matrix[8],
        matrix[3] / matrix[8],
        matrix[1] / matrix[8],
        matrix[4] / matrix[8],
        matrix[2] / matrix[8],
        matrix[5] / matrix[8],
      );
      context.drawImage(
        surface,
        bounds.x,
        bounds.y,
        surface.width / density,
        surface.height / density,
      );
      surface.width = surface.height = 0;
    } else {
      const virtual = {
        ...owner,
        localVisualBox: bounds,
        visualBox: transformRect(matrix, bounds),
      };
      context.translate(owner.box.x, owner.box.y);
      paintProjectedNode(context, virtual, (target) => {
        target.translate(-owner.localBox!.x, -owner.localBox!.y);
        painter.paint(target, bounds);
      });
    }
    context.restore();
  }

  private paintGroup(
    context: CanvasRenderingContext2D,
    group: PaintGroup,
    viewport: Rect,
    inheritedOpacity: number,
    deferredClips: ReadonlySet<string>,
  ) {
    for (const item of group.children) {
      if (isGroup(item)) {
        if (!item.bounds || !item.opacity || !intersects(item.bounds, viewport)) continue;
        // The document canvas is painted in viewport coordinates even when
        // the HTML boxes are transformed. Projecting the whole masked group
        // would resample that background twice. Project its mask/path instead.
        const canvasEffects =
          item.children.some(
            (child) => !isGroup(child) && child.canvasBackground && !child.transform,
          ) &&
          !item.backdropFilter &&
          !/(?:blur|drop-shadow|url)\(/.test(item.filter || '');
        if (
          item.owner &&
          !canvasEffects &&
          (((item.filter || item.backdropFilter) && changesFilterSpace(item.owner)) ||
            ((item.clipPath || item.mask) && item.owner.transform))
        ) {
          this.paintTransformedGroup(context, item, inheritedOpacity, deferredClips);
          continue;
        }
        const input = expand(
          viewport,
          filterMargin(item.filter) + filterMargin(item.backdropFilter),
        );
        const box = {
          x: Math.max(item.bounds.x, input.x),
          y: Math.max(item.bounds.y, input.y),
          width:
            Math.min(item.bounds.x + item.bounds.width, input.x + input.width) -
            Math.max(item.bounds.x, input.x),
          height:
            Math.min(item.bounds.y + item.bounds.height, input.y + input.height) -
            Math.max(item.bounds.y, input.y),
        };
        const transform = context.getTransform();
        const left = Math.floor(box.x * transform.a + transform.e),
          top = Math.floor(box.y * transform.d + transform.f);
        const width = Math.max(
            1,
            Math.ceil((box.x + box.width) * transform.a + transform.e) - left,
          ),
          height = Math.max(1, Math.ceil((box.y + box.height) * transform.d + transform.f) - top);
        const surface = context.canvas.ownerDocument.createElement('canvas');
        surface.width = width;
        surface.height = height;
        const layer = surface.getContext('2d')!;
        layer.setTransform(
          transform.a,
          transform.b,
          transform.c,
          transform.d,
          transform.e - left,
          transform.f - top,
        );
        if (item.backdropFilter && item.owner) {
          const owner = item.owner;
          const custom = this.backdrop?.id === item.id;
          let backdrop: HTMLCanvasElement | undefined;
          if (custom) {
            backdrop = context.canvas.ownerDocument.createElement('canvas');
            backdrop.width = width;
            backdrop.height = height;
            const target = backdrop.getContext('2d')!;
            target.setTransform(
              transform.a,
              transform.b,
              transform.c,
              transform.d,
              transform.e - left,
              transform.f - top,
            );
            this.backdrop!.paint(target);
          }
          layer.save();
          layer.translate(owner.box.x, owner.box.y);
          clipNode(layer, owner);
          if (owner.transform && owner.localBox)
            projectedClipPath(
              layer,
              {
                ...owner.localBox,
                localBox: owner.localBox,
                transform: owner.transform,
                radius: owner.radius,
                radiusY: owner.radiusY,
              },
              owner.box,
            );
          else
            roundPath(layer, 0, 0, owner.box.width, owner.box.height, owner.radius, owner.radiusY);
          layer.clip();
          layer.setTransform(1, 0, 0, 1, 0, 0);
          layer.filter = scaledFilter(item.backdropFilter, Math.abs(transform.a));
          layer.drawImage(backdrop || context.canvas, backdrop ? 0 : -left, backdrop ? 0 : -top);
          layer.restore();
          if (backdrop) backdrop.width = backdrop.height = 0;
        }
        const defer = new Set(deferredClips);
        if (item.filter) for (const clip of item.owner?.clips || []) defer.add(clipKey(clip));
        this.paintGroup(layer, item, input, inheritedOpacity * item.opacity, defer);
        let painted = surface;
        if (item.filter) {
          painted = context.canvas.ownerDocument.createElement('canvas');
          painted.width = width;
          painted.height = height;
          const filtered = painted.getContext('2d')!;
          filtered.filter = scaledFilter(item.filter, Math.abs(transform.a));
          filtered.drawImage(surface, 0, 0);
          filtered.filter = 'none';
        }
        if (item.mask && item.owner) {
          applyMasks(painted.getContext('2d')!, item.owner, this.images, layer.getTransform());
        }
        context.save();
        if (item.filter && item.owner) {
          context.translate(item.owner.box.x, item.owner.box.y);
          clipNode(context, {
            ...item.owner,
            clips: item.owner.clips.filter((clip) => !deferredClips.has(clipKey(clip))),
          });
          context.translate(-item.owner.box.x, -item.owner.box.y);
        }
        if (item.clipPath && item.owner?.clipPath) {
          const shape = shapeClipPath(
            {
              ...item.owner.clipPath,
              transform: item.owner.transform || item.owner.clipPath.transform,
            },
            { x: 0, y: 0 },
          );
          context.clip(shape.path, shape.rule);
        }
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.globalAlpha *= item.opacity;
        if (item.blendMode)
          context.globalCompositeOperation = (
            item.blendMode === 'plus-lighter' ? 'lighter' : item.blendMode
          ) as GlobalCompositeOperation;
        context.drawImage(painted, left, top);
        context.restore();
        surface.width = surface.height = 0;
        if (painted !== surface) painted.width = painted.height = 0;
      } else {
        if (!intersects(item.visualBox || item.rasterBox || item.paintBox || item.box, viewport))
          continue;
        context.save();
        context.translate(item.box.x, item.box.y);
        paintNode(
          context,
          deferredClips.size
            ? { ...item, clips: item.clips.filter((clip) => !deferredClips.has(clipKey(clip))) }
            : item,
          this.images,
          inheritedOpacity ? item.opacity / inheritedOpacity : 0,
        );
        context.restore();
      }
    }
  }
}
