import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRotation,rotationBasis} from '../src/rotation.mjs';
import {validate,navigate,pixelView,decimal,compare} from '../src/decimal.mjs';
import {gestureView,previewTransform} from '../src/navigation.mjs';
import {softwareRender} from '../src/software.mjs';
import {exactPixels} from '../src/reference.mjs';
import {defaultView,kinds} from '../src/fractals.mjs';
import {wallpaperViewPath,wallpaperSnapshot,defaultWallpaperDraft,wallpaperPlan,wallpaperManifest} from '../src/wallpaper.mjs';
import {createShareURL,readShareURL} from '../src/share.mjs';
const base={fractal:'mandelbrot',x:'-.5',y:'0',span:'3.6',iterations:80,bailout:64,julia_x:'-.8',julia_y:'.156'};
const close=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);

test('rotation has exact quarter turns, wraps degrees and leaves legacy views at their original orientation',()=>{
  assert.equal(validate(base).rotation,undefined);
  assert.deepEqual([0,90,180,270,360,-90].map(rotationBasis),[[1,0],[0,1],[-1,0],[0,-1],[1,0],[0,-1]]);
  close(rotationBasis(45)[0],Math.SQRT1_2);close(rotationBasis(45)[1],Math.SQRT1_2);
  assert.equal(validate({...base,rotation:-90}).rotation,270);assert.equal(normalizeRotation(720),0);
  for(const rotation of [NaN,Infinity,-Infinity,'90',null,360001])assert.throws(()=>validate({...base,rotation}));
});

test('rotated pan and pinch preserve screen direction and the point under the cursor',()=>{
  const view={...base,x:'0',y:'0',span:'4',rotation:90};
  const p=navigate({view,dx:.25});assert.equal(p.x,'0');assert.equal(p.y,'1');
  const viewport={width:1200,height:800},start={x:300,y:180},current={x:390,y:240};
  const target=gestureView(view,start,current,2.5,viewport);
  const original=pixelView(view,start.x-.5,start.y-.5,1200,800),after=pixelView(target,current.x-.5,current.y-.5,1200,800);
  close(Number(original.x),Number(after.x));close(Number(original.y),Number(after.y));
  const transform=previewTransform(view,target,viewport);close(transform.scaleX,2.5);close(600+transform.x+(start.x-600)*2.5,current.x);close(400+transform.y+(start.y-400)*2.5,current.y);
});

test('quarter-turn decimal coordinates and reverse navigation remain exact beyond double range',()=>{
  const view={...base,x:'0',y:'1',span:'1e-1000',rotation:90};
  const point=pixelView(view,0,0,20,20);
  assert.equal(compare(decimal(point.x),decimal('-4.75e-1001')),0);
  const moved=navigate({view,dx:.125,dy:-.25}),back=navigate({view:moved,dx:-.125,dy:.25});
  assert.equal(compare(decimal(view.x),decimal(back.x)),0);assert.equal(compare(decimal(view.y),decimal(back.y)),0);
  assert.equal(Number(view.y),Number(moved.y));assert.notEqual(view.y,moved.y);
  const diagonal=navigate({view:{...view,rotation:45},dx:.125,dy:.125});
  assert.equal(diagonal.x,'0','a diagonal symmetry-axis move has no spurious perpendicular offset');
});

test('rotation preview matrix projects a feature to the same place as independent world-coordinate geometry',()=>{
  const source={...base,x:'-.25',y:'.1',rotation:25},target={...base,x:'-.4',y:'.2',span:'2',rotation:135};
  const viewport={width:997,height:673,aspect:337/500},sourceAspect=333/497,point={x:743,y:210};
  const t=previewTransform(source,target,viewport,sourceAspect),u=(point.x/997-.5)*3.6,v=(.5-point.y/673)*sourceAspect*3.6;
  const a=25*Math.PI/180,b=135*Math.PI/180;
  const x=-.25+Math.cos(a)*u-Math.sin(a)*v-Number(target.x),y=.1+Math.sin(a)*u+Math.cos(a)*v-Number(target.y);
  const expectedX=997*(.5+(Math.cos(b)*x+Math.sin(b)*y)/2),expectedY=673*(.5-(-Math.sin(b)*x+Math.cos(b)*y)/(2*viewport.aspect));
  close(997/2+t.x+t.a*(point.x-997/2)+t.c*(point.y-673/2),expectedX);
  close(673/2+t.y+t.b*(point.x-997/2)+t.d*(point.y-673/2),expectedY);
  assert.equal(previewTransform({...base,x:'1',y:'1'},{...base,x:'0',y:'0',span:'1e-10000',rotation:90},viewport),null);
});

test('CPU rotation samples the fractal at the new orientation for all formulas instead of rotating a cropped image',async()=>{
  for(const kind of kinds){
    const view=defaultView(base,kind),size=17;
    const original=await softwareRender(view,size,size),turned=await softwareRender({...view,rotation:90},size,size);
    for(let row=0;row<size;row++)for(let col=0;col<size;col++){
      const a=turned.field[row*size+col],b=original.field[(size-1-col)*size+row];
      assert.equal(a<0,b<0,`${kind} classification`);if(a>=0)close(a,b,.002);
    }
  }
});

test('arbitrary rotated perturbation and repair agree with the independent MPFR pixel loop at deep zoom',async()=>{
  for(const view of [{...base,x:'-.743643887037151',y:'.13182590420533',span:'5e-11',iterations:800},{...base,x:'0',y:'1',span:'1e-80',iterations:800}]) {
    const rotated={...view,rotation:37.5},width=9,height=7,points=[[0,0],[8,0],[4,3],[0,6],[8,6]];
    const field=(await softwareRender(rotated,width,height)).field,oracle=await exactPixels(rotated,points,width,height);
    for(let i=0;i<points.length;i++)close(field[points[i][1]*width+points[i][0]],oracle.values[i],.002);
  }
});

test('wallpaper transitions rotate along the shorter arc and reach their saved endpoints exactly',()=>{
  for(const [a,b,half]of [[350,10,0],[10,350,0],[0,270,315],[0,180,90]]) {
    const from={...base,rotation:a},to={...base,rotation:b},path=wallpaperViewPath(from,to);
    assert.equal(path.compatible,true);assert.deepEqual(path.viewAt(0),from);assert.deepEqual(path.viewAt(1),to);close(path.viewAt(.5).rotation,half);
  }
  assert.equal(wallpaperViewPath(base,{...base,rotation:90}).viewAt(.5).rotation,45);
});

test('scene snapshots, plans, manifests and ordinary share links preserve rotation without changing target dimensions',async()=>{
  const view={...base,rotation:37.5},palettes=[{name:'Test',colors:['#001122','#ddeeff','#001122']}];
  const snapshot=wallpaperSnapshot({view,colors:{palette:0}},palettes);
  for(const kind of ['animated','static']){
    const draft=defaultWallpaperDraft(snapshot,'cover');draft.kind=kind;draft.longest='native';draft.displayProfile='fold8-ultra';
    const plans=wallpaperPlan(draft);for(const plan of plans){assert.equal(plan.sample(0).view.rotation,37.5);assert.deepEqual([plan.width,plan.height],[1080,2520]);}
    assert.equal(wallpaperManifest(draft,plans).editor.states['closed-steady'].view.rotation,37.5);
  }
  const url=await createShareURL('https://example.com/',{view},20,{compress:false});assert.equal((await readShareURL(url,20)).view.rotation,37.5);
});
