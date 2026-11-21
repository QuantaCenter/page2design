import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, copyFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const run = promisify(execFile),
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(path.join(tmpdir(), 'page-to-design-package-'));
const artifacts = path.join(root, 'artifacts/package-extraction');
await mkdir(artifacts, { recursive: true });
const packageDirectory = path.join(temp, 'packed'),
  consumer = path.join(temp, 'consumer');
await mkdir(packageDirectory);
await mkdir(consumer);
let server, browser;
try {
  await run(
    'npm',
    [
      'pack',
      '--workspace',
      '@quantacenter/page2design',
      '--pack-destination',
      packageDirectory,
      '--json',
    ],
    { cwd: root, maxBuffer: 1024 * 1024 },
  );
  const filename = (await readdir(packageDirectory)).find((name) => name.endsWith('.tgz'));
  assert(filename, 'npm pack must produce an archive');
  const archive = path.join(packageDirectory, filename);
  await copyFile(archive, path.join(artifacts, filename));
  await writeFile(
    path.join(consumer, 'package.json'),
    JSON.stringify({ name: 'isolated-core-consumer', private: true, type: 'module' }),
  );
  await run(
    'npm',
    ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', archive],
    {
      cwd: consumer,
      env: { ...process.env, npm_config_cache: path.join(temp, 'cache') },
      maxBuffer: 1024 * 1024,
    },
  );
  const installed = path.join(consumer, 'node_modules/@quantacenter/page2design');
  const metadata = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
  const declaredDependencies = {
    ...metadata.dependencies,
    ...metadata.devDependencies,
    ...metadata.optionalDependencies,
    ...metadata.peerDependencies,
  };
  for (const name of [
    'react',
    'react-dom',
    'react-konva',
    '@types/react',
    '@types/react-dom',
    'playwright',
    'sharp',
  ]) {
    assert(!Object.hasOwn(declaredDependencies, name), `Unexpected core dependency: ${name}`);
    await assert.rejects(stat(path.join(consumer, 'node_modules', name)), { code: 'ENOENT' });
  }
  assert(!Object.hasOwn(metadata.exports, './react'));
  await assert.rejects(stat(path.join(installed, 'dist/react')), { code: 'ENOENT' });
  await writeFile(
    path.join(consumer, 'check.mjs'),
    `
    import assert from 'node:assert/strict';
    import {convertSnapshot} from '@quantacenter/page2design';
    import {CanvasRenderer,loadDocumentResources} from '@quantacenter/page2design/canvas';
    import {collectDomLayout} from '@quantacenter/page2design/dom';
    globalThis.fetch=()=>{throw new Error('Core must not acquire a page.');};
    assert.equal(typeof CanvasRenderer,'function');assert.equal(typeof loadDocumentResources,'function');assert.equal(typeof collectDomLayout,'function');
    const model=convertSnapshot({id:'standalone',capturedAt:'2026-11-16T00:00:00.000Z',title:'Prepared information',viewport:{width:390,height:844},width:390,height:844,background:'#fff',nodes:[],assets:[]});
    assert.equal(model.id,'standalone');assert.equal(model.url,undefined);
    assert.throws(()=>convertSnapshot('https://example.com'),/structured page snapshot/);
    console.log('Independent Node import and conversion passed.');
  `,
  );
  await run(process.execPath, ['check.mjs'], { cwd: consumer });
  await writeFile(
    path.join(consumer, 'backend.ts'),
    `
    import {convertSnapshot,type PageSnapshot,type DesignDocument} from '@quantacenter/page2design';
    declare const input:PageSnapshot;export const model:DesignDocument=convertSnapshot(input);
    // @ts-expect-error URL acquisition is not a core input.
    convertSnapshot('https://example.com');
  `,
  );
  await writeFile(
    path.join(consumer, 'frontend.ts'),
    `
    import {type DesignDocument} from '@quantacenter/page2design';
    import {CanvasRenderer,loadDocumentResources,renderToCanvas} from '@quantacenter/page2design/canvas';
    import {collectDomLayout} from '@quantacenter/page2design/dom';
    declare const model:DesignDocument;const resources=await loadDocumentResources(model);
    new CanvasRenderer(model,resources).render(document.createElement('canvas'));
    renderToCanvas(model,resources);collectDomLayout({document,fullPage:false,maxHeight:1000,maxNodes:100});
  `,
  );
  const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
  for (const [file, lib] of [
    ['backend.ts', 'ES2022'],
    ['frontend.ts', 'ES2022,DOM,DOM.Iterable'],
  ]) {
    await writeFile(
      path.join(consumer, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          types: [],
          lib: lib.split(','),
        },
        files: [file],
      }),
    );
    await run(process.execPath, [tsc, '-p', 'tsconfig.json'], {
      cwd: consumer,
      maxBuffer: 1024 * 1024,
    });
  }
  const mimetypes = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' };
  server = createServer(async (request, response) => {
    try {
      const file = path.resolve(consumer, '.' + new URL(request.url, 'http://localhost').pathname);
      if (!file.startsWith(consumer + path.sep)) throw new Error('Invalid path');
      response.setHeader(
        'content-type',
        mimetypes[path.extname(file)] || 'application/octet-stream',
      );
      response.end(await readFile(file));
    } catch {
      response.statusCode = 404;
      response.end('Not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const executablePath =
    process.env.CHROME_EXECUTABLE_PATH ||
    (!existsSync(chromium.executablePath()) && existsSync(macChrome) ? macChrome : undefined);
  browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  const errors = [],
    externalRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:'))
      externalRequests.push(request.url());
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(base + '/node_modules/@quantacenter/page2design/examples/standalone.html');
  await page.waitForFunction(() => document.querySelector('canvas').dataset.ready === 'true');
  const result = JSON.parse(await page.locator('#result').textContent());
  assert.equal(result.under, 'card');
  assert.equal(result.button, 'floating');
  assert.equal(result.clipCorner, null);
  assert.equal(result.clipCenter, 'clipped');
  assert.equal(result.flat, true);
  assert.deepEqual(result.errors, []);
  const canvas = page.locator('canvas');
  const bounds = await canvas.boundingBox();
  const camera = JSON.parse(await canvas.getAttribute('data-camera'));
  await page.mouse.click(
    bounds.x + ((camera.x + 70 * camera.scale) / 700) * bounds.width,
    bounds.y + ((camera.y + 70 * camera.scale) / 440) * bounds.height,
  );
  assert.equal(JSON.parse(await page.locator('#selection').textContent()).id, 'card');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, -100);
  await page.waitForFunction(
    (scale) => JSON.parse(document.querySelector('canvas').dataset.camera).scale > scale,
    camera.scale,
  );
  const downloading = page.waitForEvent('download');
  await page.locator('#export').click();
  const exported = await (await downloading).path();
  await copyFile(exported, path.join(artifacts, 'standalone.png'));
  await page.screenshot({ path: path.join(artifacts, 'standalone-viewer.png') });
  await page.locator('#dom').click();
  await page.waitForFunction(() =>
    document.querySelector('#result').textContent.includes('supplied-document'),
  );
  const domResult = JSON.parse(await page.locator('#result').textContent());
  assert.equal(domResult.width, 300);
  assert(domResult.nodes > 0);
  assert.deepEqual(domResult.errors, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  const report = {
    archive: filename,
    isolatedInstall: true,
    reactDependenciesInstalled: false,
    nodeConversion: true,
    backendTypesWithoutDOM: true,
    browserTypesWithoutReact: true,
    frameworkFreeCanvas: result,
    providedDocument: domResult,
    externalRequests,
    errors,
  };
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
