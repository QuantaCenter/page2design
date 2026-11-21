import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

void test(
  'API watcher reloads imported sources after an atomic file replacement',
  { timeout: 20000 },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'page-to-design-watch-'));
    const dependency = path.join(directory, 'revision.mts');
    const entry = path.join(directory, 'server.mts');
    await writeFile(dependency, "export const revision = 'before';\n");
    await writeFile(
      entry,
      [
        "import { createServer } from 'node:http';",
        "import { revision } from './revision.mts';",
        'const server = createServer((_request, response) => response.end(revision));',
        "server.listen(0, '127.0.0.1', () => console.log('WATCH_READY ' + JSON.stringify({ port: server.address().port, revision })));",
        "process.once('SIGTERM', () => server.close(() => process.exit(0)));",
        "process.once('SIGINT', () => server.close(() => process.exit(0)));",
      ].join('\n'),
    );
    const child = spawn(process.execPath, ['scripts/dev-api.mjs', entry], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CHOKIDAR_USEPOLLING: 'false' },
    });
    let output = '';
    let errors = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      errors += chunk.toString();
    });
    const ready = async (revision: string): Promise<{ port: number }> => {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        for (const match of output.matchAll(/WATCH_READY (\{[^\n]+\})/g)) {
          const value = JSON.parse(match[1]);
          if (value.revision === revision) return value;
        }
        if (child.exitCode !== null) throw new Error(`Watcher exited: ${errors}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`Watcher did not load ${revision}: ${output}\n${errors}`);
    };
    try {
      const initial = await ready('before');
      assert.equal(await (await fetch(`http://127.0.0.1:${initial.port}`)).text(), 'before');
      await writeFile(`${dependency}.next`, "export const revision = 'after';\n");
      await rename(`${dependency}.next`, dependency);
      const updated = await ready('after');
      assert.equal(await (await fetch(`http://127.0.0.1:${updated.port}`)).text(), 'after');
    } finally {
      const exit = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill('SIGTERM');
      await exit;
      await rm(directory, { recursive: true, force: true });
    }
  },
);
