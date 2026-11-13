import { nativeCall } from './native-bridge.mjs';
import { openCurveEditor } from './curve-ui.js';
import { colorCurveChannels, validateColorCurves } from './color-curves.mjs';
import { defaultCurve } from './curve.mjs';
import { correctRenderedPixels } from './rendered-color-curves.mjs';

const $=id=>document.getElementById(id);
export function setupWallpaperCorrections({onSaved,isCurrent}) {
  const dialog=$('wallpaper-correction-copy-dialog'),status=$('wallpaper-correction-copy-status');
  const start=$('wallpaper-correction-copy-start'),cancel=$('wallpaper-correction-copy-cancel');
  let selection=null,job=null,terminal=true,opening=false;
  const quality=$('wallpaper-correction-copy-quality');
  quality.onchange=()=>{$('wallpaper-correction-copy-bitrate-row').hidden=quality.value!=='custom';};
  function openCopy(entry,screen,curves) {
    if(job&&!terminal)throw new Error('Wait for the current corrected copy.');
    selection={entry,screen,curves};job=null;terminal=true;
    $('wallpaper-correction-copy-name').value=(entry.name||'My fractal wallpaper').slice(0,68)+' (corrected)';
    quality.value='dynamic-high';quality.onchange();quality.disabled=entry.kind==='static';
    $('wallpaper-correction-copy-options').hidden=false;
    $('wallpaper-correction-copy-progress').hidden=true;status.textContent='';
    start.hidden=false;start.disabled=false;cancel.disabled=false;cancel.textContent='Cancel';
    dialog.showModal();
  }
  const failure=error=>{status.textContent=error.message;};
  function requestCancel() {
    if(!job||terminal){dialog.close();return;}
    try{const value=nativeCall('cancelWallpaperCorrectionCopy',job);cancel.disabled=!value.canCancel;status.textContent=value.message;}catch(error){failure(error);}
  }
  cancel.onclick=requestCancel;
  dialog.addEventListener('cancel',event=>{if(job&&!terminal){event.preventDefault();requestCancel();}});
  dialog.addEventListener('close',()=>{if(job&&!terminal)requestCancel();});
  start.onclick=async()=>{
    if(!selection||!terminal)return;
    try {
      const name=$('wallpaper-correction-copy-name').value.trim(),bitrateMbps=Number($('wallpaper-correction-copy-bitrate').value);
      if(!name||name.length>80)throw new Error('Choose a copy name of 1–80 characters.');
      if(quality.value==='custom'&&(!Number.isFinite(bitrateMbps)||bitrateMbps<.5||bitrateMbps>600))throw new Error('Choose a bitrate from 0.5 to 600 Mbps.');
      const {entry,screen,curves}=selection;
      let current=nativeCall('beginWallpaperCorrectionCopy',entry.id,screen,JSON.stringify({name,quality:quality.value,bitrateMbps,curves}));
      job=current.job;terminal=false;start.disabled=true;$('wallpaper-correction-copy-options').hidden=true;
      const progress=$('wallpaper-correction-copy-progress');progress.hidden=false;
      while(true){
        status.textContent=current.message;progress.value=current.progress;cancel.disabled=!current.canCancel;
        if(['completed','cancelled','failed'].includes(current.state)){
          terminal=true;cancel.disabled=false;cancel.textContent='Close';start.hidden=true;
          if(current.state==='completed')onSaved(`Saved “${name}”. Select the copy in the gallery when ready. The original and shuffle choices are unchanged.`);
          if(current.state==='failed')status.textContent=`Could not save corrected copy: ${current.error}`;
          break;
        }
        await new Promise(resolve=>setTimeout(resolve,400));
        current=nativeCall('wallpaperCorrectionCopyStatus',job);
      }
    }catch(error){
      // A status error must not leave an unobserved conversion running.
      if(job&&!terminal)try{nativeCall('cancelWallpaperCorrectionCopy',job);}catch{}
      terminal=true;cancel.disabled=false;start.disabled=false;failure(error);
    }
  };

  return {
    async open(entry,screen) {
      if(opening)return;opening=true;
      let holder,raf=null;
      try {
        const source=nativeCall('wallpaperCorrectionSource',entry.id,screen),image=new Image();
        image.src=source.image;await image.decode();
        if(!isCurrent(screen))return;
        holder=document.createElement('div');holder.hidden=true;
        const scene=document.createElement('div'),canvas=document.createElement('canvas');scene.style.cssText='width:100%;height:100%';
        canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;scene.append(canvas);holder.append(scene);document.body.append(holder);
        const context=canvas.getContext('2d');context.drawImage(image,0,0);
        const original=context.getImageData(0,0,canvas.width,canvas.height);
        let next=validateColorCurves(source.curves);
        const paint=()=>{raf=null;context.putImageData(new ImageData(correctRenderedPixels(original.data,next),canvas.width,canvas.height),0,0);};
        paint();
        openCurveEditor({
          title:'Rendered wallpaper colors',mode:'free',channels:colorCurveChannels,curves:next,
          help:'Adjust the saved image and video colors, including the interior. This preview uses the saved still image. Live correction applies to the whole transition and loop without re-rendering the fractal.',
          previewElement:scene,getPreviewAspect:()=>canvas.width/canvas.height,
          applyLabel:'Save live correction',alternateLabel:'Save corrected media copy…',
          presets:[
            {label:'Original / diagonal',curve:()=>defaultCurve()},
            {label:'Darker midtones',curve:()=>({points:[[0,0],[.5,.3],[1,1]],interpolation:'smooth'})},
            {label:'Brighter midtones',curve:()=>({points:[[0,0],[.5,.7],[1,1]],interpolation:'smooth'})},
            {label:'Gentle contrast',curve:()=>({points:[[0,0],[.25,.15],[.75,.85],[1,1]],interpolation:'smooth'})},
          ],
          onPreview:curves=>{next=validateColorCurves(curves);if(raf===null)raf=requestAnimationFrame(paint);},
          onApply:curves=>{nativeCall('setWallpaperCorrection',entry.id,screen,JSON.stringify(validateColorCurves(curves)));onSaved('Live correction saved for this wallpaper and screen. Preview plays it on the saved videos.');},
          onAlternateApply:curves=>openCopy(entry,screen,validateColorCurves(curves)),
          onClose:()=>{if(raf!==null)cancelAnimationFrame(raf);holder.remove();},
        });
      }catch(error){holder?.remove();throw error;}finally{opening=false;}
    },
  };
}
