import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import sharp from 'sharp';
import {
  prepareConversion,
  completeConversion,
  applyNativeTransforms,
  type Asset,
  type DesignDocument,
  type FontAsset,
  type CssImage,
} from '@page-to-design/core';
import {
  collectDomLayout,
  collectDomTables,
  collectDomPseudos,
  collectDomControls,
  collectDomBackgrounds,
  type PseudoLayout,
  type ControlTextLayout,
  type ControlPartLayout,
} from '@page-to-design/core/dom';
import { evaluateInPage, evaluateWithDocument } from './evaluate-in-page';
import {
  prepareTransformLayout,
  restoreTransformLayout,
  resolveNativeTransforms,
} from './transforms';
import { createImageWaiter, settleResourceBodies } from './wait-for-images';
import { installSourceResources, readSourceFonts, readSourceResource } from './source-resources';

/** URL acquisition is application policy, outside the conversion/rendering package. */
export interface ConvertOptions {
  url: string;
  width: number;
  height: number;
  fullPage: boolean;
}

let browserPromise: Promise<Browser> | undefined;
const MAX_HEIGHT = 12000;
const MAX_ASSET_BYTES = 24 * 1024 * 1024;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const customExecutable = process.env.CHROME_EXECUTABLE_PATH;
      const installedBrowser = existsSync(chromium.executablePath());
      const chromeOnMac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      const executablePath =
        customExecutable ||
        (!installedBrowser && existsSync(chromeOnMac) ? chromeOnMac : undefined);
      const browser = await chromium.launch({ headless: true, executablePath });
      browser.on('disconnected', () => {
        browserPromise = undefined;
      });
      return browser;
    })().catch((error) => {
      browserPromise = undefined;
      if (String(error).includes("Executable doesn't exist"))
        throw new Error('缺少 Chromium。请在项目目录运行 npm run setup:browser 后重试。');
      throw error;
    });
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) await (await browserPromise).close();
}

const assetId = (bytes: Buffer, fragment = '') => {
  const hash = createHash('sha256').update(bytes);
  if (fragment) hash.update('\0' + fragment);
  return `a-${hash.digest('hex').slice(0, 16)}`;
};
const dataUrl = (bytes: Buffer, mime: string) => `data:${mime};base64,${bytes.toString('base64')}`;
const inlineResource = (url: string) => {
  const match = /^data:([^,]*),([\s\S]*)$/i.exec(url.split('#')[0]);
  if (!match) return undefined;
  try {
    const fields = match[1].split(';'),
      mime = fields.shift() || 'text/plain';
    // Data URLs contain arbitrary bytes, not necessarily valid UTF-8. Decode
    // percent escapes as bytes, including forgiving literal '%' handling.
    const value = Buffer.from(match[2]);
    let length = 0;
    for (let index = 0; index < value.length; index++) {
      const pair = value[index] === 37 ? value.toString('latin1', index + 1, index + 3) : '';
      if (value[index] === 37 && /^[\da-f]{2}$/i.test(pair)) {
        value[length++] = Number.parseInt(pair, 16);
        index += 2;
      } else value[length++] = value[index];
    }
    const bytes = fields.some((field) => field.toLowerCase() === 'base64')
      ? Buffer.from(value.subarray(0, length).toString('ascii'), 'base64')
      : value.subarray(0, length);
    return bytes.length <= 8 * 1024 * 1024 ? { bytes, mime } : undefined;
  } catch {
    return undefined;
  }
};

// Initial hydration and scroll-triggered content both need a bounded quiet
// window. Network-idle can wait forever on analytics and live widgets.
async function waitForDomQuiet(page: Page) {
  await evaluateInPage(
    page,
    async () => {
      await new Promise<void>((resolve) => {
        let quietTimer: ReturnType<typeof setTimeout>;
        let maximumTimer: ReturnType<typeof setTimeout>;
        const finish = () => {
          clearTimeout(quietTimer);
          clearTimeout(maximumTimer);
          observer.disconnect();
          resolve();
        };
        const observer = new MutationObserver(() => {
          clearTimeout(quietTimer);
          quietTimer = setTimeout(finish, 350);
        });
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
        });
        quietTimer = setTimeout(finish, 600);
        maximumTimer = setTimeout(finish, 2200);
      });
    },
    undefined,
  );
}

