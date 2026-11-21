import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitCamera, measureRects, screenToDocument, zoomAt } from '../src/model/geometry.js';

test('zoom keeps the document point under the cursor fixed', () => {
  const camera = { x: 137, y: -82, scale: 0.73 };
  const point = { x: 413, y: 256 };
  const before = screenToDocument(point, camera);
  const next = zoomAt(camera, point, 2.4);
  const after = screenToDocument(point, next);
  assert.ok(Math.abs(before.x - after.x) < 1e-8);
  assert.ok(Math.abs(before.y - after.y) < 1e-8);
});

test('zoom limits do not change the anchor', () => {
  const camera = { x: 0, y: 0, scale: 1 };
  const point = { x: 200, y: 300 };
  const next = zoomAt(camera, point, 100);
  assert.equal(next.scale, 4);
  assert.deepEqual(screenToDocument(point, next), point);
});

test('vertical sibling distance is the gap between borders', () => {
  const result = measureRects(
    { x: 24, y: 72, width: 280, height: 100 },
    { x: 24, y: 196, width: 280, height: 80 },
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].value, 24);
  assert.equal(result[0].axis, 'y');
});

test('contained elements expose four interior edge distances in either order', () => {
  const outer = { x: 10, y: 20, width: 200, height: 120 };
  const inner = { x: 26, y: 44, width: 152, height: 64 };
  const result = measureRects(outer, inner);
  assert.deepEqual(
    result.map((segment) => segment.value),
    [16, 32, 24, 32],
  );
  assert.deepEqual(measureRects(inner, outer), result);
});

test('overlapping objects have no positive edge gap', () => {
  assert.deepEqual(
    measureRects(
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 50, y: 50, width: 100, height: 100 },
    ),
    [],
  );
});

test('fit camera respects the viewport and reserves room for the toolbar', () => {
  const camera = fitCamera({ width: 390, height: 844 }, { width: 1000, height: 1000 });
  assert.equal(camera.scale, 1);
  assert.equal(camera.x, 305);
  assert.equal(camera.y, 90);
});
