import { test, expect } from '@playwright/test';
import type { Camera, DesignDocument, DesignNode } from '@quantacenter/page2design';
import { CAPTURE_REVISION } from '@quantacenter/page2design';
import sharp from 'sharp';

function largeDocument(): DesignDocument {
  const nodes: DesignNode[] = Array.from({ length: 1600 }, (_, index) => {
    const box = {
      x: 16 + (index % 20) * 70,
      y: 16 + Math.floor(index / 20) * 32,
      width: 56,
      height: 24,
    };
    return {
      id: `preview-${index}`,
      parentId: null,
      children: [],
      kind: 'frame',
      name: `Preview item ${index}`,
      tag: 'div',
      box,
      contentBox: box,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      border: { top: 0, right: 0, bottom: 0, left: 0 },
      radius: [0, 0, 0, 0],
      opacity: 1,
      clips: [],
      style: { 'background-color': index % 2 ? '#7360e8' : '#f36b7f' },
      order: index,
      paintOrder: index,
      hasVisual: true,
    };
  });
  return {
    version: 1,
    captureRevision: CAPTURE_REVISION,
    id: 'preview-performance',
    title: 'Large preview',
    url: 'https://preview.test',
    capturedAt: new Date().toISOString(),
    viewport: { width: 1440, height: 900 },
    width: 1440,
    height: 2600,
    background: '#fff',
    nodes,
    assets: [],
    fonts: [],
    referenceImage:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6iT8AAAAASUVORK5CYII=',
    warnings: [],
    stats: { durationMs: 0, nativeNodes: nodes.length, rasterNodes: 0, textRuns: 0 },
  };
}

test('large preview reuses its scene on hover and virtual layers follow canvas selection', async ({
  page,
}) => {
  const source = largeDocument();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/convert', (route) => route.fulfill({ json: source }));
  await page.goto('/');
  await page
    .getByRole('textbox', { name: 'H5 页面 URL' })
    .fill(source.url || 'https://preview.test');
  await page.getByRole('button', { name: '转换为设计图' }).click();
  await expect(page.getByText('原生 Canvas 图层', { exact: true })).toBeVisible();
  const canvas = page.getByTestId('design-canvas');
  await canvas.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(await page.getByRole('treeitem').count()).toBeLessThan(100);
  await expect(page.getByRole('treeitem').first()).toHaveAttribute('aria-setsize', '1600');
  await page.evaluate(() => {
    const state = window as any;
    const layer = state.Konva.stages[0].getLayers()[0];
    const draw = layer.drawScene;
    state.previewDraws = 0;
    layer.drawScene = function (...args: unknown[]) {
      state.previewDraws++;
      return draw.apply(this, args);
    };
  });
  const camera = JSON.parse((await canvas.getAttribute('data-camera'))!) as Camera;
  const bounds = (await canvas.boundingBox())!;
  const moveTo = async (node: DesignNode, click = false) => {
    const x = bounds.x + camera.x + (node.box.x + node.box.width / 2) * camera.scale;
    const y = bounds.y + camera.y + (node.box.y + node.box.height / 2) * camera.scale;
    if (click) await page.mouse.click(x, y);
    else await page.mouse.move(x, y);
    await expect(canvas).toHaveAttribute('data-hovered-id', node.id);
  };
  for (const node of source.nodes.slice(0, 8)) await moveTo(node);
  expect(await page.evaluate(() => (window as any).previewDraws)).toBe(0);
  const last = source.nodes.at(-1)!;
  await moveTo(last, true);
  await expect(page.getByTestId(`layer-${last.id}`)).toHaveAttribute('aria-selected', 'true');
  expect(await page.getByRole('treeitem').count()).toBeLessThan(100);
  await page.getByRole('textbox', { name: '搜索图层' }).fill('Preview item 1599');
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  await expect(page.getByRole('treeitem')).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('textbox', { name: '搜索图层' }).fill('');
  await expect(page.getByTestId(`layer-${last.id}`)).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
});

