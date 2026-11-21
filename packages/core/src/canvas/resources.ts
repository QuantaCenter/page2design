import type { DesignDocument } from '../model/design.js';
import { registerVectorImage, prepareVectorImages } from './vector-images.js';
import { backgroundSize, fittedImageSize } from './images.js';
import { cssImageDimensions } from './css-images.js';
import { RasterImages } from './raster-images.js';

export interface DocumentResources {
  documentId: string;
  images: Map<string, HTMLImageElement>;
  reference: HTMLImageElement | null;
  errors: string[];
  dispose(): void;
}
export interface ResourceOptions {
  signal?: AbortSignal;
  document?: Document;
  reference?: boolean;
}

/** Decode supplied data only. Remote resource loading belongs to the host. */
function loadImage(
  source: string,
  document: Document,
  signal?: AbortSignal,
): Promise<HTMLImageElement> {
  if (!source.startsWith('data:'))
    return Promise.reject(new TypeError('Image data must be inline.'));
  return new Promise((resolve, reject) => {
    const image = document.createElement('img');
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      image.removeAttribute('src');
      reject(signal?.reason || new DOMException('Resource decoding aborted.', 'AbortError'));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    image.onload = () => {
      void image.decode().then(
        () => {
          cleanup();
          resolve(image);
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );
    };
    image.onerror = () => {
      cleanup();
      reject(new Error('Image decoding failed.'));
    };
    image.src = source;
  });
}

/** Load already supplied fonts and images; release registered fonts with dispose. */
export async function loadDocumentResources(
  source: DesignDocument,
  options: ResourceOptions = {},
): Promise<DocumentResources> {
  const document = options.document || globalThis.document;
  if (!document?.defaultView) throw new TypeError('Resource decoding requires a browser Document.');
  const { signal } = options;
  signal?.throwIfAborted();
  const fontFaces: FontFace[] = [];
  const images = new Map<string, HTMLImageElement>();
  const rasters = new RasterImages(document);
  let disposed = false;
  const dispose = () => {
    disposed = true;
    signal?.removeEventListener('abort', dispose);
    for (const face of fontFaces) document.fonts.delete(face);
    fontFaces.length = 0;
    rasters.dispose();
    images.clear();
  };
  signal?.addEventListener('abort', dispose, { once: true });
  try {
    const errors: string[] = [];
    await Promise.all(
      source.fonts.map(async (font) => {
        try {
          if (!font.dataUrl.startsWith('data:')) throw new TypeError('Font data must be inline.');
          const face = new document.defaultView!.FontFace(font.family, `url("${font.dataUrl}")`, {
            weight: font.weight,
            style: font.style,
            ...(font.unicodeRange ? { unicodeRange: font.unicodeRange } : {}),
          });
          await face.load();
          if (disposed || signal?.aborted) return;
          document.fonts.add(face);
          fontFaces.push(face);
        } catch {
          errors.push(`字体 ${font.family} 加载失败，使用本机替代字体。`);
        }
      }),
    );
    signal?.throwIfAborted();
    await Promise.all(
      source.assets.map(async (asset) => {
        try {
          const image = await loadImage(asset.dataUrl, document, signal);
          if (!disposed) {
            registerVectorImage(image, asset, document);
            images.set(asset.id, image);
          }
        } catch {
          errors.push(`素材 ${asset.id} 加载失败。`);
        }
      }),
    );
    signal?.throwIfAborted();
    await prepareVectorImages(
      source,
      images,
      document,
      (value) => loadImage(value, document, signal),
      (source, area, style) =>
        backgroundSize(cssImageDimensions(source, images, area), area, style),
      (node, image) =>
        fittedImageSize(image, node.imageBox || node.contentBox, node.style['object-fit']),
    );
    signal?.throwIfAborted();
    await rasters.prepare(
      source,
      images,
      (source, area, style) =>
        backgroundSize(cssImageDimensions(source, images, area), area, style),
      (node, image) =>
        fittedImageSize(image, node.imageBox || node.contentBox, node.style['object-fit']),
    );
    signal?.throwIfAborted();
    const reference =
      source.referenceImage && options.reference !== false
        ? await loadImage(source.referenceImage, document, signal).catch(() => null)
        : null;
    signal?.throwIfAborted();
    return { documentId: source.id, images, reference, errors, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
