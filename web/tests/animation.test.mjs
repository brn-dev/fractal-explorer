import test from 'node:test';
import assert from 'node:assert/strict';
import { animationParameters, animationPlan, cycleShapes, defaultAutomation, validateAutomation, cacheDimensions, cacheMemoryOptionsMiB, cacheMemorySetting, cacheMemoryLabel, FrameSchedule, ProgressiveAnimation } from '../src/animation.mjs';
import { animationExport, ditherFrame } from '../src/animation-export.mjs';
import { defaultView } from '../src/fractals.mjs';
import { compare, decimal, plainText } from '../src/decimal.mjs';

const base = { x:'0', y:'0', span:'3.6', fractal:'julia', iterations:800, bailout:64, julia_x:'-.8', julia_y:'.156' };
const settings = { julia_x:{enabled:true,target:'-.7',speed:.25} };
const flush = () => new Promise(resolve => setImmediate(resolve));

test('automation targets display ordinary decimals without rounding exact values', () => {
  for (const [input, expected] of [['-3982e-4','-0.3982'], ['32e-2','0.32'], ['1e3','1000'], ['-1e-7','-0.0000001'], ['0e20','0']]) {
    assert.equal(plainText(decimal(input)), expected);
  }
  const exact = '-0.' + '1234567890'.repeat(20) + '1';
  assert.equal(plainText(decimal(exact)), exact);
  const extreme = plainText(decimal('1e-24000'));
  assert.equal(compare(decimal(extreme), decimal('1e-24000')), 0);
  const view = { ...base, julia_x: '-0.4182', julia_y: '0.3' };
  for (const [key, expected] of [['julia_x', '-0.3982'], ['julia_y', '0.32']]) {
    assert.equal(defaultAutomation(view, animationParameters(view).find(p => p.key === key)).target, expected);
  }
});

test('all fractal controls and iterations have valid automation defaults', () => {
  for (const fractal of ['mandelbrot','julia','cubic','multibrot','multijulia','phoenix','ship-julia','newton']) {
    const v = defaultView(base, fractal);
    for (const p of animationParameters(v)) assert.ok(validateAutomation(v, {[p.key]:defaultAutomation(v,p)})[p.key]);
  }
  for (const speed of [0,.01,.14,2.05,Infinity,NaN]) assert.throws(()=>animationPlan(base,{julia_x:{...settings.julia_x,speed}}));
  assert.throws(()=>animationPlan(base,{julia_x:{...settings.julia_x,target:'Infinity'}}));
  assert.equal(animationPlan(base,{}),null);
});
test('independent speeds make a bounded, seamless joint cycle', () => {
  const plan = animationPlan(base,{...settings,julia_y:{enabled:true,target:'.25',speed:.15}});
  assert.equal(plan.duration,20);assert.equal(plan.frames,600);
  assert.deepEqual(plan.channels.map(p=>p.cycles),[5,3]);
  assert.deepEqual(plan.viewAt(0),base);assert.deepEqual(plan.viewAt(600),base);
  assert.equal(plan.viewAt(300).julia_x,'-.7');assert.equal(plan.viewAt(300).julia_y,'.25');
  for (let i=1;i<300;i++) assert.deepEqual(plan.viewAt(i),plan.viewAt(600-i));
});

test('cycle shapes preserve legacy motion, validate saved choices, and default new loops to smootherstep', () => {
  assert.equal(validateAutomation(base,settings).julia_x.shape,'sine');
  assert.equal(defaultAutomation(base,animationParameters(base)[0]).shape,'smootherstep');
  for(const shape of Object.keys(cycleShapes)) {
    const valid=validateAutomation(base,{julia_x:{...settings.julia_x,shape}});
    assert.deepEqual(validateAutomation(base,JSON.parse(JSON.stringify(valid))),valid);
  }
  for(const shape of ['unknown','__proto__','toString',5,{}]) assert.throws(()=>animationPlan(base,{julia_x:{...settings.julia_x,shape}}));
});

