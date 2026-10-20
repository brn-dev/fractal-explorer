import { BrowserEngine } from './engine.js';
const $ = id => document.getElementById(id);
const palettes = await (await fetch(new URL('./palettes.json', document.baseURI))).json();
const engine = new BrowserEngine($('preview'), palettes);
const base = { x: '-.5', y: '0', span: '3.6', fractal: 'mandelbrot', julia_x: '-.8', julia_y: '.156', iterations: 800, bailout: 64 };
const cases = {
  overview: base,
  spiral: { ...base, x: '-0.743643887037151', y: '0.13182590420533', span: '5e-11', iterations: 3500 },
  julia: { ...base, fractal: 'julia', x: '0', iterations: 1000 },
  deep80: { ...base, x: '0', y: '1', span: '1e-80', iterations: 1000 },
  deep1000: { ...base, x: '0', y: '1', span: '1e-1000', iterations: 4000 },
  criticalJulia: { ...base, fractal: 'julia', x: '0', y: '0', julia_x: '-2', julia_y: '0', span: '1e-180', iterations: 1000 },
  burningShip: { ...base, fractal: 'burning-ship', x: '-.5' },
  tricorn: { ...base, fractal: 'tricorn', x: '-.5' },
  cubic: { ...base, fractal: 'cubic', x: '0' },
  deep10000: { ...base, x: '-2', y: '0', span: '1e-10000', iterations: 20000 },
};
const modes = { auto: { arithmetic: 'auto', acceleration: 'auto' }, series: { arithmetic: 'double-single', acceleration: 'series' }, bla: { arithmetic: 'double-single', acceleration: 'bla' }, combined: { arithmetic: 'double-single', acceleration: 'series-bla' }, fp32: { arithmetic: 'fp32', acceleration: 'auto' } };
let data;
const median = values => values.slice().sort((a,b)=>a-b)[Math.floor(values.length / 2)];
function updateRaw() { $('results-json').value = JSON.stringify(data, null, 2); }
function addRow(row) {
  const tr = document.createElement('tr');
  const values = row.error ? [`${row.case} / ${row.mode}`, `${row.width}×${row.height}`, row.error, '—', '—', '—', '—'] : [`${row.case} / ${row.mode}`, `${row.width}×${row.height}`, row.cold_ms.toFixed(2), row.warm_median_ms.toFixed(2), row.oracle_max_error.toPrecision(4), String(row.oracle_class_errors), row.metadata.mean_skipped_steps.toFixed(1)];
  for (const value of values) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
  if (row.error || row.oracle_class_errors || row.oracle_max_error > .02) tr.className = 'failure';
  $('results').append(tr); updateRaw();
}
try {
  const hardware = await engine.init();
  $('device').textContent = hardware.gpu ? `WebGPU · ${hardware.device} · paired arithmetic probe passed` : `CPU fallback · ${hardware.error}`;
  $('run').disabled = false;
} catch (error) { $('device').textContent = error.message; }
$('run').onclick = async () => {
  $('run').disabled = true; $('download').disabled = true; $('results').replaceChildren();
  const [requestedWidth, requestedHeight] = $('resolution').value.split(',').map(Number), repeats = Number($('repeats').value);
  data = { date: new Date().toISOString(), device: engine.deviceName ?? 'CPU', gpu: engine.gpu, userAgent: navigator.userAgent, resolution: [requestedWidth, requestedHeight], repeats, timing: 'performance.now; queue completion; rendering total excludes coloring/drawing', precision: 'MPFR CPU references, paired FP32 GPU deltas; FP32 is experimental', cases, modes, rows: [] };
  try {
    for (const [name, view] of Object.entries(cases)) {
      const [width, height] = name === 'deep10000' ? [32, 24] : [requestedWidth, requestedHeight];
      const points = [[0,0],[width-1,height-1],[Math.floor(width/2),Math.floor(height/2)],[Math.floor(width*.3),Math.floor(height*.7)]];
      if (name !== 'deep10000') for (let k=0;k<12;k++) points.push([(97*k+31)%width,(127*k+17)%height]);
      $('progress').textContent = `${name}: calculating independent high-precision oracle samples…`;
      const a = await engine.worker.call('exact', view, points, width, height, 100);
      const b = await engine.worker.call('exact', view, points, width, height, 160);
      const stable = points.map((p,k)=>({point:p,value:b.values[k],stable:Math.abs(a.values[k]-b.values[k])<=.002}));
      const selected = ['overview','julia','burningShip','tricorn','cubic'].includes(name) ? ['auto','fp32'] : name === 'deep10000' ? ['series','bla'] : ['auto','series','bla','combined'];
      for (const mode of selected) {
        $('progress').textContent = `${name} / ${mode}: one cold and ${repeats} warm renders…`;
        const row = { case: name, mode, width, height, settings: modes[mode] };
        try {
          // Compile the selected pipeline separately from uncached preparation.
          if (engine.gpu) await engine.pipeline(engine.options(view, modes[mode]));
          await engine.clearCaches();
          row.cold_ms = (await engine.render(view,width,height,modes[mode])).metadata.elapsed_ms;
          row.warm_ms = [];
          for(let k=0;k<repeats;k++) { const result = await engine.render(view,width,height,modes[mode]); row.warm_ms.push(result.metadata.elapsed_ms); row.metadata = result.metadata; }
          row.warm_median_ms = median(row.warm_ms);
          const field = await engine.readField(); engine.paint(0,1,0);
          const probes = stable.filter(s=>s.stable).map(s=>({ point:s.point, expected:s.value, actual:field[s.point[1]*width+s.point[0]] }));
          row.oracle_samples = probes; row.unstable_oracles = stable.filter(s=>!s.stable).length;
          row.oracle_max_error = Math.max(0,...probes.map(p=>Math.abs(p.expected-p.actual)));
          row.oracle_class_errors = probes.filter(p=>(p.expected<0)!==(p.actual<0)).length;
        } catch(error) { row.error=error.message; }
        data.rows.push(row); addRow(row); await new Promise(resolve=>setTimeout(resolve,0));
      }
    }
    $('progress').textContent = `Complete · ${data.rows.length} configurations. Results stay on this device.`;
  } catch(error) { $('progress').textContent = `Stopped: ${error.message}`; }
  finally { updateRaw(); $('run').disabled=false; $('download').disabled=false; }
};
$('download').onclick = () => { const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})); const a=document.createElement('a');a.href=url;a.download='fractal-web-benchmark.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000); };
