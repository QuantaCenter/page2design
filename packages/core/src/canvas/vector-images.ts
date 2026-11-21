import type { Asset, CssImage, DesignDocument, DesignNode, Rect } from '../model/design.js';

export interface ImageDimensions {
  width?: number;
  height?: number;
  ratio?: number;
}
interface VectorSource extends ImageDimensions {
  svg: SVGSVGElement;
  variants: Map<string, HTMLImageElement>;
  fragment: string;
}
const sources = new WeakMap<HTMLImageElement, VectorSource>();
const sizeKey = (width: number, height: number) => `${width.toFixed(5)}:${height.toFixed(5)}`;

/** The decoder's fallback 300x150 viewport is not an SVG's natural CSS size. */
export function registerVectorImage(image: HTMLImageElement, asset: Asset, document: Document) {
  if (!asset.mime.toLowerCase().includes('svg')) return;
  const fragment = asset.dataUrl.includes('#')
    ? asset.dataUrl.slice(asset.dataUrl.indexOf('#'))
    : '';
  const match = /^data:[^,]*?(;base64)?,([\s\S]*)$/.exec(asset.dataUrl.split('#')[0]);
  if (!match) return;
  const text = match[1]
    ? new TextDecoder().decode(
        Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0)),
      )
    : decodeURIComponent(match[2]);
  const parsed = new document.defaultView!.DOMParser().parseFromString(text, 'image/svg+xml');
  if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg') return;
  const svg = parsed.documentElement as unknown as SVGSVGElement;
  const length = (property: 'width' | 'height') => {
    const value = svg.style.getPropertyValue(property) || svg.getAttribute(property) || '';
    const match = /^([\d.]+)(px|pt|pc|in|cm|mm|q)?$/i.exec(value.trim());
    if (!match)
      return value && !/(?:%|auto|none|inherit|initial|unset)/i.test(value)
        ? (property === 'width' ? image.naturalWidth : image.naturalHeight) || undefined
        : undefined;
    const units: Record<string, number> = {
      px: 1,
      pt: 96 / 72,
      pc: 16,
      in: 96,
      cm: 96 / 2.54,
      mm: 96 / 25.4,
      q: 96 / 101.6,
    };
    const size = Number(match[1]) * (units[(match[2] || 'px').toLowerCase()] || 1);
    return size > 0 ? size : undefined;
  };
  const width = length('width'),
    height = length('height');
  const viewBox = svg.viewBox.baseVal;
  const ratio =
    width && height
      ? width / height
      : viewBox.width > 0 && viewBox.height > 0
        ? viewBox.width / viewBox.height
        : undefined;
  sources.set(image, { svg, width, height, ratio, variants: new Map(), fragment });
}

export function imageDimensions(image: HTMLImageElement): ImageDimensions {
  return (
    sources.get(image) || {
      width: image.naturalWidth,
      height: image.naturalHeight,
      ratio: image.naturalWidth / image.naturalHeight,
    }
  );
}

export function backgroundVectorImage(image: HTMLImageElement, width: number, height: number) {
  return sources.get(image)?.variants.get(sizeKey(width, height)) || image;
}
export const isVectorImage = (image: HTMLImageElement) => sources.has(image);
export const hasScalableViewport = (image: HTMLImageElement) =>
  !!sources.get(image)?.svg.hasAttribute('viewBox');

/** Resolve each SVG image's concrete viewport before synchronous Canvas painting.
 * SVG remains vector data, including its masks, filters and aspect-ratio rules. */
export async function prepareVectorImages(
  source: DesignDocument,
  images: Map<string, HTMLImageElement>,
  document: Document,
  decode: (source: string) => Promise<HTMLImageElement>,
  resolveSize: (
    image: CssImage,
    area: Rect,
    style: Record<string, string>,
  ) => { width: number; height: number },
  resolveImageSize: (
    node: DesignNode,
    image: HTMLImageElement,
  ) => { width: number; height: number },
) {
  const pending = new Map<VectorSource, Set<string>>();
  const tasks: Promise<void>[] = [];
  const inputs = source.nodes.flatMap<{
    source: CssImage;
    original: Rect;
    style: Record<string, string>;
    size?: { width: number; height: number };
  }>((node) =>
    node.backgroundLayers?.length || node.maskLayers?.length
      ? [...(node.backgroundLayers || []), ...(node.maskLayers || [])].map((layer) => ({
          source: layer,
          original: layer.box,
          style: layer.style,
        }))
      : [
          {
            source: { image: node.style['background-image'], assetId: node.backgroundAssetId },
            original: node.backgroundBox || node.paintBox || node.localBox || node.box,
            style: node.style,
          },
        ],
  );
  for (const node of source.nodes) {
    const image = node.assetId && images.get(node.assetId);
    if (image && sources.has(image))
      inputs.push({
        source: { image: '', assetId: node.assetId },
        original: node.imageBox || node.contentBox,
        style: {},
        size: resolveImageSize(node, image),
      });
  }
  const nested = (source: CssImage): CssImage[] => [
    source,
    ...(source.crossFade || []).flatMap((child) => nested(child.source)),
  ];
  for (const input of inputs) {
    const original = input.original;
    const area: Rect = {
      x: Math.round(original.x),
      y: Math.round(original.y),
      width: Math.round(original.x + original.width) - Math.round(original.x),
      height: Math.round(original.y + original.height) - Math.round(original.y),
    };
    const { width, height } = input.size || resolveSize(input.source, area, input.style);
    if (!(width > 0 && height > 0) || !Number.isFinite(width + height)) continue;
    if (width < 1 || height < 1) continue;
    for (const source of nested(input.source)) {
      const image = source.assetId && images.get(source.assetId),
        vector = image && sources.get(image);
      if (!image || !vector) continue;
      const key = sizeKey(width, height),
        sizes = pending.get(vector) || new Set<string>();
      if (sizes.has(key)) continue;
      sizes.add(key);
      pending.set(vector, sizes);
      tasks.push(
        (async () => {
          const svg = vector.svg.cloneNode(true) as SVGSVGElement;
          const density = Math.min(
            1,
            8192 / width,
            8192 / height,
            Math.sqrt((16 * 1024 * 1024) / (width * height)),
          );
          const w = width * density,
            h = height * density;
          svg.setAttribute('width', String(w));
          svg.setAttribute('height', String(h));
          svg.style.setProperty('width', `${w}px`, 'important');
          svg.style.setProperty('height', `${h}px`, 'important');
          const text = new document.defaultView!.XMLSerializer().serializeToString(svg);
          const decoded = await decode(
            `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}${vector.fragment}`,
          );
          vector.variants.set(key, decoded);
        })(),
      );
    }
  }
  await Promise.all(tasks);
}
