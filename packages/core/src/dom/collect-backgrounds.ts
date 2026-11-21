import type {
  BackgroundLayer,
  CssImage,
  DesignNode,
  MaskLayer,
  ShapeClip,
} from '../model/design.js';

/** Serializable DOM adapter. All CSS lists are resolved separately; commas in
 * data URLs and gradient functions are not layer separators. */
export async function collectDomBackgrounds({
  document,
  nodes,
}: {
  document: Document;
  nodes: DesignNode[];
}) {
  const decoder = (
    document.defaultView as Window & {
      ImageDecoder?: { isTypeSupported(type: string): Promise<boolean> };
    }
  ).ImageDecoder;
  const formats = new Set(
    nodes.flatMap((node) =>
      [
        ...((node.style['background-image'] || '') + (node.style['mask-image'] || '')).matchAll(
          /type\(\s*["']([^"']+)["']\s*\)/g,
        ),
      ].map((match) => match[1].toLowerCase()),
    ),
  );
  const supported = new Set(
    (
      await Promise.all(
        [...formats].map(async (format) => {
          try {
            const available = decoder
              ? await decoder.isTypeSupported(format)
              : /^image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon|vnd.microsoft.icon)$/.test(format);
            return available ? format : undefined;
          } catch {
            return undefined;
          }
        }),
      )
    ).filter((value): value is string => !!value),
  );
  const split = (value: string, space = false) => {
    const values: string[] = [];
    let quote = '',
      depth = 0,
      escaped = false,
      start = 0;
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
      else if ((space ? /\s/.test(c) : c === ',') && !depth) {
        if (value.slice(start, i).trim()) values.push(value.slice(start, i).trim());
        start = i + 1;
      }
    }
    if (value.slice(start).trim()) values.push(value.slice(start).trim());
    return values;
  };
  const imageSource = (image: string, base: string): CssImage => {
    const set = /^(?:-webkit-)?image-set\((.*)\)$/.exec(image);
    if (set) {
      const candidates = split(set[1])
        .flatMap((entry) => {
          const parts = split(entry, true),
            source = parts.shift()!;
          let resolution = 1;
          for (const part of parts) {
            const match = /^([\d.]+)(x|dppx|dpi|dpcm)$/.exec(part);
            if (match)
              resolution =
                Number(match[1]) / (match[2] === 'dpi' ? 96 : match[2] === 'dpcm' ? 96 / 2.54 : 1);
            const type = /^type\(["']([^"']+)["']\)$/.exec(part)?.[1];
            // Match the source decoder's MIME negotiation, including formats
            // with URL support that are not accepted by image-set's type().
            if (type && !supported.has(type.toLowerCase())) return [];
          }
          return resolution > 0 ? [{ source, resolution }] : [];
        })
        .sort((a, b) => a.resolution - b.resolution);
      const chosen =
        candidates.find((entry) => entry.resolution >= document.defaultView!.devicePixelRatio) ||
        candidates.at(-1);
      if (!chosen) return { image: 'none' };
      const result = imageSource(
        /^["']/.test(chosen.source) ? `url(${chosen.source})` : chosen.source,
        base,
      );
      return { ...result, resolution: chosen.resolution };
    }
    const fade = /^(-webkit-)?cross-fade\((.*)\)$/.exec(image);
    if (fade) {
      const values = split(fade[2]);
      if (fade[1]) {
        const value = values.pop()!,
          weight = Math.max(0, Math.min(1, parseFloat(value) / (value.endsWith('%') ? 100 : 1)));
        return {
          image,
          crossFade: values.map((source, i) => ({
            source: imageSource(source, base),
            weight: i ? weight : 1 - weight,
          })),
        };
      }
      const sources = values.map((value) => {
        const tokens = split(value, true);
        let weight: number | undefined;
        for (const index of [0, tokens.length - 1])
          if (/^[\d.]+%$/.test(tokens[index])) {
            weight = parseFloat(tokens[index]) / 100;
            tokens.splice(index, 1);
            break;
          }
        return { source: imageSource(tokens.join(' '), base), weight };
      });
      const total = sources.reduce((sum, value) => sum + (value.weight || 0), 0),
        missing = sources.filter((value) => value.weight === undefined).length;
      return {
        image,
        crossFade: sources.map((value) => ({
          source: value.source,
          weight:
            total > 1
              ? (value.weight || 0) / total
              : (value.weight ?? (missing ? (1 - total) / missing : 0)),
        })),
      };
    }
    const match = /^url\(\s*(?:"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|([^)]*))\s*\)$/.exec(image);
    const value = match && (match[1] ?? match[2] ?? match[3]).replace(/\\([\\"'()])/g, '$1');
    if (value)
      try {
        return { image, url: new URL(value, base).href };
      } catch {
        /* Invalid image URL. */
      }
    return { image };
  };
  const elements = new Map<string, Element>();
  const index = (root: Document | ShadowRoot) => {
    for (const e of root.querySelectorAll('[data-page-to-design-id]')) {
      elements.set(e.getAttribute('data-page-to-design-id')!, e);
      if (e.shadowRoot) index(e.shadowRoot);
    }
  };
  index(document);
  const result: {
    id: string;
    layers: BackgroundLayer[];
    masks?: MaskLayer[];
    clipPath?: ShapeClip;
  }[] = [];
  for (const node of nodes) {
    if (node.kind === 'text' || node.kind === 'raster') continue;
    const parent = node.pseudoElement ? node.parentId : node.id,
      element = node.canvasBackground
        ? document[node.canvasBackground.source === 'html' ? 'documentElement' : 'body']
        : parent && elements.get(parent);
    if (!element) continue;
    const css = document.defaultView!.getComputedStyle(element, node.pseudoElement || null);
    if (
      css.backgroundImage === 'none' &&
      (!css.maskImage || css.maskImage === 'none') &&
      css.clipPath === 'none' &&
      !css.backgroundAttachment.split(',').some((value) => value.trim() === 'local') &&
      !node.canvasBackground
    )
      continue;
    const lists = Object.fromEntries(
      [
        'background-size',
        'background-position',
        'background-repeat',
        'background-origin',
        'background-clip',
        'background-attachment',
        'background-blend-mode',
      ].map((key) => [key, split(css.getPropertyValue(key))]),
    );
    const area = (name: string, box = node.box) => {
      const b = node.border,
        p = node.padding,
        edge = ['border-box', 'stroke-box', 'view-box', 'no-clip'].includes(name)
          ? { top: 0, right: 0, bottom: 0, left: 0 }
          : name === 'margin-box'
            ? {
                top: -node.margin.top,
                right: -node.margin.right,
                bottom: -node.margin.bottom,
                left: -node.margin.left,
              }
            : name === 'content-box' || name === 'fill-box'
              ? {
                  top: b.top + p.top,
                  right: b.right + p.right,
                  bottom: b.bottom + p.bottom,
                  left: b.left + p.left,
                }
              : b;
      return {
        x: box.x + edge.left,
        y: box.y + edge.top,
        width: Math.max(0, box.width - edge.left - edge.right),
        height: Math.max(0, box.height - edge.top - edge.bottom),
        radius: node.radius.map((r, i) =>
          Math.max(0, r - (i === 0 || i === 3 ? edge.left : edge.right)),
        ),
        radiusY: (node.radiusY || node.radius).map((r, i) =>
          Math.max(0, r - (i < 2 ? edge.top : edge.bottom)),
        ),
      };
    };
    const layers = (
      node.skipBoxBackground ||
      (css.backgroundImage === 'none' && !css.backgroundAttachment.includes('local'))
        ? []
        : split(css.backgroundImage)
    ).map((image) => imageSource(image, element.baseURI) as BackgroundLayer);
    layers.forEach((layer, i) => {
      layer.style = Object.fromEntries(
        Object.entries(lists).map(([key, values]) => [key, values[i % values.length]]),
      );
      layer.box = area(layer.style['background-origin']);
      layer.clip = area(layer.style['background-clip']);
      const attachment = layer.style['background-attachment'];
      if (attachment === 'fixed') {
        // Transforms turn non-root fixed backgrounds into scroll backgrounds.
        // This also sees the identity transforms used by the capture host while
        // measuring local geometry. Shadow hosts participate in ancestry.
        let transformed = false;
        for (let current: Element | null = node.canvasBackground ? null : element; current;) {
          const styles = [document.defaultView!.getComputedStyle(current)];
          if (current === element && node.pseudoElement) styles.push(css);
          transformed ||= styles.some((style) =>
            ['transform', 'translate', 'rotate', 'scale', 'perspective'].some(
              (property) =>
                (style.getPropertyValue(property) && style.getPropertyValue(property) !== 'none') ||
                style.willChange.split(',').some((value) => value.trim() === property),
            ),
          );
          if (transformed) break;
          const root = current.getRootNode();
          current =
            current.parentElement ||
            (root instanceof document.defaultView!.ShadowRoot ? root.host : null);
        }
        if (!transformed || element === document.documentElement) {
          layer.box = {
            x: document.defaultView!.scrollX,
            y: document.defaultView!.scrollY,
            width: document.defaultView!.innerWidth,
            height: document.defaultView!.innerHeight,
          };
          layer.imageClip = { ...layer.box };
        }
      } else if (attachment === 'local' && !node.canvasBackground) {
        const scrolling = [css.overflowX, css.overflowY].some((value) =>
          ['auto', 'scroll', 'hidden', 'overlay'].includes(value),
        );
        if (scrolling) {
          // Generated boxes have no Element scroll API. Their browser layout
          // fragments expose text overflow at the initial scroll position.
          const text = node.pseudoElement
            ? nodes
                .filter((child) => child.parentId === node.id && child.kind === 'text')
                .flatMap((child) => child.runs || [])
            : [];
          const width = node.pseudoElement
            ? Math.max(
                node.box.width - node.border.left - node.border.right,
                ...text.map((run) =>
                  Math.ceil(run.x + run.width - node.box.x - node.border.left + node.padding.right),
                ),
              )
            : element.scrollWidth;
          const height = node.pseudoElement
            ? Math.max(
                node.box.height - node.border.top - node.border.bottom,
                ...text.map((run) =>
                  Math.ceil(
                    run.y + run.height - node.box.y - node.border.top + node.padding.bottom,
                  ),
                ),
              )
            : element.scrollHeight;
          const box = {
            x: node.box.x - (node.pseudoElement ? 0 : element.scrollLeft),
            y: node.box.y - (node.pseudoElement ? 0 : element.scrollTop),
            width: width + node.border.left + node.border.right,
            height: height + node.border.top + node.border.bottom,
          };
          layer.box = area(layer.style['background-origin'], box);
          layer.clip = area(
            layer.style['background-clip'] === 'border-box'
              ? 'padding-box'
              : layer.style['background-clip'],
            box,
          );
          layer.scrollClip = area('padding-box');
        }
      }
      if (node.canvasBackground)
        layer.clip = { ...node.canvasBackground.area, radius: [0, 0, 0, 0] };
    });
    const masks =
      !node.canvasBackground && css.maskImage && css.maskImage !== 'none'
        ? split(css.maskImage).map((image, index) => {
            const value = (key: string) => {
              const values = split(css.getPropertyValue(`mask-${key}`));
              return values[index % values.length];
            };
            const origin = value('origin'),
              cut = value('clip');
            const style = Object.fromEntries(
              ['size', 'position', 'repeat'].map((key) => [`background-${key}`, value(key)]),
            );
            return {
              ...imageSource(image, element.baseURI),
              box: area(
                ['fill-box', 'stroke-box', 'view-box'].includes(origin) ? 'border-box' : origin,
              ),
              clip: area(cut),
              style,
              mode: value('mode') as MaskLayer['mode'],
              composite: value('composite') as MaskLayer['composite'],
              ...(cut === 'no-clip' ? { noClip: true } : {}),
            };
          })
        : undefined;
    const clipValue = css.clipPath;
    const shapeTokens = split(clipValue, true),
      geometry = shapeTokens.find((value) =>
        /^(?:content|padding|border|margin|fill|stroke|view)-box$/.test(value),
      );
    const clipPath =
      !node.canvasBackground && clipValue && clipValue !== 'none'
        ? {
            ownerId: node.id,
            value: shapeTokens.filter((value) => value !== geometry).join(' '),
            box: area(geometry || 'border-box'),
          }
        : undefined;
    result.push({
      id: node.id,
      layers,
      ...(masks ? { masks } : {}),
      ...(clipPath ? { clipPath } : {}),
    });
  }
  return result;
}
