import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from '../node_modules/vite/dist/node/index.js';

// Optional developer dependency; kept out of production and the ordinary Node suite.
const { chromium } = await import(process.env.FRACTAL_PLAYWRIGHT_MODULE
  ? pathToFileURL(path.resolve(process.env.FRACTAL_PLAYWRIGHT_MODULE)).href : 'playwright');
const webRoot = fileURLToPath(new URL('../', import.meta.url));

const out = path.resolve(webRoot,'../artifacts/review-touch-controls');
await fs.mkdir(out, { recursive:true });
const server = await createServer({ root:webRoot, server:{ host:'127.0.0.1',port:8801,strictPort:true } });
await server.listen();
const results = [], errors = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
let browser;
try {
  browser = await chromium.launch({ executablePath:process.env.FRACTAL_CHROME_PATH,headless:true,args:['--enable-unsafe-webgpu'] });
  const context = await browser.newContext({ viewport:{width:420,height:920},isMobile:true,hasTouch:true });
  const page = await context.newPage(), cdp = await context.newCDPSession(page);
  page.on('pageerror', error => errors.push(error.message));
  const send = (type,x,y,id=1) => cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x,y,id}]});
  const stroke = async (a,b,steps=12,delay=16) => {
    await send('touchStart',a.x,a.y);
    for(let i=1;i<=steps;i++) { await sleep(delay);await send('touchMove',a.x+(b.x-a.x)*i/steps,a.y+(b.y-a.y)*i/steps); }
    await send('touchEnd');
  };
  await page.goto('http://127.0.0.1:8801/tests/gpu.html');
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css">
    <style>#scroll{position:absolute;inset:80px 16px auto;height:500px;overflow-y:auto;overscroll-behavior:contain}.row{height:120px;padding:12px}.row input[type=range]{width:100%}.check{height:44px;display:flex;align-items:center;gap:16px}#scroll button{padding:12px}</style>
    <section id="scroll">${Array.from({length:24},(_,i)=>`<div class="row"><label>Range ${i}<input class="parameter-slider" id="r${i}" type="range" min="0" max="100" step="1" value="50"></label><label class="check"><input type="checkbox" id="c${i}"> Toggle ${i}</label></div>`).join('')}</section>`);
  await page.evaluate(async()=>{
    const {setupTouchControls}=await import('/src/touch-controls.js');setupTouchControls();
    window.events=[];document.addEventListener('input',e=>events.push({type:'input',id:e.target.id,value:e.target.value}));document.addEventListener('change',e=>events.push({type:'change',id:e.target.id,value:e.target.value}));
    window.reset=()=>{document.getElementById('scroll').scrollTop=0;for(const e of document.querySelectorAll('input[type=range]'))e.value='50';for(const e of document.querySelectorAll('input[type=checkbox]'))e.checked=false;events.length=0;};
  });
  const box = id => page.locator('#'+id).boundingBox();
  const center = async id => {const b=await box(id);return{x:b.x+b.width/2,y:b.y+b.height/2};};
  const value = id => page.locator('#'+id).inputValue();
  const logs = () => page.evaluate(()=>events);
  const reset = async()=>{await page.evaluate(()=>reset());await sleep(300);};
  const scroll = () => page.locator('#scroll').evaluate(e=>e.scrollTop);

  await reset();let p=await center('r2');const start=await scroll();
  await stroke({x:p.x-70,y:p.y},{x:p.x-65,y:p.y-155});await sleep(250);
  assert.ok(await scroll()>start+60);assert.equal(await value('r2'),'50');assert.deepEqual(await logs(),[]);
  results.push({case:'vertical swipe starting on range',scrolls:true,noValueChange:true});

  await reset();p=await center('r2');await stroke({x:p.x-60,y:p.y},{x:p.x-25,y:p.y-150});await sleep(250);
  assert.ok(await scroll()>60);assert.equal(await value('r2'),'50');assert.deepEqual(await logs(),[]);
  results.push({case:'diagonal vertical swipe',scrolls:true,noValueChange:true});

  await reset();p=await center('r2');await send('touchStart',p.x-80,p.y);await sleep(80);
  assert.equal(await value('r2'),'50');assert.deepEqual(await logs(),[]);await send('touchEnd');
  assert.ok(Number(await value('r2'))<40);assert.deepEqual((await logs()).map(e=>e.type),['input','change']);
  results.push({case:'stationary tap',noJumpOnDown:true,changesOnRelease:true});

  await reset();p=await center('r2');await send('touchStart',p.x,p.y);await send('touchMove',p.x+5,p.y+1);
  assert.equal(await value('r2'),'50');await send('touchMove',p.x+12,p.y+1);assert.ok(Number(await value('r2'))>50);
  await send('touchMove',p.x+80,p.y+2);await send('touchEnd');assert.ok(Number(await value('r2'))>70);
  assert.equal((await logs()).filter(e=>e.type==='change').length,1);assert.equal(await scroll(),0);
  results.push({case:'horizontal drag',responsiveAfter8px:true,oneCommit:true,doesNotScroll:true});

  await reset();await page.locator('#scroll').evaluate(e=>e.scrollTop=30);await sleep(30);p=await center('r2');
  await send('touchStart',p.x+90,p.y);await send('touchEnd');assert.equal(await value('r2'),'50');assert.deepEqual(await logs(),[]);
  await sleep(250);await send('touchStart',p.x+90,p.y);await send('touchEnd');assert.ok(Number(await value('r2'))>70);
  results.push({case:'recent scroll then range tap',stopsWithoutChange:true,freshIdleTouchWorks:true});

  await reset();await page.locator('#scroll').evaluate(e=>e.scrollTop=30);await sleep(30);p=await center('c2');
  await send('touchStart',p.x,p.y);await send('touchEnd');assert.equal(await page.locator('#c2').isChecked(),false);
  await sleep(250);await send('touchStart',p.x,p.y);await send('touchEnd');assert.equal(await page.locator('#c2').isChecked(),true);
  results.push({case:'recent scroll then checkbox tap',stopsWithoutToggle:true,freshIdleTouchWorks:true});

  await reset();p=await center('r2');await send('touchStart',p.x,p.y);await send('touchMove',p.x+35,p.y);await send('touchCancel');
  assert.ok(Number(await value('r2'))>50);assert.equal((await logs()).filter(e=>e.type==='change').length,1);
  await page.evaluate(()=>events.length=0);p=await center('r1');await send('touchStart',p.x-60,p.y);await send('touchCancel');
  assert.equal(await value('r1'),'50');assert.deepEqual(await logs(),[]);
  results.push({case:'cancel gestures',acceptedDragCommitsOnce:true,unrecognizedTouchDoesNothing:true});

  await reset();p=await center('r2');await send('touchStart',p.x,p.y);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:p.x,y:p.y},{id:2,x:p.x+40,y:p.y+20}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:p.x+55,y:p.y},{id:2,x:p.x+65,y:p.y+20}]});
  await send('touchEnd');assert.equal(await value('r2'),'50');assert.deepEqual(await logs(),[]);
  results.push({case:'two-finger gesture',noSliderChanges:true});

  await reset();await page.evaluate(()=>{const row=document.createElement('div');row.className='row';row.innerHTML='<input id="dynamic" class="parameter-slider" type="range" min="-2" max="2" step=".0001" value=".156">';document.getElementById('scroll').prepend(row);});
  p=await center('dynamic');await stroke(p,{x:p.x+65,y:p.y});assert.ok(Number(await value('dynamic'))>.156);
  await page.locator('#dynamic').evaluate(e=>e.value='.156');await page.evaluate(()=>events.length=0);p=await center('dynamic');
  await stroke({x:p.x-50,y:p.y},{x:p.x-50,y:p.y-100});assert.equal(Number(await value('dynamic')),.156);assert.deepEqual(await logs(),[]);
  results.push({case:'dynamically added range',horizontalDragWorks:true,verticalSwipeProtected:true});

  // Native fling, followed immediately by a touch on a moving slider.
  await reset();await stroke({x:35,y:520},{x:35,y:180},5,10);await sleep(30);
  const during=await scroll();
  const visible=await page.locator('input[type=range]').evaluateAll(es=>es.filter(e=>{const r=e.getBoundingClientRect();return r.top>100&&r.bottom<550;}).map(e=>e.id));
  assert.ok(visible.length);const target=visible[0];p=await center(target);const old=await value(target);
  await send('touchStart',p.x+55,p.y);await send('touchEnd');assert.equal(await value(target),old);assert.deepEqual(await logs(),[]);
  results.push({case:'native momentum-scroll interception',scrollTop:during,target,noValueChange:true});

  // Mouse and keyboard retain native range behavior, including during scroll cooldown.
  await reset();p=await center('r1');await page.mouse.click(p.x+80,p.y);assert.ok(Number(await value('r1'))>50);
  const before=Number(await value('r1'));await page.locator('#r1').focus();await page.keyboard.press('ArrowLeft');assert.equal(Number(await value('r1')),before-1);
  results.push({case:'mouse and keyboard',nativeBehavior:true});
  await page.screenshot({path:path.join(out,'touch-fixture.png')});

  await context.addInitScript(()=>localStorage.setItem('fractal-web-session',JSON.stringify({view:{fractal:'mandelbrot',x:'-.5',y:'0',span:'3.6',iterations:80,bailout:64,julia_x:'-.8',julia_y:'.156'},quality:.5,placesHidden:true})));
  await page.goto('http://127.0.0.1:8801/');await page.waitForFunction(()=>document.getElementById('render-dot').dataset.state==='ready');
  if(!await page.locator('#view-rotation-slider').isVisible())await page.locator('#toggle-panel').click();
  await page.locator('#view-rotation-slider').scrollIntoViewIfNeeded();await sleep(300);
  await page.evaluate(()=>{window.events=[];document.addEventListener('input',e=>{if(e.target.type==='range')events.push({id:e.target.id,value:e.target.value});});});
  const angle=await value('view-rotation-slider');p=await center('view-rotation-slider');const panelStart=await page.locator('#panel-content').evaluate(e=>e.scrollTop);
  await stroke({x:p.x+40,y:p.y},{x:p.x+45,y:p.y-120});await sleep(250);
  assert.equal(await value('view-rotation-slider'),angle);assert.deepEqual(await logs(),[]);assert.ok(await page.locator('#panel-content').evaluate(e=>e.scrollTop)>panelStart);
  await page.locator('#view-rotation-slider').scrollIntoViewIfNeeded();await sleep(300);p=await center('view-rotation-slider');
  await stroke({x:p.x-70,y:p.y},{x:p.x+70,y:p.y});assert.ok(Number(await value('view-rotation-slider'))>0);assert.equal(await value('view-rotation'),await value('view-rotation-slider'));
  await page.screenshot({path:path.join(out,'phone-settings.png')});
  results.push({case:'real app settings',swipeScrollsWithoutEditing:true,horizontalDragSynchronizesNumber:true});

  await page.locator('#export').click();await page.locator('#open-video-export').click();
  await page.locator('#color-gif-phase-slider').scrollIntoViewIfNeeded();await sleep(300);p=await center('color-gif-phase-slider');
  await stroke({x:p.x-45,y:p.y},{x:p.x+55,y:p.y});assert.ok(Number(await value('color-gif-phase-slider'))>0);
  await sleep(300);const phase=await value('color-gif-phase-slider');await page.evaluate(()=>events.length=0);p=await center('color-gif-phase-slider');
  const beforeDialog=await page.locator('#color-gif-dialog').evaluate(e=>e.scrollTop);
  await stroke({x:p.x-45,y:p.y},{x:p.x-40,y:p.y+140});await sleep(200);
  assert.equal(await value('color-gif-phase-slider'),phase);assert.deepEqual(await logs(),[]);assert.ok(await page.locator('#color-gif-dialog').evaluate(e=>e.scrollTop)<beforeDialog);
  results.push({case:'export dialog range',deliberateDragWorks:true,verticalSwipeProtected:true});
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');

  await page.locator('#fractal').selectOption('julia');
  await page.locator('#automate-julia_x').click();
  await page.locator('#automation-target-julia_x-slider').scrollIntoViewIfNeeded();await sleep(300);
  const targetValue=await value('automation-target-julia_x-slider');p=await center('automation-target-julia_x-slider');await page.evaluate(()=>events.length=0);
  await stroke({x:p.x-40,y:p.y},{x:p.x-35,y:p.y-110});await sleep(200);
  assert.equal(await value('automation-target-julia_x-slider'),targetValue);assert.deepEqual(await logs(),[]);
  await page.locator('#automation-target-julia_x-slider').scrollIntoViewIfNeeded();await sleep(300);p=await center('automation-target-julia_x-slider');
  await stroke({x:p.x-40,y:p.y},{x:p.x+60,y:p.y});assert.notEqual(await value('automation-target-julia_x-slider'),targetValue);
  assert.ok(Math.abs(Number(await value('automation-target-julia_x'))-Number(await value('automation-target-julia_x-slider')))<.001);
  results.push({case:'real dynamic automation target',verticalSwipeProtected:true,horizontalDragSynchronizesTarget:true});

  await page.locator('#toggle-panel').click();await page.waitForTimeout(250);
  const viewBefore=await page.evaluate(()=>JSON.parse(localStorage.getItem('fractal-web-session')).view);
  await stroke({x:140,y:380},{x:185,y:400});await page.waitForFunction(x=>JSON.parse(localStorage.getItem('fractal-web-session')).view.x!==x,viewBefore.x);
  results.push({case:'fractal touch navigation',panStillWorks:true});
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify({results,pageErrors:errors},null,2));console.log(JSON.stringify({results,pageErrors:errors}));
  await context.close();
} finally { await browser?.close();await server.close(); }
