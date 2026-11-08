import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {packageAndroidWeb} from '../scripts/android-web-bundle.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(action){const root=await mkdtemp(join(tmpdir(),'fractal-web-ota-'));try{await writeFile(join(root,'index.html'),'<html>Explorer</html>');await mkdir(join(root,'assets'));await writeFile(join(root,'assets/app.js'),'console.log("explorer")');return await action(root);}finally{const path=resolve(root);assert.ok(path.startsWith(resolve(tmpdir())+sep)&&path.split(sep).at(-1).startsWith('fractal-web-ota-'));await rm(path,{recursive:true,force:true});}}
test('Android web release is reproducible, complete, compressed, and excludes its own publication files',async()=>fixture(async root=>{
  const options={minVersionCode:22,builtAt:2000};const first=await packageAndroidWeb(root,options),archive=await readFile(join(root,'android-web',first.archive));
  assert.equal(sha(archive),first.sha256);assert.equal(archive.length,first.bytes);assert.equal(first.files.length,3);
  const entries=new Map();let at=0;
  while(archive.readUInt32LE(at)===0x04034b50){assert.equal(archive.readUInt16LE(at+8),8);const size=archive.readUInt32LE(at+18),length=archive.readUInt16LE(at+26),extra=archive.readUInt16LE(at+28),start=at+30+length+extra,name=archive.subarray(at+30,at+30+length).toString();entries.set(name,inflateRawSync(archive.subarray(start,start+size)));at=start+size;}
  for(const file of first.files){const bytes=entries.get(file.name);assert.equal(bytes.length,file.bytes);assert.equal(sha(bytes),file.sha256);assert.equal(bytes.equals(await readFile(join(root,file.name))),true);}
  assert.deepEqual(JSON.parse(entries.get('android-web-info.json')), {id:first.id,builtAt:2000,minVersionCode:22});
  assert.deepEqual(await packageAndroidWeb(root,options),first);assert.equal((await readFile(join(root,'android-web',first.archive))).equals(archive),true);
  assert.ok(![...entries.keys()].some(name=>name.startsWith('android-web/')));
}));
test('changing web content or minimum native version produces a different release identity',async()=>fixture(async root=>{
  const a=await packageAndroidWeb(root,{minVersionCode:22,builtAt:2000});await writeFile(join(root,'assets/app.js'),'updated();');
  const b=await packageAndroidWeb(root,{minVersionCode:22,builtAt:2000}),c=await packageAndroidWeb(root,{minVersionCode:23,builtAt:2000});
  assert.notEqual(a.id,b.id);assert.notEqual(b.id,c.id);assert.equal(c.minVersionCode,23);
}));
test('invalid publication metadata and nonportable filenames fail before a bundle is published',async()=>fixture(async root=>{
  await assert.rejects(packageAndroidWeb(root,{minVersionCode:21,builtAt:2000}),/metadata/);
  await assert.rejects(packageAndroidWeb(root,{minVersionCode:22,builtAt:0}),/metadata/);
  await writeFile(join(root,'bad name.js'),'bad');await assert.rejects(packageAndroidWeb(root,{minVersionCode:22,builtAt:2000}),/entry/);
}));
