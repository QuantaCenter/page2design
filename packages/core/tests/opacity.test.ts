import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertSnapshot, flattenDocument, type DesignNode } from '../src/index.js';

test('nested opacity isolation survives flattening without merging child layers', () => {
  const makeNode = (
    id: string,
    parentId: string | null,
    opacity: number,
    local: string,
  ): DesignNode => ({
    id,
    parentId,
    children: [],
    kind: 'frame',
    tag: 'div',
    name: id,
    box: { x: 0, y: 0, width: 100, height: 100 },
    contentBox: { x: 0, y: 0, width: 100, height: 100 },
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    border: { top: 0, right: 0, bottom: 0, left: 0 },
    radius: [0, 0, 0, 0],
    opacity,
    style: { opacity: local },
    clips: [],
    order: 0,
    paintOrder: 0,
    hasVisual: true,
  });
  const parent = makeNode('outer', null, 0.5, '.5');
  const inner = makeNode('inner', parent.id, 0.2, '.4');
  const leaf = makeNode('leaf', inner.id, 0.2, '1');
  parent.children = [inner.id];
  inner.children = [leaf.id];
  const source = {
    id: 'opacity',
    capturedAt: '2026-11-17T00:00:00Z',
    title: 'Opacity',
    width: 100,
    height: 100,
    viewport: { width: 100, height: 100 },
    background: '#fff',
    nodes: [parent, inner, leaf],
    assets: [],
  };
  const document = convertSnapshot(source);
  const expected = [
    { id: 'outer', opacity: 0.5 },
    { id: 'inner', opacity: 0.4 },
  ];
  assert.deepEqual(document.nodes.find((node) => node.id === leaf.id)!.opacityGroups, expected);
  const flat = flattenDocument(document);
  assert.equal(flat.nodes.length, 3);
  assert.ok(flat.nodes.every((node) => node.parentId === null));
  assert.deepEqual(flat.nodes.find((node) => node.id === leaf.id)!.opacityGroups, expected);
  assert.equal(source.nodes[0].opacityGroups, undefined);
});
