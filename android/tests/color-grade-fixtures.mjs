import {writeFile} from 'node:fs/promises';
import {correctRenderedPixels,renderedCurveLUT} from '../../web/src/rendered-color-curves.mjs';
const ramp=Uint8ClampedArray.from(Array.from({length:1024},(_,i)=>[i%256,(i*37)%256,(i*73)%256,i%2?255:120]).flat());
const rows=[{}, {tone:{points:[[0,0],[.5,.3],[1,1]]}}, {tone:{points:[[0,.15],[.3,.2],[1,1]]},red:{points:[[0,0],[.25,.8],[1,.9]]}},
 {red:{points:[[0,.1],[1,.9]],interpolation:'segments',bends:[-.6]},green:{points:[[0,1],[.2,0],[1,1]]},blue:{points:[[0,0],[.1,.8],[.6,.2],[1,1]],interpolation:'segments',bends:[.4,-.5,.8]}}];
for(let n=2;n<20;n++)rows.push({tone:{points:[[0,0],[n/20,(20-n)/20],[1,1]],interpolation:n%2?'smooth':'segments',bends:[.7,-.3]}});
await writeFile(process.argv[2],JSON.stringify(rows.map(curves=>({curves,source:Array.from(ramp),expected:Array.from(correctRenderedPixels(ramp,curves)),lut:Array.from(renderedCurveLUT(curves))}))));