test('all cycle shapes remain bounded and mirror exact endpoints and cached return frames', () => {
  const a='0.'+'1'.repeat(150)+'2',b='0.'+'1'.repeat(150)+'4';
  for(const shape of Object.keys(cycleShapes)) {
    const view={...base,julia_x:a},plan=animationPlan(view,{julia_x:{...settings.julia_x,target:b,shape}});
    assert.deepEqual(plan.viewAt(0),view);assert.deepEqual(plan.viewAt(120),view);assert.equal(plan.viewAt(60).julia_x,b);
    let previous=decimal(a);
    for(let i=1;i<=60;i++) {
      const current=decimal(plan.viewAt(i).julia_x);
      assert.ok(compare(current,previous)>=0);assert.ok(compare(current,decimal(b))<=0);
      assert.deepEqual(plan.viewAt(i),plan.viewAt(120-i));previous=current;
    }
    const v=defaultView(base,'newton'),integer=animationPlan(v,{power:{enabled:true,target:'8',speed:.25,shape}});
    for(let i=0;i<integer.frames;i++) assert.ok(Number.isInteger(integer.viewAt(i).power));
  }
});

test('eased turns slow down and ease-and-pause holds both endpoints', () => {
  const view={...base,julia_x:'0',julia_y:'0'};
  const plan=shape=>animationPlan(view,{julia_x:{enabled:true,target:'1',speed:.25,shape}});
  const linear=Number(plan('linear').viewAt(1).julia_x);
  for(const shape of ['sine','smoothstep','smootherstep','hold']) assert.ok(Number(plan(shape).viewAt(1).julia_x)<linear);
  const hold=plan('hold');
  for(const i of [0,1,8,9,111,119,120]) assert.equal(Number(hold.viewAt(i).julia_x),0);
  for(const i of [51,59,60,61,69]) assert.equal(Number(hold.viewAt(i).julia_x),1);
  const mixed=animationPlan(view,{julia_x:{enabled:true,target:'1',speed:.25,shape:'linear'},julia_y:{enabled:true,target:'1',speed:.25,shape:'smootherstep'}});
  assert.equal(Number(mixed.viewAt(15).julia_x),.25);assert.equal(Number(mixed.viewAt(15).julia_y),.103515625);
});

test('middle variants slow through the midpoint while retaining smooth endpoint turns', () => {
  for(const shape of ['slow-middle','pause-middle']) {
    const ease=cycleShapes[shape].ease;
    assert.equal(ease(0),0);assert.equal(ease(.5),.5);assert.equal(ease(1),1);
    assert.ok(ease(.51)-ease(.49)<.0001);
    assert.ok(ease(.01)<.0001);assert.ok(1-ease(.99)<.0001);
  }
  const view={...base,julia_x:'0'},plan=animationPlan(view,{julia_x:{enabled:true,target:'1',speed:.25,shape:'pause-middle'}});
  for(const index of [24,25,30,35,36,84,90,96]) assert.equal(Number(plan.viewAt(index).julia_x),.5);
  assert.ok(Number(plan.viewAt(23).julia_x)<.5);assert.ok(Number(plan.viewAt(37).julia_x)>.5);
});

test('continuous slow middle retains nonzero speed through the center and smooth endpoint turns', () => {
  const ease=cycleShapes['smooth-middle'].ease,h=.00001;
  const speed=t=>(ease(t+h)-ease(t-h))/(2*h);
  assert.equal(ease(0),0);assert.equal(ease(.5),.5);assert.equal(ease(1),1);
  assert.ok(speed(.5)>.3&&speed(.5)<.5);assert.ok(speed(.25)>3*speed(.5));
  assert.ok(ease(.49)<.5&&ease(.51)>.5);
  assert.ok(ease(h)/h<.0001);assert.ok((1-ease(1-h))/h<.0001);
  assert.equal(cycleShapes['slow-middle'].label,'Ease to middle');
  assert.ok((cycleShapes['slow-middle'].ease(.5+h)-cycleShapes['slow-middle'].ease(.5-h))/(2*h)<.0001);
});
test('decimal paths preserve tiny differences, exact targets, and integer powers', () => {
  const a='0.'+'1'.repeat(150)+'2', b='0.'+'1'.repeat(150)+'4';
  const plan=animationPlan({...base,julia_x:a},{julia_x:{enabled:true,target:b,speed:.25}});
  assert.equal(plan.viewAt(60).julia_x,b);
  const mid=plan.viewAt(30).julia_x;
  assert.ok(compare(decimal(mid),decimal(a))>0);assert.ok(compare(decimal(mid),decimal(b))<0);
  const v=defaultView(base,'newton'), p=animationPlan(v,{power:{enabled:true,target:'8',speed:.25}});
  for(let i=0;i<p.frames;i++)assert.ok(Number.isInteger(p.viewAt(i).power));
  assert.throws(()=>animationPlan(v,{power:{enabled:true,target:'3.5',speed:.25}}));
});

