import type { DesignDocument, DesignNode } from './design.js';

// Only visual properties survive. Source Flex/Grid, constraints and spacing are
// replaced by fixed root coordinates rather than leaking into the design data.
const visualProperties = new Set([
  'background-color',
  'background-image',
  'background-size',
  'background-position',
  'background-repeat',
  'background-origin',
  'background-clip',
  'background-attachment',
  'background-blend-mode',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-decoration-line',
  'object-fit',
  'object-position',
  'border-radius',
  'box-shadow',
  'text-shadow',
  'filter',
  'backdrop-filter',
  'mix-blend-mode',
  'isolation',
  'clip-path',
  'mask-image',
  'mask-mode',
  'mask-composite',
  'mask-size',
  'mask-position',
  'mask-repeat',
  'mask-origin',
  'mask-clip',
  'pointer-events',
  ...['top', 'right', 'bottom', 'left'].flatMap((side) => [
    `border-${side}-color`,
    `border-${side}-style`,
    `border-${side}-width`,
  ]),
]);

function absoluteStyle(node: DesignNode, index: number): Record<string, string> {
  return {
    ...Object.fromEntries(
      Object.entries(node.style).filter(
        ([property]) =>
          visualProperties.has(property) &&
          !(
            (node.skipBoxBackground && property.startsWith('background-')) ||
            (node.skipBackground &&
              (property.startsWith('background-') || property === 'box-shadow'))
          ),
      ),
    ),
    ...(node.skipBackground || node.skipBoxBackground ? { 'background-color': 'transparent' } : {}),
    position: 'absolute',
    left: `${node.box.x}px`,
    top: `${node.box.y}px`,
    width: `${node.box.width}px`,
    height: `${node.box.height}px`,
    'z-index': String(index),
    'box-sizing': 'border-box',
    display: 'block',
    margin: '0px',
    padding: '0px',
    'text-align': 'left',
    'white-space': 'pre',
  };
}

/**
 * Captured geometry and ancestor clips are already in document coordinates.
 * Each node is an independent root object with fixed artboard coordinates.
 * Image insets and ancestor masks become fixed drawing geometry; no layout
 * constraints survive. The untouched source document can still be restored.
 */
export function flattenDocument(document: DesignDocument): DesignDocument {
  return {
    ...document,
    structure: 'flat',
    layout: 'absolute',
    nodes: [...document.nodes]
      .sort((a, b) => a.paintOrder - b.paintOrder || a.order - b.order)
      .map((node, index) => ({
        ...node,
        positioning: 'absolute',
        parentId: null,
        children: [],
        contentBox: { ...(node.localBox || node.box) },
        controlBox:
          node.kind === 'control' ? { ...(node.controlBox || node.contentBox) } : node.controlBox,
        imageBox:
          ['image', 'video', 'canvas', 'svg'].includes(node.kind) || node.control?.type === 'image'
            ? { ...(node.imageBox || node.contentBox) }
            : node.imageBox,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        style: absoluteStyle(node, index),
      })),
  };
}
