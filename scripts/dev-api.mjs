import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// Watch file contents rather than native events or an import-notification hook:
// both can miss atomic replacements made by editors and workspace tools.
const entry = path.resolve(process.argv[2] || 'server/index.ts');
const roots = [...new Set([path.dirname(entry), path.resolve('packages/core/dist')])];
let child;
let stopping = false;
let checking = false;
let reloading = false;

async function fingerprint() {
  const files = [];
  const walk = async (directory) => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const item of entries) {
      const filename = path.join(directory, item.name);
      if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules')
        await walk(filename);
      else if (item.isFile() && /\.(?:[cm]?[jt]s|json)$/.test(item.name)) files.push(filename);
    }
  };
  for (const root of roots) await walk(root);
  const hash = createHash('sha256');
  for (const filename of files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    try {
      hash.update(filename);
      hash.update(await readFile(filename));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return hash.digest('hex');
}

function launch() {
  child = spawn(process.execPath, ['--import', 'tsx', entry], {
    stdio: 'inherit',
    env: process.env,
  });
  child.once('error', (error) => console.error(error.message));
}

async function stopChild() {
  const current = child;
  child = undefined;
  if (!current?.pid || current.exitCode !== null || current.signalCode !== null) return;
  const exited = new Promise((resolve) => current.once('exit', resolve));
  current.kill('SIGTERM');
  const force = setTimeout(() => current.kill('SIGKILL'), 3000);
  await exited;
  clearTimeout(force);
}

let previous = await fingerprint();
launch();
const interval = setInterval(async () => {
  if (stopping || checking || reloading) return;
  checking = true;
  try {
    const next = await fingerprint();
    if (next !== previous && !stopping) {
      previous = next;
      reloading = true;
      console.log('API sources changed, restarting capture service…');
      await stopChild();
      if (!stopping) launch();
    }
  } catch (error) {
    console.error(error.message);
  } finally {
    checking = false;
    reloading = false;
  }
}, 300);

for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    stopping = true;
    clearInterval(interval);
    void stopChild().finally(() => process.exit(0));
  });
