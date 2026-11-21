import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import sharp from 'sharp';
import type { DesignDocument } from '@page-to-design/core';
import { createImageWaiter, settleResourceBodies } from '../server/wait-for-images';

let server: Server, origin: string;
const colors: Record<string, string> = {
  '/slow-image.png': '#2a9d8f',
  '/slow-background.png': '#3468ab',
  '/slow-pseudo.png': '#e5b93c',
  '/slow-mask.png': '#ffffff',
  '/responsive-narrow.png': '#7455bd',
  '/responsive-wide.png': '#cc527a',
};
test.beforeAll(async () => {
  const images = new Map(
    await Promise.all(
      Object.entries(colors).map(
        async ([url, color]) =>
          [
            url,
            await sharp({ create: { width: 16, height: 16, channels: 4, background: color } })
              .png()
              .toBuffer(),
          ] as const,
      ),
    ),
  );
  server = createServer((request, response) => {
    const url = new URL(request.url!, 'http://fixture.test');
    if (url.pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Image readiness</title><style>
        body{margin:0;padding:24px;background:#fff;font:16px Arial}.thumbnails{display:flex;flex-wrap:wrap;width:300px}.thumbnails img{width:8px;height:8px}.spacer{height:2200px}
        #late-image{display:block;width:180px;height:auto}#background,#pseudo{width:80px;height:60px;margin-top:16px}
        .ready #background{background-image:url('/slow-background.png')}.ready #pseudo::before{content:'';display:block;width:80px;height:60px;background:url('/slow-pseudo.png')}
        #mask{width:80px;height:60px;background:#d95d62}.ready #mask{mask-image:url('/slow-mask.png')}.ready #pseudo-mask::before{content:'';display:block;width:80px;height:60px;background:#3468ab;mask-image:url('/slow-mask.png')}
        #responsive{width:80px;height:60px}.tail{height:800px}
      </style></head><body><div class="thumbnails" id="thumbnails"></div><div class="spacer"></div><div id="caption">Waiting for images</div>
      <img id="late-image" loading="lazy" alt="Late image"><div id="background"></div><div id="pseudo"></div><div id="mask"></div><div id="pseudo-mask"></div><img id="responsive" alt="Responsive image"><div class="tail"></div>
      <script>
        const pixel='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="8" height="8"%3E%3Crect width="8" height="8" fill="%23a4b9cf"/%3E%3C/svg%3E';
        for(let index=0;index<155;index++){const image=new Image();image.src=pixel;document.getElementById('thumbnails').append(image)}
        let started=false;addEventListener('scroll',()=>{if(started||scrollY<700)return;started=true;
          const image=document.getElementById('late-image');image.onload=()=>{document.getElementById('caption').textContent='Loaded image with final layout'};image.src='/slow-image.png';
          const responsive=document.getElementById('responsive');responsive.srcset='/responsive-narrow.png 390w, /responsive-wide.png 1440w';responsive.sizes='100vw';
          document.body.classList.add('ready');
        });
      </script></body></html>`);
      return;
    }
    if (url.pathname === '/never.png') {
      response.writeHead(200, { 'Content-Type': 'image/png' });
      response.flushHeaders();
      return;
    }
    const image = images.get(url.pathname);
    if (!image) {
      response.writeHead(404);
      response.end();
      return;
    }
    const timer = setTimeout(() => {
      response.writeHead(200, { 'Content-Type': 'image/png' });
      response.end(image);
    }, 5500);
    response.once('close', () => clearTimeout(timer));
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
  test(`all in-scope images decode before layout and reference capture at ${width}px`, async ({
    request,
  }) => {
    const response = await request.post('/api/convert', {
      data: { url: origin, width, height: 844, fullPage: true },
      timeout: 75000,
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    const source = (await response.json()) as DesignDocument;
    expect(source.nodes.some((node) => node.text === 'Loaded image with final layout')).toBe(true);
    expect(source.nodes.filter((node) => node.tag === 'img').length).toBeGreaterThan(150);
    const image = source.nodes.find((node) => node.name === 'Late image')!;
    expect(image.kind).toBe('image');
    expect(image.box.height).toBe(180);
    expect(image.assetId).toBeTruthy();
    const responsive = source.nodes.find((node) => node.name === 'Responsive image')!;
    expect(source.assets.find((asset) => asset.id === responsive.assetId)?.url).toContain(
      width === 390 ? 'responsive-narrow.png' : 'responsive-wide.png',
    );
    const background = source.nodes.find((node) => node.name === 'background')!,
      pseudo = source.nodes.find((node) => node.name === 'pseudo::before')!;
    expect(background.backgroundAssetId).toBeTruthy();
    expect(pseudo.backgroundAssetId).toBeTruthy();
    const mask = source.nodes.find((node) => node.name === 'mask')!,
      pseudoMask = source.nodes.find((node) => node.name === 'pseudo-mask::before')!;
    expect(mask.maskLayers![0].assetId).toBeTruthy();
    expect(pseudoMask.maskLayers![0].assetId).toBeTruthy();
    expect(
      source.warnings.filter((warning) =>
        /IMAGE_LOAD_|ASSET_FALLBACK|BACKGROUND_FALLBACK/.test(warning.code),
      ),
    ).toEqual([]);
    const reference = await sharp(Buffer.from(source.referenceImage.split(',')[1], 'base64'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (const [node, color] of [
      [image, colors['/slow-image.png']],
      [background, colors['/slow-background.png']],
      [pseudo, colors['/slow-pseudo.png']],
      [mask, '#d95d62'],
      [pseudoMask, '#3468ab'],
    ] as const) {
      const x = Math.floor(node.box.x + node.box.width / 2),
        y = Math.floor(node.box.y + node.box.height / 2),
        offset = (y * source.width + x) * 4;
      const rgb = color
        .slice(1)
        .match(/../g)!
        .map((channel) => parseInt(channel, 16));
      expect([...reference.data.subarray(offset, offset + 3)]).toEqual(rgb);
    }
  });

test('image deadlines and failures settle even when the source clock is paused', async ({
  page,
}) => {
  await page.clock.install();
  await page.setContent(`<img src="${origin}/never.png"><img src="${origin}/missing.png">`, {
    waitUntil: 'domcontentloaded',
  });
  await page.clock.pauseAt(Date.now() + 1000);
  const waiter = await createImageWaiter(page, { fullPage: true, maxHeight: 12000 });
  try {
    const started = Date.now(),
      report = await waiter.waitUntil(started + 500);
    expect(report.timedOut).toBe(true);
    expect(report.pending).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.failedUrls).toContain(origin + '/missing.png');
    expect(Date.now() - started).toBeLessThan(3000);
    // A response can send headers and never finish its body. It must not keep
    // capture stuck after the image deadline has expired.
    await settleResourceBodies(new Set([new Promise<void>(() => {})]), 100);
    expect(Date.now() - started).toBeLessThan(3000);
  } finally {
    await waiter.dispose();
  }
});
