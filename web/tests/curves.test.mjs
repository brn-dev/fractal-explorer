import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCurve, compileCurve, defaultCurve, curveFromFunction, MAX_CURVE_POINTS } from '../src/curve.mjs';
import { paletteColorTable, validateColorCurves, hasColorCurves } from '../src/color-curves.mjs';
import { animationPlan, animationParameters, defaultAutomation, validateAutomation, cycleShapes, cycleCurvePreset } from '../src/animation.mjs';
import { sliderDomain } from '../src/slider-domain.mjs';
import { wallpaperSnapshot, defaultWallpaperDraft, wallpaperPlan, wallpaperTransition, transitionCurves, transitionProgress, wallpaperPaletteDrafts, wallpaperManifest } from '../src/wallpaper.mjs';
import { createWallpaperURL, readWallpaperURL } from '../src/wallpaper-share.mjs';
import { createShareURL, readShareURL } from '../src/share.mjs';

const base={fractal:'julia',x:'0',y:'0',span:'3.6',iterations:80,bailout:64,julia_x:'-.8',julia_y:'.156'};
const palette={name:'Greys',colors:['#000000','#ffffff']};
const tone={points:[[0,0],[.5,.25],[1,1]],interpolation:'smooth'};
const cycle={points:[[0,0],[.2,1],[.6,.4],[1,0]],interpolation:'segments',bends:[-.4,.2,0]};
const transition={points:[[0,0],[.15,.8],[.5,.6],[1,1]],interpolation:'segments',bends:[-.5,0,-.3]};
const close=(a,b,tolerance=1e-10)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);

test('curve validation rejects malformed, unordered, unbounded and oversized data',()=>{
  for(const invalid of [null,[],{}, {points:[[0,0]]},{points:[[.1,0],[1,1]]},{points:[[0,0],[1,.5],[1,1]]},
    {points:[[0,0],[.0001,.1],[1,1]]},{points:[[0,0],[1,NaN]]},{points:[[0,-.1],[1,1]]},
    {points:[[0,0],[1,1]],bends:[2]},{points:[[0,0],[1,1]],bends:[]},{points:[[0,0],[1,1]],interpolation:'unsafe'},
    {points:Array.from({length:MAX_CURVE_POINTS+1},(_,i)=>[i/(MAX_CURVE_POINTS),0])}])assert.throws(()=>validateCurve(invalid));
  assert.throws(()=>validateCurve(defaultCurve(),'cycle'),/return/);
  assert.throws(()=>validateCurve(defaultCurve('cycle'),'transition'),/finish/);
  const raw={points:[[0,.3],[.3,.7],[1,.2]]};const valid=validateCurve(raw);valid.points[1][1]=0;assert.equal(raw.points[1][1],.7);
});

test('smooth curves pass through anchors and stay inside each segment without overshoot',()=>{
  for(const points of [[[0,0],[.1,.9],[.9,.91],[1,1]],[[0,.3],[.1,1],[.2,0],[.9,.5],[1,.5]]]){
    const fn=compileCurve({points});for(const [x,y] of points)close(fn(x),y);
    for(let i=1;i<points.length;i++)for(let t=0;t<=100;t++){
      const [a,b]=[points[i-1],points[i]],y=fn(a[0]+(b[0]-a[0])*t/100);
      assert.ok(y>=Math.min(a[1],b[1])-1e-12&&y<=Math.max(a[1],b[1])+1e-12);
    }
  }
});

test('segment bends preserve endpoints, work in either direction and change the middle',()=>{
  for(const bend of [-1,-.5,0,.5,1])for(const points of [[[0,0],[1,1]],[[0,1],[1,0]]]){
    const fn=compileCurve({points,interpolation:'segments',bends:[bend]});assert.equal(fn(0),points[0][1]);assert.equal(fn(1),points[1][1]);
    const amount=bend>=0?.5**(1+4*bend):1-.5**(1-4*bend);close(fn(.5),points[0][1]+(points[1][1]-points[0][1])*amount);
  }
});

