import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
const directory = new URL('../dist/', import.meta.url);
const hash = createHash('sha256');
async function fingerprint(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), folder);
    hash.update(path.pathname.slice(directory.pathname.length));
    if (entry.isDirectory()) await fingerprint(path);
    else hash.update(await readFile(path));
  }
}
await fingerprint(directory);
const version = hash.digest('hex').slice(0, 16);
const worker = new URL('sw.js', directory);
await writeFile(worker, (await readFile(worker, 'utf8')).replaceAll('__PO_BUILD__', version));
console.log(`PWA build: ${version}`);
