import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { Camera, DesignDocument, Rect } from '@page-to-design/core';

for (const width of [390, 1440]) {
  test(`complex tables retain cells, borders and backgrounds at ${width}px`, async ({
    page,
    baseURL,
  }, testInfo) => {
    const folder = `artifacts/tables/${width}`;
    await mkdir(folder, { recursive: true });
    const url = `${baseURL}/table-example.html`;
    const sourcePage = await page.context().newPage();
    await sourcePage.setViewportSize({ width, height: 844 });
    await sourcePage.goto(url);
    await sourcePage.evaluate(() => document.fonts.ready);
    const geometry = await sourcePage.evaluate(() => {
      const box = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      const ids = [
        'merged-heading',
        'merged-quarter',
        'merged-team',
        'merged-total',
        'wrapped-note',
        'nested-cell',
        'sticky-first',
      ];
      const cells = ids.map((id) => ({
        id,
        box: box(document.getElementById(id)!),
        text: document.getElementById(id)!.textContent!.replace(/\s+/g, ''),
      }));
      const sections = Array.from(document.querySelectorAll('.case')).map((element) => ({
        id: element.id,
        box: box(element),
      }));
      const probes: {
        name: string;
        box: { x: number; y: number; width: number; height: number };
      }[] = [];
      const edge = (id: string, side: 'right' | 'top') => {
        const value = box(document.getElementById(id)!);
        probes.push({
          name: `${id}-${side}`,
          box:
            side === 'right'
              ? {
                  x: Math.floor(value.x + value.width) - 3,
                  y: Math.floor(value.y + value.height / 2) - 2,
                  width: 7,
                  height: 5,
                }
              : {
                  x: Math.floor(value.x + value.width / 2) - 2,
                  y: Math.floor(value.y) - 3,
                  width: 5,
                  height: 7,
                },
        });
      };
      edge('collapse-plan', 'right');
      edge('merged-quarter', 'top');
      edge('conflict-wide', 'right');
      edge('conflict-double', 'top');
      edge('conflict-hidden', 'top');
      edge('nested-cell', 'right');
      for (const id of ['column-background', 'empty-cell', 'column-only-a', 'column-only-b']) {
        const value = box(document.getElementById(id)!);
        probes.push({
          name: `${id}-background`,
          box: { x: Math.floor(value.x) + 6, y: Math.floor(value.y) + 6, width: 4, height: 4 },
        });
      }
      return { cells, sections, probes };
    });
    await sourcePage.close();
    await page.goto('/');
    await page.getByRole('textbox', { name: 'H5 页面 URL' }).fill(url);
    await page.getByRole('combobox', { name: '画板宽度' }).selectOption(String(width));
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/convert') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '转换为设计图' }).click();
    const response = await responsePromise;
    expect(response.ok(), await response.text()).toBeTruthy();
    const source = (await response.json()) as DesignDocument;
    await expect(page.getByText('原生 Canvas 图层', { exact: true })).toBeVisible();
    for (const cell of geometry.cells) {
      const node = source.nodes.find((node) => node.name === cell.id)!;
      expect(node, `missing cell: ${cell.id}`).toBeTruthy();
      expect(node.kind).toBe('frame');
      for (const property of ['x', 'y', 'width', 'height'] as const)
        expect(
          Math.abs(node.box[property] - cell.box[property]),
          `${cell.id}.${property}`,
        ).toBeLessThan(0.6);
    }
    const wrapped = source.nodes.find((node) => node.name === 'wrapped-note')!;
    const wrappedText = source.nodes
      .filter((node) => node.parentId === wrapped.id && node.kind === 'text')
      .map((node) => node.text)
      .join('')
      .replace(/\s+/g, '');
    expect(wrappedText).toBe(geometry.cells.find((cell) => cell.id === 'wrapped-note')!.text);
    expect(
      source.nodes
        .filter((node) => ['table', 'th', 'td'].includes(node.tag))
        .every((node) => node.kind !== 'raster'),
    ).toBeTruthy();
    const download = async (name: string) => {
      await page.getByRole('button', { name: '导出', exact: true }).click();
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name }).click();
      return readFile((await (await downloading).path())!);
    };
    const native = await download('Canvas 图片');
    const exported = JSON.parse((await download('设计文档')).toString()) as DesignDocument;
    expect(
      exported.nodes.every(
        (node) =>
          node.parentId === null && node.children.length === 0 && node.positioning === 'absolute',
      ),
    ).toBeTruthy();
    expect(
      exported.nodes.find((node) => node.name === 'empty-cell')?.style['background-color'],
    ).toBe('transparent');
    const cell = source.nodes.find((node) => node.name === 'merged-team')!;
    const canvas = page.getByTestId('design-canvas');
    const canvasBox = (await canvas.boundingBox())!;
    const camera = JSON.parse((await canvas.getAttribute('data-camera'))!) as Camera;
    // Click the lower half of a rowspan cell: the next row must not steal its hit.
    await page.mouse.click(
      canvasBox.x + camera.x + (cell.box.x + 10) * camera.scale,
      canvasBox.y + camera.y + (cell.box.y + cell.box.height - 10) * camera.scale,
    );
    await expect(page.getByTestId(`layer-${cell.id}`)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('absolute-layout-info')).toContainText('absolute');
    await page.screenshot({ path: `${folder}/editor.png` });
    const reference = Buffer.from(source.referenceImage.split(',')[1], 'base64');
    await writeFile(`${folder}/reference.png`, reference);
    await writeFile(`${folder}/canvas.png`, native);
    await writeFile(`${folder}/design.json`, JSON.stringify(exported));
    const referenceRaw = await sharp(reference)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const nativeRaw = await sharp(native).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(nativeRaw.info).toEqual(referenceRaw.info);
    // Also inspect the real Konva scene currently displayed by the application,
    // independently of the offscreen PNG export path.
    const sceneData = await canvas
      .locator('canvas')
      .first()
      .evaluate((element) => (element as HTMLCanvasElement).toDataURL('image/png'));
    const sceneBuffer = Buffer.from(sceneData.split(',')[1], 'base64');
    await writeFile(`${folder}/display.png`, sceneBuffer);
    const scene = await sharp(sceneBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const sceneRatio = scene.info.width / canvasBox.width;
    for (const id of ['merged-team', 'empty-cell']) {
      const value = source.nodes.find((node) => node.name === id)!;
      const point = {
        x: value.box.x + value.box.width / 2,
        y: value.box.y + value.box.height - 12,
      };
      const sx = Math.floor((camera.x + point.x * camera.scale) * sceneRatio);
      const sy = Math.floor((camera.y + point.y * camera.scale) * sceneRatio);
      expect(sx).toBeGreaterThanOrEqual(0);
      expect(sy).toBeGreaterThanOrEqual(0);
      expect(sx).toBeLessThan(scene.info.width);
      expect(sy).toBeLessThan(scene.info.height);
      const sourceOffset = (Math.floor(point.y) * source.width + Math.floor(point.x)) * 4;
      const sceneOffset = (sy * scene.info.width + sx) * 4;
      for (const channel of [0, 1, 2])
        expect(
          Math.abs(scene.data[sceneOffset + channel] - referenceRaw.data[sourceOffset + channel]),
          `Displayed ${id} background`,
        ).toBeLessThanOrEqual(3);
    }
    const pixelDifference = (x: number, y: number) => {
      const offset = (y * source.width + x) * 4;
      return Math.max(
        ...[0, 1, 2].map((channel) =>
          Math.abs(referenceRaw.data[offset + channel] - nativeRaw.data[offset + channel]),
        ),
      );
    };
    const compare = (rect: Rect) => {
      const left = Math.max(0, Math.ceil(rect.x));
      const top = Math.max(0, Math.ceil(rect.y));
      const right = Math.min(source.width, Math.floor(rect.x + rect.width));
      const bottom = Math.min(source.height, Math.floor(rect.y + rect.height));
      let count = 0;
      let different = 0;
      let sum = 0;
      for (let y = top; y < bottom; y++)
        for (let x = left; x < right; x++) {
          const delta = pixelDifference(x, y);
          count++;
          sum += delta;
          if (delta > 32) different++;
        }
      return {
        pixels: count,
        different,
        ratio: count ? different / count : 0,
        meanMaxChannelDifference: count ? sum / count : 0,
      };
    };
    const sections = geometry.sections.map((section) => ({
      id: section.id,
      ...compare(section.box),
    }));
    const probes = geometry.probes.map((probe) => ({ name: probe.name, ...compare(probe.box) }));
    const report = {
      width,
      height: source.height,
      nodes: source.nodes.length,
      stats: source.stats,
      warnings: source.warnings,
      cells: geometry.cells,
      sections,
      probes: probes.map((probe, index) => ({ ...probe, box: geometry.probes[index].box })),
    };
    await writeFile(`${folder}/report.json`, JSON.stringify(report, null, 2));
    await testInfo.attach(`table-report-${width}`, {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });
    const previewWidth = Math.min(width, 650);
    const resizedReference = await sharp(reference)
      .resize({ width: previewWidth })
      .png()
      .toBuffer();
    const resizedNative = await sharp(native).resize({ width: previewWidth }).png().toBuffer();
    const previewHeight = (await sharp(resizedReference).metadata()).height!;
    await sharp({
      create: { width: previewWidth * 2, height: previewHeight, channels: 3, background: '#fff' },
    })
      .composite([
        { input: resizedReference, left: 0, top: 0 },
        { input: resizedNative, left: previewWidth, top: 0 },
      ])
      .png()
      .toFile(`${folder}/comparison.png`);
    expect(
      probes.filter((probe) => probe.ratio > 0.05 || probe.meanMaxChannelDifference > 3),
      `Border/background probes at ${width}px; see ${folder}/report.json`,
    ).toEqual([]);
    expect(
      sections.filter((section) => section.ratio > 0.005),
      `Visual differences at ${width}px; see ${folder}/report.json`,
    ).toEqual([]);
  });
}
