import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import type { DesignDocument } from '@quantacenter/page2design';

for (const width of [390, 1440])
  for (const fullPage of [false, true])
    test(`missing images and off-artboard fallbacks convert at ${width}px, fullPage=${fullPage}`, async ({
      request,
      page,
      baseURL,
    }) => {
      const response = await request.post('/api/convert', {
        data: {
          url: `${baseURL}/tests/fixtures/missing-assets.html`,
          width,
          height: 844,
          fullPage,
        },
        timeout: 75000,
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      const source = (await response.json()) as DesignDocument;
      const node = (name: string) => source.nodes.find((node) => node.name === name)!;
      const assetIds = new Set(source.assets.map((asset) => asset.id));
      expect(
        source.nodes.filter(
          (node) =>
            ['image', 'svg', 'raster'].includes(node.kind) &&
            (!node.assetId || !assetIds.has(node.assetId)),
        ),
      ).toEqual([]);
      const image = source.nodes.find(
        (node) => node.tag === 'img' && node.assetUrl?.endsWith('/visual-assets/pattern.png'),
      )!;
      expect(image.kind).toBe('image');
      expect(image.assetId).toBeTruthy();
      for (const name of [
        'outside-empty-image',
        'fractional-zero-image',
        'outside-frame',
        'outside-background',
      ]) {
        expect(node(name).kind, name).toBe('frame');
        expect(node(name).hasVisual, name).toBe(false);
        expect(node(name).assetId, name).toBeUndefined();
        expect(source.warnings.filter((warning) => warning.nodeId === node(name).id)).toEqual([]);
      }
      const parent = node('outside-background'),
        child = node('visible-overflow-child');
      expect(parent.children).toContain(child.id);
      expect(child.parentId).toBe(parent.id);
      expect(child.hasVisual).toBe(true);
      expect(child.box.x).toBeLessThan(width);
      expect(node('zero-clip').clipPath).toBeTruthy();
      for (const name of ['zero-mask', 'failed-mask']) {
        expect(node(name).kind).toBe('frame');
        expect(node(name).maskLayers![0].image).toBe('none');
        expect(node(name).children).toContain(node(name + '-child').id);
        expect(
          source.warnings.some(
            (warning) => warning.code === 'MASK_IMAGE_FAILED' && warning.nodeId === node(name).id,
          ),
        ).toBe(true);
      }
      expect(source.warnings.filter((warning) => warning.code === 'MASK_FALLBACK')).toEqual([]);
      const missing = source.nodes.filter((node) => node.tag === 'img' && node.kind === 'raster');
      expect(missing.length).toBe(fullPage ? 4 : 3);
      expect(missing.every((node) => node.assetId)).toBe(true);
      const empty = node('Empty source');
      expect(empty.kind).toBe('raster');
      expect(source.assets.find((asset) => asset.id === empty.assetId)?.mime).toBe('image/png');
      expect(node('Below fold').kind).toBe(fullPage ? 'raster' : 'frame');
      await page.goto('/');
      const painted = await page.evaluate(async (source) => {
        const module = '/tests/fixtures/core-api.ts';
        const { loadDocumentResources, renderToCanvas } = await import(module);
        const resources = await loadDocumentResources(source);
        try {
          return { png: renderToCanvas(source, resources).toDataURL(), errors: resources.errors };
        } finally {
          resources.dispose();
        }
      }, source);
      expect(painted.errors).toEqual([]);
      const actual = await sharp(Buffer.from(painted.png.split(',')[1], 'base64'))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const reference = await sharp(Buffer.from(source.referenceImage.split(',')[1], 'base64'))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let different = 0,
        count = 0;
      for (let y = 20; y < 460; y++)
        for (let x = 20; x < 330; x++) {
          const offset = (y * width + x) * 4;
          if (
            Math.max(
              ...[0, 1, 2].map((k) =>
                Math.abs(actual.data[offset + k] - reference.data[offset + k]),
              ),
            ) > 32
          )
            different++;
          count++;
        }
      expect(different / count).toBeLessThan(0.01);
    });
