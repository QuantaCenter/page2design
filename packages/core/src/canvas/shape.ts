import { cssLength, splitCss } from './css-values.js';
import { imagePosition } from './images.js';

/** Convert resolved CSS shape() commands into the shared native vector path. */
export function shapeData(body: string, width: number, height: number) {
  const parts = splitCss(body),
    head = splitCss(parts.shift()!, true),
    rule = head[0] === 'evenodd' ? ('evenodd' as const) : ('nonzero' as const);
  const position = (values: string[]) =>
    imagePosition(
      values
        .join(' ')
        .replace(/\bx-start\b/g, 'left')
        .replace(/\bx-end\b/g, 'right')
        .replace(/\by-start\b/g, 'top')
        .replace(/\by-end\b/g, 'bottom'),
      width,
      height,
    );
  let current = position(head.slice(head.indexOf('from') + 1)),
    start = { ...current },
    data = `M ${current.x} ${current.y}`;
  const point = (tokens: string[], relative: boolean, anchor = current) =>
    relative
      ? { x: anchor.x + cssLength(tokens[0], width), y: anchor.y + cssLength(tokens[1], height) }
      : position(tokens);
  const pair = (p: { x: number; y: number }) => `${p.x} ${p.y}`;
  const modifiers = ['with', 'of', 'cw', 'ccw', 'large', 'small', 'rotate'];
  for (const part of parts) {
    const tokens = splitCss(part, true),
      command = tokens.shift()!;
    if (command === 'close') {
      data += ' Z';
      current = { ...start };
      continue;
    }
    const relative = tokens.shift() === 'by';
    const index = tokens.findIndex((value) => modifiers.includes(value)),
      endTokens = index < 0 ? tokens : tokens.slice(0, index),
      options = index < 0 ? [] : tokens.slice(index);
    if (command === 'hline' || command === 'vline') {
      const horizontal = command === 'hline',
        basis = horizontal ? width : height;
      const values: Record<string, number> = {
        left: 0,
        top: 0,
        'x-start': 0,
        'y-start': 0,
        right: basis,
        bottom: basis,
        'x-end': basis,
        'y-end': basis,
        center: basis / 2,
      };
      const value = values[endTokens[0]] ?? cssLength(endTokens[0], basis);
      if (horizontal) current = { x: value + (relative ? current.x : 0), y: current.y };
      else current = { x: current.x, y: value + (relative ? current.y : 0) };
      data += ` L ${pair(current)}`;
      continue;
    }
    const end = point(endTokens, relative);
    if (command === 'curve' || command === 'smooth') {
      const values = options.slice(options.indexOf('with') + 1),
        slash = values.indexOf('/');
      const controls = options.includes('with')
        ? (slash < 0 ? [values] : [values.slice(0, slash), values.slice(slash + 1)]).map(
            (values) => {
              const from = values.indexOf('from');
              if (from < 0) return point(values, relative);
              const anchor =
                values[from + 1] === 'end'
                  ? end
                  : values[from + 1] === 'origin'
                    ? { x: 0, y: 0 }
                    : current;
              return point(values.slice(0, from), true, anchor);
            },
          )
        : [];
      const type =
        command === 'smooth' ? (controls.length ? 'S' : 'T') : controls.length === 2 ? 'C' : 'Q';
      data += ` ${type} ${controls.map(pair).join(' ')} ${pair(end)}`;
    } else if (command === 'arc') {
      const of = options.indexOf('of'),
        radii: string[] = [];
      for (let i = of + 1; i < options.length && !modifiers.includes(options[i]); i++)
        radii.push(options[i]);
      const rx = cssLength(
          radii[0],
          radii.length === 1 ? Math.hypot(width, height) / Math.SQRT2 : width,
        ),
        ry = radii.length === 1 ? rx : cssLength(radii[1], height),
        rotate = options.indexOf('rotate');
      const angle =
        rotate < 0 ? 0 : (cssLength(options[rotate + 1], Math.PI * 2, true) * 180) / Math.PI;
      data += ` A ${Math.abs(rx)} ${Math.abs(ry)} ${angle} ${options.includes('large') ? 1 : 0} ${options.includes('cw') ? 1 : 0} ${pair(end)}`;
    } else {
      data += ` ${command === 'move' ? 'M' : 'L'} ${pair(end)}`;
      if (command === 'move') start = { ...end };
    }
    current = end;
  }
  return { data, rule };
}
