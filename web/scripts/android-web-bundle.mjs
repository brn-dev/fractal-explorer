import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { crc32 } from '../src/zip-store.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const validPath = name => name.length <= 200 && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) && name.split('/').every(part => part && part !== '.' && part !== '..');
async function entries(root, dir = root) {
  const result = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (dir === root && ['android-web', 'android-web-info.json'].includes(item.name)) continue;
    const path = resolve(dir,item.name);
    if (item.isSymbolicLink()) throw new Error('Web update files must not be symbolic links.');
    if (item.isDirectory()) result.push(...await entries(root,path));
    else if (item.isFile()) result.push([relative(root,path).replaceAll('\\','/'),await readFile(path)]);
  }
  return result.sort(([a],[b])=>a.localeCompare(b,'en'));
}
function zip(files) {
  const bodies=[],central=[]; let offset=0;
  for(const [name,data] of files){
    const filename=Buffer.from(name),packed=deflateRawSync(data),crc=crc32(data);
    const local=Buffer.alloc(30+filename.length);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(8,8);local.writeUInt16LE(33,12);
    local.writeUInt32LE(crc,14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(filename.length,26);filename.copy(local,30);
    const record=Buffer.alloc(46+filename.length);record.writeUInt32LE(0x02014b50);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x800,8);record.writeUInt16LE(8,10);record.writeUInt16LE(33,14);
    record.writeUInt32LE(crc,16);record.writeUInt32LE(packed.length,20);record.writeUInt32LE(data.length,24);record.writeUInt16LE(filename.length,28);record.writeUInt32LE(offset,42);filename.copy(record,46);
    bodies.push(local,packed);central.push(record);offset+=local.length+packed.length;
  }
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(central.reduce((n,b)=>n+b.length,0),12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...bodies,...central,end]);
}
export async function packageAndroidWeb(root, {minVersionCode,builtAt}) {
  if(!Number.isSafeInteger(minVersionCode)||minVersionCode<22||!Number.isSafeInteger(builtAt)||builtAt<=0)throw new Error('Invalid Android web compatibility/build metadata.');
  const files=await entries(root),names=new Set();
  if(files.length<1||files.length>=255||!files.some(([name])=>name==='index.html'))throw new Error('Incomplete web bundle.');
  let total=0;const hash=createHash('sha256').update(`${minVersionCode}:${builtAt}\0`);
  for(const [name,data] of files){
    if(!validPath(name)||names.has(name.toLowerCase())||data.length>32*1024**2)throw new Error('Invalid web bundle entry: '+name);
    names.add(name.toLowerCase());total+=data.length;hash.update(name+'\0').update(data);
  }
  if(total>64*1024**2)throw new Error('Web bundle exceeds the Android update limit.');
  const id=hash.digest('hex'),identity={id,builtAt,minVersionCode};
  const info=Buffer.from(JSON.stringify(identity));files.push(['android-web-info.json',info]);
  const archive=zip(files);if(archive.length>32*1024**2)throw new Error('Compressed web update exceeds 32 MiB.');
  const manifest={format:'fractal-explorer-web-update/v1',...identity,archive:`bundle-${id}.zip`,bytes:archive.length,sha256:sha256(archive),files:files.map(([name,data])=>({name,bytes:data.length,sha256:sha256(data)}))};
  await mkdir(resolve(root,'android-web'),{recursive:true});
  await writeFile(resolve(root,'android-web-info.json'),info);
  await writeFile(resolve(root,'android-web',manifest.archive),archive);
  await writeFile(resolve(root,'android-web/latest.json'),JSON.stringify(manifest));
  return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const compat=JSON.parse(await readFile(new URL('../android-compat.json',import.meta.url),'utf8'));
  const epoch=process.env.SOURCE_DATE_EPOCH??execFileSync('git',['log','-1','--format=%ct'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
  const manifest=await packageAndroidWeb(resolve('dist'),{...compat,builtAt:Number(epoch)*1000});
  console.log(`Android web update: ${manifest.id.slice(0,12)}, ${(manifest.bytes/1048576).toFixed(1)} MiB, native ${manifest.minVersionCode}+.`);
}
