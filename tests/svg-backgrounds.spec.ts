import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { flattenDocument, type DesignDocument } from '@quantacenter/page2design';

for (const width of [390, 1440])
  test(`SVG background intrinsic sizing and viewports match at ${width}px`, async ({
    request,
    page,
    baseURL,
  }) => {
    const response = await request.post('/api/convert', {
      data: {
        url: `${baseURL}/tests/fixtures/svg-backgrounds.html`,
        width,
        height: 844,
        fullPage: true,
      },
      timeout: 75000,
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    const source = (await response.json()) as DesignDocument;
    expect(source.stats.rasterNodes).toBe(0);
    await page.goto('/');
    const output = await page.evaluate(
      async ({ source, flat }) => {
        const module = '/tests/fixtures/core-api.ts';
        const { loadDocumentResources, renderToCanvas, CanvasRenderer, paintDocument } =
          await import(module);
        const resources = await loadDocumentResources(source);
        try {
          const hierarchical = renderToCanvas(source, resources).toDataURL(),
            flattened = renderToCanvas(flat, resources).toDataURL();
          const renderer = new CanvasRenderer(flat, resources),
            previews = [];
          for (const scale of [0.5, 1, 1.5, 2]) {
            const actual = document.createElement('canvas');
            const camera = { x: 0.25, y: 0.375, scale },
              width = Math.min(source.width, 800),
              height = 900;
            renderer.render(actual, { width, height, camera });
            const expected = document.createElement('canvas');
            expected.width = width;
            expected.height = height;
            const context = expected.getContext('2d')!;
            context.setTransform(scale, 0, 0, scale, camera.x, camera.y);
            paintDocument(context, flat, resources.images);
            const a = actual.getContext('2d')!.getImageData(0, 0, width, height).data,
              b = context.getImageData(0, 0, width, height).data;
            let different = 0;
            for (let i = 0; i < a.length; i += 4)
              if (Math.max(...[0, 1, 2, 3].map((k) => Math.abs(a[i + k] - b[i + k]))) > 32)
                different++;
            previews.push({ scale, ratio: different / (width * height) });
          }
          renderer.dispose();
          return { hierarchical, flattened, previews, errors: resources.errors };
        } finally {
          resources.dispose();
        }
      },
      { source, flat: flattenDocument(source) },
    );
    expect(output.errors).toEqual([]);
    expect(output.flattened).toEqual(output.hierarchical);
    const decode = (value: string) => Buffer.from(value.split(',')[1], 'base64');
    const expected = await sharp(decode(source.referenceImage))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const actual = await sharp(decode(output.hierarchical))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const results = source.nodes
      .filter((node) => node.name.endsWith('-stage'))
      .map((node) => {
        let count = 0,
          different = 0,
          sum = 0;
        for (let y = Math.ceil(node.box.y); y < Math.floor(node.box.y + node.box.height); y++)
          for (let x = Math.ceil(node.box.x); x < Math.floor(node.box.x + node.box.width); x++) {
            const offset = (y * source.width + x) * 4,
              delta = Math.max(
                ...[0, 1, 2].map((k) =>
                  Math.abs(actual.data[offset + k] - expected.data[offset + k]),
                ),
              );
            count++;
            sum += delta;
            if (delta > 32) different++;
          }
        return { name: node.name, ratio: different / count, mean: sum / count };
      });
    const folder = `artifacts/svg-backgrounds/${width}`;
    await mkdir(folder, { recursive: true });
    await writeFile(`${folder}/reference.png`, decode(source.referenceImage));
    await writeFile(`${folder}/canvas.png`, decode(output.hierarchical));
    await writeFile(
      `${folder}/report.json`,
      JSON.stringify({ results, previews: output.previews }, null, 2),
    );
    expect(
      results.filter((result) => result.ratio > 0.01 || result.mean > 2),
      JSON.stringify(results),
    ).toEqual([]);
    expect(output.previews.filter((result) => result.ratio > 0.01)).toEqual([]);
  });
