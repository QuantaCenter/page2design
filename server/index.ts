import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { capture, closeBrowser } from './capture';
import type { ConvertOptions } from './capture';
import { CAPTURE_REVISION } from '@quantacenter/page2design';

const app = express();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
let running = 0;

app.get('/api/health', (_request, response) =>
  response.json({
    ok: true,
    service: 'page-to-design',
    captureRevision: CAPTURE_REVISION,
    running,
  }),
);
app.get('/api/demo', (_request, response) =>
  response.sendFile(path.join(root, 'public/example.html')),
);

app.post('/api/convert', async (request, response) => {
  const origin = request.get('origin');
  const host = request.get('host');
  const webPort = process.env.WEB_PORT || '5173';
  if (
    origin &&
    ![`http://127.0.0.1:${webPort}`, `http://localhost:${webPort}`, `http://${host}`].includes(
      origin,
    )
  ) {
    response.status(403).json({ error: '请从本地 Page to Design 页面发起采集。' });
    return;
  }
  let options: ConvertOptions;
  try {
    const url = new URL(String(request.body?.url || '').trim());
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.href.length > 4096
    )
      throw new Error('请输入有效的 HTTP 或 HTTPS 页面地址。');
    const width = Number(request.body.width ?? 390);
    const height = Number(request.body.height ?? 844);
    if (
      !Number.isInteger(width) ||
      width < 320 ||
      width > 1920 ||
      !Number.isInteger(height) ||
      height < 480 ||
      height > 1200
    )
      throw new Error('视口宽度需在 320–1920，高度需在 480–1200 CSS px 之间。');
    options = { url: url.href, width, height, fullPage: request.body.fullPage !== false };
  } catch (error) {
    response.status(400).json({
      error:
        error instanceof TypeError
          ? '请输入完整的页面地址，例如 https://example.com。'
          : (error as Error).message,
    });
    return;
  }
  if (running >= 2) {
    response.status(429).json({ error: '当前有两个采集任务正在进行，请稍后重试。' });
    return;
  }
  running++;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 75000);
  const onClose = () => {
    if (!response.writableEnded) controller.abort();
  };
  response.on('close', onClose);
  try {
    const document = await capture(options, controller.signal);
    if (!response.destroyed) response.json(document);
  } catch (error) {
    if (!response.destroyed)
      response.status(502).json({
        error: controller.signal.aborted
          ? '采集超时或已取消，请尝试仅转换首屏。'
          : friendlyError(error),
      });
  } finally {
    clearTimeout(timeout);
    response.off('close', onClose);
    running--;
  }
});

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('net::ERR_NAME_NOT_RESOLVED')) return '无法解析这个域名，请检查页面地址。';
  if (message.includes('net::ERR_CONNECTION_REFUSED'))
    return '无法连接页面服务，请确认地址和端口可以访问。';
  if (message.includes('Timeout')) return '页面加载超时，请检查网络，或尝试仅转换首屏。';
  if (message.includes('net::ERR_'))
    return `浏览器无法打开页面：${message.match(/net::ERR_\w+/)?.[0] || '网络错误'}`;
  return message.slice(0, 400);
}

app.use(express.static(path.join(root, 'dist')));
app.get('/{*path}', (_request, response) => response.sendFile(path.join(root, 'dist/index.html')));
app.use(
  (
    error: Error,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    response.status(400).json({ error: error.message });
  },
);
const port = Number(process.env.PORT || 8787);
const server = app.listen(port, '127.0.0.1', () =>
  console.log(`Page to Design API: http://127.0.0.1:${port}`),
);
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    server.close();
    void closeBrowser().finally(() => process.exit(0));
  });
}
