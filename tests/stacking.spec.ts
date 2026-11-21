import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { Camera, DesignDocument } from '@page-to-design/core';

test('negative card layers stay behind content inside their stacking contexts', async ({
  page,
  baseURL,
}) => {
  const folder = 'artifacts/stacking';
  await mkdir(folder, { recursive: true });
  const sourcePage = await page.context().newPage();
  await sourcePage.setViewportSize({ width: 1440, height: 844 });
  const url = `${baseURL}/tests/fixtures/stacking.html`;
  await sourcePage.goto(url);
  const areas = await sourcePage.locator('.case').evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { id: element.id, x: box.x, y: box.y, width: box.width, height: box.height };
    }),
  );
  await sourcePage.close();
  await page.goto('/');
  await page.getByRole('textbox', { name: 'H5 页面 URL' }).fill(url);
  await page.getByRole('combobox', { name: '画板宽度' }).selectOption('1440');
  const converting = page.waitForResponse(
    (response) => response.url().includes('/api/convert') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '转换为设计图' }).click();
  const response = await converting;
  expect(response.ok(), await response.text()).toBeTruthy();
  const document = (await response.json()) as DesignDocument;
  await expect(page.getByText('原生 Canvas 图层', { exact: true })).toBeVisible();
  const download = async (name: string) => {
    await page.getByRole('button', { name: '导出', exact: true }).click();
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name }).click();
    return readFile((await (await downloading).path())!);
  };
  const png = await download('Canvas 图片');
  const flat = JSON.parse((await download('设计文档')).toString()) as DesignDocument;
  expect(
    flat.nodes.every((node) => node.parentId === null && node.children.length === 0),
  ).toBeTruthy();
  await page.getByRole('button', { name: '原始层级', exact: true }).click();
  expect(await download('Canvas 图片')).toEqual(png);
  await page.getByRole('button', { name: '平铺结构', exact: true }).click();
  for (const id of [
    'card-last',
    'front-last',
    'card-first',
    'card-auto',
    'card-atomic',
    'high-child',
    'card-isolated',
    'card-flex',
  ])
    expect(document.nodes.find((node) => node.name === id)?.kind, id).toBe('frame');
  const reference = Buffer.from(document.referenceImage.split(',')[1], 'base64');
  await writeFile(`${folder}/reference.png`, reference);
  await writeFile(`${folder}/canvas.png`, png);
  await writeFile(`${folder}/design.json`, JSON.stringify(flat));
  const raw = async (input: Buffer) =>
    sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const expected = await raw(reference);
  const actual = await raw(png);
  expect(actual.info).toEqual(expected.info);
  const results = areas.map((area) => {
    let pixels = 0;
    let different = 0;
    let sum = 0;
    for (let y = Math.ceil(area.y); y < Math.floor(area.y + area.height); y++)
      for (let x = Math.ceil(area.x); x < Math.floor(area.x + area.width); x++) {
        const offset = (y * document.width + x) * 4;
        const delta = Math.max(
          ...[0, 1, 2].map((channel) =>
            Math.abs(expected.data[offset + channel] - actual.data[offset + channel]),
          ),
        );
        pixels++;
        sum += delta;
        if (delta > 32) different++;
      }
    return { id: area.id, pixels, different, ratio: different / pixels, mean: sum / pixels };
  });
  await writeFile(`${folder}/report.json`, JSON.stringify(results, null, 2));
  // Large opaque foreground probes make a grey backing layer fail even when
  // the rest of a tall page dilutes its overall pixel-difference percentage.
  for (const probe of document.nodes.filter((node) => node.name.startsWith('probe-'))) {
    const x = Math.floor(probe.box.x + probe.box.width / 2);
    const y = Math.floor(probe.box.y + probe.box.height / 2);
    const offset = (y * document.width + x) * 4;
    expect([...actual.data.subarray(offset, offset + 3)], probe.name).toEqual([
      ...expected.data.subarray(offset, offset + 3),
    ]);
  }
  const front = document.nodes.find((node) => node.name === 'probe-last')!;
  await page.getByTestId(`layer-${front.id}`).dblclick();
  await page.getByRole('combobox', { name: '缩放比例' }).selectOption('100');
  const canvas = page.getByTestId('design-canvas');
  await canvas
    .locator('canvas')
    .first()
    .evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  const camera = JSON.parse((await canvas.getAttribute('data-camera'))!) as Camera;
  const scene = await canvas
    .locator('canvas')
    .first()
    .evaluate((element) => (element as HTMLCanvasElement).toDataURL());
  const sceneRaw = await raw(Buffer.from(scene.split(',')[1], 'base64'));
  const x = Math.floor(camera.x + front.box.x + front.box.width / 2);
  const y = Math.floor(camera.y + front.box.y + front.box.height / 2);
  const offset = (y * sceneRaw.info.width + x) * 4;
  expect([...sceneRaw.data.subarray(offset, offset + 3)]).toEqual([255, 255, 255]);
  await page
    .getByTestId(`layer-${document.nodes.find((node) => node.name === 'card-last')!.id}`)
    .click();
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.click(
    bounds.x + camera.x + front.box.x + front.box.width / 2,
    bounds.y + camera.y + front.box.y + front.box.height / 2,
  );
  await expect(page.getByTestId(`layer-${front.id}`)).toHaveAttribute('aria-selected', 'true');
  expect(
    results.filter((result) => result.ratio > 0.003 || result.mean > 0.5),
    `see ${folder}/report.json`,
  ).toEqual([]);
});
