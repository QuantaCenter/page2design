import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { flattenDocument, type DesignDocument } from '@quantacenter/page2design';
for (const width of [390, 1440])
  test(`canvas pixels and WebGL buffers avoid page screenshots at ${width}px`, async ({
    page,
    request,
    baseURL,
  }) => {
    const response = await request.post('/api/convert', {
      data: {
        url: `${baseURL}/tests/fixtures/native-canvas.html`,
        width,
        height: 844,
        fullPage: true,
      },
      timeout: 75000,
    });
    expect(response.ok(), await response.text()).toBe(true);
    const source = (await response.json()) as DesignDocument;
    for (const name of ['canvas-2d', 'canvas-webgl', 'canvas-webgl2']) {
      const node = source.nodes.find((n) => n.name === name)!;
      expect(node.kind, name).toBe('canvas');
      expect(node.canvas).toEqual({ width: 160, height: 90 });
      // Identical WebGL buffers share one native asset.
      expect(source.assets.find((a) => a.id === node.assetId)?.url).toMatch(/^canvas:/);
    }
    const empty = source.nodes.find((n) => n.name === 'canvas-empty')!;
    expect(empty.kind).toBe('canvas');
    expect(empty.assetId).toBeUndefined();
    const tainted = source.nodes.find((n) => n.name === 'canvas-tainted')!;
    expect(tainted.kind).toBe('raster');
    expect(
      source.warnings.filter((w) => w.code === 'CANVAS_READBACK_FALLBACK').map((w) => w.nodeId),
    ).toEqual([tainted.id]);
    expect(source.nodes.filter((n) => n.kind === 'raster').map((n) => n.id)).toEqual([tainted.id]);
    await page.goto('/');
    const result = await page.evaluate(
      async ({ source, flat }) => {
        const module = '/tests/fixtures/core-api.ts';
        const { loadDocumentResources, renderToCanvas } = await import(module);
        const resources = await loadDocumentResources(source);
        try {
          return {
            original: renderToCanvas(source, resources).toDataURL(),
            flat: renderToCanvas(flat, resources).toDataURL(),
            errors: resources.errors,
          };
        } finally {
          resources.dispose();
        }
      },
      { source, flat: flattenDocument(source) },
    );
    expect(result.errors).toEqual([]);
    expect(result.flat).toEqual(result.original);
    const decode = (url: string) => Buffer.from(url.split(',')[1], 'base64');
    const expected = await sharp(decode(source.referenceImage)).ensureAlpha().raw().toBuffer(),
      actual = await sharp(decode(result.original)).ensureAlpha().raw().toBuffer();
    const results = source.nodes
      .filter((n) => n.name.startsWith('case-'))
      .map((n) => {
        let count = 0,
          different = 0,
          sum = 0;
        for (let y = Math.floor(n.box.y); y < Math.ceil(n.box.y + n.box.height); y++)
          for (let x = Math.floor(n.box.x); x < Math.ceil(n.box.x + n.box.width); x++) {
            const o = (y * width + x) * 4,
              d = Math.max(...[0, 1, 2].map((c) => Math.abs(expected[o + c] - actual[o + c])));
            count++;
            sum += d;
            if (d > 32) different++;
          }
        return { name: n.name, ratio: different / count, mean: sum / count };
      });
    const folder = `artifacts/native-canvas/${width}`;
    await mkdir(folder, { recursive: true });
    await writeFile(folder + '/report.json', JSON.stringify(results, null, 2));
    await writeFile(folder + '/reference.png', decode(source.referenceImage));
    await writeFile(folder + '/canvas.png', decode(result.original));
    expect(
      results.filter((r) => r.ratio > 0.01 || r.mean > 2),
      JSON.stringify(results),
    ).toEqual([]);
  });
