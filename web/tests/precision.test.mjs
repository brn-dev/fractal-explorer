import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decimal, text, navigate, compare, pixelView, validate } from '../src/decimal.mjs';
import { wide, wm, wa, magnitude, log } from '../src/wide.mjs';
import { reference, exactPixels, prepare, clearCaches } from '../src/reference.mjs';
import { softwareRender } from '../src/software.mjs';
import { zoomLabel } from '../src/numbers.mjs';

const base = { x:'-.5', y:'0', span:'3.6', fractal:'mandelbrot', julia_x:'-.8', julia_y:'.156', iterations:800, bailout:64 };
const fixture = JSON.parse(await readFile(new URL('./oracle.json', import.meta.url), 'utf8'));

test('decimal navigation retains a supplied thousand-digit center and tiny reversible shifts',()=>{
  const x = '-0.'+'7'.repeat(1050), v={...base,x,span:'1e-1000'};
  const p=navigate({view:v,dx:.125,dy:-.125});
  assert.notEqual(p.x,x);
  const back=navigate({view:p,dx:-.125,dy:.125});
  assert.equal(compare(decimal(back.x),decimal(x)),0); assert.equal(back.y,'0');
  const z=navigate({view:v,factor:2});assert.equal(compare(decimal(z.span),decimal('5e-1001')),0);
  assert.equal(zoomLabel('1e-10000'),'3.60e+10000×');
});
test('pixel centers use exact decimal/rational offsets and validation rejects unsafe inputs',()=>{
  const v={...base,x:'0',span:'1e-1000'};
  assert.equal(compare(decimal(pixelView(v,0,0,20,20).x),decimal('-4.75e-1001')),0);
  for(const span of ['0','NaN','1e-10001','17','1e999999999'])assert.throws(()=>validate({...v,span}));
  assert.throws(()=>validate({...v,fractal:'tricorn'}));assert.throws(()=>decimal('1'.repeat(12065)));
});
test('extended exponent arithmetic preserves squared offsets below IEEE exponent range',()=>{
  const a=wide(.75,-33000), squared=wm(a,a);
  assert.equal(squared.e,-66000);assert.equal(squared.m,.5625);
  const b=wa(a,wide(-.5,-33000));assert.equal(b.e,-33001);assert.equal(b.m,.5);
  assert.equal(log(magnitude({r:a,i:wide(0)})),Math.log2(.75)-33000);
});
for(const c of fixture.cases)test(`MPFR WebAssembly agrees with independent Python oracle: ${c.name}`,async()=>{
  const got=await exactPixels(c.view,c.points,c.width,c.height);
  c.expected.forEach((v,k)=>assert.ok(Math.abs(got.values[k]-v)<.002,`${c.name}: ${got.values[k]} vs ${v}`));
});
for(const name of ['deep80','deep1000','criticalJulia'])test(`series skips useful work without losing oracle agreement: ${name}`,async()=>{
  const c=fixture.cases.find(c=>c.name===name);
  const p=await prepare(c.view,c.width,c.height,'series');
  assert.ok(p.approximation.seriesN>100);assert.ok(p.orbit.digits>=-Number(c.view.span.split('e')[1]||0)+30);
  const got=await softwareRender(c.view,c.width,c.height,'series');
  c.points.forEach(([col,row],k)=>assert.ok(Math.abs(got.field[row*c.width+col]-c.expected[k])<.002));
});
test('reference and approximation caches reuse working precision and preparation',async()=>{
  clearCaches();const v=fixture.cases.find(c=>c.name==='deep1000').view;
  const a=await reference(v),b=await reference({...v,span:'5e-1001'});
  assert.equal(a.hit,false);assert.equal(b.hit,true);
  assert.equal(b.orbit.span.e,a.orbit.span.e-1);assert.equal(b.orbit.span.m,a.orbit.span.m);
  const p=await prepare(v,64,48,'series-bla');assert.ok(p.approximation.offsets.length>5);
  const q=await prepare(v,64,48,'series-bla');assert.equal(q.preparationHit,true);
  for(const level of p.approximation.nodes)for(const n of level)assert.ok(n.radius.m>=0);
});
for(const name of ['overview','burningShip','tricorn','cubic'])test(`CPU fallback matches independent oracle: ${name}`,async()=>{
  const c=fixture.cases.find(c=>c.name===name), got=await softwareRender(c.view,c.width,c.height);
  c.points.forEach(([col,row],k)=>assert.ok(Math.abs(got.field[row*c.width+col]-c.expected[k])<.002));
});
