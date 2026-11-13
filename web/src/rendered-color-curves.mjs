import { compileCurve } from './curve.mjs';
import { validateColorCurves, hasColorCurves } from './color-curves.mjs';

// Match WallpaperColorGrade and the playback shader. These act on decoded RGB,
// including interior pixels, rather than attempting to reconstruct a palette.
export const RENDERED_LUT_SIZE = 1024;
export function renderedCurveLUT(input) {
  const curves=validateColorCurves(input),keys=['red','green','blue','tone'];
  const functions=keys.map(key=>curves[key]?compileCurve(curves[key]):x=>x);
  const lut=new Uint8ClampedArray(RENDERED_LUT_SIZE*4);
  for(let i=0;i<RENDERED_LUT_SIZE;i++)for(let c=0;c<4;c++)lut[i*4+c]=Math.round(255*functions[c](i/(RENDERED_LUT_SIZE-1)));
  return lut;
}
export function correctRenderedPixels(source,input) {
  const curves=validateColorCurves(input),pixels=new Uint8ClampedArray(source);
  if(!hasColorCurves(curves))return pixels;
  const lut=renderedCurveLUT(curves),tone=!!curves.tone&&hasColorCurves({tone:curves.tone});
  const rgb=['red','green','blue'].some(key=>curves[key]&&hasColorCurves({[key]:curves[key]}));
  const clamp=x=>Math.max(0,Math.min(1,x));
  const sample=(x,c)=>{const p=clamp(x)*(RENDERED_LUT_SIZE-1),i=Math.min(RENDERED_LUT_SIZE-2,Math.floor(p)),f=p-i;return(lut[4*i+c]*(1-f)+lut[4*(i+1)+c]*f)/255;};
  for(let i=0;i<pixels.length;i+=4){
    let r=pixels[i]/255,g=pixels[i+1]/255,b=pixels[i+2]/255;
    if(tone){const light=.2126*r+.7152*g+.0722*b,next=sample(light,3);if(light>.00001){r=clamp(r*next/light);g=clamp(g*next/light);b=clamp(b*next/light);}else r=g=b=next;}
    if(rgb){r=sample(r,0);g=sample(g,1);b=sample(b,2);}
    pixels[i]=Math.round(r*255);pixels[i+1]=Math.round(g*255);pixels[i+2]=Math.round(b*255);
  }
  return pixels;
}
