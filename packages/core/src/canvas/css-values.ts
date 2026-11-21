/** Split only at the top level: quoted SVG data, CSS functions and escaped
 * characters must never become additional layers or position tokens. */
export function splitCss(value: string, space = false) {
  const result: string[] = [];
  let start = 0,
    depth = 0,
    quote = '',
    escaped = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (!depth && (space ? /\s/.test(c) : c === ',')) {
      const part = value.slice(start, i).trim();
      if (part) result.push(part);
      start = i + 1;
    }
  }
  const last = value.slice(start).trim();
  if (last) result.push(last);
  return result;
}

/** Evaluate already validated computed CSS math; never eval source CSS. */
export function cssLength(source: string, basis: number, angular = false): number {
  const tokens =
    source
      .toLowerCase()
      .match(/(?:\d*\.\d+|\d+\.?\d*)(?:e[+-]?\d+)?(?:%|[a-z]+)?|[a-z-]+|[()+*/,-]/g) || [];
  let index = 0;
  const sum = (): number => {
    let value = product();
    while (tokens[index] === '+' || tokens[index] === '-') {
      const sign = tokens[index++];
      value += product() * (sign === '-' ? -1 : 1);
    }
    return value;
  };
  const product = (): number => {
    let value = atom();
    while (tokens[index] === '*' || tokens[index] === '/') {
      const op = tokens[index++],
        next = atom();
      value = op === '*' ? value * next : value / next;
    }
    return value;
  };
  const atom = (): number => {
    const token = tokens[index++];
    if (token === '-' || token === '+') return atom() * (token === '-' ? -1 : 1);
    if (token === '(') {
      const value = sum();
      if (tokens[index] === ')') index++;
      return value;
    }
    if (['calc', 'min', 'max', 'clamp'].includes(token)) {
      if (tokens[index++] !== '(') return NaN;
      const values = [sum()];
      while (tokens[index] === ',') {
        index++;
        values.push(sum());
      }
      if (tokens[index] === ')') index++;
      return token === 'min'
        ? Math.min(...values)
        : token === 'max'
          ? Math.max(...values)
          : token === 'clamp'
            ? Math.max(values[0], Math.min(values[1], values[2]))
            : values[0];
    }
    if (!token) return NaN;
    const match = /^([\d.e+-]+)(.*)$/.exec(token);
    if (!match) return NaN;
    const units: Record<string, number> = angular
      ? { deg: Math.PI / 180, turn: Math.PI * 2, grad: Math.PI / 200, rad: 1, '%': basis / 100 }
      : { px: 1, '%': basis / 100 };
    return Number(match[1]) * (match[2] ? (units[match[2]] ?? NaN) : 1);
  };
  const value = sum();
  return index === tokens.length && Number.isFinite(value) ? value : NaN;
}
