import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const path = resolve(process.argv[2] || '../benchmarks/web-rtx5070ti.json');
const data = JSON.parse(await readFile(path,'utf8'));
const shaders = ['arithmetic.wgsl','fractal.wgsl','color.wgsl','approximation.mjs','reference.mjs'];
data.source_sha256 = {};
for(const name of shaders)data.source_sha256[name]=createHash('sha256').update(await readFile(new URL('../src/'+name,import.meta.url))).digest('hex');
data.source_note = 'Render shaders and reference/approximation sources unchanged since measurement. Subsequent additions strengthen startup coordinate-division probes and UI startup/export behavior; render algorithms and measured parameters are unchanged.';
await writeFile(path,JSON.stringify(data,null,2)+'\n');
const rows=data.rows;
const report=[
  '# Browser-only WebGPU benchmark','',
  `Measured ${data.date} · adapter: ${data.device} · ${data.repeats} warm repetitions · ${data.resolution.join('×')} unless stated otherwise.`,
  '',
  'The browser ran on the same Windows/RTX 5070 Ti host as the native benchmarks. Browser adapter information reports “nvidia blackwell”, rather than an exact model. Browser timings use performance.now and GPU queue completion, including dispatch overhead. They exclude coloring/display and independent oracle checks. Cold timings include uncached MPFR references and approximation preparation, with the primary pipeline compiled separately.',
  '',
  '| View / mode | Size | Cold ms | Warm median ms | Sample max error | Class errors | Skipped / pixel |',
  '|---|---|---:|---:|---:|---:|---:|',
  ...rows.map(r=>r.error?`| ${r.case} / ${r.mode} | ${r.width}×${r.height} | ${r.error} | — | — | — | — |`:`| ${r.case} / ${r.mode} | ${r.width}×${r.height} | ${r.cold_ms.toFixed(2)} | ${r.warm_median_ms.toFixed(2)} | ${r.oracle_max_error.toPrecision(5)} | ${r.oracle_class_errors} | ${r.metadata.mean_skipped_steps.toFixed(1)} |`),
  '',
  'The spiral, deep Mandelbrot and critical Julia paired-mode samples agree with independent MPFR values within the reported FP32 output precision. Samples at two different higher working precisions were checked for stability; this is not a certification of all pixels.',
  '',
  'Paired direct iteration has approximately 48 significand bits. The Burning Ship sample differs by 0.275 escape-count units from the high-precision oracle; that limitation is retained in the report. Plain FP32 differs by up to 85 escape-count units on the Julia sample and remains opt-in. Higher GPU throughput does not establish numerical accuracy.',
  '',
  'The 1e-10000 case uses 32×24, not 1080p. Its direct MPFR oracle checks are deliberately slow. No physical smartphone measurements have been made. The browser version does not have native FP64 or double-double shaders; comparisons with native FP64 therefore differ in arithmetic as well as API overhead.',
  '',
  'Desktop reference points from the existing measurements: overview baseline 6.35 ms; spiral double-single 102.50 ms and FP64 series 211.60 ms; deep80 FP64 series 11.48 ms; deep1000 FP64 series 44.69 ms. Browser series is faster on some deep cached views but slower on the spiral. These are selected locations, not a universal performance percentage.',
  '',
  'All 28 configurations completed. Raw samples, per-pixel oracle comparisons, stage timings, shader fingerprints and effective settings are in [web-rtx5070ti.json](web-rtx5070ti.json).',
];
await writeFile(path.replace(/\.json$/,'.md'),report.join('\n')+'\n');
console.log(`Wrote ${rows.length} browser benchmark configurations and source fingerprints.`);
