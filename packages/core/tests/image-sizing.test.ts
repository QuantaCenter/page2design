import { test } from 'node:test';
import assert from 'node:assert/strict';
import { concreteImageSize } from '../src/canvas/images.js';

test('ratio-only SVG backgrounds use the positioning area rather than decoder fallback dimensions', () => {
  assert.deepEqual(concreteImageSize({ ratio: 1 }, { width: 64, height: 64 }), {
    width: 64,
    height: 64,
  });
  assert.deepEqual(concreteImageSize({ ratio: 2 }, { width: 120, height: 80 }), {
    width: 120,
    height: 60,
  });
  assert.deepEqual(concreteImageSize({}, { width: 120, height: 80 }), { width: 120, height: 80 });
});

test('explicit and one-sided SVG sizes retain natural dimensions and aspect ratio', () => {
  assert.deepEqual(
    concreteImageSize({ width: 40, height: 30, ratio: 4 / 3 }, { width: 64, height: 64 }),
    { width: 40, height: 30 },
  );
  assert.deepEqual(concreteImageSize({ width: 40, ratio: 2 }, { width: 64, height: 64 }), {
    width: 40,
    height: 20,
  });
  assert.deepEqual(concreteImageSize({ height: 30, ratio: 2 }, { width: 64, height: 64 }), {
    width: 60,
    height: 30,
  });
  assert.deepEqual(concreteImageSize({ ratio: 2 }, { width: 64, height: 64 }, 48), {
    width: 48,
    height: 24,
  });
  assert.deepEqual(concreteImageSize({ ratio: 2 }, { width: 64, height: 64 }, undefined, 24), {
    width: 48,
    height: 24,
  });
});
