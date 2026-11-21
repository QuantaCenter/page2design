import type { DesignNode, Rect, TextRun } from '../model/design.js';

/** Browser layout information, including resolved attr()/counter() text.
 * The caller obtains layout; core never starts a browser or opens a URL. */
export interface PseudoLayout {
  parentId: string;
  type: '::before' | '::after';
  box: Rect;
  paintOrder: number;
  text: { text: string; box: Rect }[];
}
export interface PseudoOptions {
  document: Document;
  parents: DesignNode[];
  pseudos: PseudoLayout[];
}

/** Convert actual generated boxes and line fragments into independent layers.
 * DOMSnapshot.getSnapshot exposes anonymous generated text (captureSnapshot
 * omits it), so counters and wrapped content keep their browser layout. */
export function collectDomPseudos({ document, parents, pseudos }: PseudoOptions): DesignNode[] {
  const nodes: DesignNode[] = [];
  const lookup = new Map(parents.map((node) => [node.id, node]));
  const elements = new Map<string, Element>();
  const indexElements = (root: Document | ShadowRoot) => {
    for (const element of root.querySelectorAll('[data-page-to-design-id]')) {
      elements.set(element.getAttribute('data-page-to-design-id')!, element);
      if (element.shadowRoot) indexElements(element.shadowRoot);
    }
  };
  indexElements(document);
  const context = document.createElement('canvas').getContext('2d')!;
  const number = (value: string) => Number.parseFloat(value) || 0;
  const transparent = (value: string) =>
    !value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)';
  const subtreeOrder = (node: DesignNode): number =>
    Math.max(
      node.order,
      ...node.children
        .map((id) => lookup.get(id))
        .filter((node): node is DesignNode => !!node)
        .map(subtreeOrder),
    );
  for (const pseudo of pseudos) {
    const parent = lookup.get(pseudo.parentId),
      element = elements.get(pseudo.parentId);
    if (!parent || parent.kind === 'raster' || !element) continue;
    const css = document.defaultView!.getComputedStyle(element, pseudo.type);
    if (css.display === 'none' || css.visibility === 'hidden' || number(css.opacity) === 0)
      continue;
    const box = { ...pseudo.box };
    if (box.width <= 0 || box.height <= 0) continue;
    const style = Object.fromEntries(
      Object.keys(parent.style).map((property) => [property, css.getPropertyValue(property)]),
    );
    const insets = (prefix: string, suffix = '') => ({
      top: number(css.getPropertyValue(`${prefix}-top${suffix}`)),
      right: number(css.getPropertyValue(`${prefix}-right${suffix}`)),
      bottom: number(css.getPropertyValue(`${prefix}-bottom${suffix}`)),
      left: number(css.getPropertyValue(`${prefix}-left${suffix}`)),
    });
    const border = insets('border', '-width'),
      padding = insets('padding');
    const corners = ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((corner) =>
      css.getPropertyValue(`border-${corner}-radius`).split(/\s+/),
    );
    const radii = corners.map(([value]) =>
      value.includes('%') ? (number(value) / 100) * box.width : number(value),
    );
    const radiusY = corners.map(([x, value = x]) =>
      value.includes('%') ? (number(value) / 100) * box.height : number(value),
    );
    const id = `${parent.id}${pseudo.type}`;
    const order = pseudo.type === '::before' ? parent.order + 0.1 : subtreeOrder(parent) + 0.5;
    const clips = [...parent.clips];
    const containsPaint = /(?:^|\s)(?:paint|strict|content)(?:\s|$)/.test(
      parent.style.contain || '',
    );
    if (
      containsPaint ||
      parent.style['overflow-x'] !== 'visible' ||
      parent.style['overflow-y'] !== 'visible'
    )
      clips.push({
        ownerId: parent.id,
        x:
          parent.style['overflow-x'] === 'visible' && !containsPaint
            ? -100000
            : parent.box.x + parent.border.left,
        y:
          parent.style['overflow-y'] === 'visible' && !containsPaint
            ? -100000
            : parent.box.y + parent.border.top,
        width:
          parent.style['overflow-x'] === 'visible' && !containsPaint
            ? 200000
            : parent.box.width - parent.border.left - parent.border.right,
        height:
          parent.style['overflow-y'] === 'visible' && !containsPaint
            ? 200000
            : parent.box.height - parent.border.top - parent.border.bottom,
        radius: containsPaint
          ? parent.radius.map((r, i) =>
              Math.max(
                0,
                r -
                  Math.max(
                    i < 2 ? parent.border.top : parent.border.bottom,
                    i === 0 || i === 3 ? parent.border.left : parent.border.right,
                  ),
              ),
            )
          : parent.radius,
      });
    const imageUrl = /^url\(["']?(.*?)["']?\)/.exec(css.content)?.[1];
    const node: DesignNode = {
      id,
      parentId: parent.id,
      children: [],
      kind: imageUrl ? 'image' : 'frame',
      pseudoElement: pseudo.type,
      captureSourceId: parent.captureSourceId ? parent.captureSourceId + pseudo.type : undefined,
      name: `${parent.name}${pseudo.type}`,
      tag: pseudo.type,
      box,
      contentBox: {
        x: box.x + border.left + padding.left,
        y: box.y + border.top + padding.top,
        width: Math.max(0, box.width - border.left - border.right - padding.left - padding.right),
        height: Math.max(0, box.height - border.top - border.bottom - padding.top - padding.bottom),
      },
      padding,
      margin: insets('margin'),
      border,
      radius: radii,
      radiusY,
      opacity: parent.opacity * number(css.opacity),
      clips,
      style,
      assetUrl: imageUrl,
      order,
      paintOrder: pseudo.paintOrder,
      hasVisual:
        !transparent(css.backgroundColor) ||
        css.backgroundImage !== 'none' ||
        Object.values(border).some(Boolean) ||
        css.boxShadow !== 'none' ||
        !!imageUrl,
    };
    const backgroundArea = (area: string) => {
      const inset =
        area === 'border-box'
          ? { top: 0, right: 0, bottom: 0, left: 0 }
          : area === 'content-box'
            ? {
                top: border.top + padding.top,
                right: border.right + padding.right,
                bottom: border.bottom + padding.bottom,
                left: border.left + padding.left,
              }
            : border;
      return {
        x: box.x + inset.left,
        y: box.y + inset.top,
        width: Math.max(0, box.width - inset.left - inset.right),
        height: Math.max(0, box.height - inset.top - inset.bottom),
        radius: radii.map((radius, index) =>
          Math.max(0, radius - (index === 0 || index === 3 ? inset.left : inset.right)),
        ),
        radiusY: radiusY.map((radius, index) =>
          Math.max(0, radius - (index < 2 ? inset.top : inset.bottom)),
        ),
      };
    };
    if (css.backgroundImage !== 'none' || css.backgroundClip !== 'border-box') {
      node.backgroundBox = backgroundArea(css.backgroundOrigin);
      node.backgroundClip = backgroundArea(css.backgroundClip);
    }
    node.backgroundUrl = /^url\(["']?(.*?)["']?\)$/.exec(css.backgroundImage)?.[1];
    let visualBox = { ...box };
    const expandShadow = (bounds: Rect, value: string) => {
      for (const shadow of value.split(/,(?![^()]*\))/)) {
        const values = Array.from(shadow.matchAll(/(-?[\d.]+)px/g), (match) => number(match[1]));
        if (values.length < 2 || shadow.includes('inset')) continue;
        const margin = Math.max(0, (values[2] || 0) * 1.5 + (values[3] || 0)) + 3;
        const left = Math.min(visualBox.x, bounds.x + values[0] - margin),
          top = Math.min(visualBox.y, bounds.y + values[1] - margin);
        visualBox = {
          x: left,
          y: top,
          width:
            Math.max(visualBox.x + visualBox.width, bounds.x + bounds.width + values[0] + margin) -
            left,
          height:
            Math.max(
              visualBox.y + visualBox.height,
              bounds.y + bounds.height + values[1] + margin,
            ) - top,
        };
      }
    };
    expandShadow(box, css.boxShadow);
    node.visualBox = visualBox;
    nodes.push(node);
    context.font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
    const metrics = context.measureText('Hg国');
    const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent,
      descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent;
    const runs: TextRun[] = pseudo.text
      .filter((line) => line.text.length)
      .map((line) => ({
        ...line.box,
        text: line.text,
        baseline: line.box.y + (line.box.height - ascent - descent) / 2 + ascent,
        fontFamily: css.fontFamily,
        fontSize: number(css.fontSize),
        fontWeight: css.fontWeight,
        fontStyle: css.fontStyle,
        letterSpacing: number(css.letterSpacing),
        color: css.color,
        decoration: css.textDecorationLine,
        textShadow: css.textShadow,
      }));
    if (runs.length) {
      const x = Math.min(...runs.map((run) => run.x)),
        y = Math.min(...runs.map((run) => run.y));
      const textBox = {
        x,
        y,
        width: Math.max(...runs.map((run) => run.x + run.width)) - x,
        height: Math.max(...runs.map((run) => run.y + run.height)) - y,
      };
      visualBox = { ...textBox };
      for (const run of runs) expandShadow(run, css.textShadow);
      const text: DesignNode = {
        ...node,
        id: `${id}:text`,
        parentId: id,
        children: [],
        kind: 'text',
        tag: '#text',
        name: runs
          .map((run) => run.text)
          .join(' ')
          .slice(0, 32),
        box: textBox,
        contentBox: textBox,
        visualBox,
        runs,
        text: runs.map((run) => run.text).join('\n'),
        assetUrl: undefined,
        backgroundUrl: undefined,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        border: { top: 0, right: 0, bottom: 0, left: 0 },
        radius: [0, 0, 0, 0],
        hasVisual: true,
        order: order + 0.01,
      };
      nodes.push(text);
      node.children.push(text.id);
    }
  }
  return nodes;
}
