import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DesignNode } from '../src/model/design.js';
import { applyStackingOrder } from '../src/model/stacking.js';
import { applyOpacityGroups } from '../src/model/opacity.js';
import { applyNativeTransforms } from '../src/model/transform.js';
import { flattenDocument } from '../src/model/structure.js';
import type { DesignDocument } from '../src/model/design.js';
import { nodeCss } from '../src/model/css.js';

function node(
  id: string,
  parentId: string | null,
  order: number,
  paintOrder: number,
  style: Record<string, string> = {},
  kind: DesignNode['kind'] = 'frame',
): DesignNode {
  return {
    id,
    name: id,
    tag: id === 'html' || id === 'body' ? id : 'div',
    parentId,
    children: [],
    kind,
    box: { x: 0, y: 0, width: 100, height: 100 },
    contentBox: { x: 0, y: 0, width: 100, height: 100 },
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    border: { top: 0, right: 0, bottom: 0, left: 0 },
    clips: [],
    radius: [0, 0, 0, 0],
    opacity: 1,
    order,
    paintOrder,
    hasVisual: true,
    style: { position: 'static', 'z-index': 'auto', ...style },
  };
}
const ids = (nodes: DesignNode[]) =>
  [...nodes].sort((a, b) => a.paintOrder - b.paintOrder).map((node) => node.id);

test('negative child contexts paint before in-flow content while remaining above the parent background', () => {
  const nodes = [
    node('html', null, 1, 1),
    node('card', 'html', 2, 10, { position: 'relative', 'z-index': '1' }),
    node('front', 'card', 3, 10),
    node('text', 'front', 4, 10, { 'z-index': '1', position: 'relative' }, 'text'),
    node('back', 'card', 5, 12, { position: 'absolute', 'z-index': '-1' }),
    node('far', 'card', 6, 11, { position: 'absolute', 'z-index': '-2' }),
  ];
  applyStackingOrder(nodes);
  assert.deepEqual(ids(nodes), ['html', 'card', 'far', 'back', 'front', 'text']);
});

test('auto wrappers let negative contexts participate in the nearest real context and keep their positive descendants atomic', () => {
  const nodes = [
    node('html', null, 1, 1),
    node('card', 'html', 2, 10, { isolation: 'isolate' }),
    node('front', 'card', 3, 10),
    node('wrapper', 'card', 4, 11, { position: 'relative' }),
    node('back', 'wrapper', 5, 12, { position: 'absolute', 'z-index': '-1' }),
    node('high-child', 'back', 6, 13, { position: 'absolute', 'z-index': '999' }),
    node('outside', 'html', 7, 14, { position: 'relative', 'z-index': '2' }),
  ];
  applyStackingOrder(nodes);
  assert.deepEqual(ids(nodes), [
    'html',
    'card',
    'back',
    'high-child',
    'front',
    'wrapper',
    'outside',
  ]);
});

test('nested contexts resolve independently and preserve negative level and DOM tie order', () => {
  const nodes = [
    node('html', null, 1, 1),
    node('outer', 'html', 2, 5, { contain: 'paint' }),
    node('front', 'outer', 3, 5),
    node('back', 'outer', 4, 6, { position: 'absolute', 'z-index': '-1' }),
    node('back-front', 'back', 5, 6),
    node('back-under', 'back', 6, 7, { position: 'absolute', 'z-index': '-1' }),
    node('same-level-later', 'outer', 7, 8, { position: 'absolute', 'z-index': '-1' }),
  ];
  applyStackingOrder(nodes);
  assert.deepEqual(ids(nodes), [
    'html',
    'outer',
    'back',
    'back-under',
    'back-front',
    'same-level-later',
    'front',
  ]);
});

test('a static indexed flex item establishes a context, while a plain static z-index does not', () => {
  const nodes = [
    node('html', null, 1, 1),
    node('flex', 'html', 2, 1, { display: 'flex' }),
    node('card', 'flex', 3, 4, { 'z-index': '1' }),
    node('front', 'card', 4, 4),
    node('plain', 'card', 5, 4, { 'z-index': '5' }),
    node('back', 'plain', 6, 5, { position: 'absolute', 'z-index': '-1' }),
  ];
  applyStackingOrder(nodes);
  assert.deepEqual(ids(nodes), ['html', 'flex', 'card', 'back', 'front', 'plain']);
});

