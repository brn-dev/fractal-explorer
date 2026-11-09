// Deterministic, offline vector artwork from Julia-set escape contours.
// Run with Node from any directory. No generated bitmap or runtime rendering.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../app/src/main/res/', import.meta.url));
const n = 448, limit = 200, levels = [9,20,45,90], field = new Float64Array(n*n);
for (let y=0;y<n;y++) for (let x=0;x<n;x++) {
  const cx=-.8, cy=.156;
  let re=(x/(n-1)-.5)*3.8,im=(.5-y/(n-1))*3.8,step=0,abs=0;
  while(step<limit && (abs=re*re+im*im)<=4) { const next=re*re-im*im+cx;im=2*re*im+cy;re=next;step++; }
  field[y*n+x]=step===limit?limit:step+1-Math.log2(Math.log2(Math.sqrt(abs)));
}

function contours(level) {
  const nodes=new Map(), links=new Map();
  const link=(a,b)=>{if(!links.has(a))links.set(a,[]);links.get(a).push(b);};
  for(let y=0;y<n-1;y++)for(let x=0;x<n-1;x++) {
    const v=[field[y*n+x],field[y*n+x+1],field[(y+1)*n+x+1],field[(y+1)*n+x]];
    const mask=v.reduce((sum,value,i)=>sum+(value>=level?1<<i:0),0);
    if(mask===0||mask===15)continue;
    const center=v.reduce((a,b)=>a+b,0)/4>=level;
    const pairs={1:[[3,0]],2:[[0,1]],3:[[3,1]],4:[[1,2]],
      5:center?[[0,1],[2,3]]:[[3,0],[1,2]],6:[[0,2]],7:[[3,2]],8:[[2,3]],9:[[0,2]],
      10:center?[[3,0],[1,2]]:[[0,1],[2,3]],11:[[1,2]],12:[[3,1]],13:[[0,1]],14:[[3,0]]}[mask];
    const edge=e=>{
      const ids=[`h${y}:${x}`,`v${y}:${x+1}`,`h${y+1}:${x}`,`v${y}:${x}`],id=ids[e];
      if(!nodes.has(id)) {
        const a=[0,1,3,0][e],b=[1,2,2,3][e],t=(level-v[a])/(v[b]-v[a]);
        nodes.set(id,e===0?[x+t,y]:e===1?[x+1,y+t]:e===2?[x+t,y+1]:[x,y+t]);
      }
      return id;
    };
    for(const [a,b]of pairs) {const ka=edge(a),kb=edge(b);link(ka,kb);link(kb,ka);}
  }
  const visited=new Set(), loops=[];
  for(const start of links.keys()) {
    if(visited.has(start))continue;
    const points=[];let current=start,previous=null;
    do {
      visited.add(current);points.push(nodes.get(current));
      const next=links.get(current).find(key=>key!==previous);previous=current;current=next;
    }while(current && current!==start && !visited.has(current));
    if(current===start && points.length>=3)loops.push(points);
  }
  return loops;
}

const raw=levels.map(contours), outer=raw[0].flat();
const xs=outer.map(p=>p[0]),ys=outer.map(p=>p[1]);
const mid=[(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2];
const angle=-25*Math.PI/180, radius=Math.max(...outer.map(p=>Math.hypot(p[0]-mid[0],p[1]-mid[1]))),scale=31/radius;
const transform=p=>{const x=(p[0]-mid[0])*scale,y=(p[1]-mid[1])*scale;return[54+Math.cos(angle)*x-Math.sin(angle)*y,54+Math.sin(angle)*x+Math.cos(angle)*y];};
const distance=(p,a,b)=>{
  const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
  const t=length?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)):0;
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
};
function simplify(points) {
  let index=0,max=0;
  for(let i=1;i<points.length-1;i++){const d=distance(points[i],points[0],points.at(-1));if(d>max){max=d;index=i;}}
  if(max<=.16)return[points[0],points.at(-1)]; // Below 0.11 px at a 48 dp icon.
  return[...simplify(points.slice(0,index+1)).slice(0,-1),...simplify(points.slice(index))];
}
const number=v=>String(Math.round(v*100)/100);
const paths=raw.map(loops=>loops.map(points=>{
  const mapped=points.map(transform),area=Math.abs(mapped.reduce((sum,p,i)=>{const q=mapped[(i+1)%mapped.length];return sum+p[0]*q[1]-q[0]*p[1];},0)/2);
  if(area<.1)return'';
  const clean=simplify([...mapped,mapped[0]]).slice(0,-1);
  return'M'+clean.map(p=>p.map(number).join(',')).join('L')+'z';
}).join(''));
// Android's UTF-8 resource string pool has a 32,767-character limit per string.
if(paths.some(d=>d.length>30000))throw new Error('Contour path exceeds the Android resource budget');
const palettes={day:{background:'#142B28',colors:['#2C746B','#60B6A2','#E3BF77','#DCE9B2']},
  night:{background:'#11182D',colors:['#293B65','#436B98','#7A6CB0','#9D95CA']}};
const header='<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">\n';
const pathXML=(d,color)=>`    <path android:fillColor="${color}" android:fillType="evenOdd" android:pathData="${d}" />\n`;
await mkdir(path.join(root,'drawable'),{recursive:true});
for(const [mode,{colors}]of Object.entries(palettes)) {
  await writeFile(path.join(root,`drawable/launcher_${mode}_foreground.xml`),header+paths.map((d,i)=>pathXML(d,colors[i])).join('')+'</vector>\n');
}
await writeFile(path.join(root,'drawable/launcher_fractal_monochrome.xml'),header+pathXML(paths[1],'#FFFFFF')+'</vector>\n');
await writeFile(path.join(root,'values/icon_colors.xml'),'<resources>\n'+Object.entries(palettes).map(([mode,p])=>`    <color name="icon_${mode}_background">${p.background}</color>\n`).join('')+'</resources>\n');
// Legacy explicit activity shortcuts/app settings also get the new fractal mark.
await writeFile(path.join(root,'drawable/wallpaper_icon.xml'),header+pathXML('M0,0h108v108H0z',palettes.day.background)+paths.map((d,i)=>pathXML(d,palettes.day.colors[i])).join('')+'</vector>\n');
console.log(JSON.stringify({formula:'z²+c',julia:{re:-.8,im:.156},levels,vertices:paths.map(d=>(d.match(/L/g)||[]).length),rotationDegrees:-25}));
