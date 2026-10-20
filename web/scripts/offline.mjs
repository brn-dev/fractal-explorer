import { readdir, readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
const root = resolve('dist');
await mkdir(resolve(root, 'licenses'), { recursive: true });
await copyFile(new URL('../../LICENSE', import.meta.url), resolve(root, 'licenses/fractal-explorer-LICENSE.txt'));
async function files(dir) {
  const found = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, item.name);
    if (item.isDirectory()) found.push(...await files(path));
    else if (item.name !== 'sw.js') found.push(path);
  }
  return found;
}
const paths = (await files(root)).sort();
const hash = createHash('sha256'); for (const p of paths) hash.update(await readFile(p));
hash.update(await readFile(new URL('./offline.mjs', import.meta.url)));
const cache = `fractal-web-${hash.digest('hex').slice(0, 16)}`;
const urls = ['./', ...paths.map(p => './' + relative(root, p).replaceAll('\\', '/'))];
await writeFile(resolve(root, 'sw.js'), `const CACHE=${JSON.stringify(cache)};const URLS=${JSON.stringify(urls)};
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(URLS.map(url=>new Request(url,{cache:'reload'})))));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('fractal-web-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('message',e=>{if(e.data==='activate')self.skipWaiting();});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;e.respondWith(caches.open(CACHE).then(async c=>{let response=await c.match(e.request,{ignoreVary:true});if(!response&&e.request.mode==='navigate'){const url=new URL(e.request.url);url.search='';response=await c.match(url.href,{ignoreVary:true});}return response||fetch(e.request);}));});
`);
console.log(`Offline bundle: ${paths.length} static files, ${cache}.`);
