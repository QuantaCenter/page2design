import type { Page } from 'playwright';
import { setTimeout as pause } from 'node:timers/promises';

interface ImageTask {
  image: HTMLImageElement;
  source: string;
  status: 'pending' | 'loaded' | 'failed';
  decoding: boolean;
  objectUrl?: string;
}
interface ImageState {
  images: WeakMap<HTMLImageElement, ImageTask>;
  urls: Map<string, ImageTask>;
  needed: Set<string>;
  lastCssScan: number;
}
export interface ImageReadiness {
  total: number;
  loaded: number;
  failed: number;
  pending: number;
  timedOut: boolean;
  failedUrls: string[];
}
interface ScanOptions {
  fullPage: boolean;
  maxHeight: number;
  now: number;
}
type ImageScan = Omit<ImageReadiness, 'timedOut'> & { signature: number };

/** Serialized into the source page. No timers: it also works after its clock
 * is frozen, while the browser finishes network requests and image decoding. */
function scanImages(state: ImageState, options: ScanOptions) {
  const bottom = options.fullPage ? options.maxHeight : innerHeight;
  const inScope = (element: Element) => {
    const box = element.getBoundingClientRect();
    return (
      element.getClientRects().length > 0 &&
      box.x < innerWidth &&
      box.right >= 0 &&
      box.y + scrollY < bottom &&
      box.bottom + scrollY >= 0
    );
  };
  const roots: (Document | ShadowRoot)[] = [document];
  const elements: Element[] = [];
  for (let index = 0; index < roots.length; index++)
    for (const element of roots[index].querySelectorAll('*')) {
      elements.push(element);
      if (element.shadowRoot) roots.push(element.shadowRoot);
    }
  const tasks: ImageTask[] = [];
  const keys: string[] = [];
  const update = (task: ImageTask) => {
    const image = task.image;
    if (!image.complete) {
      task.status = 'pending';
      return;
    }
    if (!image.naturalWidth || !image.naturalHeight) {
      task.status = 'failed';
      return;
    }
    if (task.status === 'loaded' || task.decoding) return;
    task.status = 'pending';
    task.decoding = true;
    void image
      .decode()
      .then(
        () => {
          task.status = 'loaded';
        },
        () => {
          task.status = image.complete ? 'failed' : 'pending';
        },
      )
      .finally(() => {
        task.decoding = false;
      });
  };
  for (const element of elements) {
    if (!(element instanceof HTMLImageElement)) continue;
    const hasSource =
      !!element.getAttribute('src')?.trim() ||
      !!element.getAttribute('srcset')?.trim() ||
      !!element.closest('picture')?.querySelector('source[srcset]');
    if (!hasSource) continue;
    const hasBox = element.getClientRects().length > 0;
    if (hasBox ? !inScope(element) : element.loading === 'lazy') continue;
    // Native lazy images inside the capture band must finish even after the
    // preload scroll has returned to the top of the document.
    if (element.loading === 'lazy') element.loading = 'eager';
    const source = element.currentSrc || element.src || element.srcset;
    let task = state.images.get(element);
    if (!task || task.source !== source) {
      task = { image: element, source, status: 'pending', decoding: false };
      state.images.set(element, task);
    }
    update(task);
    tasks.push(task);
    keys.push(source);
  }
  if (options.now - state.lastCssScan >= 350) {
    const needed = new Set<string>();
    const add = (value: string, base: string) => {
      if (!value || value.startsWith('#')) return;
      try {
        needed.add(new URL(value, base).href);
      } catch {
        /* Invalid image URL. */
      }
    };
    const urls = (value: string, base: string, mask = false) => {
      const pattern = /url\(\s*(?:"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|([^)]*))\s*\)/g;
      for (const match of value.matchAll(pattern)) {
        const url = (match[1] ?? match[2] ?? match[3]).trim().replace(/\\([\\"'()])/g, '$1');
        if (mask && url.includes('#')) continue;
        add(url, base);
      }
    };
    for (const element of elements) {
      if (!inScope(element)) continue;
      urls(getComputedStyle(element).backgroundImage, element.baseURI);
      urls(getComputedStyle(element).maskImage, element.baseURI, true);
      for (const pseudo of ['::before', '::after']) {
        const style = getComputedStyle(element, pseudo);
        if (style.display === 'none' || style.content === 'none' || style.content === 'normal')
          continue;
        urls(style.backgroundImage, element.baseURI);
        urls(style.maskImage, element.baseURI, true);
        urls(style.content, element.baseURI);
      }
      if (element instanceof HTMLVideoElement) add(element.poster, element.baseURI);
      else if (element instanceof HTMLInputElement && element.type === 'image')
        add(element.getAttribute('src') || '', element.baseURI);
      else if (
        element.namespaceURI === 'http://www.w3.org/2000/svg' &&
        element.localName === 'image'
      )
        add(
          element.getAttribute('href') ||
            element.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
            '',
          element.baseURI,
        );
    }
    for (const [url, task] of state.urls)
      if (!needed.has(url)) {
        task.image.removeAttribute('src');
        if (task.objectUrl) URL.revokeObjectURL(task.objectUrl);
        state.urls.delete(url);
      }
    for (const url of needed)
      if (!state.urls.has(url)) {
        const image = new Image();
        const retained = (
          globalThis as unknown as Record<symbol, { blobs: Map<string, Blob> } | undefined>
        )[Symbol.for('page-to-design.source-resources')]?.blobs.get(url.split('#')[0]);
        const objectUrl = retained && URL.createObjectURL(retained);
        image.src = objectUrl || url;
        state.urls.set(url, { image, source: url, status: 'pending', decoding: false, objectUrl });
      }
    state.needed = needed;
    state.lastCssScan = options.now;
  }
  for (const url of state.needed) {
    const task = state.urls.get(url)!;
    update(task);
    tasks.push(task);
    keys.push(url);
  }
  let signature = 2166136261;
  for (const key of keys.sort())
    for (let index = 0; index < key.length; index++)
      signature = Math.imul(signature ^ key.charCodeAt(index), 16777619);
  return {
    total: tasks.length,
    loaded: tasks.filter((task) => task.status === 'loaded').length,
    failed: tasks.filter((task) => task.status === 'failed').length,
    failedUrls: tasks.filter((task) => task.status === 'failed').map((task) => task.source),
    pending: tasks.filter((task) => task.status === 'pending').length,
    signature,
  };
}

/** Reuse readiness across the live and frozen phases. Deadlines are measured
 * by Node, so source-page timers, analytics and carousels cannot stall it. */
export async function createImageWaiter(
  page: Page,
  options: { fullPage: boolean; maxHeight: number },
) {
  const state = await page.evaluateHandle(() => ({
    images: new WeakMap<HTMLImageElement, ImageTask>(),
    urls: new Map<string, ImageTask>(),
    needed: new Set<string>(),
    lastCssScan: 0,
  }));
  // JSHandle.evaluate invokes functions with the handle as its first argument;
  // string expressions are evaluated without that argument.
  // Serialize our own scanner for Playwright; no untrusted source is evaluated.
  // oxlint-disable-next-line typescript/no-implied-eval
  const scan = new Function(
    'state',
    'options',
    `const __name = value => value; return (${scanImages.toString()})(state, options);`,
  ) as (state: ImageState, options: ScanOptions) => ImageScan;
  return {
    async waitUntil(deadline: number): Promise<ImageReadiness> {
      let readySince = 0,
        previous: number | undefined;
      while (true) {
        const now = Date.now();
        const report = await state.evaluate(scan, { ...options, now });
        if (report.pending === 0 && report.signature === previous) readySince ||= now;
        else readySince = 0;
        previous = report.signature;
        if ((readySince && now - readySince >= 500) || Date.now() >= deadline)
          return {
            total: report.total,
            loaded: report.loaded,
            failed: report.failed,
            pending: report.pending,
            timedOut: report.pending > 0,
            failedUrls: report.failedUrls,
          };
        await pause(Math.min(125, Math.max(1, deadline - Date.now())));
      }
    },
    async dispose() {
      await state.evaluate((state) => {
        for (const task of state.urls.values()) {
          task.image.removeAttribute('src');
          if (task.objectUrl) URL.revokeObjectURL(task.objectUrl);
        }
        state.urls.clear();
      });
      await state.dispose();
    },
  };
}

/** Resource body readers may outlive a failed/streamed image response. */
export async function settleResourceBodies(tasks: Set<Promise<void>>, timeoutMs = 2000) {
  if (!tasks.size) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled(tasks),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
