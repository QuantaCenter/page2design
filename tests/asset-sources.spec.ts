import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import sharp from 'sharp';
import { flattenDocument, type DesignDocument } from '@page-to-design/core';

let server: Server, origin: string;
test.beforeAll(async () => {
  const require = createRequire(import.meta.url),
    directory = path.join(
      path.dirname(require.resolve('playwright-core/package.json')),
      'lib/vite/recorder/assets',
    ),
    font = await readFile(
      path.join(
        directory,
        (await readdir(directory)).find((name) => name.endsWith('.ttf'))!,
      ),
    );
  const png = await sharp({
      create: { width: 112, height: 64, channels: 4, background: '#267a96' },
    })
      .png()
      .toBuffer(),
    logo = await sharp(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 512 512"><rect width="512" height="512" fill="#78b328"/><text x="256" y="266" text-anchor="middle" font-family="Arial" font-size="64" fill="white">Code Icon</text><path d="M75 300L437 300" stroke="white" stroke-width="7"/></svg>',
      ),
    )
      .png()
      .toBuffer(),
    mask = await sharp(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="112" height="64"><circle cx="56" cy="32" r="28" fill="white"/></svg>',
      ),
    )
      .png()
      .toBuffer(),
    sprite =
      '<svg xmlns="http://www.w3.org/2000/svg" width="224" height="64" viewBox="0 0 224 64"><view id="left" viewBox="0 0 112 64"/><view id="right" viewBox="112 0 112 64"/><path fill="#c44767" d="M0 0H112V64H0Z"/><path fill="#36a271" d="M112 0H224V64H112Z"/></svg>',
    percent = [...png].map((byte) => '%' + byte.toString(16).padStart(2, '0')).join('');
  server = createServer((request, response) => {
    const url = new URL(request.url!, 'http://fixture.test');
    if (url.pathname === '/redirect.bin') {
      response.writeHead(302, { Location: '/sprite.bin' });
      response.end();
      return;
    }
    const body =
      url.pathname === '/logo.png'
        ? logo
        : url.pathname === '/sprite.bin'
          ? sprite
          : url.pathname === '/font.bin'
            ? font
            : url.pathname === '/mask.bin'
              ? mask
              : ['/picture.bin', '/no-mime'].includes(url.pathname)
                ? png
                : undefined;
    if (body) {
      if (url.pathname !== '/no-mime')
        response.setHeader(
          'Content-Type',
          url.pathname === '/sprite.bin'
            ? 'image/svg+xml'
            : url.pathname === '/logo.png'
              ? 'image/png'
              : 'application/octet-stream',
        );
      response.end(body);
      return;
    }
    if (url.pathname !== '/') {
      response.writeHead(404);
      response.end();
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Portable source assets</title><style>
      body{margin:0;padding:20px;background:#eef2f7;font:14px Arial}.gallery{display:grid;grid-template-columns:repeat(auto-fit,128px);gap:16px;max-width:850px}.case{width:128px;height:108px;background:white}.subject{display:block;width:112px;height:64px;margin:8px;background-size:100% 100%;background-repeat:no-repeat}.label{margin:8px;font-size:12px}#blob-mask{background:#9f3e67}#mask-child{display:block;width:70px;height:64px;background:#367aa8}#retained-child{display:block;width:60px;height:36px;background:#367aa8}#failed-background{background:#e2b84f url('/not-an-image')}.icons{margin-top:24px}.icon{display:inline-block;width:60px;height:60px;color:#123e78;font-size:40px;line-height:60px}#blob-pseudo::before{content:'\\ea76'}
    </style><div class="gallery">
      <div class="case"><img id="binary" class="subject" src="/picture.bin"><span class="label">Binary PNG</span></div>
      <div class="case"><img id="no-mime" class="subject" src="/no-mime"><span class="label">No MIME</span></div>
      <div class="case"><img id="redirect" class="subject" src="/redirect.bin#right"><span class="label">Redirect view</span></div>
      <div class="case"><div id="left-view" class="subject" style="background-image:url('/sprite.bin#left')"></div><span class="label">Left SVG view</span></div>
      <div class="case"><div id="right-view" class="subject" style="background-image:url('/sprite.bin#right')"></div><span class="label">Right SVG view</span></div>
      <div class="case"><img id="byte-data" class="subject" src="data:image/png,${percent}"><span class="label">Byte data URL</span></div>
      <div class="case"><img id="literal-percent" class="subject" src='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="112" height="64"%3E%3Crect width="100%" height="100%" fill="%23267a96"/%3E%3C/svg%3E'><span class="label">Literal percent</span></div>
      <div class="case"><img id="blob-image" class="subject"><span class="label">Revoked blob</span></div>
      <div class="case"><div id="blob-background" class="subject"></div><span class="label">Blob background</span></div>
      <div class="case"><div id="blob-mask" class="subject"><span id="mask-child"></span></div><span class="label">Blob mask</span></div>
      <div class="case"><div id="failed-background" class="subject"><span id="retained-child"></span></div><span class="label">Failed background</span></div>
      <div class="case"><svg id="svg-image" class="subject" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 64"><image href="/picture.bin" width="112" height="64"/></svg><span class="label">SVG image</span></div>
      <div class="case"><div id="unloaded-background" class="subject" style="background-color:#e2b84f"></div><span class="label">Revoked before load</span></div>
      <div class="case"><div id="unloaded-mask" class="subject" style="background-color:#367aa8"></div><span class="label">Unloaded blob mask</span></div>
      <div class="case"><img id="small-logo" class="subject" style="width:32px;height:32px;border:1px solid #ddd;box-sizing:border-box;border-radius:50%" src="/logo.png"><span class="label">Small image icon</span></div>
      <div class="case"><div id="small-background" class="subject" style="width:32px;height:32px;background-image:url('/logo.png')"></div><span class="label">Small background icon</span></div>
      <div class="case"><img id="padded-logo" class="subject" style="width:64px;height:64px;border:3px solid #485568;padding:6px;box-sizing:border-box;border-radius:16px;background-color:#b84b71" src="/picture.bin"><span class="label">Rounded content edge</span></div>
      <div class="case"><input id="padded-input" type="image" class="subject" style="width:64px;height:64px;border:3px solid #485568;padding:6px;box-sizing:border-box;border-radius:16px;background-color:#b84b71" src="/picture.bin"><span class="label">Image button</span></div>
    </div><div class="icons"><span id="buffer-icon" class="icon" style="font-family:BufferIcons">&#xea60;</span><span id="blob-pseudo" class="icon" style="font-family:BlobIcons"></span></div>
    <script>(async()=>{
      const bytes=await (await fetch('/font.bin')).arrayBuffer();
      const face=new FontFace('BufferIcons', bytes);await face.load();document.fonts.add(face);
      const fontUrl=URL.createObjectURL(new Blob([bytes],{type:'font/ttf'}));
      const style=document.createElement('style');style.textContent='@font-face{font-family:BlobIcons;src:url("'+fontUrl+'")}';document.head.append(style);await document.fonts.load('40px BlobIcons');
      const picture=URL.createObjectURL(await (await fetch('/picture.bin')).blob()),mask=URL.createObjectURL(await (await fetch('/mask.bin')).blob());
      const image=document.getElementById('blob-image');image.src=picture;await image.decode();document.getElementById('blob-background').style.backgroundImage='url("'+picture+'")';document.getElementById('blob-mask').style.maskImage='url("'+mask+'")';
      const probe=new Image();probe.src=mask;await probe.decode();getComputedStyle(document.getElementById('blob-background')).backgroundImage;getComputedStyle(document.getElementById('blob-mask')).maskImage;await new Promise(resolve=>setTimeout(resolve,150));
      for(const url of [fontUrl,picture,mask])URL.revokeObjectURL(url);document.body.dataset.ready='true';
      const broken=URL.createObjectURL(await (await fetch('/mask.bin')).blob());URL.revokeObjectURL(broken);document.getElementById('unloaded-background').style.backgroundImage='url("'+broken+'")';document.getElementById('unloaded-mask').style.maskImage='url("'+broken+'")';
    })();</script>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server failed.');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

for (const width of [390, 1440])
  test(`binary, redirected, fragment, blob and runtime font sources stay native at ${width}px`, async ({
    request,
    page,
    browser,
  }) => {
    const response = await request.post('/api/convert', {
      data: { url: origin, width, height: 844, fullPage: true },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const source = (await response.json()) as DesignDocument;
    expect(source.nodes.filter((node) => node.kind === 'raster')).toEqual([]);
    expect(source.assets.filter((asset) => asset.url?.startsWith('capture:'))).toEqual([]);
    expect(
      source.warnings.filter((warning) =>
        /FALLBACK|FONT_MISSING|IMAGE_LOAD_TIMEOUT/.test(warning.code),
      ),
    ).toEqual([]);
    expect(source.fonts.map((font) => font.family)).toEqual(
      expect.arrayContaining(['BufferIcons', 'BlobIcons']),
    );
    const node = (name: string) => source.nodes.find((node) => node.name === name)!;
    expect(node('blob-mask').children).toContain(node('mask-child').id);
    expect(node('blob-mask').maskLayers![0].assetId).toBeTruthy();
    expect(node('blob-background').backgroundLayers![0].assetId).toBeTruthy();
    expect(node('unloaded-background').backgroundLayers![0].image).toBe('none');
    expect(node('unloaded-mask').maskLayers![0].image).toBe('none');
    expect(node('failed-background').children).toContain(node('retained-child').id);
    expect(node('failed-background').backgroundLayers![0].image).toBe('none');
    const left = node('left-view').backgroundLayers![0].assetId,
      right = node('right-view').backgroundLayers![0].assetId;
    expect(left).not.toBe(right);
    expect(source.assets.find((asset) => asset.id === left)?.dataUrl).toMatch(/#left$/);
    expect(source.assets.find((asset) => asset.id === right)?.dataUrl).toMatch(/#right$/);
    expect(source.assets.find((asset) => asset.id === node('binary').assetId)?.mime).toBe(
      'image/png',
    );
    await page.goto('/');
    const result = await page.evaluate(
      async ({ source, flat }) => {
        const module = '/tests/fixtures/core-api.ts';
        const { loadDocumentResources, renderToCanvas, CanvasRenderer } = await import(module);
        const created: ImageBitmap[] = [],
          factory = window.createImageBitmap.bind(window);
        window.createImageBitmap = new Proxy(factory, {
          async apply(target, receiver, args) {
            const bitmap = (await Reflect.apply(target, receiver, args)) as ImageBitmap;
            created.push(bitmap);
            return bitmap;
          },
        });
        const resources = await loadDocumentResources(source),
          previews: { scale: number; png: string }[] = [];
        try {
          const renderer = new CanvasRenderer(flat, resources);
          for (const scale of [0.5, 1, 2]) {
            const canvas = document.createElement('canvas');
            renderer.render(canvas, {
              width: source.width * scale,
              height: source.height * scale,
              camera: { x: 0, y: 0, scale },
            });
            previews.push({ scale, png: canvas.toDataURL() });
          }
          renderer.dispose();
          const output = {
            png: renderToCanvas(source, resources).toDataURL(),
            flat: renderToCanvas(flat, resources).toDataURL(),
            previews,
            errors: resources.errors,
          };
          const resizeBytes = created.reduce(
            (sum, bitmap) => sum + bitmap.width * bitmap.height * 4,
            0,
          );
          resources.dispose();
          const partial = await loadDocumentResources(
            {
              ...source,
              id: source.id + '-partial',
              assets: [
                ...source.assets,
                { id: 'malformed-aux', mime: 'image/png', dataUrl: 'data:image/png;base64,%%%' },
              ],
            },
            { reference: false },
          );
          const partialResult = { errors: partial.errors, images: partial.images.size };
          partial.dispose();
          return {
            ...output,
            resizeBytes,
            resizes: created.length,
            released: created.every((bitmap) => !bitmap.width && !bitmap.height),
            partialResult,
          };
        } finally {
          resources.dispose();
          window.createImageBitmap = factory;
        }
      },
      { source, flat: flattenDocument(source) },
    );
    expect(result.errors).toEqual([]);
    expect(result.resizes).toBeGreaterThan(0);
    expect(result.resizeBytes).toBeLessThanOrEqual(32 * 1024 * 1024);
    expect(result.released).toBe(true);
    expect(result.partialResult.images).toBe(source.assets.length);
    expect(result.partialResult.errors).toEqual(['素材 malformed-aux 加载失败。']);
    expect(result.flat === result.png, 'hierarchical and flat exports match').toBe(true);
    const references = new Map<number, Buffer>([
      [1, Buffer.from(source.referenceImage.split(',')[1], 'base64')],
    ]);
    for (const scale of [0.5, 2]) {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        deviceScaleFactor: 1,
      });
      try {
        const reference = await context.newPage();
        await reference.goto(origin);
        await reference.waitForFunction(() => document.body.dataset.ready === 'true');
        await reference.evaluate(
          ({ width, height, scale, background }) => {
            document.documentElement.style.backgroundColor = background;
            document.documentElement.style.minHeight = `${height * scale}px`;
            Object.assign(document.body.style, {
              boxSizing: 'border-box',
              width: `${width}px`,
              transformOrigin: '0 0',
              transform: `scale(${scale})`,
            });
          },
          { width, height: source.height, scale, background: source.background },
        );
        references.set(
          scale,
          await reference.screenshot({
            fullPage: true,
            clip: {
              x: 0,
              y: 0,
              width: Math.round(width * scale),
              height: Math.round(source.height * scale),
            },
          }),
        );
      } finally {
        await context.close();
      }
    }
    const regions = [
      'binary',
      'no-mime',
      'redirect',
      'left-view',
      'right-view',
      'byte-data',
      'literal-percent',
      'blob-image',
      'blob-background',
      'blob-mask',
      'failed-background',
      'svg-image',
      'buffer-icon',
      'blob-pseudo',
      'unloaded-background',
      'unloaded-mask',
      'small-logo',
      'small-background',
      'padded-logo',
      'padded-input',
    ];
    for (const { scale, png } of [
      { scale: 1, png: result.png, reference: source.referenceImage },
      ...result.previews,
    ]) {
      const actual = await sharp(Buffer.from(png.split(',')[1], 'base64'))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      // Compare the independently scaled DOM; enlarging an already
      // downsampled 1x screenshot would penalize correctly preserved detail.
      const reference = await sharp(references.get(scale)!).ensureAlpha().raw().toBuffer();
      if (scale === 1) {
        const content = node('padded-logo').contentBox;
        const index = (content.y * source.width + content.x) * 4;
        expect([...actual.data.subarray(index, index + 3)]).toEqual([
          ...reference.subarray(index, index + 3),
        ]);
        expect([...reference.subarray(index, index + 3)]).toEqual([184, 75, 113]);
      }
      for (const name of regions) {
        const box = node(name).box;
        let different = 0,
          count = 0,
          ink = 0,
          sum = 0;
        for (
          let y = Math.ceil(box.y * scale) + 2;
          y < Math.floor((box.y + box.height) * scale) - 2;
          y++
        )
          for (
            let x = Math.ceil(box.x * scale) + 2;
            x < Math.floor((box.x + box.width) * scale) - 2;
            x++
          ) {
            const index = (y * actual.info.width + x) * 4;
            if (Math.min(...[0, 1, 2].map((channel) => reference[index + channel])) < 200) ink++;
            const delta = Math.max(
              ...[0, 1, 2].map((channel) =>
                Math.abs(actual.data[index + channel] - reference[index + channel]),
              ),
            );
            sum += delta;
            if (delta > 32) different++;
            count++;
          }
        if (name === 'small-logo' || name === 'small-background') {
          // Native minification kernels can shift a thin stroke by one device
          // pixel. Bound total color error for these 32px bitmap icons instead.
          // Boundary pixels occupy twice as much of a 16px icon at half zoom.
          expect(sum / count, name + ' at ' + scale).toBeLessThan(6 / Math.min(1, scale));
        } else
          expect(different / count, name + ' at ' + scale).toBeLessThan(
            scale === 1 ? 0.015 : 0.045,
          );
        if (scale === 1 && ['buffer-icon', 'blob-pseudo'].includes(name))
          expect(ink, name + ' has a real glyph').toBeGreaterThan(40);
      }
    }
  });
