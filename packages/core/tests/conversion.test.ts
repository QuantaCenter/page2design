import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  completeConversion,
  convertSnapshot,
  prepareConversion,
  applyNativeTransforms,
  flattenDocument,
  type PageSnapshot,
} from '../src/index.js';

function input(): PageSnapshot {
  const box = { x: 12.5, y: 24, width: 180, height: 72 };
  return {
    id: 'provided-snapshot',
    capturedAt: '2026-11-16T00:00:00.000Z',
    title: 'Prepared layout',
    viewport: { width: 390, height: 844 },
    width: 390,
    height: 844,
    background: '#fff',
    assets: [],
    nodes: [
      {
        id: 'box',
        parentId: null,
        children: [],
        kind: 'frame',
        name: 'Box',
        tag: 'div',
        box,
        contentBox: box,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        border: { top: 0, right: 0, bottom: 0, left: 0 },
        radius: [8, 8, 8, 8],
        opacity: 1,
        clips: [],
        style: { 'background-color': '#7360e8' },
        order: 0,
        paintOrder: 0,
        hasVisual: true,
      },
    ],
  };
}

test('conversion uses supplied information deterministically without mutating it', () => {
  const snapshot = input(),
    before = structuredClone(snapshot);
  const first = convertSnapshot(snapshot, { structure: 'flat' });
  assert.deepEqual(first, convertSnapshot(snapshot, { structure: 'flat' }));
  assert.deepEqual(snapshot, before);
  assert.equal(first.url, undefined);
  assert.equal(first.nodes[0].positioning, 'absolute');
  first.nodes[0].style['background-color'] = 'red';
  assert.equal(snapshot.nodes[0].style['background-color'], '#7360e8');
  assert.equal(first.stats.nativeNodes, 1);
});

test('staged conversion lets a host provide bitmap data after layout planning', () => {
  const snapshot = input();
  snapshot.nodes[0].kind = 'raster';
  const plan = prepareConversion(snapshot);
  assert.throws(() => completeConversion(plan, snapshot), /must supply an asset/);
  plan.nodes[0].assetId = 'provided-bitmap';
  const resources = {
    ...snapshot,
    assets: [{ id: 'provided-bitmap', mime: 'image/png', dataUrl: 'data:image/png;base64,AAAA' }],
  };
  const document = completeConversion(plan, resources);
  assert.equal(document.nodes[0].assetId, 'provided-bitmap');
  assert.equal(document.stats.rasterNodes, 1);
  assert.equal(snapshot.nodes[0].assetId, undefined);
  assert.equal(resources.assets[0].dataUrl, document.assets[0].dataUrl);
  assert.equal(document.assets[0].url, undefined);
});

test('conversion rejects URL-only input and unresolved remote resource bytes', () => {
  assert.throws(
    () => convertSnapshot('https://example.com' as unknown as PageSnapshot),
    /structured page snapshot/,
  );
  const snapshot = input();
  snapshot.assets = [
    {
      id: 'remote',
      url: 'https://example.com/image.png',
      mime: 'image/png',
      dataUrl: 'https://example.com/image.png',
    },
  ];
  assert.throws(() => convertSnapshot(snapshot), /must contain inline data/);
  const invalid = input();
  invalid.nodes[0].box.width = -1;
  assert.throws(() => convertSnapshot(invalid), /Invalid layout box/);
});

test('native canvas content requires pixels except for zero intrinsic size', () => {
  const snapshot = input();
  snapshot.nodes[0].kind = 'canvas';
  snapshot.nodes[0].canvas = { width: 160, height: 90 };
  assert.throws(() => convertSnapshot(snapshot), /must supply an asset/);
  snapshot.nodes[0].canvas.width = 0;
  assert.equal(convertSnapshot(snapshot).stats.rasterNodes, 0);
});

