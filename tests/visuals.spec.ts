import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { Camera, DesignDocument, Rect } from '@page-to-design/core';

for (const width of [390, 1440]) {
  test(`complex images, SVG, gradients and effects match at ${width}px`, async ({
    page,
    baseURL,
  }, testInfo) => {
    const folder = `artifacts/visuals/${width}`;
    await mkdir(folder, { recursive: true });
    const url = `${baseURL}/visual-example.html`;
    const sourcePage = await page.context().newPage();
    await sourcePage.setViewportSize({ width, height: 844 });
    await sourcePage.goto(url);
    await sourcePage.evaluate(() =>
      Promise.all(Array.from(window.document.images).map((image) => image.decode())),
    );
    const cases = await sourcePage.evaluate(() =>
      Array.from(window.document.querySelectorAll<HTMLElement>('.case')).map((element) => {
        const rect = element.querySelector('.stage')!.getBoundingClientRect();
        const subject = element.querySelector('.subject')!.getBoundingClientRect();
        const box = (value: DOMRect) => ({
          x: value.x,
          y: value.y,
          width: value.width,
          height: value.height,
        });
        return {
          id: element.id,
          kind: element.dataset.kind,
          box: box(rect),
          subject: box(subject),
        };
      }),
    );
    await sourcePage.close();
    await page.goto('/');
    await page.getByRole('textbox', { name: 'H5 页面 URL' }).fill(url);
    await page.getByRole('combobox', { name: '画板宽度' }).selectOption(String(width));
    const converted = page.waitForResponse(
      (response) =>
        response.url().includes('/api/convert') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '转换为设计图' }).click();
    const response = await converted;
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
      flat.nodes.every(
        (node) =>
          node.parentId === null && !node.children.length && node.positioning === 'absolute',
      ),
    ).toBeTruthy();
    // Removing layout constraints must leave every visual unchanged.
    await page.getByRole('button', { name: '原始层级', exact: true }).click();
    expect(await download('Canvas 图片')).toEqual(png);
    await page.getByRole('button', { name: '平铺结构', exact: true }).click();
    const reference = Buffer.from(document.referenceImage.split(',')[1], 'base64');
    await writeFile(`${folder}/reference.png`, reference);
    await writeFile(`${folder}/canvas.png`, png);
    await writeFile(`${folder}/design.json`, JSON.stringify(flat));
    const raw = async (input: Buffer) =>
      sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const original = await raw(reference);
    const painted = await raw(png);
    expect(painted.info).toEqual(original.info);
    const compare = (
      box: Rect,
      other = painted,
      camera = { x: 0, y: 0, scale: 1 },
      sceneReference?: typeof original,
    ) => {
      const region = sceneReference
        ? {
            x: camera.x + box.x * camera.scale,
            y: camera.y + box.y * camera.scale,
            width: box.width * camera.scale,
            height: box.height * camera.scale,
          }
        : box;
      const left = Math.max(0, Math.ceil(region.x));
      const top = Math.max(0, Math.ceil(region.y));
      const right = Math.min(other.info.width, Math.floor(region.x + region.width));
      const bottom = Math.min(other.info.height, Math.floor(region.y + region.height));
      let count = 0;
      let different = 0;
      let sum = 0;
      for (let y = top; y < bottom; y++)
        for (let x = left; x < right; x++) {
          const b = (y * other.info.width + x) * 4;
          const a = sceneReference ? b : (y * document.width + x) * 4;
          const delta = Math.max(
            ...[0, 1, 2].map((channel) =>
              Math.abs((sceneReference || original).data[a + channel] - other.data[b + channel]),
            ),
          );
          count++;
          sum += delta;
          if (delta > 32) different++;
        }
      return {
        pixels: count,
        different,
        ratio: different / count,
        meanMaxChannelDifference: sum / count,
      };
    };
    const results = cases.map((value) => {
      const node = document.nodes.find((node) => node.name === `${value.id}-subject`)!;
      expect(node, value.id).toBeTruthy();
      expect(node.kind, `${value.id} should retain its declared representation`).toBe(value.kind);
      for (const prop of ['x', 'y', 'width', 'height'] as const)
        expect(Math.abs(node.box[prop] - value.subject[prop]), `${value.id}.${prop}`).toBeLessThan(
          0.01,
        );
      return {
        id: value.id,
        kind: node.kind,
        fallbackReason: node.fallbackReason,
        ...compare(value.box),
      };
    });
    for (const id of ['filter-blur', 'filter-drop-shadow', 'filter-overlap']) {
      const node = document.nodes.find((node) => node.name === `${id}-subject`)!;
      expect(node.kind).not.toBe('raster');
      expect(node.compositingGroups?.find((group) => group.id === node.id)?.filter).toBeTruthy();
      expect(node.visualBox!.width).toBeGreaterThan(node.box.width);
    }
    const backdrop = document.nodes.find((node) => node.name === 'filter-backdrop-subject')!;
    expect(
      backdrop.compositingGroups?.find((group) => group.id === backdrop.id)?.backdropFilter,
    ).toBeTruthy();
    const displayed = [];
    const canvas = page.getByTestId('design-canvas');
    // Exercise the actual Konva scene at 1:1, including effects beyond a node's
    // selection rectangle. This catches errors hidden by PNG-only verification.
    const views = [
      'image-edge-position',
      'background-repeat-x',
      'background-space',
      'svg-gradient',
      'svg-use',
      'gradient-repeat',
      'shadow-spread',
      'filter-blur',
      'filter-overlap',
      'filter-backdrop',
      'filter-clipped',
    ].map((id) => ({ id, scale: 100 }));
    views.push({ id: 'shadow-spread', scale: 50 }, { id: 'shadow-spread', scale: 200 });
    for (const { id, scale } of views) {
      const node = document.nodes.find((node) => node.name === `${id}-subject`)!;
      await page.getByTestId(`layer-${node.id}`).dblclick();
      await page.getByRole('combobox', { name: '缩放比例' }).selectOption(String(scale));
      const bounds = (await canvas.boundingBox())!;
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
      expect(camera.scale).toBe(scale / 100);
      const sceneData = await canvas
        .locator('canvas')
        .first()
        .evaluate((element) => (element as HTMLCanvasElement).toDataURL());
      const sceneBuffer = Buffer.from(sceneData.split(',')[1], 'base64');
      const scene = await raw(sceneBuffer);
      expect(scene.info.width).toBe(Math.round(bounds.width));
      // Apply the same camera transform to the browser reference, including a
      // fractional pan. Comparing directly with integer source pixels would
      // falsely report image interpolation as a geometry error.
      const transformed = await page.evaluate(
        async ({ source, camera, width, height }) => {
          const image = new Image();
          image.src = source;
          await image.decode();
          const canvas = window.document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(
            image,
            camera.x,
            camera.y,
            image.naturalWidth * camera.scale,
            image.naturalHeight * camera.scale,
          );
          return canvas.toDataURL();
        },
        {
          source: document.referenceImage,
          camera,
          width: scene.info.width,
          height: scene.info.height,
        },
      );
      displayed.push({
        id,
        scale,
        ...compare(
          cases.find((value) => value.id === id)!.box,
          scene,
          camera,
          await raw(Buffer.from(transformed.split(',')[1], 'base64')),
        ),
      });
      await writeFile(`${folder}/display-${id}-${scale}.png`, sceneBuffer);
    }
    const report = {
      width,
      height: document.height,
      cases: results.length,
      stats: document.stats,
      warnings: document.warnings,
      results,
      displayed,
    };
    await writeFile(`${folder}/report.json`, JSON.stringify(report, null, 2));
    await testInfo.attach(`visual-report-${width}`, {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });
    const previewWidth = Math.min(width, 580);
    const a = await sharp(reference).resize({ width: previewWidth }).png().toBuffer();
    const b = await sharp(png).resize({ width: previewWidth }).png().toBuffer();
    await sharp({
      create: {
        width: previewWidth * 2,
        height: (await sharp(a).metadata()).height!,
        channels: 3,
        background: 'white',
      },
    })
      .composite([
        { input: a, left: 0, top: 0 },
        { input: b, left: previewWidth, top: 0 },
      ])
      .png()
      .toFile(`${folder}/comparison.png`);
    expect(
      results.filter((value) => value.ratio > 0.01 || value.meanMaxChannelDifference > 2),
      `Export differences: ${folder}/report.json`,
    ).toEqual([]);
    expect(
      displayed.filter((value) => value.ratio > 0.01 || value.meanMaxChannelDifference > 2),
      `Display differences: ${folder}/report.json`,
    ).toEqual([]);
  });
}
