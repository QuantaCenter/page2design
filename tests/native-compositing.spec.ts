import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { flattenDocument, type DesignDocument } from '@quantacenter/page2design';

for (const width of [390, 1440])
  test(`filters, blends, backdrop and inset shadows stay native at ${width}px`, async ({
    page,
    request,
    baseURL,
  }) => {
    const response = await request.post('/api/convert', {
      data: {
        url: `${baseURL}/tests/fixtures/native-compositing.html`,
        width,
        height: 844,
        fullPage: true,
      },
      timeout: 75000,
    });
    expect(response.ok(), await response.text()).toBe(true);
    const source = (await response.json()) as DesignDocument;
    expect(
      source.nodes
        .filter((n) => n.kind === 'raster')
        .map((n) => ({ name: n.name, reason: n.fallbackReason })),
    ).toEqual([]);
    expect(source.assets.filter((a) => a.url?.startsWith('capture:'))).toEqual([]);
    for (const name of [
      'blur',
      'drop',
      'color',
      'clipped',
      'nested',
      'blend',
      'backdrop',
      'pseudo',
    ])
      expect(
        source.nodes.find((n) => n.name === name)?.children.length,
        name,
      ).toBeGreaterThanOrEqual(name === 'backdrop' ? 0 : 1);
    await page.goto('/');
    const painted = await page.evaluate(
      async ({ source, flat }) => {
        const module = '/tests/fixtures/core-api.ts';
        const { loadDocumentResources, renderToCanvas, CanvasRenderer } = await import(module);
        const resources = await loadDocumentResources(source);
        try {
          const previews = [];
          for (const scale of [0.5, 1, 2]) {
            const canvas = document.createElement('canvas'),
              renderer = new CanvasRenderer(flat, resources);
            renderer.render(canvas, {
              width: source.width,
              height: source.height,
              camera: { x: 0.25, y: 0.375, scale },
            });
            previews.push({ scale, png: canvas.toDataURL() });
            renderer.dispose();
          }
          return {
            original: renderToCanvas(source, resources).toDataURL(),
            flat: renderToCanvas(flat, resources).toDataURL(),
            previews,
            errors: resources.errors,
          };
        } finally {
          resources.dispose();
        }
      },
      { source, flat: flattenDocument(source) },
    );
    expect(painted.errors).toEqual([]);
    expect(painted.flat).toEqual(painted.original);
    const decode = (url: string) => Buffer.from(url.split(',')[1], 'base64');
    const raw = (buffer: Buffer) =>
      sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const expected = await raw(decode(source.referenceImage)),
      actual = await raw(decode(painted.original));
    const results = source.nodes
      .filter((n) => n.name.startsWith('case-'))
      .map((n) => {
        let count = 0,
          different = 0,
          sum = 0;
        for (let y = Math.floor(n.box.y); y < Math.ceil(n.box.y + n.box.height); y++)
          for (let x = Math.floor(n.box.x); x < Math.ceil(n.box.x + n.box.width); x++) {
            const o = (y * width + x) * 4,
              d = Math.max(
                ...[0, 1, 2].map((i) => Math.abs(expected.data[o + i] - actual.data[o + i])),
              );
            count++;
            sum += d;
            if (d > 32) different++;
          }
        return { name: n.name, ratio: different / count, mean: sum / count };
      });
    const folder = `artifacts/native-compositing/${width}`;
    await mkdir(folder, { recursive: true });
    await writeFile(folder + '/reference.png', decode(source.referenceImage));
    await writeFile(folder + '/canvas.png', decode(painted.original));
    await writeFile(folder + '/report.json', JSON.stringify(results, null, 2));
    expect(
      results.filter((r) => r.ratio > 0.01 || r.mean > 2),
      JSON.stringify(results),
    ).toEqual([]);
    for (const preview of painted.previews) {
      const reference = await page.evaluate(
        async ({ source, scale }) => {
          const image = new Image();
          image.src = source.referenceImage;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = source.width;
          canvas.height = source.height;
          canvas
            .getContext('2d')!
            .drawImage(image, 0.25, 0.375, source.width * scale, source.height * scale);
          return canvas.toDataURL();
        },
        { source, scale: preview.scale },
      );
      const a = await raw(decode(preview.png)),
        b = await raw(decode(reference));
      let count = 0,
        different = 0,
        sum = 0;
      for (let y = 2; y < Math.min(source.height - 2, source.height * preview.scale - 2); y++)
        for (let x = 2; x < Math.min(source.width - 2, 366 * preview.scale - 2); x++) {
          const o = (y * a.info.width + x) * 4,
            d = Math.max(...[0, 1, 2].map((i) => Math.abs(a.data[o + i] - b.data[o + i])));
          count++;
          sum += d;
          if (d > 32) different++;
        }
      expect(different / count, 'preview ' + preview.scale).toBeLessThan(0.025);
      expect(sum / count, 'preview mean ' + preview.scale).toBeLessThan(3);
    }
  });
