import type { Asset, CssImage, DesignDocument, DesignNode, Rect } from '../model/design.js';

interface RasterVariant {
  image: ImageBitmap;
  padded: ImageBitmap;
}
const prepared = new WeakMap<HTMLImageElement, Map<string, RasterVariant>>();
const MAX_BYTES = 32 * 1024 * 1024;
const key = (width: number, height: number) => `${width}:${height}`;

/** Exclude animation: resizing an animated image into a bitmap freezes it. */
function staticImage(asset: Asset) {
  if (/^image\/(jpeg|bmp)$/i.test(asset.mime)) return true;
  if (!/^image\/(png|webp)$/i.test(asset.mime)) return false;
  const match = /^data:[^,]*;base64,([^#]*)/i.exec(asset.dataUrl);
  if (!match) return false;
  let bytes: string;
  try {
    bytes = atob(match[1].slice(0, 16384));
  } catch {
    return false;
  }
  if (/webp/i.test(asset.mime))
    return (
      bytes.slice(0, 4) === 'RIFF' &&
      bytes.slice(8, 12) === 'WEBP' &&
      (bytes.slice(12, 16) !== 'VP8X' || !(bytes.charCodeAt(20) & 2))
    );
  if (bytes.slice(0, 8) !== '\x89PNG\r\n\x1a\n') return false;
  for (let offset = 8; offset + 8 <= bytes.length;) {
    const type = bytes.slice(offset + 4, offset + 8);
    if (type === 'acTL') return false;
    if (type === 'IDAT') return true;
    let length = 0;
    for (let i = 0; i < 4; i++) length = length * 256 + bytes.charCodeAt(offset + i);
    offset += length + 12;
  }
  return false;
}

function variant(
  image: HTMLImageElement,
  width: number,
  height: number,
  context: CanvasRenderingContext2D,
) {
  const matrix = context.getTransform(),
    density = Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
  return prepared
    .get(image)
    ?.get(key(Math.max(1, Math.round(width * density)), Math.max(1, Math.round(height * density))));
}

export function rasterImage(
  image: HTMLImageElement,
  width: number,
  height: number,
  context: CanvasRenderingContext2D,
) {
  return variant(image, width, height, context)?.image;
}

/** Extend edge texels underneath a rounded clip. Drawing an image rectangle
 * against the same clip otherwise multiplies edge coverage at fractional zoom. */
export function paintRasterImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  destination: Rect,
  clipping?: Rect,
) {
  const entry = variant(image, width, height, context);
  if (!entry) return false;
  const pattern = context.createPattern(entry.padded, 'no-repeat');
  if (!pattern) return false;
  const x = destination.width / entry.image.width,
    y = destination.height / entry.image.height;
  pattern.setTransform({ a: x, d: y, e: destination.x - x, f: destination.y - y });
  const extendX =
    !!clipping &&
    destination.x <= clipping.x + 1e-6 &&
    destination.x + destination.width >= clipping.x + clipping.width - 1e-6;
  const extendY =
    !!clipping &&
    destination.y <= clipping.y + 1e-6 &&
    destination.y + destination.height >= clipping.y + clipping.height - 1e-6;
  context.save();
  context.fillStyle = pattern;
  context.fillRect(
    destination.x - (extendX ? x : 0),
    destination.y - (extendY ? y : 0),
    destination.width + (extendX ? x * 2 : 0),
    destination.height + (extendY ? y * 2 : 0),
  );
  context.restore();
  return true;
}

/** Exact native minification at the preview's density levels. Unlike Canvas's
 * approximate mip sampling, bitmap resize preserves thin strokes in tiny logos.
 * The original image remains the asset; derived pixels have a bounded lifetime. */
export class RasterImages {
  private images = new Map<HTMLImageElement, Map<string, RasterVariant>>();
  private bytes = 0;
  private disposed = false;

  constructor(private document: Document) {}

  dispose() {
    this.disposed = true;
    for (const [image, sizes] of this.images) {
      if (prepared.get(image) === sizes) prepared.delete(image);
      for (const bitmap of sizes.values()) {
        bitmap.image.close();
        bitmap.padded.close();
      }
    }
    this.images.clear();
    this.bytes = 0;
  }

  async prepare(
    source: DesignDocument,
    images: Map<string, HTMLImageElement>,
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
    const factory = this.document.defaultView?.createImageBitmap?.bind(this.document.defaultView);
    if (!factory) return;
    const eligible = new Set(source.assets.filter(staticImage).map((asset) => asset.id));
    const inputs: { image: HTMLImageElement; width: number; height: number }[] = [];
    const add = (image: CssImage, width: number, height: number) => {
      const decoded = image.assetId && eligible.has(image.assetId) && images.get(image.assetId);
      if (decoded && width > 0 && height > 0 && Number.isFinite(width + height))
        inputs.push({ image: decoded, width, height });
      for (const child of image.crossFade || []) add(child.source, width, height);
    };
    for (const node of source.nodes) {
      const image = node.assetId && images.get(node.assetId);
      if (image && (node.kind === 'image' || node.control?.type === 'image')) {
        const size = resolveImageSize(node, image);
        add({ image: '', assetId: node.assetId }, size.width, size.height);
      }
      const layers = [...(node.backgroundLayers || []), ...(node.maskLayers || [])];
      if (!layers.length && node.backgroundAssetId)
        layers.push({
          image: '',
          assetId: node.backgroundAssetId,
          box: node.backgroundBox || node.paintBox || node.localBox || node.box,
          clip: node.backgroundClip || { ...node.box, radius: node.radius },
          style: node.style,
        });
      for (const layer of layers) {
        const original = layer.box,
          area = {
            x: Math.round(original.x),
            y: Math.round(original.y),
            width: Math.round(original.x + original.width) - Math.round(original.x),
            height: Math.round(original.y + original.height) - Math.round(original.y),
          },
          size = resolveSize(layer, area, layer.style);
        add(layer, size.width, size.height);
      }
    }
    inputs.sort((a, b) => a.width * a.height - b.width * b.height);
    for (const density of [1, 2, 0.5, 4, 0.25, 8, 0.125])
      for (const input of inputs) {
        if (this.disposed) return;
        const { image } = input,
          width = Math.max(1, Math.round(input.width * density)),
          height = Math.max(1, Math.round(input.height * density)),
          size = key(width, height),
          cost = (width * height + (width + 2) * (height + 2)) * 4;
        if (
          (width >= image.naturalWidth / 2 && height >= image.naturalHeight / 2) ||
          this.images.get(image)?.has(size) ||
          this.bytes + cost > MAX_BYTES
        )
          continue;
        let bitmap: ImageBitmap | undefined, padded: ImageBitmap | undefined;
        const canvas = this.document.createElement('canvas');
        try {
          bitmap = await factory(image, {
            resizeWidth: width,
            resizeHeight: height,
            resizeQuality: 'high',
          });
          if (this.disposed) {
            bitmap.close();
            return;
          }
          if (bitmap.width !== width || bitmap.height !== height) {
            bitmap.close();
            continue;
          }
          canvas.width = width + 2;
          canvas.height = height + 2;
          const context = canvas.getContext('2d')!;
          const xs = [
              [0, 1, 0, 1],
              [0, width, 1, width],
              [width - 1, 1, width + 1, 1],
            ],
            ys = [
              [0, 1, 0, 1],
              [0, height, 1, height],
              [height - 1, 1, height + 1, 1],
            ];
          for (const [sx, sw, dx, dw] of xs)
            for (const [sy, sh, dy, dh] of ys)
              context.drawImage(bitmap, sx, sy, sw, sh, dx, dy, dw, dh);
          padded = await factory(canvas);
          if (this.disposed) {
            bitmap.close();
            padded.close();
            return;
          }
          const sizes = this.images.get(image) || new Map<string, RasterVariant>();
          sizes.set(size, { image: bitmap, padded });
          this.images.set(image, sizes);
          prepared.set(image, sizes);
          this.bytes += cost;
        } catch {
          bitmap?.close();
          padded?.close();
          // Unsupported decoders retain normal native drawImage painting.
        } finally {
          canvas.width = canvas.height = 0;
        }
      }
  }
}
