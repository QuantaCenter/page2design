import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import sharp from 'sharp';
import { flattenDocument, type DesignDocument } from '@quantacenter/page2design';

let server: Server, origin: string;
test.beforeAll(async () => {
  // Reuse Playwright's bundled icon font; no browser or font download.
  const require = createRequire(import.meta.url);
  const assets = path.join(
    path.dirname(require.resolve('playwright-core/package.json')),
    'lib/vite/recorder/assets',
  );
  const filename = (await readdir(assets)).find((name) => name.endsWith('.ttf'))!;
  const font = await readFile(path.join(assets, filename));
  server = createServer((request, response) => {
    const url = new URL(request.url!, 'http://fixture.test');
    const inlineFace = `@font-face{font-family:FixtureIcons;src:url(data:application/vnd.ms-fontobject;base64,RU9U) format('embedded-opentype'),url(data:font/ttf;charset=utf-8;base64,${font.toString('base64')}) format('truetype');font-weight:400;font-style:normal}`;
    if (url.pathname === '/inline-font.css') {
      response.setHeader('Content-Type', 'text/css');
      response.end(inlineFace);
      return;
    }
    if (url.pathname === '/icons.bin') {
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
      });
      response.end(font);
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    if (url.pathname === '/font') {
      const kind = url.searchParams.get('kind');
      const face =
        kind === 'inline'
          ? inlineFace
          : kind === 'cross-origin-inline'
            ? ''
            : "@font-face{font-family:FixtureIcons;src:url('/icons.bin') format('truetype');font-weight:400;font-style:normal}";
      response.end(`<!doctype html><meta charset="utf-8">${kind === 'cross-origin-inline' ? `<link rel="stylesheet" href="${origin.replace('127.0.0.1', 'localhost')}/inline-font.css">` : ''}<style>
        ${face}
        body{margin:0;padding:24px;background:#fff}.icon{display:inline-block;width:60px;height:60px;color:#123e78;font:40px/60px FixtureIcons}
        #pseudo::before{content:'\\ea76'}
      </style><span id="direct" class="icon">&#xea60;</span><span id="pseudo" class="icon"></span>`);
      return;
    }
    if (url.pathname === '/frames') {
      const child = origin.replace('127.0.0.1', 'localhost');
      response.end(`<!doctype html><style>
        body{margin:0;padding:24px;background:#eef2f7}.root{overflow:auto;min-height:1600px}
        .banner{width:300px;height:120px;overflow:hidden;border-radius:12px}
        .card{position:relative;width:180px;height:110px;margin-top:24px;overflow:hidden;border-radius:8px}
        .card>div{position:absolute;inset:0}
        iframe{display:block;width:100%;height:180px;border:0}
      </style><div class="root"><div class="banner"><iframe id="banner-frame" src="${child}/frame?color=2a9d8f"></iframe></div>
        <div class="card"><div><iframe id="card-frame" src="${child}/frame?color=cc527a"></iframe></div></div></div>`);
      return;
    }
    if (url.pathname === '/frame') {
      const color = url.searchParams.get('color') || '2a9d8f';
      response.end(`<!doctype html><style>body{margin:0}img{display:block;width:100%;height:120px}</style>
        <img src='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="300" height="120"%3E%3Crect width="300" height="120" fill="%23${color}"/%3E%3C/svg%3E'>`);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server failed.');
  origin = `http://127.0.0.1:${address.port}`;
});

for (const width of [390, 1440])
  test(`cross-origin banner and card frames retain pixels in a long page at ${width}px`, async ({
    request,
    page,
  }) => {
    const response = await request.post('/api/convert', {
      data: { url: origin + '/frames', width, height: 844, fullPage: true },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const source = (await response.json()) as DesignDocument;
    await page.goto('/');
    const result = await page.evaluate(
      async ({ source, flat }) => {
        const module = '/tests/fixtures/core-api.ts';
        const { loadDocumentResources, renderToCanvas, CanvasRenderer } = await import(module);
        const resources = await loadDocumentResources(source);
        try {
          const renderer = new CanvasRenderer(flat, resources),
            preview = document.createElement('canvas');
          renderer.render(preview, { width: source.width, height: 600 });
          renderer.dispose();
          return {
            hierarchical: renderToCanvas(source, resources).toDataURL(),
            flat: renderToCanvas(flat, resources).toDataURL(),
            preview: preview.toDataURL(),
            errors: resources.errors,
          };
        } finally {
          resources.dispose();
        }
      },
      { source, flat: flattenDocument(source) },
    );
    expect(result.errors).toEqual([]);
    const reference = await sharp(Buffer.from(source.referenceImage.split(',')[1], 'base64'))
      .ensureAlpha()
      .raw()
      .toBuffer();
    for (const name of ['banner-frame', 'card-frame']) {
      const node = source.nodes.find((node) => node.name === name)!;
      expect(node.kind).toBe('raster');
      const asset = source.assets.find((asset) => asset.id === node.assetId)!;
      const stats = await sharp(Buffer.from(asset.dataUrl.split(',')[1], 'base64')).stats();
      expect(stats.channels[3].max, name + ' has visible pixels').toBe(255);
      for (const kind of ['hierarchical', 'flat', 'preview'] as const) {
        const actual = await sharp(Buffer.from(result[kind].split(',')[1], 'base64'))
          .ensureAlpha()
          .raw()
          .toBuffer();
        let different = 0;
        for (let y = Math.ceil(node.box.y); y < Math.floor(node.box.y + 110); y++)
          for (let x = Math.ceil(node.box.x); x < Math.floor(node.box.x + node.box.width); x++) {
            const offset = (y * source.width + x) * 4;
            if (
              [0, 1, 2].some(
                (channel) => Math.abs(reference[offset + channel] - actual[offset + channel]) > 32,
              )
            )
              different++;
          }
        expect(different / (node.box.width * 110), kind + ' ' + name).toBeLessThan(0.015);
      }
    }
  });
test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

for (const kind of ['binary', 'inline', 'cross-origin-inline'])
  test(`icon fonts from ${kind} sources render native text and pseudo glyphs`, async ({
    request,
    page,
  }) => {
    const response = await request.post('/api/convert', {
      data: { url: origin + '/font?kind=' + kind, width: 390, height: 844, fullPage: false },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const source = (await response.json()) as DesignDocument;
    expect(source.fonts.some((font) => font.family === 'FixtureIcons')).toBe(true);
    expect(source.warnings.filter((warning) => warning.code === 'FONT_MISSING')).toEqual([]);
    expect(
      source.nodes.some((node) => node.kind === 'text' && node.pseudoElement === '::before'),
    ).toBe(true);
    await page.goto('/');
    const result = await page.evaluate(async (source) => {
      const module = '/tests/fixtures/core-api.ts';
      const { loadDocumentResources, renderToCanvas } = await import(module);
      const resources = await loadDocumentResources(source);
      try {
        return { png: renderToCanvas(source, resources).toDataURL(), errors: resources.errors };
      } finally {
        resources.dispose();
      }
    }, flattenDocument(source));
    expect(result.errors).toEqual([]);
    const reference = await sharp(Buffer.from(source.referenceImage.split(',')[1], 'base64'))
      .ensureAlpha()
      .raw()
      .toBuffer();
    const actual = await sharp(Buffer.from(result.png.split(',')[1], 'base64'))
      .ensureAlpha()
      .raw()
      .toBuffer();
    for (const left of [24, 84]) {
      let different = 0,
        ink = 0;
      for (let y = 24; y < 84; y++)
        for (let x = left; x < left + 60; x++) {
          const offset = (y * 390 + x) * 4;
          if (reference[offset] < 220) ink++;
          if (
            [0, 1, 2].some(
              (channel) => Math.abs(reference[offset + channel] - actual[offset + channel]) > 32,
            )
          )
            different++;
        }
      expect(ink).toBeGreaterThan(40);
      expect(different / 3600).toBeLessThan(0.015);
    }
  });
