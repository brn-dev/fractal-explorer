import test from 'node:test';
import assert from 'node:assert/strict';
import { wallpaperFrame } from '../src/wallpaper-frame.mjs';
import { wallpaperPlan, wallpaperScreenDraft, defaultWallpaperDraft, wallpaperScreenSize } from '../src/wallpaper.mjs';
import { createWallpaperURL, readWallpaperURL } from '../src/wallpaper-share.mjs';
import { screenPoint, gestureView } from '../src/navigation.mjs';
import { navigate, compare, decimal } from '../src/decimal.mjs';

const snapshot = { view: { fractal:'mandelbrot', x:'-.5', y:'0', span:'3.6', julia_x:'-.8', julia_y:'.156', iterations:100, bailout:64 },
  settings:{}, automation:{}, colors:{definition:{name:'Test',colors:['#000000','#ffffff']},density:1,phase:0}, speed:.12, wander:false };

test('Fold8 Ultra preset supplies full native dimensions without a phone or stored screen sizes', async () => {
  for (const [screen, size] of [['cover',{width:1080,height:2520}], ['inner',{width:2256,height:2504}]]) {
    const draft = defaultWallpaperDraft(snapshot,screen); draft.displayProfile='fold8-ultra'; draft.longest='native'; delete draft.screenSizes;
    const plans=wallpaperPlan(draft); assert.ok(plans.every(p=>p.width===size.width&&p.height===size.height));
    const portable=wallpaperScreenDraft(draft,screen); assert.deepEqual(portable.screenSizes[screen],size);
    assert.deepEqual(await readWallpaperURL(await createWallpaperURL('https://example.org/',draft)),portable);
    draft.screenSizes={[screen]:{width:720,height:1280}};
    assert.deepEqual(wallpaperScreenSize(draft,screen),size,'explicit preset takes priority over another device');
    const copied=wallpaperScreenSize(draft,screen);copied.width=16;assert.deepEqual(wallpaperScreenSize(draft,screen),size);
    draft.displayProfile='unknown-device';assert.throws(()=>wallpaperPlan(draft),/supported target device/);
  }
});

test('target frame keeps the entire export proportions visible above the editing toolbar', () => {
  for(const [width,height,toolbar] of [[1440,900,120],[390,844,210],[900,390,160],[2560,1440,100]]) for(const target of [{width:1080,height:2520},{width:2256,height:2504}]) {
    const frame=wallpaperFrame(width,height,target,toolbar);
    assert.ok(frame.left>=16-1e-8&&frame.left+frame.width<=width-16+1e-8);
    assert.ok(frame.top>=0&&frame.top+frame.height<=height-Math.min(Math.max(28,toolbar+30),height*.6)+1e-8);
    assert.ok(Math.abs(frame.height/frame.width-target.height/target.width)<1e-12);
    assert.ok(Math.abs(frame.left+frame.width/2-width/2)<1e-8);
  }
});

test('framed pointer navigation uses the target rectangle origin and preserves off-center zoom anchors', () => {
  const viewport=wallpaperFrame(1440,900,{width:1080,height:2520},120);
  const center=screenPoint(viewport.left+viewport.width/2,viewport.top+viewport.height/2,viewport);
  assert.ok(Math.abs(center.dx)<1e-12&&Math.abs(center.dy)<1e-12);
  const start={x:viewport.left+viewport.width*.2,y:viewport.top+viewport.height*.7};
  const current={x:start.x+25,y:start.y-17};
  const local={width:viewport.width,height:viewport.height};
  const target=gestureView(snapshot.view,start,current,1.7,viewport);
  const expected=gestureView(snapshot.view,{x:start.x-viewport.left,y:start.y-viewport.top},{x:current.x-viewport.left,y:current.y-viewport.top},1.7,local);
  assert.equal(compare(decimal(target.x),decimal(expected.x)),0);assert.equal(compare(decimal(target.y),decimal(expected.y)),0);
  assert.equal(target.span,expected.span);
  const zoomed=navigate({view:snapshot.view,...center,factor:2});
  assert.equal(zoomed.span,'18e-1');assert.ok(Math.abs(Number(zoomed.x)+.5)<1e-12&&Math.abs(Number(zoomed.y))<1e-12);
});
