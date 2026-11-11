import { validateCurve, compileCurve } from './curve.mjs';

export const colorCurveChannels = [
  {key:'tone',label:'Brightness',color:'#e7eccc'},
  {key:'red',label:'Red',color:'#f18c91'},
  {key:'green',label:'Green',color:'#98d8a6'},
  {key:'blue',label:'Blue',color:'#8cbcf1'},
];
export function validateColorCurves(data = {}) {
  if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(key=>!colorCurveChannels.some(channel=>channel.key===key)))
    throw new Error('Invalid palette color curves.');
  const out={};
  for(const {key} of colorCurveChannels)if(data[key]!==undefined)out[key]=validateCurve(data[key]);
  return out;
}
export const hasColorCurves = data => Object.values(data??{}).some(curve=>curve.points.some(([x,y])=>x!==y)||(curve.interpolation==='segments'&&curve.bends.some(value=>value!==0)));

// Interpolate the original palette first, then grade every LUT entry. Editing
// only the original stops would miss midtones in a two-color palette.
export function paletteColorTable(definition, curves = {}) {
  const colors=definition.colors.map(hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)));
  const settings=validateColorCurves(curves),active=hasColorCurves(settings);
  const tone=active&&settings.tone?compileCurve(settings.tone):null;
  const channels=['red','green','blue'].map(key=>active&&settings[key]?compileCurve(settings[key]):null);
  const table=new Float64Array(4096*3);
  for(let i=0;i<4096;i++) {
    const t=i/4096*(colors.length-1),k=Math.floor(t),f=t-k;
    let rgb=colors[k].map((value,c)=>value*(1-f)+colors[k+1][c]*f);
    if(active) {
      rgb=rgb.map(value=>value/255);
      if(tone) {
        const light=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2],next=tone(light);
        rgb=light===0?[next,next,next]:rgb.map(value=>Math.max(0,Math.min(1,value*next/light)));
      }
      rgb=rgb.map((value,c)=>(channels[c]?channels[c](value):value)*255);
    }
    table.set(rgb,i*3);
  }
  return table;
}
export function adjustedPaletteGradient(definition, curves) {
  if(!hasColorCurves(curves))return `linear-gradient(90deg, ${definition.colors.join(',')})`;
  const table=paletteColorTable(definition,curves),stops=[];
  for(let i=0;i<65;i++){const k=Math.min(4095,Math.round(i*4095/64))*3;stops.push('#'+[0,1,2].map(c=>Math.round(table[k+c]).toString(16).padStart(2,'0')).join(''));}
  return `linear-gradient(90deg, ${stops.join(',')})`;
}