test('clipping and mask boundaries retain editable children and transformed hit geometry after flattening', () => {
  const snapshot = input(),
    parent = snapshot.nodes[0],
    box = { ...parent.box, radius: [8, 8, 8, 8] };
  parent.style.opacity = '.6';
  parent.opacity = 0.6;
  parent.children = ['child'];
  parent.captureSourceId = 'source';
  parent.clipPath = { ownerId: parent.id, box, value: 'circle(40%)' };
  parent.maskLayers = [
    {
      image: 'linear-gradient(black,transparent)',
      box,
      clip: box,
      style: {},
      mode: 'alpha',
      composite: 'add',
    },
  ];
  snapshot.nodes = [
    ...snapshot.nodes,
    {
      ...structuredClone(parent),
      id: 'child',
      parentId: parent.id,
      children: [],
      style: { 'background-color': '#387ca6' },
      clipPath: undefined,
      maskLayers: undefined,
      captureSourceId: undefined,
      order: 1,
      paintOrder: 1,
    },
  ];
  const before = structuredClone(snapshot),
    plan = prepareConversion(snapshot);
  const matrix: [number, number, number, number, number, number, number, number, number] = [
    1, 0, 22, 0, 1, -8, 0, 0, 1,
  ];
  applyNativeTransforms(plan.nodes, { source: matrix });
  const result = completeConversion(plan, snapshot),
    flat = flattenDocument(result),
    child = flat.nodes.find((node) => node.id === 'child')!;
  assert.equal(result.stats.rasterNodes, 0);
  assert.equal(result.nodes[0].children[0], 'child');
  assert.deepEqual(child.compositingGroups, [
    { id: 'box', opacity: 0.6, clipPath: true, mask: true },
  ]);
  assert.deepEqual(child.clipPaths, [
    { ownerId: 'box', box, value: 'circle(40%)', transform: matrix },
  ]);
  assert.deepEqual(snapshot, before);
});

test('nested CSS image sources require supplied assets and remain portable when flattened', () => {
  const snapshot = input(),
    node = snapshot.nodes[0];
  const source = {
    image: 'url("icon.svg")',
    url: 'https://example.com/icon.svg',
    assetId: undefined as string | undefined,
  };
  node.backgroundLayers = [
    {
      image: 'cross-fade(...)',
      box: node.box,
      clip: { ...node.box, radius: [0, 0, 0, 0] },
      style: {},
      crossFade: [
        { weight: 0.5, source: { image: 'cross-fade(...)', crossFade: [{ weight: 1, source }] } },
      ],
    },
  ];
  assert.throws(() => convertSnapshot(snapshot), /must supply a background asset/);
  source.assetId = 'source';
  assert.throws(() => convertSnapshot(snapshot), /Missing background asset/);
  snapshot.assets = [
    { id: 'source', mime: 'image/svg+xml', dataUrl: 'data:image/svg+xml;base64,AAAA' },
  ];
  const result = convertSnapshot(snapshot, { structure: 'flat' });
  assert.equal(
    result.nodes[0].backgroundLayers![0].crossFade![0].source.crossFade![0].source.assetId,
    'source',
  );
  assert.equal(result.stats.rasterNodes, 0);
});

test('native filters and blend boundaries survive flattening without replacing descendants', () => {
  const snapshot = input(),
    outer = snapshot.nodes[0];
  outer.style = { ...outer.style, filter: 'blur(3px)', opacity: '.5', isolation: 'isolate' };
  outer.opacity = 0.5;
  const inner = structuredClone(outer);
  inner.id = 'inner';
  inner.parentId = outer.id;
  inner.style = { opacity: '1', 'mix-blend-mode': 'multiply' };
  outer.children = [inner.id];
  snapshot.nodes = [...snapshot.nodes, inner];
  const doc = convertSnapshot(snapshot),
    flat = convertSnapshot(snapshot, { structure: 'flat' });
  const expected = [
    { id: outer.id, opacity: 0.5, filter: 'blur(3px)', isolate: true },
    { id: inner.id, opacity: 1, blendMode: 'multiply' },
  ];
  assert.deepEqual(doc.nodes.find((n) => n.id === inner.id)!.compositingGroups, expected);
  assert.deepEqual(flat.nodes.find((n) => n.id === inner.id)!.compositingGroups, expected);
  assert.equal(flat.nodes.length, 2);
  assert.equal(flat.stats.rasterNodes, 0);
  assert.equal(inner.compositingGroups, undefined);
});
