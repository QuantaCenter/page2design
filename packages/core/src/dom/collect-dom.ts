import type {
  CaptureWarning,
  DesignNode,
  Insets,
  Rect,
  TextOverflowInfo,
  TextRun,
} from '../model/design.js';

export interface DomLayoutSnapshot {
  title: string;
  width: number;
  height: number;
  background: string;
  nodes: DesignNode[];
  warnings: CaptureWarning[];
  fontFaces: {
    family: string;
    style: string;
    weight: string;
    unicodeRange: string;
    urls: string[];
  }[];
}

export interface DomSnapshotOptions {
  document: Document;
  fullPage: boolean;
  maxHeight: number;
  maxNodes: number;
  transformedSourceIds?: string[];
  /** Source scroll extent, before the host temporarily neutralizes transforms. */
  documentHeight?: number;
}

/** Process a supplied, laid-out document. Runtime helpers stay local for host serialization. */
export function collectDomLayout(options: DomSnapshotOptions): DomLayoutSnapshot {
  const document = options.document;
  const window = document.defaultView!;
  if (!window) throw new TypeError('The supplied document must have a rendering window.');
  const getComputedStyle = window.getComputedStyle.bind(window);
  const { location, navigator, Node, NodeFilter, CSSRule, XMLSerializer } = window;
  const nodes: DesignNode[] = [];
  const warnings: CaptureWarning[] = [];
  let sequence = 0;
  let examinedCharacters = 0;
  const documentWidth = window.innerWidth;
  const documentHeight = options.fullPage
    ? Math.min(
        options.maxHeight,
        Math.max(
          options.documentHeight ??
            (document.scrollingElement || document.documentElement).scrollHeight,
          window.innerHeight,
        ),
      )
    : window.innerHeight;
  const canvas = document.createElement('canvas');
  const metricsContext = canvas.getContext('2d')!;
  const transformedSources = new Set(options.transformedSourceIds || []);
  const properties = [
    'display',
    'visibility',
    'position',
    'z-index',
    'box-sizing',
    'width',
    'height',
    'min-width',
    'max-width',
    'pointer-events',
    'background-color',
    'background-image',
    'background-size',
    'background-position',
    'background-repeat',
    'background-origin',
    'background-clip',
    'background-attachment',
    'background-blend-mode',
    'filter',
    'backdrop-filter',
    'text-shadow',
    'mix-blend-mode',
    'color',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'line-height',
    'letter-spacing',
    'text-align',
    'text-decoration-line',
    'text-transform',
    'white-space',
    'text-overflow',
    '-webkit-line-clamp',
    '-webkit-box-orient',
    'object-fit',
    'object-position',
    'border-top-color',
    'border-right-color',
    'border-bottom-color',
    'border-left-color',
    'border-top-style',
    'border-right-style',
    'border-bottom-style',
    'border-left-style',
    'border-top-width',
    'border-right-width',
    'border-bottom-width',
    'border-left-width',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'margin-top',
    'margin-right',
    'margin-bottom',
    'margin-left',
    'border-radius',
    'box-shadow',
    'opacity',
    'overflow-x',
    'overflow-y',
    'gap',
    'row-gap',
    'column-gap',
    'flex-direction',
    'justify-content',
    'align-items',
    'grid-template-columns',
    'grid-template-rows',
    'transform',
    'transform-origin',
    'appearance',
    'accent-color',
    'outline-color',
    'outline-style',
    'outline-width',
    'outline-offset',
    'resize',
    '-webkit-text-fill-color',
    'isolation',
    'contain',
    'will-change',
    'perspective',
    'translate',
    'rotate',
    'scale',
    'clip-path',
    'mask-image',
    'mask-mode',
    'mask-composite',
    'mask-size',
    'mask-position',
    'mask-repeat',
    'mask-origin',
    'mask-clip',
  ];
  const number = (value: string) => Number.parseFloat(value) || 0;
  const rect = (value: DOMRect): Rect => ({
    x: value.x + window.scrollX,
    y: value.y + window.scrollY,
    width: value.width,
    height: value.height,
  });
  const visible = (box: Rect) =>
    box.width > 0 &&
    box.height > 0 &&
    box.x < documentWidth &&
    box.x + box.width > 0 &&
    box.y < documentHeight &&
    box.y + box.height > 0;
  const insets = (css: CSSStyleDeclaration, prefix: string, suffix = ''): Insets => ({
    top: number(css.getPropertyValue(`${prefix}-top${suffix}`)),
    right: number(css.getPropertyValue(`${prefix}-right${suffix}`)),
    bottom: number(css.getPropertyValue(`${prefix}-bottom${suffix}`)),
    left: number(css.getPropertyValue(`${prefix}-left${suffix}`)),
  });
  const radius = (css: CSSStyleDeclaration, box: Rect) =>
    ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((corner) => {
      const value = css.getPropertyValue(`border-${corner}-radius`);
      return value.includes('%')
        ? (number(value) / 100) * Math.min(box.width, box.height)
        : number(value);
    });
  const transparent = (color: string) =>
    !color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)';
  const rootStyle = getComputedStyle(document.documentElement);
  const bodyStyle = document.body && getComputedStyle(document.body);
  const htmlDocument = document.documentElement.localName === 'html';
  const propagateBody =
    htmlDocument &&
    !!bodyStyle &&
    document.body.parentElement === document.documentElement &&
    rootStyle.backgroundImage === 'none' &&
    transparent(rootStyle.backgroundColor) &&
    rootStyle.contain === 'none' &&
    bodyStyle.contain === 'none';
  const canvasStyle = propagateBody ? bodyStyle! : rootStyle;
  const paintsCanvas =
    htmlDocument &&
    canvasStyle.display !== 'none' &&
    (!transparent(canvasStyle.backgroundColor) || canvasStyle.backgroundImage !== 'none');
  const nodeLimit = Math.max(1, options.maxNodes - (paintsCanvas && options.maxNodes > 1 ? 1 : 0));
  const childIds = (parentId: string | null, id: string) => {
    if (parentId) nodes.find((node) => node.id === parentId)?.children.push(id);
  };

  const union = (a: Rect, b: Rect): Rect => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x),
    height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y),
  });
  const expand = (box: Rect, x: number, y: number, extent: number): Rect => ({
    x: box.x + x - extent,
    y: box.y + y - extent,
    width: Math.max(0, box.width + extent * 2),
    height: Math.max(0, box.height + extent * 2),
  });
  function effectsBounds(element: Element, descendants: boolean): Rect {
    const css = getComputedStyle(element);
    const original = rect(element.getBoundingClientRect());
    let result = original;
    if (descendants)
      for (const child of element.children) {
        const style = getComputedStyle(child);
        if (style.display !== 'none' && style.visibility !== 'hidden')
          result = union(result, effectsBounds(child, true));
      }
    for (const shadow of (css.boxShadow + ',' + css.textShadow).split(/,(?![^()]*\))/)) {
      if (shadow.includes('inset')) continue;
      const values = Array.from(shadow.matchAll(/(-?[\d.]+)px/g), (match) => number(match[1]));
      if (values.length >= 2)
        result = union(
          result,
          expand(
            original,
            values[0],
            values[1],
            Math.max(0, (values[2] || 0) * 1.5 + (values[3] || 0)) + 2,
          ),
        );
    }
    // CSS blur() uses sigma, while box-shadow uses half the blur radius.
    for (const match of css.filter.matchAll(
      /blur\(([^)]+)\)|drop-shadow\(([^()]*(?:rgba?\([^)]*\)[^()]*)?)\)/g,
    )) {
      if (match[1]) result = expand(result, 0, 0, number(match[1]) * 3 + 2);
      else {
        const sizes = Array.from(match[2].matchAll(/(-?[\d.]+)px/g), (value) => number(value[1]));
        result = union(
          result,
          expand(result, sizes[0] || 0, sizes[1] || 0, Math.max(0, sizes[2] || 0) * 3 + 2),
        );
      }
    }
    return result;
  }

  function serializeSvg(element: Element, box: Rect) {
    const svgNamespace = 'http://www.w3.org/2000/svg';
    const attributeNamespaces: Record<string, string> = {
      xmlns: 'http://www.w3.org/2000/xmlns/',
      xml: 'http://www.w3.org/XML/1998/namespace',
      xlink: 'http://www.w3.org/1999/xlink',
    };
    const clone = element.cloneNode(true) as SVGElement;
    const queue: [Element, Element][] = [[element, clone]];
    const copiedIds = new Set(Array.from(clone.querySelectorAll('[id]'), (value) => value.id));
    if (clone.id) copiedIds.add(clone.id);
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const reference = (value: string) => {
      let url: URL;
      try {
        url = new URL(value, document.baseURI);
      } catch {
        return value;
      }
      if (!url.hash || url.href.split('#')[0] !== location.href.split('#')[0]) return url.href;
      const id = decodeURIComponent(url.hash.slice(1));
      if (!copiedIds.has(id)) {
        const original = document.getElementById(id);
        if (original) {
          const copy = original.cloneNode(true) as Element;
          copiedIds.add(id);
          for (const item of copy.querySelectorAll('[id]')) copiedIds.add(item.id);
          defs.append(copy);
          queue.push([original, copy]);
        }
      }
      return `#${id}`;
    };
    const rebase = (value: string) =>
      value.replace(/url\(["']?([^"')]+)["']?\)/g, (_, url: string) => `url("${reference(url)}")`);
    const properties = [
      'fill',
      'fill-opacity',
      'fill-rule',
      'stroke',
      'stroke-opacity',
      'stroke-width',
      'stroke-linecap',
      'stroke-linejoin',
      'stroke-miterlimit',
      'stroke-dasharray',
      'stroke-dashoffset',
      'opacity',
      'color',
      'clip-path',
      'clip-rule',
      'mask',
      'filter',
      'stop-color',
      'stop-opacity',
      'flood-color',
      'flood-opacity',
      'lighting-color',
      'paint-order',
      'vector-effect',
      'transform',
      'transform-origin',
      'transform-box',
      'font-family',
      'font-size',
      'font-weight',
      'font-style',
      'letter-spacing',
      'text-anchor',
      'dominant-baseline',
    ];
    for (let index = 0; index < queue.length; index++) {
      const [original, copy] = queue[index];
      const computed = getComputedStyle(original);
      for (const property of properties)
        (copy as SVGElement).style.setProperty(
          property,
          rebase(computed.getPropertyValue(property)),
        );
      for (const attribute of Array.from(copy.attributes)) {
        let value = rebase(attribute.value);
        if (attribute.localName === 'href' || attribute.name === 'xlink:href')
          value = reference(value);
        // DOM renderers often create xmlns/xlink/xml attributes with
        // setAttribute(), leaving namespaceURI null despite the qualified name.
        // setAttributeNS(null, 'xmlns:xlink', ...) throws and aborts the page.
        const colon = attribute.name.indexOf(':');
        const prefix =
          attribute.name === 'xmlns' ? 'xmlns' : colon > 0 ? attribute.name.slice(0, colon) : '';
        const namespace = attributeNamespaces[prefix] || attribute.namespaceURI;
        if (namespace !== attribute.namespaceURI) copy.removeAttributeNode(attribute);
        if (namespace) copy.setAttributeNS(namespace, attribute.name, value);
        else if (value !== attribute.value) copy.setAttribute(attribute.name, value);
      }
      const originals = Array.from(original.children);
      const copies = Array.from(copy.children);
      originals.forEach((child, childIndex) => queue.push([child, copies[childIndex]]));
    }
    if (defs.children.length) clone.prepend(defs);
    clone.setAttributeNS(attributeNamespaces.xmlns, 'xmlns', svgNamespace);
    clone.setAttribute('width', String(box.width));
    clone.setAttribute('height', String(box.height));
    // CSS box geometry is painted by the Canvas node, outside the SVG resource.
    for (const property of Array.from(clone.style))
      if (!properties.includes(property)) clone.style.removeProperty(property);
    for (const [property, value] of Object.entries({
      width: `${box.width}px`,
      height: `${box.height}px`,
      padding: '0px',
      margin: '0px',
      border: 'none',
      background: 'none',
      'box-shadow': 'none',
      'box-sizing': 'content-box',
    }))
      clone.style.setProperty(property, value, 'important');
    clone.style.removeProperty('transform');
    clone.style.removeProperty('opacity');
    for (const property of ['filter', 'clip-path', 'mask']) clone.style.removeProperty(property);
    return new XMLSerializer().serializeToString(clone);
  }

  function unsupported(
    element: Element,
    css: CSSStyleDeclaration,
    checkPseudos = true,
  ): string | undefined {
    const tag = element.tagName.toLowerCase();
    if (['iframe', 'object', 'embed'].includes(tag)) return `${tag} 内容保留为局部截图`;
    if (/url\(/.test(css.filter + css.backdropFilter))
      return '引用型滤镜尚未取得独立定义，保留为局部截图';
    if (css.mixBlendMode === 'plus-darker') return 'plus-darker 混合模式保留为局部截图';
    if (
      css.clipPath !== 'none' &&
      (/url\(/.test(css.clipPath) ||
        !/^(?:(?:circle|ellipse|inset|rect|xywh|polygon|path|shape)\(|(?:content|padding|border|margin|fill|stroke|view)-box\b)/.test(
          css.clipPath,
        ))
    )
      return '引用或尚未解析的裁剪路径保留为局部截图';
    if (/url\([^)]*#[^)]*\)/.test(css.maskImage || ''))
      return 'SVG 引用遮罩尚未取得独立定义，保留为局部截图';
    if (css.writingMode !== 'horizontal-tb' || css.direction === 'rtl')
      return '特殊文字方向保留为局部截图';
    const canvasBox =
      checkPseudos &&
      htmlDocument &&
      (element === document.documentElement || (element === document.body && propagateBody));
    if (!canvasBox && css.backgroundClip.split(',').some((value) => value.trim() === 'text'))
      return '文字背景裁剪保留为局部截图';
    const background = canvasBox
      ? element === document.documentElement
        ? canvasStyle.backgroundImage
        : 'none'
      : css.backgroundImage;
    if (tag === 'svg' && element.querySelector('foreignObject'))
      return 'SVG 嵌入 HTML 保留为局部截图';
    // Commas/functions inside quoted data SVG URLs belong to the image bytes,
    // not additional CSS layers. Count only top-level image list separators.
    let depth = 0,
      quote = '',
      escaped = false,
      start = 0;
    const layers: string[] = [];
    for (let index = 0; index < background.length; index++) {
      const character = background[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (quote) {
        if (character === quote) quote = '';
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }
      if (character === '(') depth++;
      else if (character === ')') depth--;
      else if (character === ',' && !depth) {
        layers.push(background.slice(start, index).trim());
        start = index + 1;
      }
    }
    layers.push(background.slice(start).trim());
    if (layers.some((layer) => layer.startsWith('element(')))
      return '特殊背景图像函数保留为局部截图';
    // Generated boxes use the same native paint support as ordinary elements.
    // Preserve existing fallbacks for other effects instead of silently losing
    // a pseudo-element's transform, filter, mask or complex background.
    if (checkPseudos)
      for (const pseudo of ['::before', '::after']) {
        const style = getComputedStyle(element, pseudo);
        if (style.content === 'none' || style.content === 'normal' || style.display === 'none')
          continue;
        const reason = unsupported(element, style, false);
        if (reason) return reason;
      }
    return undefined;
  }

  const textLanguage = (element: Element) =>
    element.closest('[lang]')?.getAttribute('lang') ||
    document.documentElement.lang ||
    navigator.language;

  function textGlyphs(textNode: Text, css: CSSStyleDeclaration, includeClipped = false): TextRun[] {
    includeClipped ||= transformedSources.has(
      textNode.parentElement?.getAttribute('data-page-to-design-source-id') || '',
    );
    if (!textNode.data.trim() || examinedCharacters > 60000 || nodes.length >= nodeLimit) return [];
    const raw = textNode.data.slice(0, 12000);
    examinedCharacters += raw.length;
    const range = document.createRange();
    range.selectNodeContents(textNode);
    if (
      !includeClipped &&
      !Array.from(range.getClientRects()).some((value) => visible(rect(value)))
    )
      return [];
    const fontSize = number(css.fontSize);
    const font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
    metricsContext.font = font;
    const language = textLanguage(textNode.parentElement!);
    if ('lang' in metricsContext) metricsContext.lang = includeClipped ? language : 'inherit';
    const metrics = metricsContext.measureText('Hg国');
    const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent;
    const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent;
    const runs: TextRun[] = [];
    const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(raw);
    for (const segment of segments) {
      range.setStart(textNode, segment.index);
      range.setEnd(textNode, segment.index + segment.segment.length);
      const boxes = Array.from(range.getClientRects());
      const renderedBox = boxes.find((value) => value.width > 0.01 && value.height > 0);
      if (!renderedBox) continue;
      const box = rect(renderedBox);
      if (!includeClipped && !visible(box)) continue;
      let content = segment.segment;
      if (
        /\s/.test(content) &&
        !css.whiteSpace.startsWith('pre') &&
        css.whiteSpace !== 'break-spaces'
      )
        content = ' ';
      if (css.textTransform === 'uppercase') content = content.toUpperCase();
      if (css.textTransform === 'lowercase') content = content.toLowerCase();
      if (
        css.textTransform === 'capitalize' &&
        (segment.index === 0 || /\s/.test(raw[segment.index - 1]))
      )
        content = content.toUpperCase();
      runs.push({
        ...box,
        text: content,
        baseline: box.y + (box.height - ascent - descent) / 2 + ascent,
        fontFamily: css.fontFamily,
        fontSize,
        fontWeight: css.fontWeight,
        fontStyle: css.fontStyle,
        letterSpacing: number(css.letterSpacing),
        color: css.color,
        decoration: css.textDecorationLine,
        textShadow: css.textShadow,
        ...(includeClipped
          ? {
              fontKerning: css.fontKerning === 'none' ? ('none' as const) : ('normal' as const),
              language,
            }
          : {}),
      });
    }
    return runs;
  }

  function mergeTextRuns(glyphs: TextRun[]): TextRun[] {
    const runs: TextRun[] = [];
    for (const glyph of glyphs) {
      const previous = runs.at(-1);
      if (
        previous &&
        !previous.generated &&
        !glyph.generated &&
        [
          'fontFamily',
          'fontSize',
          'fontWeight',
          'fontStyle',
          'fontKerning',
          'language',
          'letterSpacing',
          'color',
          'decoration',
          'textShadow',
        ].every((key) => previous[key as keyof TextRun] === glyph[key as keyof TextRun]) &&
        Math.abs(previous.y - glyph.y) < 0.5 &&
        Math.abs(previous.height - glyph.height) < 0.5 &&
        Math.abs(previous.x + previous.width - glyph.x) < Math.max(3, glyph.letterSpacing + 2)
      ) {
        previous.text += glyph.text;
        previous.width = Math.max(previous.width, glyph.x + glyph.width - previous.x);
      } else runs.push({ ...glyph });
    }
    return runs;
  }

  function appendText(
    parent: DesignNode,
    css: CSSStyleDeclaration,
    runs: TextRun[],
    overflow?: TextOverflowInfo,
    fullText?: string,
  ) {
    if (!runs.length) return;
    const x = Math.min(...runs.map((run) => run.x));
    const y = Math.min(...runs.map((run) => run.y));
    const box = overflow
      ? { ...parent.contentBox }
      : {
          x,
          y,
          width: Math.max(...runs.map((run) => run.x + run.width)) - x,
          height: Math.max(...runs.map((run) => run.y + run.height)) - y,
        };
    const id = `n${++sequence}`;
    const text = fullText ?? runs.map((run) => run.text).join('\n');
    let visualBox = { ...box };
    for (const run of runs)
      for (const shadow of (run.textShadow || css.textShadow).split(/,(?![^()]*\))/)) {
        const values = Array.from(shadow.matchAll(/(-?[\d.]+)px/g), (match) => number(match[1]));
        if (values.length >= 2)
          visualBox = union(
            visualBox,
            expand(run, values[0], values[1], Math.max(0, values[2] || 0) * 1.5 + 3),
          );
      }
    nodes.push({
      ...parent,
      id,
      parentId: parent.id,
      children: [],
      kind: 'text',
      name: text.trim().slice(0, 32),
      tag: '#text',
      box,
      contentBox: box,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      border: { top: 0, right: 0, bottom: 0, left: 0 },
      radius: [0, 0, 0, 0],
      style: {
        ...Object.fromEntries(
          properties.map((property) => [property, css.getPropertyValue(property)]),
        ),
        ...(overflow
          ? {
              'font-family': runs[0].fontFamily,
              'font-size': `${runs[0].fontSize}px`,
              'font-weight': runs[0].fontWeight,
              'font-style': runs[0].fontStyle,
            }
          : {}),
      },
      text,
      runs,
      visualBox,
      textOverflow: overflow,
      assetId: undefined,
      assetUrl: undefined,
      backgroundUrl: undefined,
      svgSource: undefined,
      hasVisual: true,
      order: sequence,
      paintOrder: 0,
    });
    parent.children.push(id);
  }

  function extractText(textNode: Text, parent: DesignNode, css: CSSStyleDeclaration) {
    appendText(parent, css, mergeTextRuns(textGlyphs(textNode, css)));
  }

  function overflowInfo(element: Element, css: CSSStyleDeclaration): TextOverflowInfo | undefined {
    const lines = number(css.getPropertyValue('-webkit-line-clamp'));
    if (lines > 0) {
      if (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth)
        return { mode: 'line-clamp', maxLines: lines, truncated: true };
      return;
    }
    if (
      css.textOverflow === 'ellipsis' &&
      css.overflowX !== 'visible' &&
      element.scrollWidth > element.clientWidth
    )
      return { mode: 'ellipsis', maxLines: 1, truncated: true };
  }

  function simpleOverflow(element: Element, css: CSSStyleDeclaration) {
    if (
      css.direction !== 'ltr' ||
      css.writingMode !== 'horizontal-tb' ||
      !['start', 'left', '-webkit-left'].includes(css.textAlign)
    )
      return false;
    if (
      !number(css.getPropertyValue('-webkit-line-clamp')) &&
      !['nowrap', 'pre'].includes(css.whiteSpace)
    )
      return false;
    if (css.whiteSpace === 'pre' && /[\r\n]/.test(element.textContent || '')) return false;
    for (const child of element.querySelectorAll('*')) {
      const style = getComputedStyle(child);
      if (style.display === 'none') continue;
      if (
        !['inline', 'contents'].includes(style.display) ||
        ['img', 'svg'].includes(child.localName) ||
        unsupported(child, style) ||
        style.position !== 'static' ||
        style.cssFloat !== 'none' ||
        !transparent(style.backgroundColor) ||
        style.backgroundImage !== 'none' ||
        Object.values(insets(style, 'border', '-width')).some(Boolean) ||
        style.boxShadow !== 'none'
      )
        return false;
    }
    return true;
  }

  function extractOverflowText(
    element: Element,
    parent: DesignNode,
    css: CSSStyleDeclaration,
    info: TextOverflowInfo,
  ) {
    const glyphs: TextRun[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode as Text;
      const style = getComputedStyle(text.parentElement!);
      if (style.visibility !== 'hidden') glyphs.push(...textGlyphs(text, style, true));
    }
    const lines: { baseline: number; glyphs: TextRun[] }[] = [];
    for (const glyph of glyphs) {
      let line = lines.find((line) => Math.abs(line.baseline - glyph.baseline) < 1);
      if (!line) {
        line = { baseline: glyph.baseline, glyphs: [] };
        lines.push(line);
      }
      line.glyphs.push(glyph);
    }
    lines.sort((a, b) => a.baseline - b.baseline);
    const kept = lines.slice(0, info.maxLines);
    const runs: TextRun[] = [];
    const visibleLines: string[] = [];
    let truncated = lines.length > info.maxLines;
    metricsContext.font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
    if ('lang' in metricsContext) metricsContext.lang = textLanguage(element);
    // Chromium enables CSS's automatic kerning at sizes where Canvas's auto
    // mode may disable it. Preserve the browser's measured character positions.
    metricsContext.fontKerning = css.fontKerning === 'none' ? 'none' : 'normal';
    metricsContext.letterSpacing = `${number(css.letterSpacing)}px`;
    const ellipsisWidth = metricsContext.measureText('…').width;
    const right = parent.contentBox.x + parent.contentBox.width;
    for (const [index, line] of kept.entries()) {
      const overflowing = line.glyphs.some((glyph) => glyph.x + glyph.width > right + 0.01);
      const ellipsize =
        info.mode === 'ellipsis'
          ? overflowing
          : index === info.maxLines - 1 && (truncated || overflowing);
      let shown = line.glyphs;
      if (ellipsize) {
        truncated = true;
        shown = shown.filter((glyph) => glyph.x + glyph.width <= right - ellipsisWidth + 0.01);
        while (shown.at(-1)?.text === ' ' && !css.whiteSpace.startsWith('pre')) shown.pop();
        // CSS keeps the first grapheme and clips it if even the marker cannot fit.
        if (!shown.length && line.glyphs.length) shown = [line.glyphs[0]];
        const last = shown.at(-1)!;
        shown.push({
          ...last,
          text: '…',
          x: last.x + last.width,
          width: ellipsisWidth,
          baseline: line.baseline,
          fontFamily: css.fontFamily,
          fontSize: number(css.fontSize),
          fontWeight: css.fontWeight,
          fontStyle: css.fontStyle,
          letterSpacing: number(css.letterSpacing),
          color: css.color,
          decoration: css.textDecorationLine,
          fontKerning: css.fontKerning === 'none' ? 'none' : 'normal',
          language: textLanguage(element),
          generated: 'ellipsis',
        });
      }
      runs.push(...mergeTextRuns(shown));
      visibleLines.push(shown.map((glyph) => glyph.text).join(''));
    }
    const clip = {
      ownerId: parent.id,
      x: parent.box.x + parent.border.left,
      y: parent.box.y + parent.border.top,
      width: parent.box.width - parent.border.left - parent.border.right,
      height: parent.box.height - parent.border.top - parent.border.bottom,
      radius: parent.radius.map((value, i) =>
        Math.max(
          0,
          value -
            Math.max(
              i < 2 ? parent.border.top : parent.border.bottom,
              i === 0 || i === 3 ? parent.border.left : parent.border.right,
            ),
        ),
      ),
    };
    // Legacy -webkit-line-clamp can expose part of the next line inside bottom
    // padding. Retain that clipped ink rather than silently changing its appearance.
    runs.push(
      ...mergeTextRuns(
        lines
          .slice(info.maxLines)
          .flatMap((line) =>
            line.glyphs.filter(
              (glyph) => glyph.y < clip.y + clip.height && glyph.y + glyph.height > clip.y,
            ),
          ),
      ),
    );
    appendText(
      { ...parent, clips: [...parent.clips, clip] },
      css,
      runs,
      { ...info, truncated, visibleText: visibleLines.join('\n') },
      element.textContent?.trim() || '',
    );
  }

  function visit(
    element: Element,
    parentId: string | null,
    clips: DesignNode['clips'],
    parentOpacity: number,
    depth: number,
  ) {
    if (nodes.length >= nodeLimit || depth > 70) return;
    const tag = element.tagName.toLowerCase();
    if (['script', 'style', 'link', 'meta', 'head', 'noscript', 'template'].includes(tag)) return;
    const css = getComputedStyle(element);
    const hiddenRoot =
      css.visibility === 'hidden' && element === document.documentElement && htmlDocument;
    if (
      css.display === 'none' ||
      (css.visibility === 'hidden' && !hiddenRoot) ||
      number(css.opacity) === 0
    )
      return;
    const box = rect(element.getBoundingClientRect());
    const zeroWrapper =
      (box.width === 0 || box.height === 0) &&
      (element.children.length > 0 ||
        ['::before', '::after'].some((pseudo) => {
          const style = getComputedStyle(element, pseudo);
          return !['none', 'normal'].includes(style.content) && style.display !== 'none';
        }));
    if (
      !visible(box) &&
      !zeroWrapper &&
      !transformedSources.has(element.getAttribute('data-page-to-design-source-id') || '') &&
      css.display !== 'contents'
    ) {
      // A zero-sized wrapper can still have visible absolutely positioned descendants.
      if (box.width === 0 || box.height === 0) {
        for (const child of element.children)
          visit(child, parentId, clips, parentOpacity * number(css.opacity), depth + 1);
      }
      return;
    }
    if (css.display === 'contents') {
      for (const child of element.children) visit(child, parentId, clips, parentOpacity, depth + 1);
      return;
    }
    const id = `n${++sequence}`;
    element.setAttribute('data-page-to-design-id', id);
    const padding = insets(css, 'padding');
    const border = insets(css, 'border', '-width');
    const radii = radius(css, box);
    const style = Object.fromEntries(
      properties.map((property) => [property, css.getPropertyValue(property)]),
    );
    const overflow = overflowInfo(element, css);
    const fallbackReason =
      unsupported(element, css) ||
      (overflow && !simpleOverflow(element, css) ? '复杂省略排版保留为局部截图' : undefined);
    const kind = fallbackReason
      ? 'raster'
      : tag === 'img'
        ? 'image'
        : tag === 'canvas'
          ? 'canvas'
          : tag === 'video'
            ? 'video'
            : ['input', 'select', 'textarea', 'progress', 'meter'].includes(tag)
              ? 'control'
              : tag === 'svg'
                ? 'svg'
                : 'frame';
    const label =
      element.getAttribute('aria-label') ||
      element.getAttribute('alt') ||
      element.id ||
      (typeof element.className === 'string'
        ? element.className.trim().split(/\s+/).slice(0, 2).join(' · ')
        : '') ||
      tag;
    const node: DesignNode = {
      id,
      parentId,
      children: [],
      kind,
      name: label.slice(0, 70),
      tag,
      box,
      captureSourceId: element.getAttribute('data-page-to-design-source-id') || undefined,
      contentBox: {
        x: box.x + border.left + padding.left,
        y: box.y + border.top + padding.top,
        width: Math.max(0, box.width - border.left - border.right - padding.left - padding.right),
        height: Math.max(0, box.height - border.top - border.bottom - padding.top - padding.bottom),
      },
      padding,
      margin: insets(css, 'margin'),
      border,
      radius: radii,
      opacity: parentOpacity * number(css.opacity),
      clips: [...clips],
      style,
      order: sequence,
      paintOrder: 0,
      hasVisual:
        !transparent(css.backgroundColor) ||
        css.backgroundImage !== 'none' ||
        Object.values(border).some((value) => value > 0) ||
        css.boxShadow !== 'none' ||
        kind !== 'frame',
      fallbackReason,
    };
    if (hiddenRoot) {
      node.skipBackground = true;
      node.skipBorders = true;
      node.hasVisual = false;
      node.style['pointer-events'] = 'none';
    }
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
        radius: radii.map((value, index) =>
          Math.max(
            0,
            value -
              Math.max(
                index < 2 ? inset.top : inset.bottom,
                index === 0 || index === 3 ? inset.left : inset.right,
              ),
          ),
        ),
      };
    };
    if (css.backgroundImage !== 'none' || css.backgroundClip !== 'border-box') {
      node.backgroundBox = backgroundArea(css.backgroundOrigin);
      node.backgroundClip = backgroundArea(css.backgroundClip);
    }
    if (fallbackReason || css.boxShadow !== 'none' || css.filter !== 'none')
      node.visualBox = effectsBounds(element, Boolean(fallbackReason) || css.filter !== 'none');
    if (kind === 'image')
      node.assetUrl = (element as HTMLImageElement).currentSrc || (element as HTMLImageElement).src;
    if (kind === 'canvas') {
      const canvas = element as HTMLCanvasElement;
      node.canvas = { width: canvas.width, height: canvas.height };
    }
    if (kind === 'video') {
      const video = element as HTMLVideoElement;
      node.video = {
        currentTime: video.currentTime,
        duration: Number.isFinite(video.duration) ? video.duration : undefined,
        width: video.videoWidth,
        height: video.videoHeight,
        source: video.currentSrc || video.src || undefined,
        poster: video.poster || undefined,
      };
    }
    if (kind === 'control') {
      const field = element as HTMLInputElement;
      const type = tag === 'input' ? field.type : tag;
      const select = tag === 'select' ? (element as HTMLSelectElement) : undefined;
      const placeholder = element.getAttribute('placeholder') || undefined;
      const placeholderStyle = getComputedStyle(element, '::placeholder');
      const value =
        type === 'password'
          ? '•'.repeat(Array.from(field.value).length)
          : select
            ? Array.from(select.selectedOptions)
                .map((option) => option.label)
                .join(', ')
            : type === 'file'
              ? Array.from(field.files || [])
                  .map((file) => file.name)
                  .join(', ')
              : ['progress', 'meter'].includes(type)
                ? String((element as HTMLProgressElement).value)
                : field.value || '';
      node.control = {
        type,
        value,
        placeholder,
        disabled: element.matches(':disabled'),
        readOnly: !!field.readOnly,
        checked: type === 'checkbox' || type === 'radio' ? field.checked : undefined,
        indeterminate: type === 'checkbox' ? field.indeterminate : undefined,
        min: element.hasAttribute('min')
          ? number(element.getAttribute('min')!)
          : type === 'range' || type === 'progress' || type === 'meter'
            ? 0
            : undefined,
        max: element.hasAttribute('max')
          ? number(element.getAttribute('max')!)
          : type === 'range'
            ? 100
            : type === 'progress' || type === 'meter'
              ? 1
              : undefined,
        step: element.hasAttribute('step') ? number(element.getAttribute('step')!) : undefined,
        multiple: select?.multiple,
        size: select?.size,
        options: select
          ? Array.from(select.options).map((option) => ({
              label: option.label,
              selected: option.selected,
              disabled: option.disabled || !!option.closest('optgroup:disabled'),
            }))
          : undefined,
        scrollTop: element.scrollTop,
        scrollLeft: element.scrollLeft,
        focused: document.activeElement === element,
        placeholderColor: placeholderStyle.color,
        placeholderOpacity: number(placeholderStyle.opacity || '1'),
        accentColor: css.accentColor,
      };
      node.controlBox = { ...node.contentBox };
      if (type === 'image') node.assetUrl = field.src;
      if (type === 'progress' && !element.hasAttribute('value')) node.control.indeterminate = true;
    }
    if (kind === 'svg') {
      try {
        node.svgSource = serializeSvg(element, node.contentBox);
      } catch {
        node.kind = 'raster';
        node.fallbackReason = 'SVG 序列化失败，已保留为局部截图';
        node.visualBox = effectsBounds(element, false);
      }
    }
    const backgroundMatch = /^url\(["']?(.*?)["']?\)$/.exec(css.backgroundImage);
    if (backgroundMatch) node.backgroundUrl = backgroundMatch[1];
    nodes.push(node);
    childIds(parentId, id);
    if (node.fallbackReason) {
      if (overflow) {
        node.text = element.textContent?.trim() || '';
        node.textOverflow = overflow;
      }
      warnings.push({ code: 'RASTER_FALLBACK', message: node.fallbackReason, nodeId: id });
      return;
    }
    if (overflow) {
      extractOverflowText(element, node, css, overflow);
      return;
    }
    if (
      kind === 'image' ||
      kind === 'video' ||
      kind === 'canvas' ||
      kind === 'control' ||
      kind === 'svg'
    )
      return;
    const childClips = [...clips];
    const containsPaint = /(?:^|\s)(?:paint|strict|content)(?:\s|$)/.test(css.contain);
    if (containsPaint || css.overflowX !== 'visible' || css.overflowY !== 'visible') {
      childClips.push({
        ownerId: id,
        x: css.overflowX === 'visible' && !containsPaint ? -100000 : box.x + border.left,
        y: css.overflowY === 'visible' && !containsPaint ? -100000 : box.y + border.top,
        width:
          css.overflowX === 'visible' && !containsPaint
            ? 200000
            : Math.max(0, box.width - border.left - border.right),
        height:
          css.overflowY === 'visible' && !containsPaint
            ? 200000
            : Math.max(0, box.height - border.top - border.bottom),
        radius: containsPaint
          ? radii.map((r, i) =>
              Math.max(
                0,
                r -
                  Math.max(
                    i < 2 ? border.top : border.bottom,
                    i === 0 || i === 3 ? border.left : border.right,
                  ),
              ),
            )
          : css.overflowX === 'visible' || css.overflowY === 'visible'
            ? [0, 0, 0, 0]
            : radii,
      });
    }
    for (const child of element.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE)
        visit(child as Element, id, childClips, node.opacity, depth + 1);
      else if (child.nodeType === Node.TEXT_NODE) {
        const originalClips = node.clips;
        node.clips = childClips;
        extractText(child as Text, node, css);
        node.clips = originalClips;
      }
    }
    if (element.shadowRoot) {
      for (const child of element.shadowRoot.children)
        visit(child, id, childClips, node.opacity, depth + 1);
    }
  }

  visit(document.documentElement, null, [], 1, 0);
  const root = nodes.find((node) => node.tag === 'html');
  if (root && root.kind !== 'raster' && paintsCanvas && nodes.length < options.maxNodes) {
    const area = { x: 0, y: 0, width: documentWidth, height: documentHeight };
    const background: DesignNode = {
      ...root,
      id: root.id + ':canvas-background',
      parentId: root.id,
      children: [],
      kind: 'frame',
      name: '页面背景',
      tag: '#canvas-background',
      visualBox: area,
      contentBox: { ...root.box },
      backgroundBox: undefined,
      backgroundClip: { ...area, radius: [0, 0, 0, 0] },
      backgroundUrl: undefined,
      captureSourceId: undefined,
      radius: [0, 0, 0, 0],
      radiusY: undefined,
      clips: [],
      style: {
        ...Object.fromEntries(
          properties
            .filter((property) => property.startsWith('background-'))
            .map((property) => [property, canvasStyle.getPropertyValue(property)]),
        ),
        opacity: '1',
        'pointer-events': 'none',
        'box-shadow': 'none',
      },
      skipBorders: true,
      skipBackground: false,
      hasVisual: true,
      order: root.order - 0.01,
      paintOrder: root.paintOrder - 0.01,
      canvasBackground: { source: propagateBody ? 'body' : 'html', area },
    };
    root.skipBoxBackground = true;
    root.backgroundUrl = undefined;
    if (propagateBody) {
      const body = nodes.find((node) => node.tag === 'body');
      if (body) {
        body.skipBoxBackground = true;
        body.backgroundUrl = undefined;
      }
    }
    root.children.unshift(background.id);
    nodes.unshift(background);
  }
  if (nodes.length >= options.maxNodes)
    warnings.push({
      code: 'NODE_LIMIT',
      message: `页面超过 ${options.maxNodes} 个图层，已截取前面的内容。`,
    });
  if (examinedCharacters > 60000)
    warnings.push({ code: 'TEXT_LIMIT', message: '页面文字较多，部分文字未转换。' });
  if (options.fullPage && document.documentElement.scrollHeight > options.maxHeight)
    warnings.push({ code: 'HEIGHT_LIMIT', message: `长页最多采集 ${options.maxHeight} CSS px。` });
  const fontFaces: DomLayoutSnapshot['fontFaces'] = [];
  function readRules(rules: CSSRuleList, baseUrl: string) {
    for (const rule of rules) {
      if (rule.type === CSSRule.FONT_FACE_RULE) {
        const style = (rule as CSSFontFaceRule).style;
        const urls = Array.from(
          style.getPropertyValue('src').matchAll(/url\(["']?([^"')]+)["']?\)/g),
        ).flatMap((match) => {
          try {
            return [new URL(match[1], baseUrl).href];
          } catch {
            return [];
          }
        });
        fontFaces.push({
          family: style.fontFamily.replace(/^["']|["']$/g, ''),
          style: style.fontStyle || 'normal',
          weight: style.fontWeight || '400',
          unicodeRange: style.getPropertyValue('unicode-range'),
          urls,
        });
      } else if ('cssRules' in rule) {
        try {
          readRules((rule as CSSGroupingRule).cssRules, baseUrl);
        } catch {
          /* Cross-origin stylesheet. */
        }
      }
    }
  }
  for (const sheet of document.styleSheets) {
    try {
      readRules(sheet.cssRules, sheet.href || document.baseURI);
    } catch {
      /* Supplemented by captured CSS responses on the server. */
    }
  }
  return {
    title: document.title || location.hostname,
    width: documentWidth,
    height: documentHeight,
    background: '#ffffff',
    nodes,
    warnings,
    fontFaces,
  };
}
