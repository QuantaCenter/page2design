import type { DesignNode, Rect, TransformMatrix } from './design.js';

export function multiplyTransforms(a: TransformMatrix, b: TransformMatrix): TransformMatrix {
  return Array.from({ length: 9 }, (_, index) => {
    const row = Math.floor(index / 3),
      column = index % 3;
    return a[row * 3] * b[column] + a[row * 3 + 1] * b[column + 3] + a[row * 3 + 2] * b[column + 6];
  }) as TransformMatrix;
}

export function projectPoint(matrix: TransformMatrix, point: { x: number; y: number }) {
  const w = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
  return {
    x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / w,
    y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / w,
  };
}
export function transformRect(matrix: TransformMatrix, box: Rect): Rect {
  const points = [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x + box.width, box.y + box.height],
    [box.x, box.y + box.height],
  ].map(([x, y]) => projectPoint(matrix, { x, y }));
  const x = Math.min(...points.map((point) => point.x)),
    y = Math.min(...points.map((point) => point.y));
  return {
    x,
    y,
    width: Math.max(...points.map((point) => point.x)) - x,
    height: Math.max(...points.map((point) => point.y)) - y,
  };
}
export function inverseTransform(m: TransformMatrix): TransformMatrix | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const result: TransformMatrix = [
    e * i - f * h,
    c * h - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d,
  ];
  const determinant = a * result[0] + b * result[3] + c * result[6];
  return Math.abs(determinant) < 1e-12
    ? null
    : (result.map((value) => value / determinant) as TransformMatrix);
}

/** Match the browser's projected border quad, including nested transforms and origin. */
export function matrixFromQuad(box: Rect, quad: number[]): TransformMatrix | null {
  if (!box.width || !box.height || quad.length !== 8) return null;
  const [x0, y0, x1, y1, x2, y2, x3, y3] = quad;
  const dx1 = x1 - x2,
    dx2 = x3 - x2,
    dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2,
    dy2 = y3 - y2,
    dy3 = y0 - y1 + y2 - y3;
  const determinant = dx1 * dy2 - dx2 * dy1;
  // CDP quads are rounded to float coordinates. A long page can make an
  // affine rectangle fail exact parallelogram closure by a few float ULPs.
  // Do not invent a perspective surface (and extra texture sampling) for it.
  const affine =
    Math.abs(dx3) <=
      Math.max(1e-5, Math.max(Math.abs(x0), Math.abs(x1), Math.abs(x2), Math.abs(x3)) * 2 ** -22) &&
    Math.abs(dy3) <=
      Math.max(1e-5, Math.max(Math.abs(y0), Math.abs(y1), Math.abs(y2), Math.abs(y3)) * 2 ** -22);
  const g = affine ? 0 : (dx3 * dy2 - dx2 * dy3) / determinant;
  const h = affine ? 0 : (dx1 * dy3 - dx3 * dy1) / determinant;
  const a = (x1 - x0 + g * x1) / box.width,
    b = (x3 - x0 + h * x3) / box.height;
  const d = (y1 - y0 + g * y1) / box.width,
    e = (y3 - y0 + h * y3) / box.height;
  const p = g / box.width,
    q = h / box.height;
  const matrix: TransformMatrix = [
    a,
    b,
    x0 - a * box.x - b * box.y,
    d,
    e,
    y0 - d * box.x - e * box.y,
    p,
    q,
    1 - p * box.x - q * box.y,
  ];
  return matrix.every(Number.isFinite) ? matrix : null;
}

export function applyNativeTransforms(
  nodes: DesignNode[],
  matrices: Record<string, TransformMatrix>,
) {
  const lookup = new Map(nodes.map((node) => [node.id, node]));
  const matrixFor = (node: DesignNode): TransformMatrix | undefined =>
    matrices[node.captureSourceId || ''] ||
    (node.parentId ? lookup.get(node.parentId)?.transform : undefined);
  // Parents precede descendants in layout order; generated table borders inherit their owner.
  for (const node of [...nodes].sort((a, b) => a.order - b.order)) {
    let matrix = matrixFor(node);
    let canvasPaint: Rect | undefined;
    if (node.canvasBackground) {
      const root = node.parentId && lookup.get(node.parentId);
      const source = root && matrices[root.captureSourceId || ''];
      const isolated = root && root.compositingGroups?.some((group) => group.id === root.id);
      matrix = undefined;
      if (root && source && isolated && Math.abs(source[6]) + Math.abs(source[7]) >= 1e-10) {
        // An isolated perspective root flattens its CSS transform for canvas
        // painting before projecting the complete surface. Apply the origin
        // after flattening; the homography's numerator includes perspective
        // origin terms and cannot be used as this affine transform.
        const css = /^matrix3d\((.*)\)$/
          .exec(root.style.transform || '')?.[1]
          .split(',')
          .map(Number);
        const origin = (root.style['transform-origin'] || '0 0').split(/\s+/).map(parseFloat);
        const box = root.localBox || root.box;
        const x = box.x + (origin[0] || 0),
          y = box.y + (origin[1] || 0);
        const affine: TransformMatrix =
          css?.length === 16
            ? [
                css[0],
                css[4],
                css[12] + x - css[0] * x - css[4] * y,
                css[1],
                css[5],
                css[13] + y - css[1] * x - css[5] * y,
                0,
                0,
                1,
              ]
            : [source[0], source[1], source[2], source[3], source[4], source[5], 0, 0, 1];
        matrix = multiplyTransforms(source, affine);
        canvasPaint = root.maskLayers?.length
          ? transformRect(source, box)
          : node.canvasBackground.area;
        node.backgroundClip = { ...canvasPaint, radius: [0, 0, 0, 0] };
        for (const layer of node.backgroundLayers || [])
          layer.clip = { ...canvasPaint, radius: [0, 0, 0, 0] };
      }
    }
    if (!matrix) continue;
    node.transform = matrix;
    node.localBox = { ...node.box };
    node.localVisualBox = { ...(canvasPaint || node.visualBox || node.box) };
    node.box = transformRect(matrix, node.box);
    node.visualBox = transformRect(matrix, node.localVisualBox);
  }
  for (const node of nodes) {
    node.clipPaths = node.clipPaths?.map((clip) => ({
      ...clip,
      transform: lookup.get(clip.ownerId)?.transform,
    }));
    node.clips = node.clips.map((clip) => {
      const matrix = clip.ownerId ? lookup.get(clip.ownerId)?.transform : undefined;
      return matrix
        ? {
            ...clip,
            ...transformRect(matrix, clip),
            localBox: { x: clip.x, y: clip.y, width: clip.width, height: clip.height },
            transform: matrix,
          }
        : clip;
    });
    delete node.captureSourceId;
  }
}