test('all existing cycle and transition presets load as editable full curves within 0.25%',()=>{
  for(const [shape,{ease}] of Object.entries(cycleShapes)){
    const spec=cycleCurvePreset(shape),fn=compileCurve(spec,'cycle');assert.ok(spec.points.length<=MAX_CURVE_POINTS);
    assert.equal(fn(0),0);assert.equal(fn(1),0);
    for(let i=0;i<=1000;i++)close(fn(i/1000),ease(2*Math.min(i/1000,1-i/1000)),.0025);
  }
  for(const {value} of transitionCurves.filter(c=>c.value!=='custom')){
    const fn=compileCurve(curveFromFunction(t=>transitionProgress(t,value),'transition'),'transition');
    for(let i=0;i<=1000;i++)close(fn(i/1000),transitionProgress(i/1000,value),.0025);
  }
});

test('identity palette curves preserve the previous floating point LUT exactly',()=>{
  const definition={colors:['#1041b8','#cddd19','#001221']},table=paletteColorTable(definition),identity=paletteColorTable(definition,{tone:defaultCurve(),red:defaultCurve()});
  for(let i=0;i<4096;i++)for(let c=0;c<3;c++){
    const t=i/4096*2,k=Math.floor(t),f=t-k,a=parseInt(definition.colors[k].slice(1+2*c,3+2*c),16),b=parseInt(definition.colors[k+1].slice(1+2*c,3+2*c),16);
    assert.equal(table[i*3+c],a*(1-f)+b*f);assert.equal(identity[i*3+c],table[i*3+c]);
  }
  assert.equal(hasColorCurves(validateColorCurves({tone:defaultCurve()})),false);
  assert.equal(hasColorCurves(validateColorCurves({tone:{points:[[0,0],[1,1]],interpolation:'segments',bends:[.2]}})),true);
});

test('brightness grades interpolated midtones; RGB curves follow tone and affect only their own channel',()=>{
  const table=paletteColorTable(palette,{tone});for(let c=0;c<3;c++)close(table[2048*3+c],255*.25);
  const red={points:[[0,0],[1,.5]]},graded=paletteColorTable(palette,{tone,red});
  close(graded[2048*3],255*.125);close(graded[2048*3+1],255*.25);close(graded[2048*3+2],255*.25);
  const blue=paletteColorTable(palette,{blue:{points:[[0,.1],[1,1]]}});close(blue[0],0);close(blue[1],0);close(blue[2],25.5);
  const lifted=paletteColorTable(palette,{tone:{points:[[0,.2],[1,1]]}});assert.deepEqual(Array.from(lifted.slice(0,3)),[51,51,51]);
  for(const invalid of [null,[],{pink:tone},{tone:{points:[[0,0],[1,2]]}}])assert.throws(()=>validateColorCurves(invalid));
});

test('custom automation follows an asymmetric full cycle, repeats at exact speeds and closes at the base',()=>{
  const settings={julia_x:{enabled:true,target:'-.6',speed:.25,shape:'custom',curve:cycle}},plan=animationPlan(base,settings,30),fn=compileCurve(cycle,'cycle');
  assert.deepEqual(plan.viewAt(0),base);assert.deepEqual(plan.viewAt(plan.frames),base);
  for(let i=0;i<plan.frames;i++)close(Number(plan.viewAt(i).julia_x),-.8+.2*fn(i/plan.frames));
  assert.notEqual(plan.viewAt(24).julia_x,plan.viewAt(96).julia_x);
  const together=animationPlan(base,{...settings,julia_y:{enabled:true,target:'.3',speed:.15,shape:'sine'}},15);
  assert.equal(together.duration,20);assert.equal(together.channels[0].cycles,5);assert.deepEqual(together.viewAt(300),base);
  assert.equal(together.viewAt(12).julia_x,together.viewAt(72).julia_x);
});

test('custom curve validation rejects broken loop seams and missing curves',()=>{
  for(const entry of [{shape:'custom'},{shape:'custom',curve:transition},{shape:'custom',curve:{points:[[0,0],[1,.1]]}}])
    assert.throws(()=>validateAutomation(base,{rotation:{enabled:true,target:'90',speed:.25,...entry}}));
  const entry={enabled:true,target:'90',speed:.25,shape:'custom',curve:cycle};
  assert.deepEqual(validateAutomation(base,{rotation:entry}).rotation.curve,validateCurve(cycle,'cycle'));
});

