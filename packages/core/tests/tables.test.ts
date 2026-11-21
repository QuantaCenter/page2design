import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  collapsedBorderLines,
  type TableCell,
  type TablePart,
  type TableSnapshot,
} from '../src/model/tables.js';

const cell = (x: number, y: number, width: number, height: number): TableCell => ({
  tag: 'td',
  box: { x, y, width, height },
  border: { top: 0, right: 0, bottom: 0, left: 0 },
  colors: ['red', 'red', 'red', 'red'],
  styles: ['none', 'none', 'none', 'none'],
  priority: 6,
  areas: [],
  row: 0,
  column: 0,
  rowSpan: 1,
  colSpan: 1,
  hiddenEmpty: false,
  radius: [0, 0, 0, 0],
});
const table = (cells: TableCell[], parts: TablePart[] = []): TableSnapshot => ({
  nodeId: 'table',
  collapsed: true,
  gridBox: { x: 0, y: 0, width: 20, height: 20 },
  paintBox: { x: 0, y: 0, width: 20, height: 20 },
  cells,
  parts,
  descendantIds: [],
});

test('collapsed borders resolve width, style, cell priority and hidden suppression', () => {
  const left = cell(0, 0, 10, 10);
  const right = cell(10, 0, 10, 10);
  left.border.right = 1;
  left.styles[1] = 'solid';
  right.border.left = 2;
  right.styles[3] = 'dashed';
  right.colors[3] = 'blue';
  assert.equal(collapsedBorderLines(table([left, right]))[0].color, 'blue');
  left.border.right = 3;
  right.border.left = 3;
  right.styles[3] = 'double';
  assert.equal(collapsedBorderLines(table([left, right]))[0].style, 'double');
  right.styles[3] = 'solid';
  assert.equal(collapsedBorderLines(table([left, right]))[0].color, 'red'); // same-level leftmost cell wins
  const row: TablePart = {
    ...cell(0, 0, 10, 10),
    priority: 5,
    colors: ['green', 'green', 'green', 'green'],
  };
  row.border.right = 3;
  row.styles[1] = 'solid';
  assert.equal(collapsedBorderLines(table([left, right], [row]))[0].color, 'red');
  right.styles[3] = 'hidden';
  right.border.left = 0;
  assert.deepEqual(collapsedBorderLines(table([left, right], [row])), []);
});

test('row borders stop at a rowspan cell instead of drawing through its middle', () => {
  const spanning = cell(0, 0, 10, 20);
  spanning.rowSpan = 2;
  const upper = cell(10, 0, 10, 10);
  const lower = cell(10, 10, 10, 10);
  const row: TablePart = { ...cell(0, 0, 20, 10), tag: 'tr', priority: 5 };
  row.border.bottom = 2;
  row.styles[2] = 'solid';
  const lines = collapsedBorderLines(table([spanning, upper, lower], [row]));
  assert.equal(lines.length, 1);
  assert.deepEqual([lines[0].x1, lines[0].y1, lines[0].x2, lines[0].y2], [10, 10, 20, 10]);
});