test('tile boundaries preserve translucent pixels at fractional offsets and bitmap memory stays bounded', async ({
  page,
}) => {
  await page.goto('/');
  const source = largeDocument();
  source.width = 1800;
  source.height = 1300;
  source.background = 'rgba(36,60,90,0.3)';
  source.nodes = [
    { ...source.nodes[0], box: { x: 0, y: 0, width: 1800, height: 1300 }, opacity: 0.5 },
    {
      ...source.nodes[1],
      box: { x: 40, y: 60, width: 1500, height: 1000 },
      opacity: 0.4,
      compositingGroups: [{ id: source.nodes[1].id, opacity: 1, blendMode: 'multiply' }],
    },
  ];
  const result = await page.evaluate(async (document) => {
    const previewModule = '/tests/fixtures/core-api.ts';
    const paintModule = '/tests/fixtures/core-api.ts';
    const { PreviewCache } = await import(previewModule);
    const { paintNode } = await import(paintModule);
    const actual = window.document.createElement('canvas');
    const expected = window.document.createElement('canvas');
    actual.width = expected.width = 1400;
    actual.height = expected.height = 900;
    const a = actual.getContext('2d', { willReadFrequently: true })!;
    const b = expected.getContext('2d', { willReadFrequently: true })!;
    const images = new Map();
    const cache = new PreviewCache(document, document.nodes, images);
    const canvases: HTMLCanvasElement[] = [];
    const bitmaps: ImageBitmap[] = [];
    const transferProperty = Object.getOwnPropertyDescriptor(
      OffscreenCanvas.prototype,
      'transferToImageBitmap',
    )!;
    const transfer = transferProperty.value as (this: OffscreenCanvas) => ImageBitmap;
    OffscreenCanvas.prototype.transferToImageBitmap = function () {
      const bitmap = transfer.call(this);
      bitmaps.push(bitmap);
      return bitmap;
    };
    const createElement = window.document.createElement.bind(window.document);
    window.document.createElement = ((...args: Parameters<typeof createElement>) => {
      const element = createElement(...args);
      if (element instanceof HTMLCanvasElement) canvases.push(element);
      return element;
    }) as typeof window.document.createElement;
    let maxDifference = 0;
    let peakBytes = 0;
    try {
      for (const density of [0.125, 0.25, 0.5, 1, 2, 4, 8])
        for (let shift = 0; shift < 4; shift++) {
          const x = 31.25 - shift * 200 * density;
          const y = 20.375 - shift * 140 * density;
          for (const context of [a, b]) {
            context.reset();
            context.setTransform(density, 0, 0, density, x, y);
            context.beginPath();
            context.rect(0, 0, document.width, document.height);
            context.clip();
            context.fillStyle = document.background;
            context.fillRect(0, 0, document.width, document.height);
          }
          cache.paint(a, {
            x: -x / density,
            y: -y / density,
            width: actual.width / density,
            height: actual.height / density,
          });
          peakBytes = Math.max(
            peakBytes,
            [...canvases, ...bitmaps].reduce(
              (sum, canvas) => sum + canvas.width * canvas.height * 4,
              0,
            ),
          );
          if (shift) continue;
          for (const node of document.nodes) {
            b.save();
            if (node.compositingGroups?.[0].blendMode) b.globalCompositeOperation = 'multiply';
            b.translate(node.box.x, node.box.y);
            paintNode(b, node, images);
            b.restore();
          }
          const actualPixels = a.getImageData(0, 0, actual.width, actual.height).data;
          const expectedPixels = b.getImageData(0, 0, expected.width, expected.height).data;
          // Each zoom level has a boundary at device pixel 768. Probe both sides
          // away from primitive edges, including overlapping translucent fills.
          for (const position of [120, 240, 480, 720, 880])
            for (let delta = -3; delta <= 3; delta++) {
              const reduction = Math.min(1, density);
              for (const [px, py] of [
                [Math.round(768 * reduction + x) + delta, Math.round(position * reduction)],
                [Math.round(position * reduction), Math.round(768 * reduction + y) + delta],
              ]) {
                const offset = (py * actual.width + px) * 4;
                for (let channel = 0; channel < 4; channel++)
                  maxDifference = Math.max(
                    maxDifference,
                    Math.abs(actualPixels[offset + channel] - expectedPixels[offset + channel]),
                  );
              }
            }
        }
      return { maxDifference, peakBytes, tilesCreated: canvases.length };
    } finally {
      window.document.createElement = createElement;
      Object.defineProperty(OffscreenCanvas.prototype, 'transferToImageBitmap', transferProperty);
      cache.dispose();
    }
  }, source);
  expect(result.maxDifference).toBeLessThanOrEqual(2);
  expect(result.tilesCreated).toBeGreaterThan(30);
  expect(result.peakBytes).toBeLessThanOrEqual(64 * 1024 * 1024);
});