export async function capture(
  options: ConvertOptions,
  signal?: AbortSignal,
): Promise<DesignDocument> {
  const startedAt = performance.now();
  const browser = await getBrowser();
  if (signal?.aborted) throw new Error('采集已取消');
  const context = await browser.newContext({
    viewport: { width: options.width, height: options.height },
    deviceScaleFactor: 1,
    // Keep the requested CSS viewport even on pages with no viewport meta tag.
    isMobile: false,
    hasTouch: options.width < 768,
    reducedMotion: 'reduce',
    colorScheme: 'light',
    locale: 'zh-CN',
  });
  const closeOnAbort = () => {
    void context.close();
  };
  signal?.addEventListener('abort', closeOnAbort, { once: true });
  const resourceBodies = new Map<string, { bytes: Buffer; mime: string }>();
  const cssBodies = new Map<string, string>();
  const pendingResources = new Set<Promise<void>>();
  const failedBlobImages = new Set<string>();
  let resourceBytes = 0;
  try {
    const page = await context.newPage();
    await page.addInitScript(`(() => {
      const __name = value => value;
      (${installSourceResources.toString()})();
    })()`);
    // Keep the native WebGL drawing buffer available for direct canvas
    // readback after source animation freezes. This is not a page screenshot.
    await page.addInitScript(`(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, options) {
        return getContext.call(this, type, /^(webgl2?|experimental-webgl)$/.test(type)
          ? {...options, preserveDrawingBuffer: true} : options);
      };
    })()`);
    // Install before the page registers timers so the carousel, requestAnimationFrame
    // and idle callbacks can all be paused after loading, without missing old timers.
    await page.clock.install();
    page.setDefaultTimeout(12000);
    page.on('dialog', (dialog) => {
      void dialog.dismiss();
    });
    page.on('requestfailed', (request) => {
      // Retained bytes must not resurrect a CSS image whose original object
      // URL was revoked before it ever loaded in the source page.
      if (
        request.resourceType() === 'image' &&
        request.url().startsWith('blob:') &&
        request.failure()?.errorText !== 'net::ERR_ABORTED'
      )
        failedBlobImages.add(request.url().split('#')[0]);
    });
    page.on('response', (response) => {
      const resourceType = response.request().resourceType();
      const declaredMime = (response.headers()['content-type'] || '').split(';')[0].trim();
      // A source the browser decoded can be served as generic binary data.
      // Request type is authoritative for images as well as icon fonts.
      const mime =
        resourceType === 'stylesheet' ? 'text/css' : declaredMime || 'application/octet-stream';
      if (
        !response.ok() ||
        (!['image', 'font', 'stylesheet'].includes(resourceType) &&
          !/^(image\/|font\/|application\/(?:font|x-font)|text\/css)/.test(mime))
      )
        return;
      if (
        Number(response.headers()['content-length'] || 0) > 8 * 1024 * 1024 ||
        resourceBytes > MAX_ASSET_BYTES
      )
        return;
      const task = (async () => {
        try {
          const bytes = await response.body();
          if (resourceBytes + bytes.length > MAX_ASSET_BYTES || bytes.length > 8 * 1024 * 1024)
            return;
          resourceBytes += bytes.length;
          if (mime === 'text/css') cssBodies.set(response.url(), bytes.toString('utf8'));
          else {
            const resource = { bytes, mime };
            resourceBodies.set(response.url().split('#')[0], resource);
            for (let request = response.request(); request;) {
              resourceBodies.set(request.url().split('#')[0], resource);
              const previous = request.redirectedFrom();
              if (!previous) break;
              request = previous;
            }
          }
        } catch {
          /* A cancelled or streamed response can have no body. */
        }
      })();
      pendingResources.add(task);
      void task.then(() => pendingResources.delete(task));
    });
    const response = await page.goto(options.url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    if (response && response.status() >= 400)
      throw new Error(`页面返回 HTTP ${response.status()}，请检查地址或登录状态。`);
    await page.waitForLoadState('load', { timeout: 8000 }).catch(() => undefined);
    await waitForDomQuiet(page);
    await evaluateInPage(
      page,
      async () => {
        await Promise.race([
          document.fonts.ready,
          new Promise((resolve) => setTimeout(resolve, 2500)),
        ]);
      },
      undefined,
    );
    if (options.fullPage) {
      await evaluateInPage(
        page,
        async (maxHeight) => {
          const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
          let previousHeight = 0;
          for (
            let y = 0, steps = 0;
            y < Math.min(document.documentElement.scrollHeight, maxHeight) && steps < 18;
            y += window.innerHeight, steps++
          ) {
            window.scrollTo(0, y);
            await pause(200);
            previousHeight = document.documentElement.scrollHeight;
          }
          window.scrollTo(0, 0);
          await pause(previousHeight ? 180 : 80);
        },
        MAX_HEIGHT,
      );
      // Scrolling starts asynchronous feeds that may replace the skeleton DOM.
      // Collect after those updates, so local screenshots still find their IDs.
      await waitForDomQuiet(page);
    }
    await page.addStyleTag({
      content:
        '*,*::before,*::after{animation-play-state:paused!important;transition:none!important;caret-color:transparent!important}html{scroll-behavior:auto!important}',
    });
    const imageWaiter = await createImageWaiter(page, {
      fullPage: options.fullPage,
      maxHeight: MAX_HEIGHT,
    });
    const imageDeadline = Date.now() + 20000;
    await imageWaiter.waitUntil(imageDeadline);
    await evaluateInPage(
      page,
      async () => {
        await Promise.all(
          Array.from(document.querySelectorAll('video'))
            .slice(0, 30)
            .map(
              (video) =>
                new Promise<void>((resolve) => {
                  if (video.readyState >= 2 || (!video.currentSrc && !video.src)) {
                    resolve();
                    return;
                  }
                  const done = () => {
                    clearTimeout(timer);
                    video.removeEventListener('loadeddata', done);
                    video.removeEventListener('error', done);
                    resolve();
                  };
                  const timer = setTimeout(done, 1500);
                  video.addEventListener('loadeddata', done, { once: true });
                  video.addEventListener('error', done, { once: true });
                }),
            ),
        );
        for (const video of document.querySelectorAll('video')) video.pause();
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      },
      undefined,
    );
    // DOM geometry, the reference image and every isolated bitmap must describe
    // one frame. Pausing CSS alone leaves JS carousels changing classes and boxes
    // while dozens of local screenshots are being taken.
    await page.clock.pauseAt(Date.now() + 1000);
    const imageReadiness = await imageWaiter.waitUntil(imageDeadline);
    const failedImageUrls = new Set(imageReadiness.failedUrls);
    await imageWaiter.dispose();
    await settleResourceBodies(pendingResources);
    await evaluateInPage(
      page,
      () => {
        for (const animation of document.getAnimations()) {
          if (animation.playState === 'running') animation.pause();
        }
      },
      undefined,
    );
    const transformState = await prepareTransformLayout(page);
    const collected = await evaluateWithDocument(page, collectDomLayout, {
      fullPage: options.fullPage,
      maxHeight: MAX_HEIGHT,
      maxNodes: 4500,
      transformedSourceIds: transformState.active,
      documentHeight: transformState.height,
    });
    collected.fontFaces.push(...(await evaluateInPage(page, readSourceFonts, undefined)));
    if (imageReadiness.failed)
      collected.warnings.push({
        code: 'IMAGE_LOAD_FAILED',
        message: `${imageReadiness.failed} 项图片资源加载或解码失败，已保留当前可见状态。`,
      });
    if (imageReadiness.timedOut)
      collected.warnings.push({
        code: 'IMAGE_LOAD_TIMEOUT',
        message: `${imageReadiness.pending} 项图片资源在 20 秒内未完成加载或解码，已保留当前可见状态。`,
      });
    collected.height = options.fullPage
      ? Math.min(MAX_HEIGHT, transformState.height)
      : options.height;
    const tables = await evaluateWithDocument(page, collectDomTables, {});

    // Paint-order data is a hint, not a full CSS display list. DOM order breaks ties.
    try {
      const session = await context.newCDPSession(page);
      // This protocol method includes generated anonymous text and inline line
      // boxes. captureSnapshot omits pseudo-element text, including counters.
      const snapshot = await session.send('DOMSnapshot.getSnapshot', {
        computedStyleWhitelist: [
          'font-family',
          'font-size',
          'font-weight',
          'font-style',
          'letter-spacing',
          'text-decoration-line',
          'text-shadow',
          'color',
          'background-color',
        ],
        includePaintOrder: true,
        includeUserAgentShadowTree: true,
      });
      const orders = new Map<string, number>();
      const pseudos: PseudoLayout[] = [];
      const layouts = new Map<number, typeof snapshot.layoutTreeNodes>();
      for (const layout of snapshot.layoutTreeNodes) {
        const values = layouts.get(layout.domNodeIndex) || [];
        values.push(layout);
        layouts.set(layout.domNodeIndex, values);
      }
      const controls = new Map(
        collected.nodes.filter((node) => node.control).map((node) => [node.id, node]),
      );
      const parents = new Map<number, number>();
      snapshot.domNodes.forEach((node, index) => {
        for (const child of node.childNodeIndexes || []) parents.set(child, index);
      });
      const text: ControlTextLayout[] = [],
        parts: ControlPartLayout[] = [];
      snapshot.domNodes.forEach((dom, index) => {
        let owner = index,
          field: DesignDocument['nodes'][number] | undefined;
        for (let depth = 0; depth < 90; depth++) {
          const id = snapshot.domNodes[owner]?.attributes?.find(
            (attribute) => attribute.name === 'data-page-to-design-id',
          )?.value;
          field = id ? controls.get(id) : undefined;
          if (field || !parents.has(owner)) break;
          owner = parents.get(owner)!;
        }
        if (!field?.control || owner === index) return;
        for (const layout of layouts.get(index) || []) {
          const style = Object.fromEntries(
            (layout.styleIndex === undefined
              ? []
              : snapshot.computedStyles[layout.styleIndex]?.properties || []
            ).map((property) => [property.name, property.value]),
          );
          for (const line of layout.inlineTextNodes || []) {
            const value = (layout.layoutText || '').slice(
              line.startCharacterIndex,
              line.startCharacterIndex + line.numCharacters,
            );
            text.push({
              nodeId: field.id,
              text:
                field.control.type === 'password' ? '•'.repeat(Array.from(value).length) : value,
              box: line.boundingBox,
              style,
            });
          }
          const role =
            dom.nodeName === 'OPTION'
              ? 'option'
              : dom.attributes?.find((attribute) => attribute.name === 'pseudo')?.value;
          if (role) parts.push({ nodeId: field.id, role, box: layout.boundingBox, style });
        }
      });
      const enriched = await evaluateWithDocument(page, collectDomControls, {
        nodes: [...controls.values()],
        text,
        parts,
      });
      for (const node of enriched) controls.get(node.id)!.control = node.control;
      for (const dom of snapshot.domNodes) {
        const id = dom.attributes?.find(
          (attribute) => attribute.name === 'data-page-to-design-id',
        )?.value;
        if (!id) continue;
        if (dom.layoutNodeIndex !== undefined)
          orders.set(id, snapshot.layoutTreeNodes[dom.layoutNodeIndex].paintOrder || 0);
        for (const index of dom.pseudoElementIndexes || []) {
          const pseudo = snapshot.domNodes[index];
          if (
            !['before', 'after'].includes(pseudo.pseudoType || '') ||
            pseudo.layoutNodeIndex === undefined
          )
            continue;
          const layout = snapshot.layoutTreeNodes[pseudo.layoutNodeIndex];
          pseudos.push({
            parentId: id,
            type: `::${pseudo.pseudoType}` as PseudoLayout['type'],
            box: layout.boundingBox,
            paintOrder: layout.paintOrder || 0,
            text: (layouts.get(index) || []).flatMap((value) =>
              (value.inlineTextNodes || []).map((line) => ({
                text: (value.layoutText || '').slice(
                  line.startCharacterIndex,
                  line.startCharacterIndex + line.numCharacters,
                ),
                box: line.boundingBox,
              })),
            ),
          });
        }
      }
      for (const node of collected.nodes)
        node.paintOrder = orders.get(node.tag === '#text' ? node.parentId! : node.id) || 0;
      const allGenerated = await evaluateWithDocument(page, collectDomPseudos, {
        parents: collected.nodes,
        pseudos,
      });
      const generated = allGenerated.slice(0, Math.max(0, 4500 - collected.nodes.length));
      if (generated.length < allGenerated.length)
        collected.warnings.push({
          code: 'NODE_LIMIT',
          message: '页面超过 4500 个图层，部分伪元素未转换。',
        });
      const generatedIds = new Set(generated.map((node) => node.id));
      for (const node of generated)
        node.children = node.children.filter((id) => generatedIds.has(id));
      const byId = new Map(collected.nodes.map((node) => [node.id, node]));
      for (const node of generated) {
        if (node.pseudoElement && node.tag !== '#text') {
          const parent = node.parentId && byId.get(node.parentId);
          if (parent) {
            if (node.pseudoElement === '::before') parent.children.unshift(node.id);
            else parent.children.push(node.id);
          }
        }
      }
      collected.nodes.push(...generated);
      await session.detach();
    } catch {
      collected.warnings.push({
        code: 'PAINT_ORDER',
        message: '浏览器绘制顺序信息不可用，本次按 DOM 顺序绘制。',
      });
    }
    const backgrounds = await evaluateWithDocument(page, collectDomBackgrounds, {
      nodes: collected.nodes,
    });
    const backgroundNodes = new Map(collected.nodes.map((node) => [node.id, node]));
    for (const info of backgrounds) {
      const node = backgroundNodes.get(info.id)!;
      if (info.layers.length) node.backgroundLayers = info.layers;
      if (info.masks) node.maskLayers = info.masks;
      if (info.clipPath) node.clipPath = info.clipPath;
    }
    await restoreTransformLayout(page);
    const transforms = await resolveNativeTransforms(page, transformState, collected.nodes);
    const plan = prepareConversion({
      ...collected,
      tables,
      viewport: { width: options.width, height: options.height },
    });
    applyNativeTransforms(plan.nodes, transforms);
    collected.nodes = plan.nodes;
    collected.warnings = plan.warnings;

    const screenshot = await page.screenshot({
      fullPage: true,
      type: 'png',
      clip: { x: 0, y: 0, width: collected.width, height: collected.height },
      timeout: 15000,
    });
    await settleResourceBodies(pendingResources);
    const assets: Asset[] = [];
    const assetsById = new Map<string, Asset>();
    const addAsset = async (
      bytes: Buffer,
      mime: string,
      url: string,
      fragment = '',
    ): Promise<string> => {
      const id = assetId(bytes, fragment);
      if (assetsById.has(id)) return id;
      let width: number | undefined;
      let height: number | undefined;
      try {
        const metadata = await sharp(bytes).metadata();
        width = metadata.width;
        height = metadata.height;
        const types: Record<string, string> = {
          jpeg: 'image/jpeg',
          png: 'image/png',
          gif: 'image/gif',
          webp: 'image/webp',
          svg: 'image/svg+xml',
          avif: 'image/avif',
          heif: metadata.compression === 'av1' ? 'image/avif' : 'image/heif',
          tiff: 'image/tiff',
        };
        mime = types[metadata.format || ''] || mime;
      } catch {
        /* SVG or unsupported source dimensions are optional. */
      }
      const asset = { id, url, mime, dataUrl: dataUrl(bytes, mime) + fragment, width, height };
      assets.push(asset);
      assetsById.set(id, asset);
      return id;
    };
    const resourceReads = new Map<string, Promise<{ bytes: Buffer; mime: string } | undefined>>();
    const resolveResource = async (url: string, allowFetch = true) => {
      const canonical = url.split('#')[0];
      const existing = resourceBodies.get(canonical) || inlineResource(canonical);
      if (existing) return existing;
      if (!allowFetch) return undefined;
      let pending = resourceReads.get(canonical);
      if (!pending) {
        pending = (async () => {
          const maximum = Math.min(8 * 1024 * 1024, MAX_ASSET_BYTES - resourceBytes);
          if (maximum <= 0) return undefined;
          const source = await evaluateInPage(page, readSourceResource, {
            url: canonical,
            maximum,
          });
          // A cache read can itself have supplied a network response body.
          const captured = resourceBodies.get(canonical);
          if (captured) return captured;
          if (!source) return undefined;
          const bytes = Buffer.from(source.base64, 'base64');
          if (bytes.length > maximum || resourceBytes + bytes.length > MAX_ASSET_BYTES)
            return undefined;
          resourceBytes += bytes.length;
          const resource = { bytes, mime: source.mime };
          resourceBodies.set(canonical, resource);
          return resource;
        })();
        resourceReads.set(canonical, pending);
      }
      return pending;
    };
    const imageReads = new Map<string, Promise<string | undefined>>();
    const resolveImage = async (url: string, allowFetch = true) => {
      if (failedImageUrls.has(url)) return undefined;
      const cached = imageReads.get(url);
      if (cached) return cached;
      const resource = await resolveResource(url, allowFetch);
      if (!resource) return undefined;
      let pending = imageReads.get(url);
      if (!pending) {
        pending = (async () => {
          // Fetching an empty <img src=""> returns the HTML document, not an
          // image. Validate generic responses before making a canvas asset.
          if (!/^image\//i.test(resource.mime)) {
            const signature = resource.bytes.subarray(0, 4);
            const legacyImage =
              signature.subarray(0, 2).toString() === 'BM' ||
              signature.equals(Buffer.from([0, 0, 1, 0])) ||
              signature.equals(Buffer.from([0, 0, 2, 0]));
            if (!legacyImage) {
              try {
                await sharp(resource.bytes).metadata();
              } catch {
                return undefined;
              }
            }
          }
          const hash = url.indexOf('#'),
            fragment = hash >= 0 ? url.slice(hash) : '';
          return resource
            ? addAsset(
                resource.bytes,
                resource.mime,
                url.startsWith('data:') ? 'embedded' : url,
                fragment,
              )
            : undefined;
        })();
        imageReads.set(url, pending);
      }
      return pending;
    };
    const selectorFor = (node: DesignDocument['nodes'][number]) =>
      node.pseudoElement && node.tag !== '#text'
        ? `[data-page-to-design-id="${node.parentId}"]${node.pseudoElement}`
        : `[data-page-to-design-id="${node.id}"]`;
    const hasCaptureArea = (node: DesignDocument['nodes'][number]) => {
      const bounds = node.visualBox || node.box;
      return (
        bounds.width > 0 &&
        bounds.height > 0 &&
        bounds.x < collected.width &&
        bounds.y < collected.height &&
        bounds.x + bounds.width > 0 &&
        bounds.y + bounds.height > 0
      );
    };
    const invisibleInk = new Set<string>();
    const skipInvisiblePaint = (node: DesignDocument['nodes'][number]) => {
      // Keep geometry and children: an off-artboard wrapper can still contain
      // visible overflowing descendants. There is no bitmap to acquire for
      // the wrapper's own empty paint region.
      invisibleInk.add(node.id);
      node.kind = 'frame';
      node.hasVisual = false;
      node.skipBackground = true;
      node.skipBorders = true;
      node.assetId = undefined;
      node.assetUrl = undefined;
      node.svgSource = undefined;
      node.backgroundAssetId = undefined;
      node.backgroundUrl = undefined;
      node.backgroundLayers = undefined;
      node.fallbackReason = undefined;
      node.rasterBox = undefined;
      node.rasterMode = undefined;
    };
    const rasterize = async (node: DesignDocument['nodes'][number], reason: string) => {
      const bounds = node.visualBox || node.box;
      const left = Math.max(0, Math.floor(bounds.x));
      const top = Math.max(0, Math.floor(bounds.y));
      const width = Math.min(collected.width - left, Math.ceil(bounds.x + bounds.width) - left);
      const height = Math.min(collected.height - top, Math.ceil(bounds.y + bounds.height) - top);
      if (bounds.width <= 0 || bounds.height <= 0 || width <= 0 || height <= 0) {
        skipInvisiblePaint(node);
        return false;
      }
      const nativeComposite = node.compositingGroups?.some(
        (group) => group.id === node.id && (group.backdropFilter || group.blendMode),
      );
      const composited =
        !nativeComposite &&
        ((node.style['backdrop-filter'] && node.style['backdrop-filter'] !== 'none') ||
          (node.style['mix-blend-mode'] && node.style['mix-blend-mode'] !== 'normal'));
      const selector = selectorFor(node);
      // Capture transparent local ink instead of copying the final page crop.
      // Otherwise later translucent siblings are included twice, and expanded
      // filter/shadow bounds overwrite unrelated layers with page backgrounds.
      let rules: string;
      if (composited) {
        const descendants = new Set<string>();
        const visit = (id: string) => {
          descendants.add(id);
          for (const child of collected.nodes.find((value) => value.id === id)?.children || [])
            visit(child);
        };
        visit(node.id);
        const later = collected.nodes.filter(
          (value) =>
            value.tag !== '#text' &&
            !descendants.has(value.id) &&
            (value.paintOrder > node.paintOrder ||
              (value.paintOrder === node.paintOrder && value.order > node.order)),
        );
        rules = later.map((value) => `${selectorFor(value)}{visibility:hidden!important}`).join('');
      } else {
        rules =
          node.tag === 'html' && node.style.visibility === 'hidden'
            ? ''
            : node.canvasBackground
              ? '*,*::before,*::after{visibility:hidden!important}'
              : node.pseudoElement
                ? `*,*::before,*::after{visibility:hidden!important}${selector}{visibility:visible!important}`
                : `*{visibility:hidden!important}${selector},${selector} *,${selector}::before,${selector}::after{visibility:visible!important}`;
        if (
          !node.canvasBackground &&
          (!['html', 'body'].includes(node.tag) || (node.tag === 'body' && node.skipBoxBackground))
        )
          rules += 'html,body{background:transparent!important}';
      }
      // Opacity is applied by the Canvas isolation groups, including effects
      // that still need a bitmap. Do not bake the same group alpha into it.
      for (const group of node.compositingGroups || node.opacityGroups || []) {
        const owner = collected.nodes.find((value) => value.id === group.id);
        if (owner)
          rules += `${selectorFor(owner)}{opacity:1!important${'filter' in group && group.filter ? ';filter:opacity(1)!important' : ''}${'blendMode' in group && group.blendMode ? ';mix-blend-mode:normal!important' : ''}${'backdropFilter' in group && group.backdropFilter ? ';backdrop-filter:opacity(1)!important' : ''}${'clipPath' in group && group.clipPath ? ';clip-path:none!important' : ''}${'mask' in group && group.mask ? ';mask-image:none!important' : ''}}`;
      }
      const isolation = await page.addStyleTag({ content: rules });
      let bytes: Buffer;
      try {
        // Chromium can omit a cross-origin frame's surface when a long-page
        // screenshot is clipped to a small region, even with decoded images.
        // Keep captures inside the viewport on its normal compositor path.
        const inViewport = left + width <= options.width && top + height <= options.height;
        bytes = await page.screenshot({
          type: 'png',
          fullPage: !inViewport,
          omitBackground: !composited,
          clip: { x: left, y: top, width, height },
          timeout: 15000,
        });
      } finally {
        await isolation.evaluate((element) => (element as Element).remove());
      }
      node.kind = 'raster';
      node.fallbackReason = reason;
      node.assetId = await addAsset(bytes, 'image/png', `capture:${node.id}`);
      // Retain the original fractional bounds for selection and measurement.
      node.rasterBox = { x: left, y: top, width, height };
      node.visualBox = { ...node.rasterBox };
      node.rasterMode = composited ? 'composited' : 'isolated';
      node.hasVisual = true;
      return true;
    };
    const nodesById = new Map(collected.nodes.map((node) => [node.id, node]));
    const pruned = new Set<string>();
    const pruneChildren = (node: DesignDocument['nodes'][number]) => {
      for (const id of node.children) {
        pruned.add(id);
        const child = nodesById.get(id);
        if (child) pruneChildren(child);
      }
      node.children = [];
    };
    for (const node of collected.nodes) {
      if (pruned.has(node.id)) continue;
      if (node.kind === 'raster') await rasterize(node, node.fallbackReason!);
      else if (node.kind === 'video') {
        const frame = await evaluateInPage(
          page,
          (id) => {
            const video = document.querySelector<HTMLVideoElement>(
              `[data-page-to-design-id="${id}"]`,
            );
            if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight)
              return { error: '视频尚未解码出可用帧' };
            try {
              const canvas = document.createElement('canvas');
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              canvas.getContext('2d')!.drawImage(video, 0, 0);
              return { dataUrl: canvas.toDataURL('image/png') };
            } catch {
              return { error: '视频帧受跨域或受保护媒体限制，无法读取像素' };
            }
          },
          node.id,
        );
        if (frame.dataUrl) node.assetId = await resolveImage(frame.dataUrl);
        if (!node.assetId && node.video?.poster)
          node.assetId = await resolveImage(node.video.poster);
        if (!node.assetId)
          collected.warnings.push({
            code: 'VIDEO_FRAME_UNAVAILABLE',
            message: frame.error || '视频帧无法打包',
            nodeId: node.id,
          });
      } else if (node.kind === 'canvas') {
        const result = await evaluateInPage(
          page,
          (id) => {
            const canvas = document.querySelector<HTMLCanvasElement>(
              `[data-page-to-design-id="${id}"]`,
            );
            if (!canvas?.width || !canvas.height) return { empty: true };
            try {
              return { dataUrl: canvas.toDataURL('image/png') };
            } catch {
              return { error: '画布受到跨域或受保护内容读回限制' };
            }
          },
          node.id,
        );
        if (result.dataUrl)
          node.assetId = await addAsset(
            Buffer.from(result.dataUrl.split(',')[1], 'base64'),
            'image/png',
            `canvas:${node.id}`,
          );
        else if (result.error) {
          const reason = `${result.error}，保留为局部截图`;
          await rasterize(node, reason);
          collected.warnings.push({
            code: 'CANVAS_READBACK_FALLBACK',
            message: reason,
            nodeId: node.id,
          });
        }
      } else if (node.svgSource) {
        const parsed = await evaluateInPage(
          page,
          (source) => {
            const svg = new DOMParser().parseFromString(source, 'image/svg+xml');
            return {
              valid:
                svg.documentElement.localName === 'svg' &&
                svg.documentElement.namespaceURI === 'http://www.w3.org/2000/svg' &&
                !svg.querySelector('parsererror'),
              references: Array.from(svg.querySelectorAll('image,use')).map((element) => ({
                tag: element.localName,
                href:
                  element.getAttribute('href') ||
                  element.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
                  '',
              })),
            };
          },
          node.svgSource,
        );
        if (!parsed.valid) {
          const reason = 'SVG 标记无法独立解析，已保留为局部截图';
          await rasterize(node, reason);
          collected.warnings.push({ code: 'SVG_FALLBACK', message: reason, nodeId: node.id });
          continue;
        }
        const replacements: Record<string, string> = {};
        let missing = false;
        for (const reference of parsed.references) {
          if (!reference.href || reference.href.startsWith('#')) continue;
          if (failedBlobImages.has(reference.href.split('#')[0])) {
            missing = true;
            break;
          }
          if (reference.tag === 'use') {
            missing = true;
            break;
          }
          const id = await resolveImage(reference.href);
          if (!id) {
            missing = true;
            break;
          }
          replacements[reference.href] = assetsById.get(id)!.dataUrl;
        }
        if (missing) {
          const reason = 'SVG 引用资源无法完整打包，已保留为局部截图';
          await rasterize(node, reason);
          collected.warnings.push({ code: 'SVG_FALLBACK', message: reason, nodeId: node.id });
        } else {
          node.svgSource = await evaluateInPage(
            page,
            ({ source, replacements }) => {
              const svg = new DOMParser().parseFromString(source, 'image/svg+xml');
              for (const element of svg.querySelectorAll('image'))
                for (const attribute of Array.from(element.attributes)) {
                  if (attribute.localName === 'href' && replacements[attribute.value]) {
                    if (attribute.namespaceURI)
                      element.setAttributeNS(
                        attribute.namespaceURI,
                        attribute.name,
                        replacements[attribute.value],
                      );
                    else element.setAttribute(attribute.name, replacements[attribute.value]);
                  }
                }
              return new XMLSerializer().serializeToString(svg.documentElement);
            },
            { source: node.svgSource, replacements },
          );
          node.assetId = await addAsset(
            Buffer.from(node.svgSource),
            'image/svg+xml',
            `svg:${node.id}`,
          );
        }
      } else if (node.kind === 'image' || node.assetUrl) {
        node.assetId = node.assetUrl
          ? await resolveImage(node.assetUrl, hasCaptureArea(node))
          : undefined;
        if (!node.assetId) {
          const reason = '图片资源无法打包，已保留为局部截图';
          await rasterize(node, reason);
          collected.warnings.push({ code: 'ASSET_FALLBACK', message: reason, nodeId: node.id });
        }
      }
      if (node.backgroundLayers?.length || node.maskLayers?.length) {
        const failedMask = (image: CssImage): boolean =>
          !!(
            image.url &&
            (failedImageUrls.has(image.url) || failedBlobImages.has(image.url.split('#')[0]))
          ) || !!image.crossFade?.some((child) => failedMask(child.source));
        const resolveSource = async (image: CssImage): Promise<boolean> => {
          let missing = false;
          if (image.url) {
            image.assetId = await resolveImage(image.url);
            if (!image.assetId) missing = true;
          }
          for (const child of image.crossFade || [])
            missing = (await resolveSource(child.source)) || missing;
          return missing;
        };
        let missing = false,
          missingMask = false;
        for (const layer of node.backgroundLayers || []) {
          if (failedMask(layer)) {
            if (!hasCaptureArea(node)) {
              skipInvisiblePaint(node);
              break;
            }
            layer.image = 'none';
            layer.url = undefined;
            layer.assetId = undefined;
            layer.crossFade = undefined;
            collected.warnings.push({
              code: 'BACKGROUND_IMAGE_FAILED',
              message: '背景图片加载或解码失败，已原生保留背景颜色及独立子图层。',
              nodeId: node.id,
            });
          } else missing = (await resolveSource(layer)) || missing;
        }
        for (const layer of node.maskLayers || []) {
          if (failedMask(layer)) {
            // A failed mask source is transparent in CSS, including a failed
            // cross-fade input. Keep editable descendants and box hit testing.
            layer.image = 'none';
            layer.url = undefined;
            layer.assetId = undefined;
            layer.crossFade = undefined;
            collected.warnings.push({
              code: 'MASK_IMAGE_FAILED',
              message: '遮罩图片加载或解码失败，已原生保留透明遮罩及独立子图层。',
              nodeId: node.id,
            });
          } else missingMask = (await resolveSource(layer)) || missingMask;
        }
        if (missingMask) {
          // Source bytes may be inaccessible even though the browser can paint
          // them. Capture the full effect subtree using the established raster
          // path, rather than dropping its mask or requiring an absent asset.
          const visit = (owner: typeof node) => {
            for (const id of owner.children) {
              const child = nodesById.get(id);
              if (!child) continue;
              const a = node.visualBox || node.box,
                b = child.visualBox || child.box;
              const x = Math.min(a.x, b.x),
                y = Math.min(a.y, b.y);
              node.visualBox = {
                x,
                y,
                width: Math.max(a.x + a.width, b.x + b.width) - x,
                height: Math.max(a.y + a.height, b.y + b.height) - y,
              };
              visit(child);
            }
          };
          visit(node);
          const own = node.compositingGroups?.find((group) => group.id === node.id);
          if (own) {
            delete own.filter;
            delete own.backdropFilter;
            delete own.blendMode;
            delete own.isolate;
            delete own.clipPath;
            delete own.mask;
          }
          node.maskLayers = undefined;
          node.clipPath = undefined;
          const reason = '遮罩素材无法直接取得，已保留为局部截图';
          if (await rasterize(node, reason)) pruneChildren(node);
          collected.warnings.push({ code: 'MASK_FALLBACK', message: reason, nodeId: node.id });
          continue;
        }
        if (node.backgroundLayers?.length === 1)
          node.backgroundAssetId = node.backgroundLayers[0].assetId;
        if (missing) {
          const reason = '背景图片无法打包，已保留为局部截图';
          if (await rasterize(node, reason)) pruneChildren(node);
          collected.warnings.push({
            code: 'BACKGROUND_FALLBACK',
            message: reason,
            nodeId: node.id,
          });
        }
      } else if (node.backgroundUrl) {
        node.backgroundAssetId = await resolveImage(node.backgroundUrl);
        if (!node.backgroundAssetId) {
          const reason = '背景图片无法打包，已保留为局部截图';
          if (await rasterize(node, reason)) pruneChildren(node);
          collected.warnings.push({
            code: 'BACKGROUND_FALLBACK',
            message: reason,
            nodeId: node.id,
          });
        }
      }
    }
    collected.nodes = collected.nodes.filter((node) => !pruned.has(node.id));
    collected.warnings = collected.warnings.filter(
      (warning) => !warning.nodeId || !invisibleInk.has(warning.nodeId),
    );
    plan.warnings = collected.warnings;

    for (const [sheetUrl, css] of cssBodies) {
      for (const match of css.matchAll(/@font-face\s*\{([^}]+)\}/g)) {
        // A data URL contains semicolons. Split declarations only outside CSS
        // strings and functions, including cross-origin stylesheets whose CSSOM
        // cannot be inspected from the source document.
        const declarations = new Map<string, string>();
        let start = 0,
          depth = 0,
          quote = '';
        const block = match[1] + ';';
        for (let index = 0; index < block.length; index++) {
          const char = block[index];
          if (char === '\\') {
            index++;
            continue;
          }
          if (quote) {
            if (char === quote) quote = '';
            continue;
          }
          if (char === '"' || char === "'") {
            quote = char;
            continue;
          }
          if (char === '(') depth++;
          else if (char === ')') depth--;
          else if (char === ';' && !depth) {
            const declaration = block.slice(start, index),
              colon = declaration.indexOf(':');
            if (colon >= 0)
              declarations.set(
                declaration.slice(0, colon).trim().toLowerCase(),
                declaration.slice(colon + 1).trim(),
              );
            start = index + 1;
          }
        }
        const read = (name: string) => declarations.get(name) || '';
        const urls = Array.from(read('src').matchAll(/url\(["']?([^"')]+)["']?\)/g)).flatMap(
          (source) => {
            try {
              return [new URL(source[1], sheetUrl).href];
            } catch {
              return [];
            }
          },
        );
        const family = read('font-family').replace(/^["']|["']$/g, '');
        if (family && urls.length)
          collected.fontFaces.push({
            family,
            style: read('font-style') || 'normal',
            weight: read('font-weight') || '400',
            unicodeRange: read('unicode-range'),
            urls,
          });
      }
    }
    const fonts: FontAsset[] = [];
    const fontKeys = new Set<string>();
    const usedFontFamilies = collected.nodes.flatMap((node) =>
      [...(node.runs || []), ...(node.control?.textRuns || [])].map((run) =>
        run.fontFamily.toLowerCase(),
      ),
    );
    for (const font of collected.fontFaces) {
      if (!usedFontFamilies.some((value) => value.includes(font.family.toLowerCase()))) continue;
      const key = `${font.family}:${font.weight}:${font.style}:${font.unicodeRange}`;
      if (fontKeys.has(key)) continue;
      let resource: { bytes: Buffer; mime: string } | undefined;
      for (const url of font.urls) {
        // Stylesheets also declare unused Unicode subsets and fallback faces.
        // Do not download those merely because the family appears on the page.
        if (!/^(data:|blob:)/i.test(url) && !resourceBodies.has(url.split('#')[0])) continue;
        const value = await resolveResource(url);
        if (!value) continue;
        const signature = value.bytes.toString('latin1', 0, 4);
        // Choose a source the browser FontFace API can decode. In particular,
        // older icon-font CSS lists an unsupported inline EOT before its TTF.
        if (['wOFF', 'wOF2', 'OTTO', 'true', 'ttcf', '\x00\x01\x00\x00'].includes(signature)) {
          resource = value;
          break;
        }
      }
      if (!resource) continue;
      fontKeys.add(key);
      fonts.push({
        family: font.family,
        style: font.style,
        weight: font.weight,
        unicodeRange: font.unicodeRange || undefined,
        dataUrl: dataUrl(resource.bytes, resource.mime),
      });
    }
    for (const family of new Set(collected.fontFaces.map((font) => font.family))) {
      if (
        usedFontFamilies.some((value) => value.includes(family.toLowerCase())) &&
        !fonts.some((font) => font.family === family)
      ) {
        collected.warnings.push({
          code: 'FONT_MISSING',
          message: `网页字体 ${family} 无法打包，画布将尝试使用本机匹配字体。`,
        });
      }
    }
    if (
      options.fullPage &&
      collected.nodes.some((node) => ['fixed', 'sticky'].includes(node.style.position))
    ) {
      collected.warnings.push({
        code: 'POSITION_SNAPSHOT',
        message: '固定与吸顶元素记录的是页面顶部时的状态。',
      });
    }
    plan.nodes = collected.nodes;
    const convertedDocument = completeConversion(plan, {
      id: randomUUID(),
      capturedAt: new Date().toISOString(),
      assets,
      fonts,
      referenceImage: dataUrl(screenshot, 'image/png'),
      durationMs: Math.round(performance.now() - startedAt),
    });
    return { ...convertedDocument, url: page.url() };
  } finally {
    signal?.removeEventListener('abort', closeOnAbort);
    await context.close();
  }
}
