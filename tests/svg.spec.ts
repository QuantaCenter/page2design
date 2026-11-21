import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { DesignDocument } from '@page-to-design/core';

test('DOM-created and qualified SVG namespaces survive capture without aborting the page', async ({
  page,
  baseURL,
}) => {
  const folder = 'artifacts/svg-namespaces';
  await mkdir(folder, { recursive: true });
  const url = `${baseURL}/tests/fixtures/svg-namespace.html`;
  await page.goto(url);
  const declarations = await page.locator('#runtime-svg').evaluate((element) =>
    Array.from(element.attributes)
      .filter((attribute) => ['xmlns', 'xmlns:xlink', 'xml:space'].includes(attribute.name))
      .map((attribute) => ({ name: attribute.name, namespace: attribute.namespaceURI })),
  );
  expect(declarations).toHaveLength(3);
  expect(declarations.every((attribute) => attribute.namespace === null)).toBeTruthy();
  await page.goto('/');
  await page.getByRole('textbox', { name: 'H5 页面 URL' }).fill(url);
  const converting = page.waitForResponse(
    (response) => response.url().includes('/api/convert') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '转换为设计图' }).click();
  const response = await converting;
  expect(response.ok(), await response.text()).toBeTruthy();
  const source = (await response.json()) as DesignDocument;
  await expect(page.getByText('原生 Canvas 图层', { exact: true })).toBeVisible();
  const vectors = source.nodes.filter((node) =>
    ['runtime-svg', 'qualified-svg', 'image-svg'].includes(node.name),
  );
  expect(vectors).toHaveLength(3);
  expect(vectors.every((node) => node.kind === 'svg' && node.assetId)).toBeTruthy();
  const parsed = await page.evaluate(
    (sources) =>
      sources.map((source) => {
        const svg = new DOMParser().parseFromString(source!, 'image/svg+xml');
        const image = svg.querySelector('image');
        return {
          valid: !svg.querySelector('parsererror'),
          namespace: svg.documentElement.namespaceURI,
          imageHrefs: image
            ? Array.from(image.attributes)
                .filter((attribute) => attribute.localName === 'href')
                .map((attribute) => attribute.value)
            : [],
        };
      }),
    vectors.map((node) => node.svgSource),
  );
  expect(
    parsed.every((svg) => svg.valid && svg.namespace === 'http://www.w3.org/2000/svg'),
  ).toBeTruthy();
  const imageHrefs = parsed.flatMap((svg) => svg.imageHrefs);
  expect(imageHrefs).toHaveLength(2);
  expect(imageHrefs.every((value) => value.startsWith('data:image/png;base64,'))).toBeTruthy();
  const fallback = source.nodes.find((node) => node.name === 'framework-svg')!;
  expect(fallback.kind).toBe('raster');
  expect(fallback.fallbackReason).toContain('SVG');
  expect(
    source.nodes.some((node) => node.text?.includes('Content after the SVGs remains available.')),
  ).toBeTruthy();
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Canvas 图片' }).click();
  const native = await readFile((await (await downloading).path())!);
  const reference = Buffer.from(source.referenceImage.split(',')[1], 'base64');
  await writeFile(`${folder}/canvas.png`, native);
  await writeFile(`${folder}/reference.png`, reference);
  const raw = async (input: Buffer) =>
    sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const expected = await raw(reference);
  const actual = await raw(native);
  expect(actual.info).toEqual(expected.info);
  for (const node of [...vectors, fallback]) {
    let different = 0;
    let count = 0;
    for (let y = Math.ceil(node.box.y); y < Math.floor(node.box.y + node.box.height); y++)
      for (let x = Math.ceil(node.box.x); x < Math.floor(node.box.x + node.box.width); x++) {
        const offset = (y * source.width + x) * 4;
        const delta = Math.max(
          ...[0, 1, 2].map((channel) =>
            Math.abs(expected.data[offset + channel] - actual.data[offset + channel]),
          ),
        );
        if (delta > 32) different++;
        count++;
      }
    expect(different / count, node.name).toBeLessThan(0.005);
  }
  await writeFile(
    `${folder}/report.json`,
    JSON.stringify(
      {
        declarations,
        parsed: parsed.map((svg) => ({
          ...svg,
          imageHrefs: svg.imageHrefs.map((value) => value.slice(0, 22)),
        })),
        nativeSvgNodes: vectors.length,
        fallback: { kind: fallback.kind, reason: fallback.fallbackReason },
        stats: source.stats,
      },
      null,
      2,
    ),
  );
});
