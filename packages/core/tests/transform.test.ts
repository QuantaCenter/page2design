import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  matrixFromQuad,
  projectPoint,
  inverseTransform,
  transformRect,
  type TransformMatrix,
} from '../src/index.js';

test('border quad preserves rotation, origin and inverse pointer coordinates', () => {
  const box = { x: 10, y: 20, width: 80, height: 40 };
  const matrix = matrixFromQuad(box, [200, 100, 200, 180, 160, 180, 160, 100])!;
  const point = projectPoint(matrix, { x: 50, y: 40 });
  assert.deepEqual(point, { x: 180, y: 140 });
  assert.deepEqual(projectPoint(inverseTransform(matrix)!, point), { x: 50, y: 40 });
  assert.deepEqual(transformRect(matrix, box), { x: 160, y: 100, width: 40, height: 80 });
});

test('perspective quad reconstructs interior points instead of an affine approximation', () => {
  const expected: TransformMatrix = [1, 0, 10, 0, 1, 20, 0.005, 0.002, 1];
  const box = { x: 10, y: 20, width: 80, height: 40 };
  const quad = [
    [10, 20],
    [90, 20],
    [90, 60],
    [10, 60],
  ].flatMap(([x, y]) => {
    const point = projectPoint(expected, { x, y });
    return [point.x, point.y];
  });
  const matrix = matrixFromQuad(box, quad)!;
  const point = projectPoint(matrix, { x: 40, y: 30 });
  assert.ok(Math.abs(point.x - 50 / 1.26) < 1e-9);
  assert.ok(Math.abs(point.y - 50 / 1.26) < 1e-9);
  const original = projectPoint(inverseTransform(matrix)!, point);
  assert.ok(Math.abs(original.x - 40) < 1e-9);
  assert.ok(Math.abs(original.y - 30) < 1e-9);
  assert.equal(inverseTransform([0, 0, 0, 0, 0, 0, 0, 0, 1]), null);
});

test('float-rounded quads on long pages retain affine painting without losing real perspective', () => {
  const box = { x: 36, y: 4644, width: 306, height: 132 };
  const quad = [
    36, 4644, 320.19000244140625, 4658.8935546875, 313.7652282714843, 4781.4853515625,
    29.57523727416994, 4766.591796874999,
  ];
  const affine = matrixFromQuad(box, quad)!;
  assert.deepEqual(affine.slice(6), [0, 0, 1]);
  for (const [i, point] of [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x + box.width, box.y + box.height],
    [box.x, box.y + box.height],
  ].entries()) {
    const actual = projectPoint(affine, { x: point[0], y: point[1] });
    assert.ok(Math.abs(actual.x - quad[i * 2]) < 0.001);
    assert.ok(Math.abs(actual.y - quad[i * 2 + 1]) < 0.001);
  }
  const perspective = matrixFromQuad(
    box,
    quad.map((value, index) => (index === 4 ? value - 1 : value)),
  )!;
  assert.ok(Math.abs(perspective[6]) + Math.abs(perspective[7]) > 1e-8);
});