test('resuming at a new location preserves the held cycle position, direction, and independent parameter rates', () => {
  for (const shape of Object.keys(cycleShapes)) {
    const settings={julia_x:{enabled:true,target:'-.6',speed:.1,shape},julia_y:{enabled:true,target:'.4',speed:.2,shape}};
    const original=animationPlan(base,settings), moved={...base,x:'.125',y:'-.05',span:'.4'};
    for (const offset of [37,original.frames-37,original.frames+37]) {
      const resumed=animationPlan(moved,settings,30,offset);
      assert.equal(resumed.frameOffset,offset%original.frames);
      assert.equal(resumed.frames,original.frames);
      for (const index of [0,1,23,resumed.frames-1,resumed.frames]) {
        const expected=original.viewAt(index+offset), actual=resumed.viewAt(index);
        assert.equal(actual.julia_x,expected.julia_x);assert.equal(actual.julia_y,expected.julia_y);
        assert.equal(actual.x,moved.x);assert.equal(actual.y,moved.y);assert.equal(actual.span,moved.span);
      }
      const movedAgain=animationPlan({...moved,x:'.25'},settings,30,resumed.frameOffset+23);
      assert.equal(movedAgain.viewAt(0).julia_x,resumed.viewAt(23).julia_x);
      assert.equal(movedAgain.viewAt(0).julia_y,resumed.viewAt(23).julia_y);
      assert.deepEqual(resumed.viewAt(0),resumed.viewAt(resumed.frames));
      assert.deepEqual(resumed.settings,original.settings);
    }
  }
});
test('a slow first pass skips missed deadlines and fills every remaining hole', () => {
  const schedule=new FrameSchedule(120);
  assert.equal(schedule.next(0),0);schedule.complete([0],1000);
  assert.equal(schedule.next(1000),1);schedule.complete([1],1120);
  assert.equal(schedule.next(1120),4); // 2 and 3 missed their deadlines.
  let time=1120, next=4;
  while(schedule.firstPass){schedule.complete([next],time+=120);next=schedule.next(time);}
  assert.ok(!schedule.ready.has(2));assert.ok(!schedule.ready.has(3));
  let iterations=0;
  while(next!==null&&iterations++<120){schedule.complete([next],time+=120);next=schedule.next(time);}
  assert.equal(schedule.ready.size,120);assert.equal(next,null);
  for(let index=0;index<120;index++)assert.equal(schedule.visible(1000+index*1000/30+.001),index);
});
test('pause freezes playback and rendering during a suspended first frame', () => {
  const schedule=new FrameSchedule(120);schedule.pause(100);schedule.complete([0],500);schedule.resume(1000);
  assert.equal(schedule.index(1000),0);assert.equal(schedule.index(1100),3);
  schedule.pause(1100);assert.equal(schedule.index(7000),3);schedule.resume(8000);assert.equal(schedule.index(8000),3);
});
test('mirror aliases do not prematurely end the first pass', () => {
  const s=new FrameSchedule(120);s.complete([0],0);assert.equal(s.next(0),1);
  s.complete([1,119],10);assert.equal(s.next(10),2);assert.equal(s.firstPass,true);
});
test('cache memory preferences restore valid limits and choose device defaults', () => {
  assert.equal(cacheMemorySetting(),2048);assert.equal(cacheMemorySetting(undefined,true),256);
  for(const value of cacheMemoryOptionsMiB) for(const mobile of [false,true]) assert.equal(cacheMemorySetting(value,mobile),value);
  for(const value of [null,0,-1,'2048',NaN,Infinity,32768]) {
    assert.equal(cacheMemorySetting(value),2048);assert.equal(cacheMemorySetting(value,true),256);
  }
  assert.equal(cacheMemoryLabel(256),'256 MB');assert.equal(cacheMemoryLabel(2048),'2 GB');assert.equal(cacheMemoryLabel(16384),'16 GB');
});

