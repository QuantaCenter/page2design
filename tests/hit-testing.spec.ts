import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { Camera, DesignDocument } from '@page-to-design/core';

test('transparent raster overlays pass hover, selection and measurement to visible layers', async ({
  page,
  baseURL,
}) => {
  await page.goto('/');
  await page
    .getByRole('textbox', { name: 'H5 页面 URL' })
    .fill(`${baseURL}/tests/fixtures/transparent-overlay.html`);
  const converting = page.waitForResponse(
    (response) => response.url().includes('/api/convert') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '转换为设计图' }).click();
  const response = await converting;
  expect(response.ok(), await response.text()).toBeTruthy();
  const document = (await response.json()) as DesignDocument;
  await expect(page.getByText('原生 Canvas 图层', { exact: true })).toBeVisible();
  const node = (name: string) => document.nodes.find((node) => node.name === name)!;
  for (const name of ['ring-overlay']) {
    expect(node(name).kind).toBe('raster');
    expect(node(name).box.width).toBe(390);
    expect(node(name).box.height).toBe(844);
  }
  expect(
    document.warnings.some(
      (warning) =>
        warning.code === 'CANVAS_READBACK_FALLBACK' && warning.nodeId === node('ring-overlay').id,
    ),
  ).toBe(true);
  expect(node('empty-overlay').kind).toBe('frame');
  expect(node('sparse-overlay').kind).toBe('frame');
  expect(node('empty-overlay').hasVisual).toBe(false);
  const first = node('first-card');
  const second = node('second-card');
  const canvas = page.getByTestId('design-canvas');
  const checks = [];
  for (const scale of [100, 50, 200]) {
    await page.getByTestId(`layer-${first.id}`).dblclick();
    await page.getByRole('combobox', { name: '缩放比例' }).selectOption(String(scale));
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
    const bounds = (await canvas.boundingBox())!;
    const point = (x: number, y: number) => ({
      x: bounds.x + camera.x + x * camera.scale,
      y: bounds.y + camera.y + y * camera.scale,
    });
    for (const probe of [
      { name: 'under all overlays', x: first.box.x + 60, y: first.box.y + 100, id: first.id },
      { name: 'transparent ring hole', x: 162, y: 266, id: second.id },
      { name: 'painted ring edge', x: 142, y: 266, id: node('ring-overlay').id },
      { name: 'painted floating tool', x: 342, y: 110, id: node('tool').id },
    ]) {
      const position = point(probe.x, probe.y);
      await page.mouse.move(position.x, position.y);
      await expect(canvas, `${probe.name} hover at ${scale}%`).toHaveAttribute(
        'data-hovered-id',
        probe.id,
      );
      // A canvas click must use the same transparent hit regions as hover.
      await page.mouse.click(position.x, position.y);
      await expect(
        page.getByTestId(`layer-${probe.id}`),
        `${probe.name} at ${scale}%`,
      ).toHaveAttribute('aria-selected', 'true');
      checks.push({ scale, name: probe.name, selected: probe.id });
    }
    const position = point(first.box.x + 60, first.box.y + 100);
    await page.mouse.click(position.x, position.y);
    await expect(page.getByTestId(`layer-${first.id}`)).toHaveAttribute('aria-selected', 'true');
  }
  await page.getByRole('button', { name: '测距工具', exact: true }).click();
  const camera = JSON.parse((await canvas.getAttribute('data-camera'))!) as Camera;
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.click(
    bounds.x + camera.x + 162 * camera.scale,
    bounds.y + camera.y + 266 * camera.scale,
  );
  await expect(page.getByTestId('measurement-panel')).toContainText('24 px');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Canvas 图片' }).click();
  const png = await readFile((await (await downloading).path())!);
  const reference = Buffer.from(document.referenceImage.split(',')[1], 'base64');
  const actual = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const expected = await sharp(reference).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(actual.info).toEqual(expected.info);
  for (const [x, y] of [
    [84, 172],
    [162, 266],
    [142, 266],
    [342, 110],
  ]) {
    const offset = (y * document.width + x) * 4;
    expect([...actual.data.subarray(offset, offset + 4)]).toEqual([
      ...expected.data.subarray(offset, offset + 4),
    ]);
  }
  await mkdir('artifacts/hit-testing', { recursive: true });
  await writeFile('artifacts/hit-testing/canvas.png', png);
  await writeFile('artifacts/hit-testing/reference.png', reference);
  await writeFile(
    'artifacts/hit-testing/report.json',
    JSON.stringify({ checks, measuredGap: 24 }, null, 2),
  );
  await page.screenshot({ path: 'artifacts/hit-testing/editor.png' });
});
