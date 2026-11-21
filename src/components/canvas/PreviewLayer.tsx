import { memo, useCallback, useEffect, useMemo, type ReactElement } from 'react';
import { Group, Layer, Rect, Shape } from 'react-konva';
import type Konva from 'konva';
import {
  intersects,
  screenToDocument,
  type Camera,
  type DesignDocument,
  type DesignNode,
} from '@page-to-design/core';
import { paintNodeHit, PreviewCache } from '@page-to-design/core/canvas';

const emptyScene = () => {};

const HitShape = memo(function HitShape({
  node,
  images,
}: {
  node: DesignNode;
  images: Map<string, HTMLImageElement>;
}) {
  const hit = useCallback(
    (context: Konva.Context, shape: Konva.Shape) => {
      paintNodeHit(context._context, node, images, shape.colorKey);
    },
    [node, images],
  );
  return (
    <Shape
      designId={node.id}
      x={node.box.x}
      y={node.box.y}
      width={node.box.width}
      height={node.box.height}
      fill="#000"
      perfectDrawEnabled={false}
      sceneFunc={emptyScene}
      hitFunc={hit}
    />
  );
});

// Selection and hover live in the annotation layer. They must not invalidate
// the page preview, its hit shapes, or its painted tile cache.
export const PreviewLayer = memo(function PreviewLayer({
  document,
  images,
  reference,
  ready,
  camera,
  width,
  height,
  referenceView,
  interactive,
}: {
  document: DesignDocument;
  images: Map<string, HTMLImageElement>;
  reference: HTMLImageElement | null;
  ready: boolean;
  camera: Camera;
  width: number;
  height: number;
  referenceView: boolean;
  interactive: boolean;
}) {
  const sorted = useMemo(
    () => [...document.nodes].sort((a, b) => a.paintOrder - b.paintOrder || a.order - b.order),
    [document],
  );
  const cache = useMemo(
    () => new PreviewCache(document, sorted, images),
    [document, sorted, images],
  );
  useEffect(() => () => cache.dispose(), [cache]);
  const referenceCache = useMemo(
    () => (reference ? new PreviewCache(document, [], images, reference) : null),
    [document, images, reference],
  );
  useEffect(() => () => referenceCache?.dispose(), [referenceCache]);
  const viewport = useMemo(
    () => ({
      ...screenToDocument({ x: -80, y: -80 }, camera),
      width: (width + 160) / camera.scale,
      height: (height + 160) / camera.scale,
    }),
    [camera, width, height],
  );
  const visible = useMemo(
    () =>
      sorted.filter(
        (node) =>
          node.tag !== '#table-borders' && !node.canvasBackground && intersects(node.box, viewport),
      ),
    [sorted, viewport],
  );
  // Reuse the elements too: memoizing HitShape alone still constructs hundreds
  // of JSX objects on every pan, which is costly in React development builds.
  // Cached JSX must be rebuilt when node ordering or decoded images change.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const hitElements = useMemo(() => new Map<string, ReactElement>(), [sorted, images]);
  const hits = useMemo(
    () =>
      ready
        ? visible.map((node) => {
            let element = hitElements.get(node.id);
            if (!element) {
              element = <HitShape key={node.id} node={node} images={images} />;
              hitElements.set(node.id, element);
            }
            return element;
          })
        : [],
    [ready, visible, hitElements, images],
  );
  const scene = useCallback(
    (context: Konva.Context) => {
      if (referenceView) {
        cache.dispose();
        referenceCache?.paint(context._context, viewport);
      } else {
        referenceCache?.dispose();
        cache.paint(context._context, viewport);
      }
    },
    [cache, referenceCache, referenceView, viewport],
  );
  return (
    <Layer listening={interactive}>
      <Group x={camera.x} y={camera.y} scaleX={camera.scale} scaleY={camera.scale}>
        <Rect
          width={document.width}
          height={document.height}
          fill={document.background}
          shadowColor="#26334d"
          shadowOpacity={0.12}
          shadowBlur={28}
          shadowOffsetY={8}
          listening={false}
        />
        <Group clipX={0} clipY={0} clipWidth={document.width} clipHeight={document.height}>
          {(referenceView ? !!reference : ready) && (
            <Shape
              width={document.width}
              height={document.height}
              listening={false}
              perfectDrawEnabled={false}
              sceneFunc={scene}
            />
          )}
          {hits}
        </Group>
      </Group>
    </Layer>
  );
});
