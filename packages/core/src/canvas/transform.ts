import type { Clip, DesignNode } from '../model/design.js';
import { projectPoint } from '../model/transform.js';

export function localDrawingNode(node: DesignNode): DesignNode {
  return {
    ...node,
    box: node.localBox || node.box,
    visualBox: node.localVisualBox,
    transform: undefined,
    clips: [],
    paintBox: node.paintBox || node.localBox,
  };
}

/** Rounded masks use the same projected path for painting and pointer tests. */
export function projectedClipPath(
  context: CanvasRenderingContext2D,
  clip: Clip,
  origin: { x: number; y: number },
) {
  const box = clip.localBox || clip,
    matrix = clip.transform!;
  const xs = clip.radius.map((value) => Math.max(0, value)),
    ys = (clip.radiusY || clip.radius).map((value) => Math.max(0, value));
  const scale = Math.min(
    1,
    box.width / (xs[0] + xs[1] || 1),
    box.width / (xs[2] + xs[3] || 1),
    box.height / (ys[0] + ys[3] || 1),
    box.height / (ys[1] + ys[2] || 1),
  );
  xs.forEach((value, index) => {
    xs[index] = value * scale;
    ys[index] *= scale;
  });
  const centers = [
    [box.x + xs[0], box.y + ys[0]],
    [box.x + box.width - xs[1], box.y + ys[1]],
    [box.x + box.width - xs[2], box.y + box.height - ys[2]],
    [box.x + xs[3], box.y + box.height - ys[3]],
  ];
  context.beginPath();
  for (let corner = 0; corner < 4; corner++)
    for (let step = 0; step <= 12; step++) {
      const angle = Math.PI + (corner * Math.PI) / 2 + ((step / 12) * Math.PI) / 2;
      const point = projectPoint(matrix, {
        x: centers[corner][0] + Math.cos(angle) * xs[corner],
        y: centers[corner][1] + Math.sin(angle) * ys[corner],
      });
      if (corner === 0 && step === 0) context.moveTo(point.x - origin.x, point.y - origin.y);
      else context.lineTo(point.x - origin.x, point.y - origin.y);
    }
  context.closePath();
}
