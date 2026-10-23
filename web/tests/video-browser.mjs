import { mp4Encoder, supportsMP4 } from '../src/video-export.js';
import { Input, BlobSource, ALL_FORMATS, VideoSampleSink } from 'mediabunny';

const source=document.querySelector('#source'), decoded=document.querySelector('#decoded');
const context=source.getContext('2d'), out=decoded.getContext('2d',{willReadFrequently:true});
const report=message=>{document.querySelector('#results').textContent+=`${message}\n`;};
const field=new Float32Array(source.width*source.height);
for(let y=0;y<source.height;y++) for(let x=0;x<source.width;x++) {
  let zx=(x/source.width-.5)*3.2,zy=(y/source.height-.5)*1.8,n=0;
  while(zx*zx+zy*zy<256&&n<400){const next=zx*zx-zy*zy-.7269;zy=2*zx*zy+.1889;zx=next;n++;}
  field[y*source.width+x]=n===400?-1:Math.log1p(n)*3;
}
function paint(index,monochrome){
  const image=context.createImageData(source.width,source.height);
  for(let i=0;i<field.length;i++){
    const p=i*4,t=field[i]+index*.08;
    for(let c=0;c<3;c++)image.data[p+c]=field[i]<0?8:Math.round(127.5*(1+Math.cos(t+(monochrome?0:c*2.094))));
    image.data[p+3]=255;
  }
  context.putImageData(image,0,0);return image.data;
}
function psnr(expected,actual){
  let error=0;for(let i=0;i<expected.length;i++)if(i%4!==3)error+=(expected[i]-actual[i])**2;
  const mse=error/(expected.length/4*3);return mse===0?Infinity:10*Math.log10(255**2/mse);
}
paint(0,false);
document.querySelector('#run').onclick=async()=>{
  const button=document.querySelector('#run');button.disabled=true;document.querySelector('#results').textContent='';
  for(const link of document.querySelectorAll('#downloads a'))URL.revokeObjectURL(link.href);
  document.querySelector('#downloads').replaceChildren();
  try{
    const scores=new Map();
    for(const monochrome of [true,false])for(const [name,quality]of [['High',{bitrate:1658880}],['Extreme',{bitrate:16588800}],['Maximum',{quantizer:0,bitrate:null}]]){
      const options={width:source.width,height:source.height,fps:30,...quality};
      if(!await supportsMP4(options)){report(`SKIP ${name} ${monochrome?'gray':'color'}: unsupported`);continue;}
      let encoder,input;
      try{
        encoder=await mp4Encoder(source,options);
        const original=paint(0,monochrome);
        for(let i=0;i<12;i++){paint(i,monochrome);await encoder.add(i);}
        const blob=await encoder.finish();encoder=null;
        paint(0,monochrome);
        if(name==='High'){
          const reference=await new Promise(resolve=>source.toBlob(resolve,'image/png'));
          const link=document.createElement('a');link.href=URL.createObjectURL(reference);link.download=`video-quality-source-${monochrome?'gray':'color'}.png`;link.textContent=`Download source ${monochrome?'gray':'color'}`;document.querySelector('#downloads').append(link);
        }
        input=new Input({source:new BlobSource(blob),formats:ALL_FORMATS});
        const track=await input.getPrimaryVideoTrack(),sink=new VideoSampleSink(track),sample=await sink.getSample(0);
        if(!sample)throw Error('No decoded frame.');
        try{sample.draw(out,0,0);}finally{sample.close();}
        const score=psnr(original,out.getImageData(0,0,source.width,source.height).data);
        if(monochrome&&name==='Maximum'&&score<scores.get('Extreme')-.25)throw Error('Maximum lost more grayscale detail than Extreme.');
        scores.set(name,score);
        report(`PASS ${name} ${monochrome?'gray':'color'}: ${score.toFixed(2)} dB RGB PSNR, ${blob.size} bytes, ${(blob.size*8/.4/1e6).toFixed(2)} Mbps actual`);
        const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`video-quality-${name.toLowerCase()}-${monochrome?'gray':'color'}.mp4`;link.textContent=`Download ${name} ${monochrome?'gray':'color'}`;document.querySelector('#downloads').append(link);
      }catch(error){report(`FAIL ${name}: ${error.message}`);}finally{if(encoder)await encoder.cancel().catch(()=>{});input?.dispose();}
    }
    report('DONE');
  }catch(error){report(`FAIL ${error.message}`);}finally{button.disabled=false;}
};