test('cache resolutions fit phone and multi-gigabyte desktop budgets without overflow', () => {
  for(const budget of cacheMemoryOptionsMiB.map(n=>n*1048576))for(const frames of [15,120,600]){
    const d=cacheDimensions({width:7680,height:4320},frames,budget);
    assert.ok(d.width*d.height*4*(frames+2)<=budget);
    assert.ok(d.width>=16&&d.height>=16);assert.ok(Math.abs(d.width/d.height-16/9)<.025);
  }
  const dimensions={width:3840,height:2160,capped:false}, small=cacheDimensions(dimensions,120,256*1048576), large=cacheDimensions(dimensions,120,2048*1048576);
  assert.ok(large.width>small.width*2);assert.ok(large.height>small.height*2);
  const full=cacheDimensions(dimensions,120,16384*1048576);
  assert.equal(full.width,3840);assert.equal(full.height,2160);assert.equal(full.capped,false);
});
test('changed settings discard late frames, then restart at frame zero', async () => {
  let finish, time=0; const shown=[], starts=[];
  const player=new ProgressiveAnimation({now:()=>time,render:view=>{starts.push(view.julia_x);return new Promise(resolve=>{finish=resolve;});},present:frame=>shown.push(frame.view.julia_x)});
  const a=animationPlan(base,settings), b=animationPlan({...base,julia_x:'-.9'},settings);
  player.configure(a,{width:16,height:16});player.tick(0);await flush();
  player.configure(b,{width:16,height:16});finish({field:new Float32Array(256),metadata:{}});await flush();
  assert.equal(player.schedule.ready.size,0);assert.equal(shown.length,0);assert.equal(player.cachedBytes,0);
  time=100;player.tick(time);await flush();assert.deepEqual(starts,['-.8','-.9']);
  finish({field:new Float32Array(256),metadata:{}});await flush();player.paused=true;player.tick(200);assert.deepEqual(shown,['-.9']);
  player.paused=false;player.tick(300);assert.deepEqual(shown,['-.9']);
  player.configure(null);assert.equal(player.frames.length,0);
  assert.equal(player.cachedBytes,0);
});
test('a paused animation refreshes frame zero for a changed view without backfilling', async () => {
  let renders=0,time=0;const shown=[];
  const player=new ProgressiveAnimation({now:()=>time,render:async()=>({field:new Float32Array(256),metadata:{id:renders++}}),present:frame=>shown.push(frame.view.x)});
  player.paused=true;player.configure(animationPlan(base,settings),{width:16,height:16});player.tick(time);await flush();player.tick(time+=100);
  assert.equal(renders,1);assert.deepEqual(shown,['0']);
  player.configure(animationPlan({...base,x:'.1'},settings),{width:16,height:16});player.tick(time);await flush();player.tick(time+=100);
  assert.equal(renders,2);assert.deepEqual(shown,['0','.1']);
  for(let i=0;i<20;i++)player.tick(time+=100);assert.equal(renders,2);
});

test('pause holds the displayed values when an in-flight frame finishes, then resumes the existing cache', async () => {
  let finish, time=0, renders=0; const shown=[];
  const player=new ProgressiveAnimation({now:()=>time,
    render:()=>{renders++;return new Promise(resolve=>{finish=resolve;});},
    present:(frame,index)=>shown.push({frame,index})});
  player.configure(animationPlan(base,settings),{width:16,height:16});
  player.tick(time);await flush();finish({field:new Float32Array(256),metadata:{}});await flush();
  player.tick(time);await flush();
  assert.equal(renders,2);assert.equal(shown.length,1);
  const held=player.lastShown, frames=player.frames;
  time=40;player.setPaused(true);
  const elapsed=player.schedule.elapsed(time);
  time=1000;finish({field:new Float32Array(256),metadata:{}});await flush();
  for(let i=0;i<10;i++)player.tick(time+=100);
  assert.equal(player.lastShown,held);assert.equal(shown.length,1);assert.equal(renders,2);
  assert.equal(player.schedule.elapsed(time),elapsed);
  assert.ok(player.schedule.ready.has(1));
  player.tick(time,false,true); // Recoloring can still repaint the held field.
  assert.equal(shown.at(-1).frame,held);assert.equal(renders,2);
  time+=500;player.setPaused(false);
  assert.equal(player.schedule.elapsed(time),elapsed);assert.equal(player.frames,frames);
  player.tick(time);await flush();
  assert.equal(shown.at(-1).index,1);assert.equal(renders,3);
  time+=100;finish({field:new Float32Array(256),metadata:{}});await flush();
  assert.ok(player.schedule.ready.size>2);
});
test('a complete RAM cache plays at 30 fps without new renders', async () => {
  let renders=0,time=0;const shown=[];
  const plan=animationPlan(base,{julia_x:{...settings.julia_x,speed:2}});
  const player=new ProgressiveAnimation({now:()=>time,render:async()=>({field:new Float32Array(256),metadata:{id:renders++}}),present:(_,i)=>shown.push(i)});
  player.configure(plan,{width:16,height:16});
  for(let i=0;i<40;i++){time=i*40;player.tick(time);await flush();}
  assert.equal(player.schedule.ready.size,plan.frames);const count=renders;
  assert.equal(player.cachedBytes,renders*256*4);
  for(let i=0;i<plan.frames;i++){time+=1000/30+.001;player.tick(time);await flush();}
  assert.equal(renders,count);assert.equal(new Set(shown.slice(-plan.frames)).size,plan.frames);
});

