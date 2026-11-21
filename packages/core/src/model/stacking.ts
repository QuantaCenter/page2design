import type { DesignNode } from './design.js';

const zIndex = (node: DesignNode) =>
  node.kind === 'text' ? 0 : Number.parseInt(node.style['z-index'], 10) || 0;
const transparent = (value: string | undefined) =>
  !value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)';

function createsContext(node: DesignNode, parent?: DesignNode) {
  if (node.kind === 'text') return false;
  if (!parent || node.tag === 'html') return true;
  const style = node.style;
  const position = style.position || 'static';
  const indexed = style['z-index'] && style['z-index'] !== 'auto';
  const layoutItem = /^(?:inline-)?(?:flex|grid)$/.test(parent.style.display || '');
  if (
    position === 'fixed' ||
    position === 'sticky' ||
    (indexed && (position !== 'static' || layoutItem))
  )
    return true;
  if ((style.opacity && Number(style.opacity) < 1) || style.isolation === 'isolate') return true;
  if (
    [
      'transform',
      'translate',
      'rotate',
      'scale',
      'perspective',
      'filter',
      'backdrop-filter',
      'clip-path',
      'mask-image',
    ].some((property) => style[property] && style[property] !== 'none')
  )
    return true;
  if (style['mix-blend-mode'] && style['mix-blend-mode'] !== 'normal') return true;
  if (/(?:^|\s)(?:layout|paint|strict|content)(?:\s|$)/.test(style.contain || '')) return true;
  return (style['will-change'] || '')
    .split(',')
    .some((property) =>
      [
        'transform',
        'translate',
        'rotate',
        'scale',
        'perspective',
        'opacity',
        'filter',
        'backdrop-filter',
        'clip-path',
        'mask-image',
        'mix-blend-mode',
      ].includes(property.trim()),
    );
}

/** CDP paintOrders describe paint layers, not every CSS painting phase. A
 * context's in-flow backgrounds can share its rank while negative child
 * contexts have larger ranks. Move those child contexts between the context's
 * own background and its content, keeping each child context atomic.
 * https://www.w3.org/TR/CSS22/zindex.html#painting-order */
export function applyStackingOrder(nodes: DesignNode[]) {
  const lookup = new Map(nodes.map((node) => [node.id, node]));
  const ranks = new Map(
    nodes.map((node) => [node.id, { paint: node.paintOrder, tree: node.order }]),
  );
  const compare = (a: DesignNode, b: DesignNode) =>
    ranks.get(a.id)!.paint - ranks.get(b.id)!.paint ||
    ranks.get(a.id)!.tree - ranks.get(b.id)!.tree;
  let ordered = [...nodes].sort(compare);
  const contexts = new Set(
    nodes
      .filter((node) => createsContext(node, node.parentId ? lookup.get(node.parentId) : undefined))
      .map((node) => node.id),
  );
  const children = new Map<string, DesignNode[]>();
  for (const node of nodes)
    if (node.parentId) {
      const siblings = children.get(node.parentId) || [];
      siblings.push(node);
      children.set(node.parentId, siblings);
    }
  const groups = new Map<string, DesignNode[]>();
  const depths = new Map<string, number>();
  for (const node of nodes) {
    let parent = node.parentId && lookup.get(node.parentId);
    let depth = 0;
    let owner: string | undefined;
    while (parent) {
      depth++;
      if (!owner && contexts.has(parent.id)) owner = parent.id;
      parent = parent.parentId && lookup.get(parent.parentId);
    }
    depths.set(node.id, depth);
    if (!owner || !contexts.has(node.id) || zIndex(node) >= 0) continue;
    const negatives = groups.get(owner) || [];
    negatives.push(node);
    groups.set(owner, negatives);
  }
  // Resolve inner contexts before moving their containing context as a unit.
  for (const [owner, negatives] of [...groups].sort(
    (a, b) => depths.get(b[0])! - depths.get(a[0])!,
  )) {
    const context = lookup.get(owner)!;
    const blocks = negatives
      .sort((a, b) => zIndex(a) - zIndex(b) || compare(a, b))
      .map((root) => {
        const ids = new Set<string>();
        const collect = (node: DesignNode) => {
          ids.add(node.id);
          for (const child of children.get(node.id) || []) collect(child);
        };
        collect(root);
        return { ids, nodes: ordered.filter((node) => ids.has(node.id)) };
      });
    const moving = new Set(blocks.flatMap((block) => [...block.ids]));
    ordered = ordered.filter((node) => !moving.has(node.id));
    let anchor = context;
    // A plain body background propagates to the root canvas. It must stay
    // behind negative root descendants instead of covering them a second time.
    if (
      context.tag === 'html' &&
      (!context.style.contain || context.style.contain === 'none') &&
      transparent(context.style['background-color']) &&
      (!context.style['background-image'] || context.style['background-image'] === 'none')
    ) {
      const body = (children.get(context.id) || []).find(
        (node) => node.tag === 'body' && !contexts.has(node.id),
      );
      if (
        body &&
        (!body.style.contain || body.style.contain === 'none') &&
        !body.skipBoxBackground &&
        !transparent(body.style['background-color']) &&
        (!body.style['background-image'] || body.style['background-image'] === 'none')
      )
        anchor = body;
    }
    const index = ordered.findIndex((node) => node.id === anchor.id);
    ordered.splice(index + 1, 0, ...blocks.flatMap((block) => block.nodes));
  }
  ordered.forEach((node, index) => {
    node.paintOrder = index + 1;
  });
}
