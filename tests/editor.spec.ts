import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { Camera, DesignDocument } from '@page-to-design/core';

let fixtureServer: Server;
let fixtureUrl: string;
test.beforeAll(async () => {
  const html = await readFile(new URL('./fixtures/layout.html', import.meta.url));
  fixtureServer = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(html);
  });
  await new Promise<void>((resolve) => fixtureServer.listen(0, '127.0.0.1', resolve));
  const address = fixtureServer.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server failed');
  fixtureUrl = `http://127.0.0.1:${address.port}/`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    fixtureServer.close((error) => (error ? reject(error) : resolve())),
  );
});

test('rejects unsupported URLs and invalid viewports', async ({ request }) => {
  const invalid = await request.post('/api/convert', { data: { url: 'file:///etc/passwd' } });
  expect(invalid.status()).toBe(400);
  const invalidWidth = await request.post('/api/convert', { data: { url: fixtureUrl, width: 40 } });
  expect(invalidWidth.status()).toBe(400);
  const crossOrigin = await request.post('/api/convert', {
    headers: { Origin: 'https://unrelated.example' },
    data: { url: fixtureUrl },
  });
  expect(crossOrigin.status()).toBe(403);
});

test('captures real nodes, exact box-model geometry, text runs and embedded resources', async ({
  request,
}) => {
  const response = await request.post('/api/convert', {
    data: { url: fixtureUrl, width: 390, height: 844, fullPage: false },
    timeout: 60000,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const doc = (await response.json()) as DesignDocument;
  expect(doc.width).toBe(390);
  expect(doc.height).toBe(844);
  const card = doc.nodes.find((node) => node.name === 'card-a')!;
  expect(card.kind).toBe('frame');
  expect(card.box).toEqual({ x: 24, y: 72, width: 280, height: 100 });
  expect(card.padding.left).toBe(16);
  expect(card.border.top).toBe(2);
  expect(card.contentBox.width).toBe(244);
  expect(
    doc.nodes.some((node) => node.kind === 'text' && node.text?.includes('原生文本')),
  ).toBeTruthy();
  expect(
    doc.nodes
      .filter((node) => node.kind === 'text')
      .every((node) => node.runs?.every((run) => run.baseline > run.y)),
  ).toBeTruthy();
  const image = doc.nodes.find((node) => node.kind === 'image')!;
  expect(
    doc.assets.some(
      (asset) =>
        asset.id === image.assetId && asset.dataUrl.startsWith('data:image/svg+xml;base64,'),
    ),
  ).toBeTruthy();
  const input = doc.nodes.find((node) => node.tag === 'input')!;
  expect(input.kind).toBe('control');
  expect(input.assetId).toBeUndefined();
  expect(input.control?.type).toBe('text');
  expect(input.box.x).toBe(24.5);
  expect(input.rasterBox).toBeUndefined();
  expect(input.children).toEqual([]);
  expect(doc.nodes.find((node) => node.name === 'overflow-child')?.clips.length).toBeGreaterThan(0);
  expect(doc.stats.nativeNodes).toBeGreaterThan(15);
  expect(doc.stats.rasterNodes).toBe(0);
  expect(doc.nodes.some((node) => node.text === 'Async content ready')).toBeTruthy();
});

test('URL to native canvas: select, zoom, pan, measure and export', async ({ page }) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '每一个网页，都值得拆开看看。' })).toBeVisible();
  await page.getByRole('textbox', { name: 'H5 页面 URL' }).fill(fixtureUrl);
  await page.getByRole('checkbox', { name: '整页' }).uncheck();
  const captureResponse = page.waitForResponse(
    (response) => response.url().includes('/api/convert') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '转换为设计图' }).click();
  const doc = (await (await captureResponse).json()) as DesignDocument;
  expect(doc.nodes, JSON.stringify(doc)).toBeTruthy();
  await expect(page.getByText('原生 Canvas 图层', { exact: true })).toBeVisible();
  const canvas = page.getByTestId('design-canvas');
  await canvas.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const box = (await canvas.boundingBox())!;
  const original = JSON.parse((await canvas.getAttribute('data-camera'))!) as Camera;
  const card = doc.nodes.find((node) => node.name === 'card-a')!;
  const second = doc.nodes.find((node) => node.name === 'card-b')!;
  await page.mouse.click(
    box.x + original.x + (card.box.x + 10) * original.scale,
    box.y + original.y + (card.box.y + 65) * original.scale,
  );
  await expect(page.getByTestId(`layer-${card.id}`)).toHaveAttribute('aria-selected', 'true');
  await expect(
    page.getByRole('complementary', { name: '属性面板' }).getByText('280', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: '放大', exact: true }).click();
  const zoomed = JSON.parse((await canvas.getAttribute('data-camera'))!) as Camera;
  expect(zoomed.scale).toBeCloseTo(original.scale * 1.2);
  await expect(
    page.getByRole('complementary', { name: '属性面板' }).getByText('280', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: '拖动工具', exact: true }).click();
  await page.mouse.move(box.x + 45, box.y + box.height - 85);
  await page.mouse.down();
  await page.mouse.move(box.x + 105, box.y + box.height - 45, { steps: 8 });
  await page.mouse.up();
  const panned = JSON.parse((await canvas.getAttribute('data-camera'))!) as Camera;
  expect(panned.x - zoomed.x).toBeCloseTo(60, 0);
  expect(panned.y - zoomed.y).toBeCloseTo(40, 0);

  await page.getByRole('button', { name: '测距工具', exact: true }).click();
  await page.getByTestId(`layer-${second.id}`).click();
  await expect(page.getByTestId('measurement-panel')).toContainText('24 px');
  await expect(page.getByTestId(`layer-${card.id}`)).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: 'artifacts/editor-measurement.png' });

  await page.getByRole('button', { name: '切换原图对照' }).click();
  await expect(page.getByText('浏览器原图', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '切换原图对照' }).click();

  await page.getByRole('button', { name: '导出', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Canvas 图片' }).click();
  const download = await downloading;
  await download.saveAs('artifacts/canvas-fixture.png');
  const output = (await download.path())!;
  const metadata = await sharp(output).metadata();
  expect(metadata.width).toBe(390);
  expect(metadata.height).toBe(844);
  const samplePixel = async (x: number, y: number) => [
    ...(await sharp(output)
      .extract({ left: x, top: y, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer()),
  ];
  expect(await samplePixel(40, 150)).toEqual([115, 96, 232]);
  expect(await samplePixel(225, 135)).toEqual([243, 107, 127]);
  expect(await samplePixel(170, 445)).toEqual([244, 245, 249]); // clipped overflow is not painted outside its parent
  expect(browserErrors).toEqual([]);
});

test('teaching sample converts without external assets', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '体验教学示例' }).click();
  await expect(page.getByText('原生 Canvas 图层', { exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole('textbox', { name: 'H5 页面 URL' })).toHaveValue(/\/api\/demo$/);
  await expect(page.getByRole('treeitem', { name: '把周末，', exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/editor-demo.png' });
});

test('flat layers preserve selection, measurement and rendered pixels across structure changes', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'H5 页面 URL' }).fill(fixtureUrl);
  await page.getByRole('checkbox', { name: '整页' }).uncheck();
  const captureResponse = page.waitForResponse(
    (response) => response.url().includes('/api/convert') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '转换为设计图' }).click();
  const source = (await (await captureResponse).json()) as DesignDocument;
  await expect(page.getByText('原生 Canvas 图层', { exact: true })).toBeVisible();
  const first = source.nodes.find((node) => node.name === 'card-a')!;
  const second = source.nodes.find((node) => node.name === 'card-b')!;
  const text = source.nodes.find(
    (node) => node.kind === 'text' && node.text?.includes('原生文本'),
  )!;
  const textItem = page.getByTestId(`layer-${text.id}`);
  await expect(page.getByRole('button', { name: '平铺结构', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('treeitem')).toHaveCount(source.nodes.length);
  await expect(textItem).toHaveAttribute('aria-level', '1');
  await expect(page.getByRole('button', { name: `折叠 ${first.name}`, exact: true })).toHaveCount(
    0,
  );

  await page.getByTestId(`layer-${first.id}`).click();
  await expect(page.getByTestId('absolute-layout-info')).toContainText('absolute');
  await expect(page.locator('.css-code')).toContainText('position: absolute;');
  await expect(page.locator('.css-code')).toContainText('left: 24px;');
  await expect(page.locator('.css-code')).toContainText('top: 72px;');
  await expect(page.getByRole('button', { name: '切换盒模型显示', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '测距工具', exact: true }).click();
  await page.getByTestId(`layer-${second.id}`).click();
  await expect(page.getByTestId('measurement-panel')).toContainText('24 px');

  const downloadExport = async (name: string) => {
    await page.getByRole('button', { name: '导出', exact: true }).click();
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name }).click();
    const download = await downloading;
    return readFile((await download.path())!);
  };
  const flat = JSON.parse((await downloadExport('设计文档')).toString()) as DesignDocument;
  expect(flat.structure).toBe('flat');
  expect(flat.layout).toBe('absolute');
  expect(flat.nodes).toHaveLength(source.nodes.length);
  expect(
    flat.nodes.every((node) => node.parentId === null && node.children.length === 0),
  ).toBeTruthy();
  expect(
    flat.nodes.every(
      (node) => node.positioning === 'absolute' && node.style.position === 'absolute',
    ),
  ).toBeTruthy();
  expect(
    flat.nodes.every(
      (node) =>
        !node.style.gap && !node.style['flex-direction'] && !node.style['grid-template-columns'],
    ),
  ).toBeTruthy();
  expect(flat.nodes.find((node) => node.id === first.id)?.box).toEqual(first.box);
  expect(flat.nodes.find((node) => node.id === second.id)?.style.display).toBe('block');
  expect(source.nodes.find((node) => node.id === second.id)?.style.display).toBe('flex');
  const sourceImage = source.nodes.find((node) => node.kind === 'image')!;
  expect(flat.nodes.find((node) => node.id === sourceImage.id)?.imageBox).toEqual(
    sourceImage.contentBox,
  );
  const flatPng = await downloadExport('Canvas 图片');
  await page.setViewportSize({ width: 1280, height: 900 });
  expect((await downloadExport('Canvas 图片')).equals(flatPng)).toBeTruthy();
  await page.screenshot({ path: 'artifacts/editor-flat.png' });

  await page.getByRole('button', { name: '原始层级', exact: true }).click();
  await expect(page.getByRole('tree')).toHaveAttribute('data-structure', 'hierarchical');
  expect(Number(await textItem.getAttribute('aria-level'))).toBeGreaterThan(1);
  await expect(page.getByTestId(`layer-${first.id}`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('measurement-panel')).toContainText('24 px');
  await expect(page.getByRole('button', { name: '切换盒模型显示', exact: true })).toBeVisible();
  await expect(page.locator('.css-code')).toContainText('padding: 16px 16px 16px 16px;');
  const hierarchicalPng = await downloadExport('Canvas 图片');
  expect(hierarchicalPng.equals(flatPng)).toBeTruthy();
  const hierarchical = JSON.parse((await downloadExport('设计文档')).toString()) as DesignDocument;
  expect(hierarchical.structure).toBe('hierarchical');
  expect(hierarchical.nodes.find((node) => node.id === text.id)?.parentId).toBe(text.parentId);

  await page.getByRole('button', { name: `折叠 ${first.name}`, exact: true }).click();
  await expect(textItem).toHaveCount(0);
  await page.getByRole('button', { name: '平铺结构', exact: true }).click();
  await expect(textItem).toHaveAttribute('aria-level', '1');
  await expect(page.getByTestId('measurement-panel')).toContainText('24 px');
});

test('invalid input shows a recoverable error', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'H5 页面 URL' }).fill('javascript:alert(1)');
  await page.getByRole('button', { name: '转换为设计图' }).click();
  await expect(page.getByRole('alert')).toContainText('HTTP 或 HTTPS');
  await page.getByRole('button', { name: '关闭错误提示' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('outdated capture results are rejected instead of rendering a stale document', async ({
  page,
}) => {
  await page.route('**/api/convert', (route) =>
    route.fulfill({ json: { version: 1, id: 'old-engine', nodes: [] } }),
  );
  await page.goto('/');
  await page.getByRole('textbox', { name: 'H5 页面 URL' }).fill(fixtureUrl);
  await page.getByRole('button', { name: '转换为设计图' }).click();
  await expect(page.getByRole('alert')).toContainText('采集服务尚未更新');
  await expect(page.getByText('原生 Canvas 图层', { exact: true })).toHaveCount(0);
});
