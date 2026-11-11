import { validateCurve, compileCurve, defaultCurve, MAX_CURVE_POINTS, CURVE_GAP } from './curve.mjs';
const $=id=>document.getElementById(id),clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
let current=null,initialized=false,raf=null;

export function openCurveEditor(options) {
  if(current)throw new Error('Finish the current curve edit first.');
  const dialog=$('curve-dialog'),canvas=$('curve-graph'),ctx=canvas.getContext('2d');
  const mode=options.mode??'free',channels=options.channels??[{key:'curve',label:'Custom',color:'#d6eca7'}];
  const working=Object.fromEntries(Object.entries(options.curves??{}).map(([key,value])=>[key,validateCurve(value,mode)]));
  const session=current={options,mode,channels,working,key:channels[0].key,selected:1,segment:0,playing:mode!=='free',phase:0,drag:null,applied:false};
  const curve=()=>session.working[session.key]??=defaultCurve(mode);
  const output=()=>structuredClone(Object.fromEntries(Object.entries(session.working).map(([key,value])=>[key,validateCurve(value,mode)])));
  const error=message=>{$('curve-error').textContent=message;$('curve-error').hidden=!message;};
  const emit=()=>{try{const value=output();options.onPreview?.(value);error('');sync();}catch(e){error(e.message);}};
  const pointLocked=index=>mode!=='free'&&(index===0||index===curve().points.length-1);
  const coord=([x,y])=>[24+x*(canvas.width-48),canvas.height-24-y*(canvas.height-48)];
  function sync() {
    const value=curve(),points=value.points;
    session.selected=clamp(session.selected,0,points.length-1);session.segment=clamp(session.segment,0,points.length-2);
    const [x,y]=points[session.selected];
    $('curve-input').value=String(Number((100*x).toFixed(4)));$('curve-output').value=String(Number((100*y).toFixed(4)));
    $('curve-output-slider').value=String(100*y);
    $('curve-input').disabled=session.selected===0||session.selected===points.length-1;
    $('curve-output').disabled=$('curve-output-slider').disabled=pointLocked(session.selected);
    $('curve-remove').disabled=session.selected===0||session.selected===points.length-1;
    $('curve-add').disabled=points.length>=MAX_CURVE_POINTS;
    $('curve-interpolation').value=value.interpolation;
    $('curve-bend').value=String(value.bends[session.segment]*100);
    $('curve-bend-value').textContent=`${Math.round(value.bends[session.segment]*100)}%`;
    $('curve-bend').disabled=value.interpolation!=='segments'||points[session.segment][1]===points[session.segment+1][1];
    $('curve-point-caption').textContent=`Point ${session.selected+1} / ${points.length} · segment ${session.segment+1}`;
    $('curve-play').textContent=session.playing?'Pause curve':'Play curve';
    const definition=options.getPalette?.();
    if(definition){$('curve-palette-before').style.background=options.paletteGradient(definition,{});$('curve-palette-after').style.background=options.paletteGradient(definition,session.working);}
    draw();
  }
  function draw() {
    const value=curve(),fn=compileCurve(value,mode),color=channels.find(c=>c.key===session.key).color;
    ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#0a1115';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.lineWidth=1;ctx.strokeStyle='#ffffff16';ctx.beginPath();
    for(let i=0;i<=4;i++){const x=24+(canvas.width-48)*i/4,y=24+(canvas.height-48)*i/4;ctx.moveTo(x,24);ctx.lineTo(x,canvas.height-24);ctx.moveTo(24,y);ctx.lineTo(canvas.width-24,y);}ctx.stroke();
    ctx.fillStyle='#8e9eaa';ctx.font='10px system-ui';ctx.fillText('0%',4,canvas.height-7);ctx.fillText('100%',canvas.width-34,canvas.height-7);ctx.fillText('100%',0,15);
    ctx.strokeStyle='#ffffff35';ctx.beginPath();ctx.moveTo(...coord([0,0]));ctx.lineTo(...coord([1,mode==='cycle'?0:1]));ctx.stroke();
    ctx.strokeStyle=color;ctx.lineWidth=2.5;ctx.beginPath();for(let i=0;i<=300;i++){const p=coord([i/300,fn(i/300)]);if(!i)ctx.moveTo(...p);else ctx.lineTo(...p);}ctx.stroke();
    if(value.interpolation==='segments')for(let i=0;i<value.points.length-1;i++){
      if(value.points[i][1]===value.points[i+1][1])continue;
      const x=(value.points[i][0]+value.points[i+1][0])/2,p=coord([x,fn(x)]);
      ctx.beginPath();ctx.arc(...p,4,0,Math.PI*2);ctx.fillStyle='#0a1115';ctx.fill();ctx.strokeStyle=i===session.segment?'#ffffff':color;ctx.lineWidth=1.2;ctx.stroke();
    }
    value.points.forEach((point,i)=>{ctx.beginPath();ctx.arc(...coord(point),i===session.selected?6:4,0,Math.PI*2);ctx.fillStyle=i===session.selected?'#ffffff':color;ctx.fill();});
    if(session.playing){const p=coord([session.phase,fn(session.phase)]);ctx.strokeStyle='#ffffff60';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(p[0],24);ctx.lineTo(p[0],canvas.height-24);ctx.stroke();ctx.fillStyle='#ffffff';ctx.beginPath();ctx.arc(...p,4,0,Math.PI*2);ctx.fill();}
  }
  function add(x,y) {
    const value=curve();if(value.points.length>=MAX_CURVE_POINTS)return;
    const index=value.points.findIndex(p=>p[0]>x);
    if(index<=0||x-value.points[index-1][0]<CURVE_GAP||value.points[index][0]-x<CURVE_GAP)return;
    value.points.splice(index,0,[x,y]);value.bends.splice(index-1,1,0,0);session.selected=index;session.segment=index;emit();
  }
  function move(x,y) {
    const value=curve(),i=session.selected,point=value.points[i];
    if(i>0&&i<value.points.length-1)point[0]=clamp(x,value.points[i-1][0]+CURVE_GAP,value.points[i+1][0]-CURVE_GAP);
    if(!pointLocked(i))point[1]=clamp(y);
    emit();
  }
  function remove() {
    const value=curve(),i=session.selected;if(i===0||i===value.points.length-1)return;
    value.points.splice(i,1);value.bends.splice(i-1,2,0);session.selected=Math.min(i,value.points.length-1);session.segment=Math.min(i,value.points.length-2);emit();
  }
  const position=event=>{const r=canvas.getBoundingClientRect();return [clamp((event.clientX-r.left)*canvas.width/r.width-24,0,canvas.width-48)/(canvas.width-48),1-clamp((event.clientY-r.top)*canvas.height/r.height-24,0,canvas.height-48)/(canvas.height-48)];};
  canvas.onpointerdown=event=>{
    if(!event.isPrimary||event.button!==0)return;event.preventDefault();canvas.focus();canvas.setPointerCapture(event.pointerId);
    const p=position(event),pixel=coord(p),value=curve(),fn=compileCurve(value,mode);
    const radius=(event.pointerType==='touch'?22:12)*canvas.width/canvas.getBoundingClientRect().width;
    let hit=-1,best=radius;
    value.points.forEach((point,i)=>{const q=coord(point),distance=Math.hypot(q[0]-pixel[0],q[1]-pixel[1]);if(distance<best){best=distance;hit=i;}});
    let segment=-1;if(hit<0&&value.interpolation==='segments')for(let i=0;i<value.points.length-1;i++){const x=(value.points[i][0]+value.points[i+1][0])/2,q=coord([x,fn(x)]),distance=Math.hypot(q[0]-pixel[0],q[1]-pixel[1]);if(value.points[i][1]!==value.points[i+1][1]&&distance<best){segment=i;best=distance;}}
    if(hit>=0){session.selected=hit;session.segment=Math.min(hit,value.points.length-2);}if(segment>=0)session.segment=segment;
    session.drag={id:event.pointerId,start:[event.clientX,event.clientY],point:hit,segment,moved:false};sync();
  };
  canvas.onpointermove=event=>{
    const drag=session.drag;if(!drag||drag.id!==event.pointerId)return;
    drag.moved||=Math.hypot(event.clientX-drag.start[0],event.clientY-drag.start[1])>4;if(!drag.moved)return;
    const p=position(event);if(drag.point>=0)move(Math.round(p[0]*1000)/1000,Math.round(p[1]*1000)/1000);
    else if(drag.segment>=0){const value=curve(),i=drag.segment,a=value.points[i][1],b=value.points[i+1][1],fraction=clamp((p[1]-a)/(b-a),.0001,.9999);value.bends[i]=clamp(fraction<=.5?(Math.log(fraction)/Math.log(.5)-1)/4:-(Math.log(1-fraction)/Math.log(.5)-1)/4,-1,1);emit();}
  };
  canvas.onpointerup=event=>{const drag=session.drag;if(!drag||drag.id!==event.pointerId)return;session.drag=null;if(!drag.moved&&drag.point<0&&drag.segment<0){const p=position(event);add(Math.round(p[0]*1000)/1000,Math.round(p[1]*1000)/1000);}if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);};
  canvas.onpointercancel=canvas.onlostpointercapture=()=>{session.drag=null;};canvas.onclick=event=>event.stopPropagation();
  canvas.onkeydown=event=>{
    const point=curve().points[session.selected],step=event.shiftKey ? .05 : .01;
    if(['PageUp','PageDown','Home','End'].includes(event.key)) {
      event.preventDefault();
      session.selected=event.key==='Home'?0:event.key==='End'?curve().points.length-1:clamp(session.selected+(event.key==='PageUp'?-1:1),0,curve().points.length-1);
      session.segment=Math.min(session.selected,curve().points.length-2);sync();
    } else if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();remove();}
    else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){
      event.preventDefault();move(point[0]+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0),point[1]+(event.key==='ArrowDown'?-step:event.key==='ArrowUp'?step:0));
    }
  };
  $('curve-title').textContent=options.title??'Custom curve';$('curve-help').textContent=mode==='free'?'Tap to add points; drag points or hollow handles to reshape. Brightness adjusts light and dark tones; Red, Green and Blue adjust color balance. Interior color stays separate.':mode==='cycle'?'Tap to add points, drag points to reshape, and drag hollow handles to bend segments. The loop starts and returns to Start; 100% reaches Target.':'Tap to add points, drag points to reshape, and drag hollow handles to bend segments. The transition starts at 0% and ends at 100%.';
  $('curve-channel-row').hidden=channels.length===1;$('curve-channel').replaceChildren();
  for(const channel of channels){const option=document.createElement('option');option.value=channel.key;option.textContent=channel.label;$('curve-channel').append(option);}
  $('curve-channel').value=session.key;$('curve-channel').onchange=()=>{session.key=$('curve-channel').value;session.selected=1;session.segment=0;sync();};
  $('curve-presets').replaceChildren();const blank=document.createElement('option');blank.value='';blank.textContent='Load a preset…';$('curve-presets').append(blank);
  for(const [i,preset] of (options.presets??[]).entries()){const option=document.createElement('option');option.value=String(i);option.textContent=preset.label;$('curve-presets').append(option);}
  $('curve-presets').onchange=()=>{if($('curve-presets').value==='')return;session.working[session.key]=validateCurve(options.presets[Number($('curve-presets').value)].curve(),mode);session.selected=Math.min(1,curve().points.length-1);session.segment=0;$('curve-presets').value='';emit();};
  $('curve-interpolation').onchange=()=>{curve().interpolation=$('curve-interpolation').value;emit();};
  $('curve-input').onchange=$('curve-output').onchange=()=>{if(!$('curve-input').value.trim()||!$('curve-output').value.trim())return;const x=Number($('curve-input').value)/100,y=Number($('curve-output').value)/100;if(Number.isFinite(x)&&Number.isFinite(y))move(x,y);};
  $('curve-output-slider').oninput=()=>move(curve().points[session.selected][0],Number($('curve-output-slider').value)/100);
  $('curve-bend').oninput=()=>{curve().bends[session.segment]=Number($('curve-bend').value)/100;emit();};
  $('curve-add').onclick=()=>{const value=curve(),lengths=value.points.slice(1).map((p,i)=>p[0]-value.points[i][0]),i=lengths.indexOf(Math.max(...lengths)),x=(value.points[i][0]+value.points[i+1][0])/2;add(x,compileCurve(value,mode)(x));};
  $('curve-remove').onclick=remove;$('curve-reset').onclick=()=>{session.working[session.key]=defaultCurve(mode);session.selected=1;session.segment=0;emit();};
  $('curve-reset-all').hidden=channels.length===1;$('curve-reset-all').onclick=()=>{session.working={};session.selected=1;session.segment=0;curve();emit();};
  $('curve-play').hidden=mode==='free';$('curve-play').onclick=()=>{session.playing=!session.playing;sync();};
  $('curve-palette-ramps').hidden=!options.getPalette;
  $('curve-apply').onclick=()=>{try{options.onApply(output());session.applied=true;dialog.close();}catch(e){error(e.message);}};
  $('curve-cancel').onclick=()=>dialog.close();
  if(!initialized){dialog.addEventListener('close',()=>{const ended=current;current=null;cancelAnimationFrame(raf);if(ended&&!ended.applied)ended.options.onCancel?.();});initialized=true;}
  error('');sync();dialog.showModal();let last=performance.now(),lastDraw=0;
  function tick(time){if(current!==session)return;if(session.playing&&!document.hidden){session.phase=(session.phase+(time-last)/2000)%1;if(time-lastDraw>33){draw();lastDraw=time;}}last=time;raf=requestAnimationFrame(tick);}
  if(mode!=='free')raf=requestAnimationFrame(tick);
}