test('cache RAM counts whole shared buffers once and resets when released', async () => {
  const shared=new Float32Array(1024);let time=0;
  const player=new ProgressiveAnimation({now:()=>time,render:async()=>({field:shared.subarray(0,256),metadata:{}}),present:()=>{}});
  const plan=animationPlan(base,{julia_x:{...settings.julia_x,speed:2}});
  player.configure(plan,{width:16,height:16});
  for(let i=0;i<40;i++){time=i*40;player.tick(time);await flush();}
  assert.equal(player.schedule.ready.size,plan.frames);assert.equal(player.cachedBytes,shared.buffer.byteLength);
  player.configure(null);assert.equal(player.cachedBytes,0);assert.equal(player.cacheBuffers.size,0);
});

const state={view:base,automation:settings,aspect:9/16,colors:{phase:0},visibleView:base};
const output={mode:'parameters',format:'mp4',quality:'high',longest:720,fps:30,start:.2,speed:.12,wander:true,duration:4};
test('MP4 and GIF share the parameter path at independently chosen sizes and frame rates',()=>{
  const p=animationExport(state,output),g=animationExport(state,{...output,format:'gif',quality:'draft',fps:15,longest:1080});
  assert.equal(p.frames,120);assert.equal(g.frames,60);assert.equal(g.paletteSize,64);
  assert.equal(p.width%2,0);assert.equal(p.height%2,0);assert.equal(g.width,1080);
  assert.deepEqual(p.viewAt(30),g.viewAt(15));assert.equal(p.phaseAt(120),p.phaseAt(0));
  assert.ok(animationExport(state,{...output,quality:'draft'}).bitrate<p.bitrate);
  assert.throws(()=>animationExport(state,{...output,format:'gif',fps:60}));
});

test('Ultra and Extreme MP4 quality preserve detail with substantially higher bitrates',()=>{
  const options={...output,longest:1920,aspectRatio:'16:9'};
  const high=animationExport(state,options),ultra=animationExport(state,{...options,quality:'ultra'}),extreme=animationExport(state,{...options,quality:'extreme'});
  assert.equal(high.bitrate,14929920);
  assert.equal(ultra.bitrate,59719680);
  assert.equal(extreme.bitrate,149299200);
  for (const p of [ultra,extreme]) {
    assert.equal(p.width,high.width);assert.equal(p.height,high.height);assert.equal(p.frames,high.frames);
    assert.deepEqual(p.viewAt(30),high.viewAt(30));assert.equal(p.phaseAt(30),high.phaseAt(30));
  }
});

test('high-resolution MP4 quality has distinct bitrate ceilings and GIF retains its palette limits',()=>{
  const options={...output,longest:3840,aspectRatio:'1:1',fps:60};
  for (const [quality,bitrate] of [['high',80e6],['ultra',240e6],['extreme',600e6]]) {
    assert.equal(animationExport(state,{...options,quality}).bitrate,bitrate);
  }
  for (const [quality,paletteSize] of [['draft',64],['balanced',128],['high',256]]) {
    assert.equal(animationExport(state,{...output,format:'gif',quality}).paletteSize,paletteSize);
  }
  for (const quality of ['ultra','extreme']) {
    assert.throws(()=>animationExport(state,{...output,format:'gif',quality}),/require MP4/);
  }
});