test('rotation automation uses zero for legacy scenes and unwrapped targets for full turns',()=>{
  const p=animationParameters(base).find(p=>p.key==='rotation');assert.equal(defaultAutomation(base,p).target,'90');
  for(const [target,quarter,half] of [[90,45,90],[360,180,0],[-360,180,0],[810,45,90]]){
    const plan=animationPlan(base,{rotation:{enabled:true,target:String(target),speed:.25,shape:'linear'}},30);
    assert.equal(plan.viewAt(30).rotation,quarter);assert.equal(plan.viewAt(60).rotation,half);
    assert.deepEqual(plan.viewAt(120),base);assert.deepEqual(plan.viewAt(30),plan.viewAt(90));
  }
  assert.deepEqual(sliderDomain(p,0,90),{min:-360,max:360,step:.1});
  for(const target of [449,810,-810])for(const precision of [false,true]){const d=sliderDomain(p,0,target,precision);assert.ok(d.min<=Math.min(0,target)&&d.max>=Math.max(0,target));}
});

test('custom wallpaper motion can reverse and still meets the exact steady loop and palette grade',()=>{
  const state={view:base,colors:{definition:palette,density:1,phase:0,interiorColor:'#123456',colorCurves:{tone}},speed:.25,automation:{rotation:{enabled:true,target:'360',speed:.25,shape:'custom',curve:cycle}}};
  const draft=defaultWallpaperDraft(wallpaperSnapshot(state,[]),'inner');draft.transitions['open-transition']={seconds:1,easing:'custom',curve:transition};
  const [arrival,steady]=wallpaperPlan(draft);assert.ok(arrival.sample(5).amount>arrival.sample(15).amount);
  assert.deepEqual(arrival.sample(0).view,draft.states['open-transition'].view);
  const last=arrival.sample(arrival.frames-1),first=steady.sample(0);assert.deepEqual(last.view,first.view);assert.deepEqual(last.colors,first.colors);
  assert.deepEqual(first.colors.colorCurves,validateColorCurves({tone}));
  assert.deepEqual(animationPlan(base,state.automation,steady.fps).viewAt(steady.frames),first.view);
  assert.throws(()=>wallpaperTransition({...draft,transitions:{'open-transition':{seconds:1,easing:'custom'}}},'open-transition'));
  draft.paletteVariants=[{name:'Other',colors:['#123456','#fedcba']}];
  for(const output of wallpaperPaletteDrafts(draft))for(const scene of Object.values(output.states))assert.deepEqual(scene.colors.colorCurves,validateColorCurves({tone}));
  assert.deepEqual(wallpaperManifest(draft,[arrival,steady]).editor.transitions['open-transition'].curve,transition);
});

test('color grades, custom cycles, rotation and transition curves survive scene and PC share links',async()=>{
  const automation={rotation:{enabled:true,target:'449',speed:.25,shape:'custom',curve:cycle}};
  const state={view:base,palette:0,colorCurves:{tone,blue:{points:[[0,0],[1,.8]]}},automation};
  for(const compress of [false,true]){
    const link=await createShareURL('https://example.com/',state,25,{compress});const restored=await readShareURL(link,25);
    assert.deepEqual(restored.colorCurves,validateColorCurves(state.colorCurves));assert.deepEqual(restored.automation,validateAutomation(base,automation));
    const draft=defaultWallpaperDraft(wallpaperSnapshot({view:base,automation,colors:{...state,definition:palette}},[]),'cover');
    draft.transitions['closed-transition']={seconds:1.5,easing:'custom',curve:transition};
    const copy=await readWallpaperURL(await createWallpaperURL('https://example.com/',draft,{compress}));
    assert.deepEqual(copy,draft);assert.deepEqual(wallpaperPlan(copy).map(p=>p.sample(2)),wallpaperPlan(draft).map(p=>p.sample(2)));
  }
});
