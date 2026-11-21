import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { flattenDocument, type DesignDocument } from '@quantacenter/page2design';

for (const width of [390, 1440])
  for (const fixedOnly of [false, true])
    test(`fixed and local backgrounds stay native at ${width}px (${fixedOnly ? 'viewport' : 'long page'})`, async ({
      page,
      request,
      baseURL,
    }) => {
      test.setTimeout(90000);
      const response = await request.post('/api/convert', {
        data: {
          url: `${baseURL}/tests/fixtures/native-attachments.html${fixedOnly ? '?fixed-only' : ''}`,
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
      expect(source.nodes.filter((n) => n.name.startsWith('case-'))).toHaveLength(
        fixedOnly ? 15 : 31,
      );
      const fixed = source.nodes.find((n) => n.name === 'fixed-percent')!.backgroundLayers![0];
      expect(fixed.box).toEqual({ x: 0, y: 0, width, height: 844 });
      for (const name of fixedOnly
        ? []
        : ['local-vertical', 'local-both', 'local-color', 'local-bottom']) {
        const node = source.nodes.find((n) => n.name === name)!;
        expect(node.children.length).toBeGreaterThan(0);
        expect(node.backgroundLayers![0].scrollClip, name).toBeTruthy();
        expect(node.backgroundLayers![0].box.height, name).toBeGreaterThan(node.box.height);
      }
      if (!fixedOnly) {
        const owner = source.nodes.find((n) => n.name === 'local-pseudo')!;
        const pseudo = source.nodes.find(
          (n) => n.parentId === owner.id && n.pseudoElement && n.kind !== 'text',
        )!;
        expect(pseudo.backgroundLayers![0].scrollClip).toBeTruthy();
        expect(pseudo.backgroundLayers![0].box.width).toBeGreaterThan(pseudo.box.width);
        expect(
          source.nodes.find((n) => n.name === 'local-clip')!.backgroundLayers![0].scrollClip,
        ).toBeUndefined();
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
              const reference = document.createElement('canvas');
              reference.width = canvas.width;
              reference.height = canvas.height;
              reference
                .getContext('2d')!
                .drawImage(
                  resources.reference!,
                  0.25,
                  0.375,
                  source.width * scale,
                  source.height * scale,
                );
              previews.push({ scale, png: canvas.toDataURL(), reference: reference.toDataURL() });
            }
            renderer.dispose();
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
      expect(painted.flat === painted.original, 'flat and hierarchical exports match').toBe(true);
      const decode = (url: string) => Buffer.from(url.split(',')[1], 'base64');
      const raw = (url: string) =>
        sharp(decode(url)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const comparisons = [
        { scale: 1, png: painted.original, reference: source.referenceImage, offset: false },
        ...painted.previews.map((p) => ({ ...p, offset: true })),
      ];
      const results = [];
      for (const comparison of comparisons) {
        const [a, b] = await Promise.all([raw(comparison.png), raw(comparison.reference)]);
        for (const n of source.nodes.filter((n) => n.name.startsWith('case-'))) {
          let count = 0,
            different = 0,
            sum = 0,
            rawDifferent = 0,
            rawSum = 0;
          const s = comparison.scale,
            dx = comparison.offset ? 0.25 : 0,
            dy = comparison.offset ? 0.375 : 0;
          for (
            let y = Math.ceil(n.box.y * s + dy) + 1;
            y < Math.floor((n.box.y + n.box.height) * s + dy) - 1;
            y++
          )
            for (
              let x = Math.ceil(n.box.x * s + dx) + 1;
              x < Math.floor((n.box.x + n.box.width) * s + dx) - 1;
              x++
            ) {
              const o = (y * a.info.width + x) * 4;
              const rawDifference = Math.max(
                ...[0, 1, 2].map((i) => Math.abs(a.data[o + i] - b.data[o + i])),
              );
              let d = rawDifference;
              // Previewing native vectors/bitmaps and resampling a 1x screenshot
              // have different AA kernels. Allow one physical pixel of sampling
              // tolerance in both directions; exports use direct pixel comparison.
              if (comparison.offset) {
                let forward = d,
                  reverse = d;
                for (let sy = -1; sy <= 1; sy++)
                  for (let sx = -1; sx <= 1; sx++) {
                    const neighbor = ((y + sy) * a.info.width + x + sx) * 4;
                    forward = Math.min(
                      forward,
                      Math.max(
                        ...[0, 1, 2].map((i) => Math.abs(a.data[o + i] - b.data[neighbor + i])),
                      ),
                    );
                    reverse = Math.min(
                      reverse,
                      Math.max(
                        ...[0, 1, 2].map((i) => Math.abs(b.data[o + i] - a.data[neighbor + i])),
                      ),
                    );
                  }
                d = Math.max(forward, reverse);
              }
              count++;
              sum += d;
              if (d > 32) different++;
              rawSum += rawDifference;
              if (rawDifference > 32) rawDifferent++;
            }
          const bitmap = source.nodes.some(
            (child) =>
              child.parentId === n.id && child.backgroundLayers?.some((layer) => layer.assetId),
          );
          results.push({
            name: n.name,
            scale: s,
            preview: comparison.offset,
            ratio: different / count,
            mean: sum / count,
            rawRatio: rawDifferent / count,
            rawMean: rawSum / count,
            // Account for the higher proportion of edge AA in narrow cards,
            // bounded by one physical pixel around their perimeter. The strict
            // mean still catches incorrect colour, positioning or lost paint.
            ratioLimit: comparison.offset
              ? bitmap
                ? 0.04
                : 0.025
              : Math.max(0.01, (2 * (n.box.width + n.box.height)) / (n.box.width * n.box.height)),
            // Native bitmap minification retains details absent in a resized
            // screenshot. The export still uses the strict per-pixel gate.
            meanLimit: comparison.offset && bitmap ? 6 : comparison.offset ? 3 : 2,
          });
        }
      }
      const folder = `artifacts/native-attachments/${width}${fixedOnly ? '-viewport' : ''}`;
      await mkdir(folder, { recursive: true });
      await writeFile(folder + '/reference.png', decode(source.referenceImage));
      await writeFile(folder + '/canvas.png', decode(painted.original));
      await writeFile(folder + '/report.json', JSON.stringify(results, null, 2));
      await writeFile(folder + '/document.json', JSON.stringify(source));
      expect(results.filter((r) => r.ratio > r.ratioLimit || r.mean > r.meanLimit)).toEqual([]);
    });
