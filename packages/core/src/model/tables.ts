import type { BorderLine, Clip, DesignNode, Insets, Rect } from './design.js';

export interface TablePart {
  nodeId?: string;
  tag: string;
  box: Rect;
  border: Insets;
  colors: string[];
  styles: string[];
  priority: number;
  areas: Clip[];
}
export interface TableCell extends TablePart {
  row: number;
  column: number;
  rowSpan: number;
  colSpan: number;
  hiddenEmpty: boolean;
  radius: number[];
}
export interface TableSnapshot {
  nodeId: string;
  collapsed: boolean;
  gridBox: Rect;
  paintBox: Rect;
  parts: TablePart[];
  cells: TableCell[];
  descendantIds: string[];
}

const styleRank: Record<string, number> = {
  hidden: 100,
  double: 9,
  solid: 8,
  dashed: 7,
  dotted: 6,
  ridge: 5,
  outset: 4,
  groove: 3,
  inset: 2,
  none: 0,
};
interface Candidate extends BorderLine {
  priority: number;
  originX: number;
  originY: number;
}

/** Resolve shared CSS table edges once, including cell/row/column/table priority. */
export function collapsedBorderLines(table: TableSnapshot): BorderLine[] {
  const groups = new Map<string, Candidate[]>();
  for (const source of [...table.parts, ...table.cells]) {
    const box = source.box;
    const sides = [
      [box.x, box.y, box.x + box.width, box.y],
      [box.x + box.width, box.y, box.x + box.width, box.y + box.height],
      [box.x, box.y + box.height, box.x + box.width, box.y + box.height],
      [box.x, box.y, box.x, box.y + box.height],
    ];
    const widths = [
      source.border.top,
      source.border.right,
      source.border.bottom,
      source.border.left,
    ];
    sides.forEach(([x1, y1, x2, y2], index) => {
      const style = source.styles[index];
      if (style !== 'hidden' && (!widths[index] || style === 'none')) return;
      const key = x1 === x2 ? `v:${Math.round(x1 * 64)}` : `h:${Math.round(y1 * 64)}`;
      const candidates = groups.get(key) || [];
      candidates.push({
        x1,
        y1,
        x2,
        y2,
        width: widths[index],
        color: source.colors[index],
        style,
        priority: source.priority,
        originX: box.x,
        originY: box.y,
      });
      groups.set(key, candidates);
    });
  }
  const result: BorderLine[] = [];
  for (const candidates of groups.values()) {
    const vertical = candidates[0].x1 === candidates[0].x2;
    const ends = candidates.flatMap((line) => (vertical ? [line.y1, line.y2] : [line.x1, line.x2]));
    const minimum = Math.min(...ends);
    const maximum = Math.max(...ends);
    const cellEdges = table.cells.flatMap((cell) =>
      vertical
        ? [cell.box.y, cell.box.y + cell.box.height]
        : [cell.box.x, cell.box.x + cell.box.width],
    );
    const boundaries = [
      ...new Set([...ends, ...cellEdges.filter((value) => value > minimum && value < maximum)]),
    ].sort((a, b) => a - b);
    for (let index = 0; index < boundaries.length - 1; index++) {
      const start = boundaries[index];
      const end = boundaries[index + 1];
      const middle = (start + end) / 2;
      const fixed = vertical ? candidates[0].x1 : candidates[0].y1;
      // A row/column edge must not draw through a cell spanning across it.
      const insideSpan = table.cells.some((cell) =>
        vertical
          ? fixed > cell.box.x + 0.01 &&
            fixed < cell.box.x + cell.box.width - 0.01 &&
            middle > cell.box.y + 0.01 &&
            middle < cell.box.y + cell.box.height - 0.01
          : fixed > cell.box.y + 0.01 &&
            fixed < cell.box.y + cell.box.height - 0.01 &&
            middle > cell.box.x + 0.01 &&
            middle < cell.box.x + cell.box.width - 0.01,
      );
      if (insideSpan) continue;
      const covering = candidates.filter((line) =>
        vertical ? line.y1 <= middle && line.y2 >= middle : line.x1 <= middle && line.x2 >= middle,
      );
      if (!covering.length || covering.some((line) => line.style === 'hidden')) continue;
      covering.sort(
        (a, b) =>
          b.width - a.width ||
          (styleRank[b.style] || 0) - (styleRank[a.style] || 0) ||
          b.priority - a.priority ||
          a.originY - b.originY ||
          a.originX - b.originX,
      );
      const winner = covering[0];
      result.push({
        x1: vertical ? fixed : start,
        y1: vertical ? start : fixed,
        x2: vertical ? fixed : end,
        y2: vertical ? end : fixed,
        width: winner.width,
        color: winner.color,
        style: winner.style,
      });
    }
  }
  return result.sort((a, b) => a.width - b.width);
}

function union(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  return {
    x,
    y,
    width: Math.max(...rects.map((rect) => rect.x + rect.width)) - x,
    height: Math.max(...rects.map((rect) => rect.y + rect.height)) - y,
  };
}

function pixelBox(box: Rect): Rect {
  const x = Math.round(box.x);
  const y = Math.round(box.y);
  return {
    x,
    y,
    width: Math.round(box.x + box.width) - x,
    height: Math.round(box.y + box.height) - y,
  };
}

export function applyTablePaint(nodes: DesignNode[], tables: TableSnapshot[]) {
  const lookup = new Map(nodes.map((node) => [node.id, node]));
  let sequence = Math.max(0, ...nodes.map((node) => node.order));
  for (const table of tables) {
    const root = lookup.get(table.nodeId);
    if (!root || root.kind === 'raster') continue;
    root.paintBox = pixelBox(table.paintBox);
    if (table.collapsed) root.skipBorders = true;
    for (const part of table.parts) {
      if (part.tag === 'table') continue;
      const node = part.nodeId && lookup.get(part.nodeId);
      if (!node || node.kind === 'raster') continue;
      node.backgroundAreas = part.areas.map((area) => ({ ...pixelBox(area), radius: area.radius }));
      node.skipBackground = !part.areas.length;
      node.skipBorders = true;
      if (node.backgroundAreas.length) node.paintBox = union(node.backgroundAreas);
    }
    for (const cell of table.cells) {
      const node = cell.nodeId && lookup.get(cell.nodeId);
      if (!node || node.kind === 'raster') continue;
      node.paintBox = pixelBox(node.box);
      if (table.collapsed || cell.hiddenEmpty) node.skipBorders = true;
      if (cell.hiddenEmpty) node.skipBackground = true;
    }
    if (!table.collapsed) continue;
    const lines = collapsedBorderLines(table);
    if (!lines.length) continue;
    const descendants = new Set(table.descendantIds);
    const paintOrder = Math.max(
      root.paintOrder,
      ...nodes.filter((node) => descendants.has(node.id)).map((node) => node.paintOrder),
    );
    const id = `${root.id}-borders`;
    const borderNode: DesignNode = {
      id,
      parentId: root.id,
      children: [],
      kind: 'frame',
      name: `${root.name} · 折叠边框`,
      tag: '#table-borders',
      box: { ...table.paintBox },
      contentBox: { ...table.paintBox },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      border: { top: 0, right: 0, bottom: 0, left: 0 },
      radius: [0, 0, 0, 0],
      opacity: root.opacity,
      clips: [...root.clips],
      style: {},
      lines,
      order: ++sequence,
      paintOrder: paintOrder + 0.01,
      hasVisual: true,
    };
    root.children.push(id);
    nodes.push(borderNode);
  }
}
