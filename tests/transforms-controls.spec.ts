import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { flattenDocument, projectPoint, type DesignDocument } from '@quantacenter/page2design';

for (const width of [390, 1440])
  test(`native transforms and live form states at ${width}px`, async ({
    page,
    request,
    baseURL,
  }) => {
    const response = await request.post('/api/convert', {
      data: {
        url: `${baseURL}/tests/fixtures/transforms-controls.html`,
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
      'rotated-box',
      'origin-box',
      'nested-box',
      'nested-child',
      'individual-box',
      'mirrored-box',
      'perspective-box',
    ]) {
      expect(node(name).kind, name).toBe('frame');
      expect(node(name).transform, name).toHaveLength(9);
      expect(node(name).fallbackReason, name).toBeUndefined();
    }
    expect(source.nodes.some((node) => node.pseudoElement && node.transform)).toBeTruthy();
    expect(source.stats.rasterNodes).toBe(0);
    expect(source.assets.filter((asset) => asset.url?.startsWith('capture:'))).toEqual([]);
    for (const name of [
      'current-input',
      'placeholder-input',
      'disabled-input',
      'readonly-input',
      'password-input',
      'current-textarea',
      'current-select',
      'list-select',
      'range-input',
      'progress-control',
      'meter-control',
      'date-input',
      'color-input',
    ])
      expect(node(name).kind, name).toBe('control');
    expect(node('current-input').control?.value).toBe('Current value');
    expect(node('current-select').control?.value).toBe('Selected label');
    expect(node('checked').control?.checked).toBe(true);
    expect(node('unchecked').control?.checked).toBe(false);
    expect(node('indeterminate').control?.indeterminate).toBe(true);
    expect(node('disabled-input').control?.disabled).toBe(true);
    expect(node('readonly-input').control?.readOnly).toBe(true);
    expect(JSON.stringify(source)).not.toContain('secret123');
    expect(node('current-textarea').control?.textRuns!.length).toBeGreaterThan(2);
    await page.goto('/');
    const flat = flattenDocument(source);
    const rotated = node('rotated-box'),
      inside = projectPoint(rotated.transform!, {
        x: rotated.localBox!.x + 20,
        y: rotated.localBox!.y + 70,
      });
    const clipped = node('clipped-child'),
      outsideClip = projectPoint(clipped.transform!, {
        x: clipped.localBox!.x + 80,
        y: clipped.localBox!.y + 30,
      });
    const result = await page.evaluate(
      async ({ source, flat, inside, outsideClip }) => {
        const module = '/tests/fixtures/core-api.ts';
        const { loadDocumentResources, renderToCanvas, paintDocument, CanvasRenderer } =
          await import(module);
        const resources = await loadDocumentResources(source);
        const renderer = new CanvasRenderer(flat, resources);
        try {
          const original = renderToCanvas(source, resources).toDataURL(),
            flattened = renderToCanvas(flat, resources).toDataURL();
          const rotated = source.nodes.find((node) => node.name === 'rotated-box')!;
          const hit = renderer.hitTest(inside)?.id,
            outside = renderer.hitTest({ x: rotated.box.x + 1, y: rotated.box.y + 1 })?.id,
            clipHit = renderer.hitTest(outsideClip)?.id;
          const previews = [];
          for (const name of ['perspective-box', 'transformed-clip', 'transformed-input'])
            for (const scale of [0.5, 1, 2]) {
              const target = source.nodes.find((node) => node.name === name)!,
                width = Math.min(600, source.width),
                height = 220;
              const camera = {
                x: width / 2 - (target.box.x + target.box.width / 2) * scale + 0.25,
                y: height / 2 - (target.box.y + target.box.height / 2) * scale + 0.375,
                scale,
              };
              const canvas = document.createElement('canvas');
              renderer.render(canvas, { width, height, camera });
              const expected = document.createElement('canvas');
              expected.width = width;
              expected.height = height;
              const direct = expected.getContext('2d')!;
              direct.setTransform(scale, 0, 0, scale, camera.x, camera.y);
              paintDocument(direct, flat, resources.images);
              const a = canvas.getContext('2d')!.getImageData(0, 0, width, height).data,
                b = expected.getContext('2d')!.getImageData(0, 0, width, height).data;
              let different = 0,
                sum = 0;
              for (let i = 0; i < a.length; i += 4) {
                const delta = Math.max(
                  ...[0, 1, 2].map((channel) => Math.abs(a[i + channel] - b[i + channel])),
                );
                sum += delta;
                if (delta > 32) different++;
              }
              previews.push({
                name,
                scale,
                png: canvas.toDataURL(),
                ratio: different / (width * height),
                mean: sum / (width * height),
              });
            }
          return { original, flattened, hit, outside, clipHit, previews, errors: resources.errors };
        } finally {
          renderer.dispose();
          resources.dispose();
        }
      },
      { source, flat, inside, outsideClip },
    );
    expect(result.errors).toEqual([]);
    expect(result.original).toEqual(result.flattened);
    expect(result.hit).toBe(rotated.id);
    expect(result.outside).not.toBe(rotated.id);
    expect(result.clipHit).not.toBe(clipped.id);
    const decode = (url: string) => Buffer.from(url.split(',')[1], 'base64');
    const actual = await sharp(decode(result.original))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const expected = await sharp(decode(source.referenceImage))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const results = source.nodes
      .filter((node) => node.name.startsWith('case-'))
      .map((node) => {
        let count = 0,
          different = 0,
          sum = 0;
        for (let y = Math.floor(node.box.y); y < Math.ceil(node.box.y + node.box.height); y++)
          for (let x = Math.floor(node.box.x); x < Math.ceil(node.box.x + node.box.width); x++) {
            const offset = (y * source.width + x) * 4,
              delta = Math.max(
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
    const folder = `artifacts/transforms-controls/${width}`;
    await mkdir(folder, { recursive: true });
    await writeFile(`${folder}/canvas.png`, decode(result.original));
    await writeFile(`${folder}/reference.png`, decode(source.referenceImage));
    await writeFile(`${folder}/design.json`, JSON.stringify(source));
    await writeFile(
      `${folder}/report.json`,
      JSON.stringify(
        { results, previews: result.previews.map(({ png: _png, ...metrics }) => metrics) },
        null,
        2,
      ),
    );
    for (const preview of result.previews)
      await writeFile(
        `${folder}/preview-${preview.name}-${preview.scale}.png`,
        decode(preview.png),
      );
    expect(
      results.filter((result) => result.ratio > 0.01 || result.mean > 2),
      JSON.stringify(results),
    ).toEqual([]);
    expect(
      result.previews
        .filter((result) => result.ratio > 0.03 || result.mean > 3)
        .map(({ png: _png, ...metrics }) => metrics),
    ).toEqual([]);
    if (width === 390) {
      await page.route('**/api/convert', (route) => route.fulfill({ json: source }));
      await page
        .getByRole('textbox', { name: 'H5 页面 URL' })
        .fill(`${baseURL}/tests/fixtures/transforms-controls.html`);
      await page.getByRole('button', { name: '转换为设计图' }).click();
      await expect(page.getByText('原生 Canvas 图层', { exact: true })).toBeVisible();
      await page.getByTestId(`layer-${rotated.id}`).dblclick();
      await page.getByRole('combobox', { name: '缩放比例' }).selectOption('100');
      const canvas = page.getByTestId('design-canvas');
      await canvas.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const bounds = (await canvas.boundingBox())!,
        camera = JSON.parse((await canvas.getAttribute('data-camera'))!);
      await page.mouse.click(
        bounds.x + camera.x + inside.x * camera.scale,
        bounds.y + camera.y + inside.y * camera.scale,
      );
      await expect(page.getByTestId(`layer-${rotated.id}`)).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(page.getByTestId('transform-info')).toContainText('二维矩阵');
      await page.getByTestId(`layer-${node('current-input').id}`).click();
      await expect(page.getByTestId('control-info')).toContainText('Current value');
    }
  });
