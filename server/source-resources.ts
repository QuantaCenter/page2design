/** Installed before source scripts run. Retain small, page-owned resources that
 * have no network response, including revoked object URLs and FontFace buffers. */
export function installSourceResources() {
  const maximum = 24 * 1024 * 1024,
    perResource = 8 * 1024 * 1024;
  const state = {
    blobs: new Map<string, Blob>(),
    fonts: new Map<FontFace, string | ArrayBuffer>(),
  };
  Object.defineProperty(globalThis, Symbol.for('page-to-design.source-resources'), {
    value: state,
  });
  let retained = 0;
  const blobs = new WeakSet<Blob>();
  const createObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (source) {
    const url = createObjectURL(source);
    if (source instanceof Blob && source.size <= perResource) {
      if (!blobs.has(source) && retained + source.size <= maximum) {
        blobs.add(source);
        retained += source.size;
      }
      if (blobs.has(source)) state.blobs.set(url, source);
    }
    return url;
  };
  globalThis.FontFace = new Proxy(FontFace, {
    construct(target, args, newTarget) {
      const face = Reflect.construct(target, args, newTarget) as FontFace;
      const source = args[1] as string | ArrayBuffer | ArrayBufferView;
      if (typeof source === 'string') state.fonts.set(face, source);
      else {
        const bytes = ArrayBuffer.isView(source)
          ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
          : new Uint8Array(source);
        if (bytes.length <= perResource && retained + bytes.length <= maximum) {
          state.fonts.set(face, bytes.slice().buffer);
          retained += bytes.length;
        }
      }
      return face;
    },
  });
}

/** Serialized into the source page; source-page timers may already be paused. */
export async function readSourceResource(options: { url: string; maximum: number }) {
  const state = (globalThis as unknown as Record<symbol, { blobs: Map<string, Blob> } | undefined>)[
    Symbol.for('page-to-design.source-resources')
  ];
  try {
    let blob = state?.blobs.get(options.url);
    if (!blob) {
      const controller = new AbortController();
      // AbortSignal.timeout uses the browser's native clock, unlike page timers.
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(2500)]);
      const response = await fetch(options.url, {
        credentials: 'include',
        cache: 'force-cache',
        signal,
      });
      if (!response.ok || !response.body) return undefined;
      if (Number(response.headers.get('content-length')) > options.maximum) {
        controller.abort();
        return undefined;
      }
      const reader = response.body.getReader(),
        chunks: Uint8Array<ArrayBuffer>[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > options.maximum) {
          await reader.cancel();
          controller.abort();
          return undefined;
        }
        chunks.push(value);
      }
      blob = new Blob(chunks, { type: response.headers.get('content-type') || '' });
    }
    if (!blob.size || blob.size > options.maximum) return undefined;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let start = 0; start < bytes.length; start += 16384)
      binary += String.fromCharCode(...bytes.subarray(start, start + 16384));
    return { base64: btoa(binary), mime: blob.type || 'application/octet-stream' };
  } catch {
    return undefined;
  }
}

/** FontFace objects added by scripts are absent from stylesheet CSSOM. */
export function readSourceFonts() {
  const state = (
    globalThis as unknown as Record<
      symbol,
      { fonts: Map<FontFace, string | ArrayBuffer> } | undefined
    >
  )[Symbol.for('page-to-design.source-resources')];
  const result: {
    family: string;
    style: string;
    weight: string;
    unicodeRange: string;
    urls: string[];
  }[] = [];
  for (const [face, source] of state?.fonts || []) {
    if (!document.fonts.has(face) || face.status !== 'loaded') continue;
    let urls: string[];
    if (typeof source === 'string')
      urls = Array.from(source.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g)).flatMap(
        (match) => {
          try {
            return [new URL((match[1] ?? match[2] ?? match[3]).trim(), document.baseURI).href];
          } catch {
            return [];
          }
        },
      );
    else {
      const bytes = new Uint8Array(source);
      let binary = '';
      for (let start = 0; start < bytes.length; start += 16384)
        binary += String.fromCharCode(...bytes.subarray(start, start + 16384));
      urls = ['data:application/octet-stream;base64,' + btoa(binary)];
    }
    result.push({
      family: face.family.replace(/^["']|["']$/g, ''),
      style: face.style,
      weight: face.weight,
      unicodeRange: face.unicodeRange,
      urls,
    });
  }
  return result;
}
