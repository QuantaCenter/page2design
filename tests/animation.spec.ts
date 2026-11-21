import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { DesignDocument } from '@quantacenter/page2design';

test('carousel DOM, reference and local screenshots retain one timer and animation frame', async ({
  page,
  baseURL,
}) => {
  const folder = 'artifacts/animation';
  await mkdir(folder, { recursive: true });
  await page.goto('/');
  await page
    .getByRole('textbox', { name: 'H5 页面 URL' })
    .fill(`${baseURL}/tests/fixtures/animated-carousel.html`);
  const converting = page.waitForResponse(
    (response) => response.url().includes('/api/convert') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '转换为设计图' }).click();
  const response = await converting;
  expect(response.ok(), await response.text()).toBeTruthy();
  const source = (await response.json()) as DesignDocument;
  await expect(page.getByText('原生 Canvas 图层', { exact: true })).toBeVisible();
  const reference = Buffer.from(source.referenceImage.split(',')[1], 'base64');
  const expected = await sharp(reference).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const native = source.nodes.find((node) => node.name === 'native-swatch')!;
  const pixel = (data: Buffer, x: number, y: number) => [
    ...data.subarray((y * source.width + x) * 4, (y * source.width + x) * 4 + 3),
  ];
  const expectedRgb = native.style['background-color'].match(/\d+/g)!.map(Number);
  const center = (node: typeof native) => [
    Math.floor(node.box.x + node.box.width / 2),
    Math.floor(node.box.y + node.box.height / 2),
  ];
  const [nx, ny] = center(native);
  expect(pixel(expected.data, nx, ny), 'DOM and reference use the same slide').toEqual(expectedRgb);
  const probes = [];
  for (const node of source.nodes.filter(
    (node) => node.name === 'timer-tile' || node.name === 'raf-tile',
  )) {
    expect(node.kind).toBe('frame');
    expect(node.assetId).toBeUndefined();
    const [x, y] = center(node);
    const rgb = pixel(expected.data, x, y);
    expect(
      node.style['background-color'].match(/\d+/g)!.map(Number),
      `${node.name} native geometry shares the reference frame`,
    ).toEqual(rgb);
    probes.push({ name: node.name, rgb });
  }
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Canvas 图片' }).click();
  const canvas = await readFile((await (await downloading).path())!);
  const actual = await sharp(canvas).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (const node of source.nodes.filter(
    (node) => node.name === 'timer-tile' || node.name === 'raf-tile',
  )) {
    const [x, y] = center(node);
    expect(pixel(actual.data, x, y), node.name + ' native export').toEqual(
      pixel(expected.data, x, y),
    );
  }
  const active = source.nodes.find((node) => node.name === 'dot · active')!;
  let different = 0;
  let count = 0;
  for (
    let y = Math.floor(active.box.y) - 2;
    y < Math.ceil(active.box.y + active.box.height) + 2;
    y++
  ) {
    for (
      let x = Math.floor(active.box.x) - 2;
      x < Math.ceil(active.box.x + active.box.width) + 2;
      x++
    ) {
      const a = pixel(actual.data, x, y);
      const b = pixel(expected.data, x, y);
      if (a.some((value, index) => Math.abs(value - b[index]) > 32)) different++;
      count++;
    }
  }
  await writeFile(`${folder}/canvas.png`, canvas);
  await writeFile(`${folder}/reference.png`, reference);
  await writeFile(
    `${folder}/report.json`,
    JSON.stringify(
      {
        slide: source.nodes.find((node) => node.kind === 'text')?.text,
        probes,
        activeDot: { different, count },
      },
      null,
      2,
    ),
  );
  expect(different / count, 'animated semicircles preserve the selected dot shape').toBeLessThan(
    0.035,
  );
});
