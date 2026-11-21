import type { CompositingGroup, DesignNode } from './design.js';

/** Isolate a CSS opacity context once, rather than fading each overlapping child. */
export function applyOpacityGroups(nodes: DesignNode[]) {
  const lookup = new Map(nodes.map((node) => [node.id, node]));
  const resolved = new Map<string, NonNullable<DesignNode['opacityGroups']>>();
  const resolving = new Set<string>();
  const groups = (node: DesignNode): NonNullable<DesignNode['opacityGroups']> => {
    if (resolved.has(node.id)) return resolved.get(node.id)!;
    if (resolving.has(node.id)) throw new TypeError('Cyclic layout hierarchy.');
    resolving.add(node.id);
    const parent = node.parentId && lookup.get(node.parentId);
    const inherited = parent ? groups(parent) : [];
    const local = Number.parseFloat(node.style.opacity);
    const value =
      node.kind !== 'text' && local >= 0 && local < 1
        ? [...inherited, { id: node.id, opacity: local }]
        : inherited;
    resolving.delete(node.id);
    resolved.set(node.id, value);
    return value;
  };
  for (const node of nodes) {
    const value = groups(node);
    if (value.length) node.opacityGroups = value.map((group) => ({ ...group }));
  }
  const effects = new Map<string, CompositingGroup[]>();
  const resolve = (node: DesignNode): CompositingGroup[] => {
    const cached = effects.get(node.id);
    if (cached) return cached;
    const parent = node.parentId && lookup.get(node.parentId);
    const inherited = parent ? resolve(parent) : [];
    const local = Number.parseFloat(node.style.opacity);
    const opacity = node.kind !== 'text' && local >= 0 && local < 1 ? local : 1;
    const native = node.kind !== 'raster' && node.kind !== 'text';
    const property = (name: string, initial: string) =>
      native && node.style[name] && node.style[name] !== initial ? node.style[name] : undefined;
    const filter = property('filter', 'none'),
      backdropFilter = property('backdrop-filter', 'none');
    const blendMode = property('mix-blend-mode', 'normal'),
      isolate = native && node.style.isolation === 'isolate';
    const clipPath = native && !!node.clipPath,
      mask = native && !!node.maskLayers?.length;
    const value =
      opacity < 1 || filter || backdropFilter || blendMode || isolate || clipPath || mask
        ? [
            ...inherited,
            {
              id: node.id,
              opacity,
              ...(filter ? { filter } : {}),
              ...(backdropFilter ? { backdropFilter } : {}),
              ...(blendMode ? { blendMode } : {}),
              ...(isolate ? { isolate: true } : {}),
              ...(clipPath ? { clipPath: true } : {}),
              ...(mask ? { mask: true } : {}),
            },
          ]
        : inherited;
    effects.set(node.id, value);
    return value;
  };
  for (const node of nodes) {
    const value = resolve(node);
    if (value.length) node.compositingGroups = value.map((group) => ({ ...group }));
    const inherited = value.flatMap((group) => {
      const path = lookup.get(group.id)?.clipPath;
      return path ? [{ ...path }] : [];
    });
    if (inherited.length) node.clipPaths = inherited;
  }
}