test('reference view preserves source pixels and releases inactive view tiles within one bitmap budget', async ({
  page,
}) => {
  await page.goto('/');
  const source = largeDocument();
  source.width = 1800;
  source.height = 1300;
  source.nodes = source.nodes.slice(0, 2);
  const result = await page.evaluate(async (source) => {
    const module = '/tests/fixtures/core-api.ts';
    const { CanvasRenderer } = await import(module);
    const original = document.createElement('canvas');
    original.width = source.width;
    original.height = source.height;
    const paint = original.getContext('2d')!;
    paint.fillStyle = '#e36a70';
    paint.fillRect(0, 0, original.width, original.height);
    paint.fillStyle = '#386fa6';
    for (let y = 0; y < original.height; y += 64)
      for (let x = 0; x < original.width; x += 64) paint.fillRect(x, y, 32, 32);
    const reference = new Image();
    reference.src = original.toDataURL();
    await reference.decode();
    const renderer = new CanvasRenderer(source, { images: new Map(), reference }),
      canvas = document.createElement('canvas');
    const create = document.createElement.bind(document),
      allocated: (HTMLCanvasElement | ImageBitmap)[] = [];
    const transferProperty = Object.getOwnPropertyDescriptor(
      OffscreenCanvas.prototype,
      'transferToImageBitmap',
    )!;
    const transfer = transferProperty.value as (this: OffscreenCanvas) => ImageBitmap;
    OffscreenCanvas.prototype.transferToImageBitmap = function () {
      const bitmap = transfer.call(this);
      allocated.push(bitmap);
      return bitmap;
    };
    document.createElement = ((...args: Parameters<typeof create>) => {
      const element = create(...args);
      if (element instanceof HTMLCanvasElement) allocated.push(element);
      return element;
    }) as typeof document.createElement;
    let released = true,
      peak = 0,
      exact = true;
    let previous: (HTMLCanvasElement | ImageBitmap)[] = [];
    try {
      for (const scale of [0.125, 0.5, 1, 2, 4, 8])
        for (const referenceView of [false, true, false, true]) {
          renderer.render(canvas, {
            width: 1400,
            height: 900,
            camera: { x: 0, y: 0, scale },
            referenceView,
          });
          released &&= previous.every((c) => !c.width && !c.height);
          previous = allocated.filter((c) => c.width && c.height);
          peak = Math.max(
            peak,
            previous.reduce((sum, c) => sum + c.width * c.height * 4, 0),
          );
          if (referenceView && scale === 1) {
            const a = canvas.getContext('2d')!.getImageData(0, 0, 1400, 900).data,
              b = paint.getImageData(0, 0, 1400, 900).data;
            exact &&= a.every((value, index) => value === b[index]);
          }
        }
    } finally {
      document.createElement = create;
      Object.defineProperty(OffscreenCanvas.prototype, 'transferToImageBitmap', transferProperty);
      renderer.dispose();
    }
    return { released, peak, exact, disposed: allocated.every((c) => !c.width && !c.height) };
  }, source);
  expect(result.exact).toBe(true);
  expect(result.released).toBe(true);
  expect(result.disposed).toBe(true);
  expect(result.peak).toBeLessThanOrEqual(64 * 1024 * 1024);
});

test('the editor switches between native pixels and the reference at every preview scale', async ({
  page,
}) => {
  const source = largeDocument();
  source.width = 900;
  source.height = 600;
  source.nodes = [
    {
      ...source.nodes[0],
      box: { x: 0, y: 0, width: 900, height: 600 },
      contentBox: { x: 0, y: 0, width: 900, height: 600 },
      style: { 'background-color': 'rgb(200,70,85)' },
    },
  ];
  source.stats.nativeNodes = 1;
  source.referenceImage =
    'data:image/png;base64,' +
    (
      await sharp({
        create: { width: 900, height: 600, channels: 3, background: { r: 48, g: 112, b: 176 } },
      })
        .png()
        .toBuffer()
    ).toString('base64');
  await page.route('**/api/convert', (route) => route.fulfill({ json: source }));
  await page.goto('/');
  await page.getByRole('textbox', { name: 'H5 页面 URL' }).fill('https://preview.test/reference');
  await page.getByRole('button', { name: '转换为设计图' }).click();
  await expect(page.getByText('原生 Canvas 图层', { exact: true })).toBeVisible();
  const canvas = page.getByTestId('design-canvas');
  await page.getByTestId('layer-' + source.nodes[0].id).dblclick();
  const pixel = async () => {
    const bounds = (await canvas.boundingBox())!,
      camera = JSON.parse((await canvas.getAttribute('data-camera'))!) as Camera;
    const png = await page.screenshot({
      clip: {
        x: Math.floor(bounds.x + camera.x + 450 * camera.scale),
        y: Math.floor(bounds.y + camera.y + 300 * camera.scale),
        width: 1,
        height: 1,
      },
    });
    return [...(await sharp(png).removeAlpha().raw().toBuffer())];
  };
  for (const scale of [50, 100, 200]) {
    await page.getByRole('combobox', { name: '缩放比例' }).selectOption(String(scale));
    await expect.poll(pixel).toEqual([200, 70, 85]);
    await page.getByRole('button', { name: '切换原图对照', exact: true }).click();
    await expect.poll(pixel).toEqual([48, 112, 176]);
    await page.getByRole('button', { name: '切换原图对照', exact: true }).click();
    await expect.poll(pixel).toEqual([200, 70, 85]);
  }
});
