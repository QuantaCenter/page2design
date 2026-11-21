import type { Page } from 'playwright';
import { matrixFromQuad, type DesignNode, type TransformMatrix } from '@page-to-design/core';
import { evaluateInPage } from './evaluate-in-page';

export async function prepareTransformLayout(page: Page) {
  return evaluateInPage(
    page,
    () => {
      const entries: Record<string, Record<string, string>> = {};
      const active: string[] = [];
      const keys = [
        'transform',
        'transform-origin',
        'transform-style',
        'translate',
        'rotate',
        'scale',
        'perspective',
        'perspective-origin',
        'backface-visibility',
      ];
      let sequence = 0;
      const hasTransform = (css: CSSStyleDeclaration) =>
        ['transform', 'translate', 'rotate', 'scale', 'perspective'].some(
          (key) => css.getPropertyValue(key) && css.getPropertyValue(key) !== 'none',
        );
      const visitRoot = (root: Document | ShadowRoot, inherited: boolean) => {
        const rules: string[] = [];
        const visit = (element: Element, parentActive: boolean) => {
          const id = `s${++sequence}`;
          element.setAttribute('data-page-to-design-source-id', id);
          const css = getComputedStyle(element),
            own = hasTransform(css),
            affected = parentActive || own;
          entries[id] = Object.fromEntries(keys.map((key) => [key, css.getPropertyValue(key)]));
          if (affected) active.push(id);
          if (own)
            rules.push(
              `[data-page-to-design-source-id="${id}"]{transform:matrix(1,0,0,1,0,0)!important;translate:none!important;rotate:none!important;scale:none!important;perspective:none!important}`,
            );
          for (const pseudo of ['::before', '::after']) {
            const style = getComputedStyle(element, pseudo);
            if (style.content === 'none' || style.content === 'normal' || style.display === 'none')
              continue;
            entries[id + pseudo] = Object.fromEntries(
              keys.map((key) => [key, style.getPropertyValue(key)]),
            );
            if (affected || hasTransform(style)) active.push(id + pseudo);
            if (hasTransform(style))
              rules.push(
                `[data-page-to-design-source-id="${id}"]${pseudo}{transform:matrix(1,0,0,1,0,0)!important;translate:none!important;rotate:none!important;scale:none!important;perspective:none!important}`,
              );
          }
          // SVG contents are already kept as one vector resource. Preserve their
          // internal transforms while neutralizing only the outer HTML box.
          if (element.namespaceURI !== 'http://www.w3.org/2000/svg')
            for (const child of element.children) visit(child, affected);
          if (element.shadowRoot) visitRoot(element.shadowRoot, affected);
        };
        for (const element of root.children) visit(element, inherited);
        if (rules.length) {
          const style = document.createElement('style');
          style.setAttribute('data-page-to-design-transform-reset', '');
          style.textContent = rules.join('');
          if (root instanceof Document) (root.head || root.documentElement).append(style);
          else root.append(style);
        }
      };
      const height = Math.max(
        (document.scrollingElement || document.documentElement).scrollHeight,
        innerHeight,
      );
      visitRoot(document, false);
      return { entries, active, height };
    },
    undefined,
  );
}

export async function restoreTransformLayout(page: Page) {
  await evaluateInPage(
    page,
    () => {
      const restore = (root: Document | ShadowRoot) => {
        for (const style of root.querySelectorAll('style[data-page-to-design-transform-reset]'))
          style.remove();
        for (const element of root.querySelectorAll('*'))
          if (element.shadowRoot) restore(element.shadowRoot);
      };
      restore(document);
    },
    undefined,
  );
}

export async function resolveNativeTransforms(
  page: Page,
  state: Awaited<ReturnType<typeof prepareTransformLayout>>,
  nodes: DesignNode[],
) {
  for (const node of nodes)
    if (node.captureSourceId && state.entries[node.captureSourceId])
      Object.assign(node.style, state.entries[node.captureSourceId]);
  if (!state.active.length) return {};
  const active = new Set(state.active);
  const local = new Map(
    nodes
      .filter(
        (node) => node.tag !== '#text' && node.captureSourceId && active.has(node.captureSourceId),
      )
      .map((node) => [node.captureSourceId!, node.box]),
  );
  const matrices: Record<string, TransformMatrix> = {};
  const session = await page.context().newCDPSession(page);
  try {
    const snapshot = await session.send('DOMSnapshot.getSnapshot', {
      computedStyleWhitelist: [],
      includePaintOrder: true,
    });
    const orders = new Map<string, number>();
    const pending: { source: string; backendNodeId: number }[] = [];
    for (const node of snapshot.domNodes) {
      const id = node.attributes?.find(
        (attribute) => attribute.name === 'data-page-to-design-id',
      )?.value;
      const source = node.attributes?.find(
        (attribute) => attribute.name === 'data-page-to-design-source-id',
      )?.value;
      if (id && node.layoutNodeIndex !== undefined)
        orders.set(id, snapshot.layoutTreeNodes[node.layoutNodeIndex].paintOrder || 0);
      if (source && local.has(source)) pending.push({ source, backendNodeId: node.backendNodeId });
      for (const index of node.pseudoElementIndexes || []) {
        const pseudo = snapshot.domNodes[index];
        if (id && pseudo.layoutNodeIndex !== undefined)
          orders.set(
            id + `::${pseudo.pseudoType}`,
            snapshot.layoutTreeNodes[pseudo.layoutNodeIndex].paintOrder || 0,
          );
        const key = source + `::${pseudo.pseudoType}`;
        if (source && local.has(key))
          pending.push({ source: key, backendNodeId: pseudo.backendNodeId });
      }
    }
    for (const node of nodes)
      node.paintOrder =
        orders.get(node.tag === '#text' ? node.parentId! : node.id) ?? node.paintOrder;
    for (let start = 0; start < pending.length; start += 24)
      await Promise.all(
        pending.slice(start, start + 24).map(async (value) => {
          const { model } = await session
            .send('DOM.getBoxModel', { backendNodeId: value.backendNodeId })
            .catch(() => ({ model: undefined }));
          if (!model) return;
          const matrix = matrixFromQuad(local.get(value.source)!, model.border);
          if (matrix) matrices[value.source] = matrix;
        }),
      );
    return matrices;
  } finally {
    await session.detach();
  }
}
