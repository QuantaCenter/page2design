import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright';
import { CAPTURE_REVISION } from '@quantacenter/page2design';

const source = process.argv[2] || 'artifacts/bilibili-stacking/live/design.json';
const output = process.argv[3] || 'artifacts/performance/preview.json';
const document = JSON.parse(await readFile(source, 'utf8'));
if (document.captureRevision !== CAPTURE_REVISION)
  throw new Error('请使用当前采集版本导出的设计文档重新测量。');
const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath =
  process.env.CHROME_EXECUTABLE_PATH ||
  (!existsSync(chromium.executablePath()) && existsSync(macChrome) ? macChrome : undefined);
const browser = await chromium.launch({ headless: true, executablePath });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 2,
  });
  // tsx preserves local function names with this helper when serializing callbacks.
  await page.addInitScript('window.__name = value => value');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/convert', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(document) }),
  );
  await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:5173');
  await page.getByRole('textbox', { name: 'H5 页面 URL' }).fill('https://preview.test');
  await page.getByRole('button', { name: '转换为设计图' }).click();
  await page.getByText('原生 Canvas 图层', { exact: true }).waitFor();
  await page.getByRole('combobox', { name: '缩放比例' }).selectOption('100');
  const settle = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  await settle();
  await page.evaluate(() => {
    const state = window as any;
    state.previewProfile = { scene: [], hit: [], frames: [], running: false };
    for (const [method, key] of [
      ['drawScene', 'scene'],
      ['drawHit', 'hit'],
    ]) {
      const original = state.Konva.Layer.prototype[method];
      state.Konva.Layer.prototype[method] = function (...args: unknown[]) {
        const start = performance.now();
        try {
          return original.apply(this, args);
        } finally {
          if (state.previewProfile.running && this === state.Konva.stages[0]?.getLayers()[0])
            state.previewProfile[key].push(performance.now() - start);
        }
      };
    }
    const frame = (time: number) => {
      const profile = state.previewProfile;
      if (profile.running && profile.previous) profile.frames.push(time - profile.previous);
      profile.previous = profile.running ? time : 0;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  const session = await page.context().newCDPSession(page);
  await session.send('Performance.enable');
  const canvas = page.getByTestId('design-canvas');
  const bounds = (await canvas.boundingBox())!;
  const metrics = async () =>
    Object.fromEntries(
      (await session.send('Performance.getMetrics')).metrics.map((metric) => [
        metric.name,
        metric.value,
      ]),
    );
  const measure = async (action: () => Promise<void>) => {
    await page.evaluate(() => {
      const profile = (window as any).previewProfile;
      profile.scene = [];
      profile.hit = [];
      profile.frames = [];
      profile.previous = 0;
      profile.running = true;
    });
    const before = await metrics();
    const start = performance.now();
    await action();
    await settle();
    const durationMs = performance.now() - start;
    const after = await metrics();
    const profile = await page.evaluate(() => {
      const profile = (window as any).previewProfile;
      profile.running = false;
      return { scene: profile.scene, hit: profile.hit, frames: profile.frames };
    });
    const summarize = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return {
        count: values.length,
        totalMs: values.reduce((a, b) => a + b, 0),
        p95Ms: sorted[Math.floor(sorted.length * 0.95)] || 0,
      };
    };
    return {
      durationMs,
      taskMs: (after.TaskDuration - before.TaskDuration) * 1000,
      scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
      scene: summarize(profile.scene),
      hit: summarize(profile.hit),
      frames: summarize(profile.frames),
    };
  };
  const hover = await measure(async () => {
    for (let index = 0; index < 72; index++)
      await page.mouse.move(
        bounds.x + 85 + (index % 9) * 75,
        bounds.y + 100 + Math.floor(index / 9) * 65,
      );
  });
  await page.getByRole('button', { name: '拖动工具', exact: true }).click();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  if (process.env.PREVIEW_CPU_PROFILE) {
    await session.send('Profiler.enable');
    await session.send('Profiler.start');
  }
  const pan = await measure(async () => {
    for (let index = 0; index < 72; index++)
      await page.mouse.move(
        bounds.x + bounds.width / 2 + Math.sin(index / 12) * 150,
        bounds.y + bounds.height / 2 + Math.cos(index / 12) * 100,
      );
  });
  if (process.env.PREVIEW_CPU_PROFILE) {
    const { profile } = await session.send('Profiler.stop');
    await mkdir(dirname(process.env.PREVIEW_CPU_PROFILE), { recursive: true });
    await writeFile(process.env.PREVIEW_CPU_PROFILE, JSON.stringify(profile));
  }
  await page.mouse.up();
  await page.getByRole('button', { name: '选择工具', exact: true }).click();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  const zoom = await measure(async () => {
    for (let index = 0; index < 48; index++) await page.mouse.wheel(0, index < 24 ? -10 : 10);
  });
  const report = {
    source,
    nodes: document.nodes.length,
    dpr: 2,
    viewport: { width: 1440, height: 1000 },
    hover,
    pan,
    zoom,
    errors,
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
