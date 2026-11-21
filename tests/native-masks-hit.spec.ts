import { test, expect } from '@playwright/test';
import {
  flattenDocument,
  projectPoint,
  type DesignDocument,
  type Camera,
} from '@page-to-design/core';

test('native clipping controls DOM and Canvas hits while image masks preserve box hit testing', async ({
  page,
  request,
  baseURL,
}) => {
  const url = `${baseURL}/tests/fixtures/native-masks.html`;
  const response = await request.post('/api/convert', {
    data: { url, width: 390, height: 844, fullPage: true },
    timeout: 75000,
  });
  expect(response.ok(), await response.text()).toBe(true);
  const source = (await response.json()) as DesignDocument;
  const lookup = (name: string) => source.nodes.find((node) => node.name === name)!;
  const probes = [
    { name: 'circle', x: 10, y: 70, under: true },
    { name: 'circle', x: 140, y: 70, under: false },
    { name: 'polygon-hole', x: 140, y: 70, under: true },
    { name: 'polygon-hole', x: 15, y: 70, under: false },
    { name: 'path-hole', x: 140, y: 70, under: true },
    { name: 'path-hole', x: 20, y: 70, under: false },
    { name: 'clip-affine', x: 8, y: 70, under: true },
    { name: 'clip-affine', x: 140, y: 70, under: false },
    { name: 'clip-perspective', x: 140, y: 70, under: true },
    { name: 'clip-perspective', x: 20, y: 70, under: false },
    { name: 'mask-image', x: 140, y: 70, under: false },
    { name: 'mask-linear', x: 8, y: 70, under: false },
  ].map((probe) => {
    const owner = lookup(probe.name),
      box = owner.localBox || owner.box,
      local = { x: box.x + probe.x, y: box.y + probe.y };
    return {
      ...probe,
      point: owner.transform ? projectPoint(owner.transform, local) : local,
      expected: lookup(probe.name + (probe.under ? '-under' : '')).id,
    };
  });
  const original = await page.context().newPage();
  await original.setViewportSize({ width: 390, height: 844 });
  await original.goto(url);
  for (const probe of probes) {
    const id = await original.evaluate(({ point }) => {
      window.scrollTo(0, point.y - 300);
      return document.elementFromPoint(point.x - scrollX, point.y - scrollY)?.closest('[id]')?.id;
    }, probe);
    expect(id, probe.name + ' DOM ' + JSON.stringify(probe.point)).toBe(
      probe.name + (probe.under ? '-under' : ''),
    );
  }
  await original.close();
  await page.goto('/');
  const hits = await page.evaluate(
    async ({ source, probes }) => {
      const module = '/tests/fixtures/core-api.ts';
      const { loadDocumentResources, CanvasRenderer } = await import(module);
      const resources = await loadDocumentResources(source),
        renderer = new CanvasRenderer(source, resources);
      try {
        return probes.map((probe) => renderer.hitTest(probe.point)?.id);
      } finally {
        renderer.dispose();
        resources.dispose();
      }
    },
    { source: flattenDocument(source), probes },
  );
  expect(hits).toEqual(probes.map((probe) => probe.expected));
  await page.route('**/api/convert', (route) => route.fulfill({ json: source }));
  await page.getByRole('textbox', { name: 'H5 页面 URL' }).fill(url);
  await page.getByRole('button', { name: '转换为设计图' }).click();
  await expect(page.getByText('原生 Canvas 图层', { exact: true })).toBeVisible();
  const canvas = page.getByTestId('design-canvas');
  for (const name of ['polygon-hole', 'clip-perspective', 'mask-image'])
    for (const scale of [50, 100, 200]) {
      const owner = lookup(name);
      await page.getByTestId(`layer-${owner.id}`).dblclick();
      await page.getByRole('combobox', { name: '缩放比例' }).selectOption(String(scale));
      for (const probe of probes.filter((probe) => probe.name === name)) {
        const camera = JSON.parse((await canvas.getAttribute('data-camera'))!) as Camera,
          bounds = (await canvas.boundingBox())!;
        const point = {
          x: bounds.x + camera.x + probe.point.x * camera.scale,
          y: bounds.y + camera.y + probe.point.y * camera.scale,
        };
        await page.mouse.move(point.x, point.y);
        await expect(canvas, name + ' hover').toHaveAttribute('data-hovered-id', probe.expected);
        await page.mouse.click(point.x, point.y);
        await expect(
          page.getByTestId(`layer-${probe.expected}`),
          name + ' selected',
        ).toHaveAttribute('aria-selected', 'true');
      }
    }
});
