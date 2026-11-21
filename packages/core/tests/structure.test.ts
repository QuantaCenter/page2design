import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DesignDocument, DesignNode } from '../src/model/design.js';
import { flattenDocument } from '../src/model/structure.js';
import { nodeCss } from '../src/model/css.js';

test('flattening preserves rendering, source hierarchy, stable IDs and fractional geometry', () => {
  const makeNode = (id: string, values: Partial<DesignNode>): DesignNode => ({
    id,
    parentId: null,
    children: [],
    kind: 'frame',
    name: id,
    tag: 'div',
    box: { x: 12.5, y: 24.25, width: 100, height: 60 },
    contentBox: { x: 12.5, y: 24.25, width: 100, height: 60 },
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    border: { top: 0, right: 0, bottom: 0, left: 0 },
    radius: [0, 0, 0, 0],
    opacity: 1,
    clips: [],
    style: {},
    order: 0,
    paintOrder: 0,
    hasVisual: true,
    ...values,
  });
  const parent = makeNode('container', {
    children: ['text', 'image'],
    padding: { top: 16, right: 16, bottom: 16, left: 16 },
    margin: { top: 24, right: 0, bottom: 24, left: 0 },
    style: {
      display: 'flex',
      position: 'sticky',
      gap: '24px',
      'flex-direction': 'column',
      'min-width': '40vw',
      'max-width': '100%',
      transform: 'matrix(1, 0, 0, 1, 0, 0)',
      'background-color': 'rgb(115, 96, 232)',
    },
  });
  const text = makeNode('text', {
    parentId: parent.id,
    kind: 'text',
    text: 'A clipped label',
    order: 1,
    paintOrder: 5,
    clips: [{ x: 12, y: 24, width: 80, height: 40, radius: [8, 8, 8, 8] }],
    style: { color: 'rgb(35, 45, 55)' },
    opacity: 0.75,
  });
  const image = makeNode('image', {
    parentId: parent.id,
    kind: 'image',
    assetId: 'asset-1',
    order: 2,
    paintOrder: 3,
    padding: { top: 6, right: 6, bottom: 6, left: 6 },
    contentBox: { x: 18.5, y: 30.25, width: 88, height: 48 },
  });
  const document: DesignDocument = {
    version: 1,
    structure: 'hierarchical',
    id: 'document',
    title: 'Structure fixture',
    url: 'http://localhost/',
    capturedAt: '2026-11-16T00:00:00.000Z',
    viewport: { width: 390, height: 844 },
    width: 390,
    height: 844,
    background: '#fff',
    nodes: [parent, text, image],
    assets: [],
    fonts: [],
    referenceImage: '',
    warnings: [],
    stats: { durationMs: 0, nativeNodes: 3, rasterNodes: 0, textRuns: 1 },
  };
  const original = structuredClone(document);
  const flat = flattenDocument(document);
  assert.equal(flat.structure, 'flat');
  assert.equal(flat.layout, 'absolute');
  assert.deepEqual(
    flat.nodes.map((node) => node.id),
    ['container', 'image', 'text'],
  );
  assert.ok(flat.nodes.every((node) => node.parentId === null && node.children.length === 0));
  for (const source of document.nodes) {
    const flattened = flat.nodes.find((node) => node.id === source.id)!;
    assert.equal(flattened.positioning, 'absolute');
    assert.equal(flattened.style.position, 'absolute');
    assert.equal(flattened.style.left, `${source.box.x}px`);
    assert.equal(flattened.style.top, `${source.box.y}px`);
    assert.equal(flattened.style.width, `${source.box.width}px`);
    assert.equal(flattened.style.height, `${source.box.height}px`);
    for (const property of [
      'gap',
      'flex-direction',
      'grid-template-columns',
      'min-width',
      'max-width',
      'transform',
    ])
      assert.equal(flattened.style[property], undefined);
    assert.deepEqual(flattened.padding, { top: 0, right: 0, bottom: 0, left: 0 });
    assert.deepEqual(flattened.margin, { top: 0, right: 0, bottom: 0, left: 0 });
    for (const property of [
      'box',
      'border',
      'radius',
      'opacity',
      'clips',
      'text',
      'runs',
      'assetId',
      'paintOrder',
      'order',
    ] as const)
      assert.deepEqual(flattened[property], source[property]);
  }
  assert.deepEqual(flat.nodes.find((node) => node.id === image.id)?.imageBox, image.contentBox);
  assert.equal(flat.nodes[0].style['background-color'], parent.style['background-color']);
  const css = nodeCss(flat.nodes[0]);
  assert.match(css, /position: absolute;/);
  assert.match(css, /left: 12\.5px;/);
  assert.match(css, /top: 24\.25px;/);
  assert.match(css, /width: 100px;/);
  assert.match(css, /margin: 0;/);
  assert.match(css, /padding: 0;/);
  assert.doesNotMatch(css, /flex|grid|gap|min-width|max-width|%|vw|sticky|transform/);
  assert.match(nodeCss(parent), /display: flex;/);
  assert.match(nodeCss(parent), /padding: 16px 16px 16px 16px;/);
  assert.deepEqual(document, original);
  flat.nodes[0].children.push('independent-array');
  assert.deepEqual(parent.children, ['text', 'image']);
});
