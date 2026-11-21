import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cssLength, splitCss } from '../src/canvas/css-values.js';
import { inverseTransform, multiplyTransforms, projectPoint } from '../src/model/transform.js';
import type { TransformMatrix } from '../src/model/design.js';

test('CSS list parsing preserves quoted SVG payloads and nested colors', () => {
  const css =
    'url("data:image/svg+xml,<svg data-x=\'a,b\'>(foo)</svg>"), radial-gradient(rgb(1,2,3),#fff)';
  assert.deepEqual(splitCss(css), [
    'url("data:image/svg+xml,<svg data-x=\'a,b\'>(foo)</svg>")',
    'radial-gradient(rgb(1,2,3),#fff)',
  ]);
  assert.deepEqual(splitCss('calc(30% + 5px) min(40px, 70%)', true), [
    'calc(30% + 5px)',
    'min(40px, 70%)',
  ]);
});
test('computed CSS math resolves percentages, nesting and angles without executing input', () => {
  assert.equal(cssLength('calc(30% + 5px)', 200), 65);
  assert.equal(cssLength('clamp(12px, calc(50% - 4px), 60px)', 200), 60);
  assert.equal(cssLength('max(10px, min(25%, 80px))', 200), 50);
  assert.equal(cssLength('calc(100% / 2 - 3px)', -100), -53);
  assert.equal(cssLength('.5turn', Math.PI * 2, true), Math.PI);
  assert.ok(Number.isNaN(cssLength('1px; throw Error()', 100)));
});
test('nested effect coordinate matrices compose back to the same projected point', () => {
  const parent: TransformMatrix = [1.2, 0.15, 30, 0.2, 0.75, 15, 0.0001, 0.0002, 1],
    child: TransformMatrix = [0.9, -0.2, 9, 0.1, 1.1, 7, 0, 0, 1];
  const world = multiplyTransforms(parent, child),
    relative = multiplyTransforms(inverseTransform(parent)!, world);
  for (const point of [
    { x: 0, y: 0 },
    { x: 120, y: 80 },
  ]) {
    const a = projectPoint(relative, point),
      b = projectPoint(child, point);
    assert.ok(Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 1e-8);
  }
});
