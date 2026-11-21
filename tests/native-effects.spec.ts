import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { flattenDocument, type DesignDocument } from '@page-to-design/core';

for (const width of [390, 1440])
  test(`opacity, video, generated content and text shadows render natively at ${width}px`, async ({
    page,
    request,
    baseURL,
  }) => {
    const response = await request.post('/api/convert', {
      data: {
        url: `${baseURL}/tests/fixtures/native-effects.html`,
        width,
        height: 844,
        fullPage: true,
      },
      timeout: 75000,
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    const source = (await response.json()) as DesignDocument;
    const node = (name: string) => source.nodes.find((node) => node.name === name)!;
    for (const name of [
      'opacity-group',
      'opacity-filter',
      'opacity-zero',
      'pseudo-content',
      'pseudo-wrapped',
      'text-shadow',
      'text-shadow-transparent',
      'text-shadow-mixed',
    ]) {
      expect(node(name).kind, name).toBe('frame');
      expect(node(name).children.length, name).toBeGreaterThan(0);
      expect(node(name).fallbackReason, name).toBeUndefined();
    }
    expect(node('opacity-group').opacityGroups).toEqual([
      { id: node('opacity-group').id, opacity: 0.45 },
    ]);
    const nested = source.nodes.find((node) => node.name === 'nested')!;
    expect(nested.opacityGroups).toHaveLength(2);
    expect(
      source.nodes.some((node) => node.pseudoElement === '::before' && node.kind === 'frame'),
    ).toBeTruthy();
    expect(
      source.nodes
        .filter((node) => node.pseudoElement && node.kind === 'text')
        .map((node) => node.text)
        .join(' '),
    ).toContain('Generated label');
    expect(
      source.nodes
        .filter((node) => node.pseudoElement && node.kind === 'text')
        .map((node) => node.text)
        .join(' '),
    ).toContain('7');
    const video = node('native-video');
    expect(video.kind).toBe('video');
    expect(video.video!.width).toBe(160);
    expect(video.video!.height).toBe(90);
    expect(video.assetId).toBeTruthy();
    expect(node('poster-video').kind).toBe('video');
    expect(node('poster-video').assetId).toBeTruthy();
    expect(
      source.warnings.filter((warning) =>
        /整体透明度|video 内容|伪元素内容|文字阴影|VIDEO_FRAME/.test(
          warning.message + warning.code,
        ),
      ),
    ).toEqual([]);
    expect(source.assets.filter((asset) => asset.url?.startsWith('capture:'))).toHaveLength(0);
    await page.goto('/');
    const flat = flattenDocument(source);
    const rendered = await page.evaluate(
      async ({ source, flat }) => {
        const module = '/tests/fixtures/core-api.ts';
        const { loadDocumentResources, renderToCanvas, CanvasRenderer } = await import(module);
        const resources = await loadDocumentResources(source);
        try {
          const original = renderToCanvas(source, resources).toDataURL();
          const flattened = renderToCanvas(flat, resources).toDataURL();
          const previews = [];
          for (const scale of [0.5, 1, 2]) {
            const canvas = window.document.createElement('canvas');
            const renderer = new CanvasRenderer(flat, resources);
            renderer.render(canvas, {
              width: source.width,
              height: source.height,
              camera: { x: 0.25, y: 0.375, scale },
              pixelRatio: 1,
            });
            previews.push({ scale, png: canvas.toDataURL() });
            renderer.dispose();
          }
          return { original, flattened, previews, errors: resources.errors };
        } finally {
          resources.dispose();
        }
      },
      { source, flat },
    );
    expect(rendered.errors).toEqual([]);
    expect(rendered.flattened).toEqual(rendered.original);
    const folder = `artifacts/native-effects/${width}`;
    await mkdir(folder, { recursive: true });
    const decode = (url: string) => Buffer.from(url.split(',')[1], 'base64');
    const raw = (input: Buffer) =>
      sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const expected = await raw(decode(source.referenceImage)),
      actual = await raw(decode(rendered.original));
    const results = source.nodes
      .filter((node) => node.name.startsWith('case-'))
      .map((node) => {
        let count = 0,
          different = 0,
          sum = 0;
        for (let y = Math.floor(node.box.y); y < Math.ceil(node.box.y + node.box.height); y++)
          for (let x = Math.floor(node.box.x); x < Math.ceil(node.box.x + node.box.width); x++) {
            const offset = (y * source.width + x) * 4;
            const delta = Math.max(
              ...[0, 1, 2].map((channel) =>
                Math.abs(actual.data[offset + channel] - expected.data[offset + channel]),
              ),
            );
            count++;
            sum += delta;
            if (delta > 32) different++;
          }
        return { name: node.name, ratio: different / count, mean: sum / count };
      });
    const previewResults = [];
    for (const preview of rendered.previews) {
      const transformed = await page.evaluate(
        async ({ source, scale }) => {
          const image = new Image();
          image.src = source.referenceImage;
          await image.decode();
          const canvas = window.document.createElement('canvas');
          canvas.width = source.width;
          canvas.height = source.height;
          const context = canvas.getContext('2d')!;
          context.drawImage(image, 0.25, 0.375, source.width * scale, source.height * scale);
          return canvas.toDataURL();
        },
        { source, scale: preview.scale },
      );
      const a = await raw(decode(preview.png)),
        b = await raw(decode(transformed));
      let count = 0,
        different = 0,
        sum = 0;
      for (let y = 2; y < Math.min(source.height - 2, source.height * preview.scale - 2); y++)
        for (let x = 2; x < Math.min(source.width - 2, 366 * preview.scale - 2); x++) {
          const offset = (y * a.info.width + x) * 4;
          const delta = Math.max(
            ...[0, 1, 2].map((channel) =>
              Math.abs(a.data[offset + channel] - b.data[offset + channel]),
            ),
          );
          count++;
          sum += delta;
          if (delta > 32) different++;
        }
      previewResults.push({ scale: preview.scale, ratio: different / count, mean: sum / count });
    }
    await writeFile(`${folder}/reference.png`, decode(source.referenceImage));
    await writeFile(`${folder}/canvas.png`, decode(rendered.original));
    await writeFile(`${folder}/report.json`, JSON.stringify({ results, previewResults }, null, 2));
    expect(
      results.filter((result) => result.ratio > 0.01 || result.mean > 2),
      JSON.stringify(results),
    ).toEqual([]);
    expect(
      previewResults.filter((result) => result.ratio > 0.025 || result.mean > 3),
      JSON.stringify(previewResults),
    ).toEqual([]);
  });
