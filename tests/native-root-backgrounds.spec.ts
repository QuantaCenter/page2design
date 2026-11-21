import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { flattenDocument, type DesignDocument } from '@quantacenter/page2design';

const cases = [
  'root-fixed',
  'body-fixed',
  'root-local',
  'body-local',
  'root-scroll',
  'body-scroll',
  'root-alpha',
  'body-alpha',
  'root-filter',
  'root-opacity',
  'root-transform',
  'root-3d-affine',
  'root-3d-perspective',
  'root-transform-filter',
  'root-clip',
  'root-mask',
  'root-mask-color',
  'root-mask-perspective',
  'root-mask-perspective-center',
  'root-mask-perspective-x',
  'root-mask-3d-affine',
  'root-3d-opacity',
  'root-3d-filter',
  'root-contain',
  'body-contain',
  'two-backgrounds',
  'body-hidden',
  'root-hidden',
  'body-none',
  'root-text-clip',
  'body-text-clip',
  'root-shadow',
  'root-round',
  'root-blur',
  'root-blend',
  'body-blend',
  'root-blend-mask',
];
for (const width of [390, 1440])
  for (const name of cases)
    test(`document canvas background ${name} stays native at ${width}px`, async ({
      page,
      request,
      baseURL,
    }) => {
      test.setTimeout(90000);
      const url = `${baseURL}/tests/fixtures/native-root-backgrounds.html?case=${name}`;
      await page.setViewportSize({ width, height: 844 });
      await page.goto(url);
      const actualHeight = await page.evaluate(() =>
        Math.max(innerHeight, (document.scrollingElement || document.documentElement).scrollHeight),
      );
      const response = await request.post('/api/convert', {
        data: {
          url,
          width,
          height: 844,
          fullPage: true,
        },
        timeout: 75000,
      });
      expect(response.ok(), await response.text()).toBe(true);
      const source = (await response.json()) as DesignDocument;
      expect(source.height, 'artboard matches the source scrolling viewport').toBe(actualHeight);
      expect(
        source.nodes
          .filter((n) => n.kind === 'raster')
          .map((n) => ({ name: n.name, reason: n.fallbackReason })),
      ).toEqual([]);
      expect(source.assets.filter((a) => a.url?.startsWith('capture:'))).toEqual([]);
      const canvas = source.nodes.find((n) => n.canvasBackground);
      if (['root-contain', 'body-contain', 'body-none'].includes(name))
        expect(canvas).toBeUndefined();
      else {
        expect(canvas, name + ' separate canvas paint').toBeTruthy();
        if (
          [
            'root-mask-perspective',
            'root-mask-perspective-center',
            'root-mask-perspective-x',
            'root-3d-opacity',
            'root-3d-filter',
          ].includes(name)
        )
          expect(canvas!.transform).toBeTruthy();
        else expect(canvas!.transform).toBeUndefined();
        expect(canvas!.canvasBackground!.source).toBe(
          name.startsWith('body') ||
            [
              'root-filter',
              'root-opacity',
              'root-transform',
              'root-3d-affine',
              'root-3d-perspective',
              'root-transform-filter',
              'root-clip',
              'root-mask',
              'root-mask-color',
              'root-mask-perspective',
              'root-mask-perspective-center',
              'root-mask-perspective-x',
              'root-mask-3d-affine',
              'root-3d-opacity',
              'root-3d-filter',
            ].includes(name)
            ? 'body'
            : 'html',
        );
        const owner = source.nodes.find((n) => n.id === canvas!.parentId)!;
        expect(owner.skipBoxBackground).toBe(true);
        expect(canvas!.paintOrder).toBeLessThan(owner.paintOrder);
      }
      await page.goto('/');
      const painted = await page.evaluate(
        async ({ source, flat }) => {
          const module = '/tests/fixtures/core-api.ts';
          const { loadDocumentResources, renderToCanvas, CanvasRenderer } = await import(module);
          const resources = await loadDocumentResources(source);
          try {
            const renderer = new CanvasRenderer(flat, resources),
              previews = [];
            for (const scale of [0.5, 1, 2]) {
              const canvas = document.createElement('canvas');
              renderer.render(canvas, {
                width: source.width * scale + 2,
                height: source.height * scale + 2,
                camera: { x: 0.25, y: 0.375, scale },
              });
              const png = canvas.toDataURL();
              const reference = document.createElement('canvas');
              renderer.render(reference, {
                width: source.width * scale + 2,
                height: source.height * scale + 2,
                camera: { x: 0.25, y: 0.375, scale },
                referenceView: true,
              });
              previews.push({ scale, png, reference: reference.toDataURL() });
            }
            const foreground = flat.nodes.find((n) => n.name === 'front');
            const reference1x = document.createElement('canvas');
            renderer.render(reference1x, {
              width: source.width,
              height: source.height,
              referenceView: true,
            });
            const referencePng = reference1x.toDataURL();
            const hit = foreground
              ? renderer.hitTest({
                  x: foreground.box.x + foreground.box.width / 2,
                  y: foreground.box.y + foreground.box.height / 2,
                })?.id
              : undefined;
            renderer.dispose();
            return {
              png: renderToCanvas(source, resources).toDataURL(),
              flat: renderToCanvas(flat, resources).toDataURL(),
              previews,
              errors: resources.errors,
              hit,
              reference1x: referencePng,
            };
          } finally {
            resources.dispose();
          }
        },
        { source, flat: flattenDocument(source) },
      );
      expect(painted.errors).toEqual([]);
      expect(painted.flat === painted.png, 'flat/hierarchy equality').toBe(true);
      if (
        ![
          'body-hidden',
          'root-hidden',
          'body-none',
          'root-clip',
          'root-mask',
          'root-mask-color',
          'root-mask-perspective',
          'body-contain',
        ].includes(name)
      )
        expect(painted.hit).toBeTruthy();
      expect(painted.hit).not.toBe(canvas?.id || 'nonexistent-canvas-node');
      const decode = (url: string) => Buffer.from(url.split(',')[1], 'base64');
      const raw = (url: string) =>
        sharp(decode(url)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const [referencePixels, originalPixels] = await Promise.all([
        raw(painted.reference1x),
        raw(source.referenceImage),
      ]);
      expect(
        referencePixels.data.equals(originalPixels.data),
        'reference sampling preserves every original pixel at 1x',
      ).toBe(true);
      const comparisons = [
        { scale: 1, png: painted.png, reference: source.referenceImage, preview: false },
        ...painted.previews.map((p) => ({ ...p, preview: true })),
      ];
      const results = [];
      for (const c of comparisons) {
        const [a, b] = await Promise.all([raw(c.png), raw(c.reference)]);
        const delta = (ai: number, bi: number) =>
          Math.max(
            Math.abs(a.data[ai] - b.data[bi]),
            Math.abs(a.data[ai + 1] - b.data[bi + 1]),
            Math.abs(a.data[ai + 2] - b.data[bi + 2]),
          );
        let count = 0,
          sum = 0,
          different = 0,
          rawSum = 0,
          rawDifferent = 0;
        for (let y = 0; y < Math.floor(source.height * c.scale); y++)
          for (let x = 0; x < Math.floor(source.width * c.scale); x++) {
            const o = (y * a.info.width + x) * 4;
            const rawDelta = delta(o, o);
            let d = rawDelta;
            if (c.preview && x > 0 && y > 0) {
              let forward = d,
                reverse = d;
              for (let sy = -1; sy <= 1; sy++)
                for (let sx = -1; sx <= 1; sx++) {
                  const offset = ((y + sy) * a.info.width + x + sx) * 4;
                  forward = Math.min(forward, delta(o, offset));
                  reverse = Math.min(reverse, delta(offset, o));
                }
              d = Math.max(forward, reverse);
            }
            count++;
            sum += d;
            rawSum += rawDelta;
            if (d > 32) different++;
            if (rawDelta > 32) rawDifferent++;
          }
        results.push({
          scale: c.scale,
          preview: c.preview,
          ratio: different / count,
          mean: sum / count,
          rawRatio: rawDifferent / count,
          rawMean: rawSum / count,
        });
      }
      const folder = `artifacts/native-root-backgrounds/${width}/${name}`;
      await mkdir(folder, { recursive: true });
      await writeFile(folder + '/report.json', JSON.stringify(results, null, 2));
      await writeFile(folder + '/document.json', JSON.stringify(source));
      await writeFile(folder + '/reference.png', decode(source.referenceImage));
      await writeFile(folder + '/canvas.png', decode(painted.png));
      expect(
        results.filter((r) => r.ratio > (r.preview ? 0.04 : 0.01) || r.mean > (r.preview ? 6 : 2)),
      ).toEqual([]);
    });
