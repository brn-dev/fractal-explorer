import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const snapshot = JSON.parse(await readFile(new URL('../desktop-snapshot.json', import.meta.url), 'utf8'));
const mismatches = [];
for (const [path, expected] of Object.entries(snapshot)) {
  const data = await readFile(new URL('../../' + path, import.meta.url));
  if (createHash('sha256').update(data).digest('hex') !== expected) mismatches.push(path);
}
if (mismatches.length) throw new Error('Desktop files changed: ' + mismatches.join(', '));
console.log(`${Object.keys(snapshot).length} desktop source and test files are byte-for-byte unchanged.`);