test('the propagated body background remains below negative root layers', () => {
  const nodes = [
    node('html', null, 1, 1),
    node('body', 'html', 2, 1, { 'background-color': 'rgb(255, 255, 255)' }),
    node('front', 'body', 3, 1),
    node('back', 'body', 4, 2, { position: 'absolute', 'z-index': '-1' }),
  ];
  applyStackingOrder(nodes);
  assert.deepEqual(ids(nodes), ['html', 'body', 'back', 'front']);
});

test('containment prevents a body background from becoming the root negative-layer anchor', () => {
  for (const owner of ['html', 'body']) {
    const nodes = [
      node('html', null, 1, 1),
      node('body', 'html', 2, 1, { 'background-color': 'rgb(255, 255, 255)' }),
      node('front', 'body', 3, 1),
      node('back', 'body', 4, 2, { position: 'absolute', 'z-index': '-1' }),
    ];
    nodes.find((n) => n.id === owner)!.style.contain = 'size';
    applyStackingOrder(nodes);
    assert.deepEqual(ids(nodes), ['html', 'back', 'body', 'front']);
  }
});

test('a canvas background keeps root effects and paint order while body and root boxes remain independently editable', () => {
  const root = node('html', null, 1, 1, { opacity: '.5', filter: 'brightness(.8)' });
  root.opacity = 0.5;
  root.captureSourceId = 'source-root';
  const body = node('body', 'html', 2, 1, {
    'background-color': '#2676c8',
    'background-image': 'linear-gradient(red,blue)',
    'box-shadow': '2px 3px 4px black',
  });
  body.skipBoxBackground = true;
  const background = node('canvas', 'html', 0.99, 0.99, {
    'background-color': '#2676c8',
    'pointer-events': 'none',
  });
  background.canvasBackground = { source: 'body', area: { x: 0, y: 0, width: 300, height: 600 } };
  background.opacity = 0.5;
  const back = node('back', 'body', 3, 2, { position: 'absolute', 'z-index': '-1' }),
    front = node('front', 'body', 4, 1);
  root.children = [background.id, body.id];
  body.children = [back.id, front.id];
  const nodes = [background, root, body, back, front];
  applyStackingOrder(nodes);
  applyOpacityGroups(nodes);
  assert.deepEqual(ids(nodes), ['canvas', 'html', 'back', 'body', 'front']);
  assert.equal(background.compositingGroups?.[0].id, 'html');
  assert.equal(background.compositingGroups?.[0].opacity, 0.5);
  assert.equal(background.compositingGroups?.[0].filter, 'brightness(.8)');
  applyNativeTransforms(nodes, { 'source-root': [1, 0, 20, 0, 1, 30, 0, 0, 1] });
  assert.equal(background.transform, undefined);
  assert.equal(front.transform?.[2], 20);
  const document: DesignDocument = {
    version: 1,
    id: 'canvas-test',
    title: 'Canvas',
    capturedAt: '2026-11-17',
    viewport: { width: 300, height: 200 },
    width: 300,
    height: 600,
    background: '#fff',
    nodes,
    assets: [],
    fonts: [],
    referenceImage: '',
    warnings: [],
    stats: { durationMs: 0, nativeNodes: 5, rasterNodes: 0, textRuns: 0 },
  };
  const flat = flattenDocument(document),
    flatBody = flat.nodes.find((n) => n.id === 'body')!;
  assert.equal(flatBody.style['background-color'], 'transparent');
  assert.equal(flatBody.style['background-image'], undefined);
  assert.equal(flatBody.style['box-shadow'], '2px 3px 4px black');
  assert.deepEqual(
    flat.nodes.find((n) => n.id === 'canvas')!.canvasBackground,
    background.canvasBackground,
  );
  assert.equal(body.style['background-color'], '#2676c8');
  assert.doesNotMatch(nodeCss(body), /background-(?:image|color)/);
  assert.match(nodeCss(body), /box-shadow/);
});