test('animation aspect defaults to the main view, including portrait views',()=>{
  for (const [aspect, width, height] of [[9/16,720,406],[1,720,720],[1.5,480,720]]) {
    const source={...state,aspect};
    const implicit=animationExport(source,output),explicit=animationExport(source,{...output,aspectRatio:'view'});
    assert.equal(implicit.width,width);assert.equal(implicit.height,height);
    assert.equal(explicit.width,width);assert.equal(explicit.height,height);
    assert.equal(source.aspect,aspect);
  }
});

test('aspect overrides render all animation modes and formats at the selected shape',()=>{
  const sizes=[['16:9',1920,1080],['1:1',1920,1920],['21:9',1920,822],['9:16',1080,1920],['4:3',1920,1440],['3:2',1920,1280]];
  for (const format of ['gif','mp4']) for (const mode of ['parameters','colors','zoom']) {
    const options={...output,format,mode,longest:1920,fps:10,speed:2};
    const original=animationExport(state,options);
    for (const [aspectRatio,width,height] of sizes) {
      const p=animationExport(state,{...options,aspectRatio});
      assert.equal(p.width,width);assert.equal(p.height,height);
      assert.deepEqual(p.viewAt(0),original.viewAt(0));
      assert.deepEqual(p.viewAt(p.frames-1),original.viewAt(original.frames-1));
      assert.equal(p.frames,original.frames);
    }
  }
  assert.equal(state.aspect,9/16);
});

test('aspect overrides respect the GIF memory budget and reject unknown ratios',()=>{
  const options={...output,mode:'zoom',format:'gif',longest:1920,fps:15};
  assert.doesNotThrow(()=>animationExport({...state,mobile:true},{...options,aspectRatio:'21:9'}));
  assert.throws(()=>animationExport({...state,mobile:true},{...options,aspectRatio:'1:1'}),/too large/);
  for (const aspectRatio of ['invalid','0:1','__proto__',null]) {
    assert.throws(()=>animationExport(state,{...output,aspectRatio}),/aspect ratio/);
  }
});

test('GIF and MP4 export use every selected cycle shape at matching timestamps',()=>{
  for(const shape of Object.keys(cycleShapes)) {
    const source={...state,automation:{julia_x:{...settings.julia_x,shape}}};
    const live=animationPlan(source.view,source.automation),mp4=animationExport(source,{...output,fps:60}),gif=animationExport(source,{...output,format:'gif',fps:15});
    assert.equal(mp4.parameters.channels[0].shape,shape);
    for(let i=0;i<gif.frames;i++) {
      assert.deepEqual(gif.viewAt(i),live.viewAt(i*2));assert.deepEqual(gif.viewAt(i),mp4.viewAt(i*4));
    }
    assert.equal(mp4.viewAt(mp4.frames/2).julia_x,settings.julia_x.target);
  }
});
test('GIF timing distributes 30/40ms frames without changing total animation duration',()=>{
  for(const fps of [10,15,24,30]){
    const p=animationExport(state,{...output,format:'gif',fps});
    const delays=Array.from({length:p.frames},(_,i)=>p.delay(i));
    assert.ok(delays.every(d=>d>=30&&d%10===0));assert.equal(delays.reduce((a,b)=>a+b,0),4000);
  }
});
test('colors and zoom exports preserve their respective loop and endpoint behavior',()=>{
  const c=animationExport(state,{...output,mode:'colors',wander:true});assert.equal(c.viewAt(8),base);assert.equal(c.looping,true);
  const z=animationExport(state,{...output,mode:'zoom',wander:false});
  assert.equal(compare(decimal(z.viewAt(0).span),decimal(base.span)),0);assert.equal(Number(z.viewAt(z.frames-1).span),Number(base.span)/8);assert.equal(z.looping,false);
  assert.throws(()=>animationExport({...state,automation:{}},output));
  assert.throws(()=>animationExport(state,{...output,mode:'zoom',duration:0}));
  assert.throws(()=>animationExport(state,{...output,format:'gif',longest:3840}));
});
test('ordered GIF dithering preserves opacity and exact interior pixels',()=>{
  const bytes=new Uint8ClampedArray([8,17,18,255,128,128,128,255,128,128,128,255]);
  const out=ditherFrame(bytes,2);assert.deepEqual([...out.slice(0,4)],[8,17,18,255]);assert.equal(out[7],255);assert.notDeepEqual(out,bytes);
});
