import type { DesignNode } from './design.js';
import { round } from './geometry.js';

export function nodeCss(node: DesignNode) {
  const style = node.style;
  const absolute = node.positioning === 'absolute';
  const properties: [string, string][] = [];
  if (absolute)
    properties.push(
      ['position', 'absolute'],
      ['left', `${round(node.box.x, 2)}px`],
      ['top', `${round(node.box.y, 2)}px`],
    );
  properties.push(
    ['box-sizing', 'border-box'],
    ['width', `${round(node.box.width, 2)}px`],
    ['height', `${round(node.box.height, 2)}px`],
  );
  if (absolute) properties.push(['z-index', style['z-index']], ['margin', '0'], ['padding', '0']);
  if (node.kind === 'text') {
    if (absolute) properties.push(['white-space', 'pre']);
    for (const key of [
      'font-family',
      'font-size',
      'font-weight',
      'line-height',
      'letter-spacing',
      'color',
      'text-align',
      'text-shadow',
    ]) {
      if (style[key] && style[key] !== 'normal') properties.push([key, style[key]]);
    }
  } else {
    const keys = absolute
      ? ['background-color', 'background-image', 'border-radius', 'box-shadow']
      : [
          'display',
          'background-color',
          'background-image',
          'border-radius',
          'box-shadow',
          'gap',
          'flex-direction',
          'justify-content',
          'align-items',
        ];
    for (const key of keys) {
      if (node.skipBoxBackground && key.startsWith('background-')) continue;
      if (node.skipBackground && (key.startsWith('background-') || key === 'box-shadow')) continue;
      if (style[key] && !['none', 'normal', '0px', 'rgba(0, 0, 0, 0)'].includes(style[key]))
        properties.push([key, style[key]]);
    }
    if (!absolute && Object.values(node.padding).some(Boolean))
      properties.push([
        'padding',
        `${node.padding.top}px ${node.padding.right}px ${node.padding.bottom}px ${node.padding.left}px`,
      ]);
    for (const side of node.skipBorders ? [] : ['top', 'right', 'bottom', 'left']) {
      if (parseFloat(style[`border-${side}-width`]) > 0)
        properties.push([
          `border-${side}`,
          `${style[`border-${side}-width`]} ${style[`border-${side}-style`]} ${style[`border-${side}-color`]}`,
        ]);
    }
  }
  return `.element {\n${properties.map(([name, value]) => `  ${name}: ${value};`).join('\n')}\n}`;
}
