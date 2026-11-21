import type { DesignNode, Rect, TextRun } from '../model/design.js';

export interface ControlTextLayout {
  nodeId: string;
  text: string;
  box: Rect;
  style: Record<string, string>;
}
export interface ControlPartLayout {
  nodeId: string;
  role: string;
  box: Rect;
  style: Record<string, string>;
}

/** Use browser-provided UA text lines, including localized date fields,
 * selected labels, placeholders and soft-wrapped textarea content. */
export function collectDomControls({
  document,
  nodes,
  text,
  parts,
}: {
  document: Document;
  nodes: DesignNode[];
  text: ControlTextLayout[];
  parts: ControlPartLayout[];
}): DesignNode[] {
  const lookup = new Map(nodes.map((node) => [node.id, node]));
  const context = document.createElement('canvas').getContext('2d')!;
  for (const fragment of text) {
    const node = lookup.get(fragment.nodeId);
    if (!node?.control) continue;
    const style = { ...node.style, ...fragment.style },
      size = parseFloat(style['font-size']) || 13;
    context.font = `${style['font-style']} ${style['font-weight']} ${size}px ${style['font-family']}`;
    const metrics = context.measureText('Hg国'),
      ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent,
      descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent;
    const run: TextRun = {
      ...fragment.box,
      text: fragment.text,
      baseline: fragment.box.y + (fragment.box.height - ascent - descent) / 2 + ascent,
      fontFamily: style['font-family'],
      fontSize: size,
      fontWeight: style['font-weight'],
      fontStyle: style['font-style'],
      letterSpacing: parseFloat(style['letter-spacing']) || 0,
      color: style.color,
      decoration: style['text-decoration-line'] || 'none',
      textShadow: style['text-shadow'],
    };
    (node.control.textRuns ||= []).push(run);
  }
  for (const part of parts) {
    const node = lookup.get(part.nodeId);
    if (node?.control)
      (node.control.parts ||= []).push({ role: part.role, box: part.box, style: part.style });
  }
  return nodes;
}
