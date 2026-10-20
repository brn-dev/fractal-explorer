import { zoomLabel } from './numbers.mjs';
import { navigate as navigateLocal, validate } from './decimal.mjs';
import { BrowserEngine } from './engine.js';
import { renderDimensions, qualityScales } from './resolution.mjs';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
const $ = (id) => document.getElementById(id);
const canvas = $("fractal-canvas");
const base = {
  x: "-0.5",
  y: "0",
  span: "3.6",
  fractal: "mandelbrot",
  iterations: 800,
  bailout: 64,
  julia_x: "-0.7269",
  julia_y: "0.1889",
};
const descriptions = {
  mandelbrot: [
    "The Mandelbrot set",
    "An entire universe, hiding at the edge.",
    "z<sub>n+1</sub> = z<sub>n</sub>² + c",
  ],
  julia: [
    "A Julia universe",
    "One constant. Infinitely many possibilities.",
    "z<sub>n+1</sub> = z<sub>n</sub>² + c",
  ],
  "burning-ship": [
    "The Burning Ship",
    "Find a little order in the beautiful chaos.",
    "z<sub>n+1</sub> = |Re(z²+c)| + i|Im(z²+c)|",
  ],
  tricorn: [
    "The Tricorn",
    "A familiar universe, reflected in itself.",
    "z<sub>n+1</sub> = z̄<sub>n</sub>² + c",
  ],
  cubic: [
    "A cubic universe",
    "Symmetry takes an unexpected turn.",
    "z<sub>n+1</sub> = z<sub>n</sub>³ + c",
  ],
};
const palettes = await (await fetch(new URL('./palettes.json', document.baseURI))).json();
const engine = new BrowserEngine(canvas, palettes);
let paintingReady = false;
let engineReady = false;
let parameterPreview = false, parameterPreviewTimer, locationIntroTimer;
const destinations = [
  {
    name: "The beginning",
    level: "A WORLD IN ONE SHAPE",
    view: { ...base },
    zoom: "1×",
  },
  {
    name: "Seahorse valley",
    level: "SPIRALS WITHIN SPIRALS",
    view: {
      ...base,
      x: "-0.7435",
      y: "0.1314",
      span: "0.008",
      iterations: 1600,
    },
    zoom: "450×",
  },
  {
    name: "The spiral",
    level: "BEYOND ORDINARY PRECISION",
    view: {
      ...base,
      x: "-0.743643887037151",
      y: "0.13182590420533",
      span: "0.00000000005",
      iterations: 3500,
    },
    zoom: "7.2e10×",
  },
  {
    name: "Julia gardens",
    level: "A DIFFERENT KIND OF INFINITY",
    view: {
      ...base,
      x: "0",
      y: "0",
      span: "3.6",
      fractal: "julia",
      julia_x: "-0.8",
      julia_y: "0.156",
      iterations: 1000,
    },
    zoom: "JULIA",
  },
  {
    name: "The deep edge",
    level: "80 DECIMAL PLACES BELOW",
    view: { ...base, x: "0", y: "1", span: "1e-80", iterations: 1000 },
    zoom: "3.6e80×",
  },
  {
    name: "Beyond doubles",
    level: "1,000 DECIMAL PLACES BELOW",
    view: { ...base, x: "0", y: "1", span: "1e-1000", iterations: 4000 },
    zoom: "3.6e1000×",
  },
];
let renderSettings = {
  arithmetic: "auto",
  range_mode: "auto",
  acceleration: "auto",
};
let placesHidden = false;
let view = { ...base },
  palette = 0,
  density = 1,
  phase = 0,
  field = null,
  meta = null;
let generation = 0,
  viewEpoch = 0,
  dirty = false,
  rendering = false,
  scheduled = null,
  navChain = Promise.resolve(),
  activeDestination = 0;
let lastPaint = 0,
  toastTimer,
  imageView = null,
  imageSettings = null;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 6500);
}
async function localNavigation(body) {
  return { json: async () => navigateLocal(body) };
}
function gradient(p) {
  return `linear-gradient(90deg, ${p.colors.join(",")})`;
}
function buildPalettes() {
  palettes.forEach((p, i) => {
    const b = document.createElement("button");
    b.className = "palette";
    b.style.background = gradient(p);
    b.title = p.name;
    b.setAttribute("aria-label", p.name);
    b.onclick = () => {
      palette = i;
      syncPalette();
      paint();
      saveSession();
    };
    $("palettes").append(b);
  });
  syncPalette();
}
function syncPalette() {
  document.querySelectorAll(".palette").forEach((b, i) => {
    b.classList.toggle("active", i === palette);
    b.setAttribute("aria-pressed", String(i === palette));
  });
  $("palette-name").textContent = palettes[palette].name;
  $("palette-preview").style.background = gradient(palettes[palette]);
}
function colorTable(index = palette) {
  const colors = palettes[index].colors.map((c) =>
      [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)),
    ),
    table = new Uint8ClampedArray(4096 * 3);
  for (let i = 0; i < 4096; i++) {
    const t = (i / 4096) * (colors.length - 1),
      k = Math.floor(t),
      f = t - k;
    for (let j = 0; j < 3; j++)
      table[i * 3 + j] = colors[k][j] * (1 - f) + colors[k + 1][j] * f;
  }
  return table;
}
function paint(target = canvas, values = field, metadata = meta, colors = {palette,density,phase}) {
  const {density: colorDensity, phase: colorPhase} = colors;
  if (!values || !metadata) return;
  if (target === canvas) { if (paintingReady) engine.paint(colors.palette, colorDensity, colorPhase); return; }
  // Remove the common iteration offset: a deep view may span only a few
  // escape counts after hundreds or thousands of shared iterations.
  if (metadata.color_origin === undefined) {
    let minimum = Infinity;
    for (const value of values)
      if (value >= 0 && value < minimum) minimum = value;
    metadata.color_origin = Number.isFinite(minimum) ? minimum : 0;
  }
  if (target.width !== metadata.width || target.height !== metadata.height) {
    target.width = metadata.width;
    target.height = metadata.height;
  }
  const context = target.getContext("2d"),
    image = context.createImageData(metadata.width, metadata.height),
    bytes = image.data,
    table = colorTable(colors.palette);
  for (let i = 0; i < values.length; i++) {
    const n = values[i],
      o = i * 4;
    if (n < 0) {
      bytes[o] = 8;
      bytes[o + 1] = 17;
      bytes[o + 2] = 18;
    } else {
      let t =
        (Math.log1p(Math.max(0, n - metadata.color_origin)) * 0.2 * colorDensity +
          colorPhase) %
        1;
      if (t < 0) t += 1;
      const k = Math.min(4095, Math.floor(t * 4096)) * 3;
      bytes[o] = table[k];
      bytes[o + 1] = table[k + 1];
      bytes[o + 2] = table[k + 2];
    }
    bytes[o + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}
function buildDestinations() {
  $("destination-list").replaceChildren();
  destinations.forEach((d, i) => {
    const b = document.createElement("button");
    b.className = `destination-card${i === activeDestination ? " active" : ""}`;
    b.innerHTML = `<span class="card-top"><span>0${i + 1}</span><span>↗</span></span><span><span class="card-name"></span><span class="card-level" style="display:block"></span></span>`;
    b.querySelector(".card-name").textContent = d.name;
    b.querySelector(".card-level").textContent = d.level;
    b.onclick = () => { loadView(d.view, i); showLocationIntro(); };
    $("destination-list").append(b);
  });
}
function syncView() {
  const [title, description, formula] = descriptions[view.fractal];
  $("view-title").replaceChildren(
    document.createTextNode(title),
    Object.assign(document.createElement("span"), { textContent: "." }),
  );
  $("view-description").textContent = description;
  $("formula").innerHTML = formula;
  $("fractal").value = view.fractal;
  $("iterations").value = view.iterations;
  $("center-x").value = view.x;
  $("center-y").value = view.y;
  $("span").value = view.span;
  $("julia-x").value = view.julia_x;
  $("julia-y").value = view.julia_y;
  for (const axis of ['x', 'y']) {
    const slider = $(`julia-${axis}-slider`);
    if (!parameterPreview) {
      const extent = Math.max(2, Math.ceil(Math.abs(Number(view[`julia_${axis}`]))));
      slider.min = String(-extent); slider.max = String(extent);
    }
    // Updating a thumb must never round the stored decimal or its text field.
    slider.value = view[`julia_${axis}`];
  }
  $('iterations-slider').value = String(view.iterations);
  $("julia-controls").hidden = !["julia", "cubic"].includes(view.fractal);
  $("zoom-label").textContent = zoomLabel(view.span);
}
function showLocationIntro() {
  clearTimeout(locationIntroTimer);
  const intro = $('location-intro');
  intro.classList.remove('intro-hidden');
  intro.setAttribute('aria-hidden', 'false');
  locationIntroTimer = setTimeout(() => {
    intro.classList.add('intro-hidden');
    intro.setAttribute('aria-hidden', 'true');
  }, 3000);
}
function saveSession() {
  try {
    localStorage.setItem(
      "fractal-web-session",
      JSON.stringify({ view, palette, density, phase, renderSettings, quality: Number($("quality").value), placesHidden }),
    );
  } catch {}
}
function toggleUI() {
  const hidden = document.body.classList.toggle('ui-hidden');
  const button = $('toggle-ui');
  const label = hidden ? 'Show UI' : 'Hide UI';
  button.setAttribute('aria-label', label);
  button.title = `${label} (H)`;
  button.setAttribute('aria-expanded', String(!hidden));
  if (hidden) {
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    button.focus({ preventScroll: true });
  }
}
function setPlacesHidden(hidden) {
  placesHidden = hidden;
  $('destination-list').hidden = hidden;
  $('places-label').hidden = hidden;
  $('destinations').classList.toggle('places-hidden', hidden);
  const button = $('toggle-destinations');
  button.setAttribute('aria-label', hidden ? 'Show places' : 'Hide places');
  button.title = `${hidden ? 'Show' : 'Hide'} preset location cards (P)`;
  button.setAttribute('aria-expanded', String(!hidden));
}
function loadView(next, index = -1, preview = false) {
  clearTimeout(parameterPreviewTimer);
  parameterPreview = preview;
  viewEpoch++;
  view = { ...base, ...next };
  activeDestination = index;
  generation++;
  syncView();
  buildDestinations();
  saveSession();
  requestRender();
  if (preview) parameterPreviewTimer = setTimeout(finishParameterPreview, 180);
}
function finishParameterPreview() {
  clearTimeout(parameterPreviewTimer);
  if (!parameterPreview) return;
  parameterPreview = false;
  paintingReady = false;
  requestRender();
}
async function validateAndLoad(next) {
  try {
    const response = await localNavigation({ view: next });
    loadView(await response.json());
  } catch (error) {
    toast(error.message);
    syncView();
  }
}
function requestRender(delay = 0) {
  engine.cancel();
  generation++;
  dirty = true;
  clearTimeout(scheduled);
  scheduled = setTimeout(render, delay);
}
async function render() {
  if (!engineReady || rendering || !dirty) return;
  dirty = false;
  rendering = true;
  paintingReady = false;
  document.body.classList.add("busy");
  $("render-status").textContent = "Tracing the infinite…";
  const token = generation,
    snapshot = { ...view },
    settingsSnapshot = { ...renderSettings };
  const quality = parameterPreview ? Math.min(1, Number($("quality").value)) : $("quality").value;
  const { width, height, capped } = renderDimensions(innerWidth, innerHeight, quality, { gpu: engine.gpu, mobile: engine.mobile, limits: engine.renderLimits });
  $("quality-note").textContent = `${parameterPreview ? 'Preview · ' : ''}${width.toLocaleString()} × ${height.toLocaleString()} pixels${capped ? ' · resolution limit reached' : ''}. Higher quality smooths fine edges; increase iterations for more fractal detail.`;
  try {
    const result = await engine.render(snapshot, width, height, settingsSnapshot);
    const metadata = result.metadata, values = result.field;

    if (token === generation) {
      field = values;
      meta = metadata;
      imageView = snapshot;
      imageSettings = settingsSnapshot;
      paintingReady = true;
      paint();
      canvas.style.transform = "";
      $("render-status").textContent =
        `${meta.backend.toUpperCase()} · ${meta.elapsed_ms.toLocaleString()} ms`;
      $("render-resolution").textContent = `${width} × ${height}`;
      $("precision-mode").textContent =
        meta.perturbation
          ? `${meta.digits}-digit reference orbit`
          : `${meta.arithmetic || "fp64"} direct iteration`;
      $("precision-detail").textContent =
        meta.perturbation
          ? `${meta.arithmetic || "fp64"} · ${meta.range_mode || "standard"} · ${meta.acceleration || "none"}`
          : "Adaptive · deep zoom activates automatically";
      $("precision-detail").title =
        `${meta.repaired} unstable pixels repaired; ${meta.promoted_pixels || 0} pixels promoted`;
      $("performance-note").classList.toggle(
        "experimental",
        !!meta.experimental,
      );
      const timings = meta.timings || {};
      $("stage-times").textContent =
        `Reference ${(timings.reference_ms || 0).toFixed(1)} ms · Prepare ${(timings.preparation_ms || 0).toFixed(1)} ms · GPU ${(timings.kernel_ms || 0).toFixed(1)} ms · Repair ${(timings.repair_ms || 0).toFixed(1)} ms`;
      if (meta.warning) toast(meta.warning);
    }
  } catch (error) {
    if (token === generation && error.name !== "AbortError") {
      canvas.style.transform = "";
      $("render-status").textContent = "Render could not complete";
      toast(error.message);
    }
  } finally {
    rendering = false;
    document.body.classList.remove("busy");
    if (dirty) render();
  }
}
function navigate(dx, dy, factor = 1) {
  // Serialize navigation requests so every tiny decimal movement builds on the previous one.
  generation++;
  const epoch = viewEpoch;
  navChain = navChain
    .then(async () => {
      if (epoch !== viewEpoch) return;
      const response = await localNavigation({ view, dx, dy, factor });
      const moved = await response.json();
      if (epoch !== viewEpoch) return;
      view = moved;
      activeDestination = -1;
      syncView();
      buildDestinations();
      saveSession();
      requestRender(65);
    })
    .catch((error) => toast(error.message));
  return navChain;
}
function isInput(event) {
  return (
    ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName) ||
    !!document.querySelector("dialog[open]")
  );
}
function setupNavigation() {
  const viewport = $("viewport");
  const pointers = new Map();
  let pinch = null;
  let drag = null,
    wheel = 0,
    wheelTimer;
  viewport.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      wheel += e.deltaY;
      clearTimeout(wheelTimer);
      const x = e.clientX / innerWidth - 0.5,
        y = (innerHeight / 2 - e.clientY) / innerWidth;
      wheelTimer = setTimeout(() => {
        const factor = Math.exp(-Math.max(-900, Math.min(900, wheel)) * 0.002);
        wheel = 0;
        navigate(x, y, factor);
      }, 45);
    },
    { passive: false },
  );
  viewport.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    viewport.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x:e.clientX, y:e.clientY });
    if (pointers.size === 2) {
      const [a,b] = [...pointers.values()];
      pinch = { initial:Math.hypot(a.x-b.x,a.y-b.y), current:Math.hypot(a.x-b.x,a.y-b.y), x:(a.x+b.x)/2, y:(a.y+b.y)/2 };
      drag = null; return;
    }
    drag = { x: e.clientX, y: e.clientY };
  });
  viewport.addEventListener("pointermove", (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if (pinch && pointers.size === 2) {
      const [a,b] = [...pointers.values()]; pinch.current = Math.hypot(a.x-b.x,a.y-b.y);
      canvas.style.transform = `scale(${Math.max(.1,Math.min(10,pinch.current/Math.max(1,pinch.initial)))})`;
      return;
    }
    if (drag)
      canvas.style.transform = `translate(${e.clientX - drag.x}px, ${e.clientY - drag.y}px)`;
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pinch) {
      const factor = Math.max(.05,Math.min(20,pinch.current/Math.max(1,pinch.initial)));
      navigate(pinch.x/innerWidth-.5,(innerHeight/2-pinch.y)/innerWidth,factor);
      pinch=null; drag=null; pointers.clear(); return;
    }
    if (!drag) return;
    const dx = (drag.x - e.clientX) / innerWidth,
      dy = (e.clientY - drag.y) / innerWidth;
    drag = null;
    if (Math.abs(dx) + Math.abs(dy) > 0.001) navigate(dx, dy);
    else canvas.style.transform = "";
  };
  viewport.addEventListener("pointerup", end);
  viewport.addEventListener("pointercancel", () => {
    pointers.clear(); pinch=null;
    drag = null;
    canvas.style.transform = "";
  });
  viewport.addEventListener("dblclick", (e) =>
    navigate(
      e.clientX / innerWidth - 0.5,
      (innerHeight / 2 - e.clientY) / innerWidth,
      3,
    ),
  );
  $("zoom-in").onclick = () => navigate(0, 0, 2);
  $("zoom-out").onclick = () => navigate(0, 0, 0.5);
  $("reset").onclick = () =>
    loadView({
      ...base,
      fractal: view.fractal,
      x: view.fractal === "mandelbrot" ? "-0.5" : "0",
      julia_x: view.julia_x,
      julia_y: view.julia_y,
    });
  document.addEventListener("keydown", (e) => {
    if (isInput(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.tagName === "BUTTON" && [" ", "Enter"].includes(e.key)) return;
    const key = e.key.toLowerCase(),
      step = e.shiftKey ? 0.02 : 0.15;
    let action;
    if (["w", "arrowup"].includes(key)) action = () => navigate(0, step);
    if (["s", "arrowdown"].includes(key)) action = () => navigate(0, -step);
    if (["a", "arrowleft"].includes(key)) action = () => navigate(-step, 0);
    if (["d", "arrowright"].includes(key)) action = () => navigate(step, 0);
    if (["e", "+", "=", " "].includes(key))
      action = () => navigate(0, 0, e.shiftKey ? 1.1 : 2);
    if (["q", "-", "_"].includes(key))
      action = () => navigate(0, 0, e.shiftKey ? 1 / 1.1 : 0.5);
    if (key === "r") action = () => $("reset").click();
    if (key === "h" && !e.repeat) action = () => $("toggle-ui").click();
    if (key === "p" && !e.repeat) action = () => $("toggle-destinations").click();
    if (key === "?") action = () => $("help-dialog").showModal();
    if (action) {
      e.preventDefault();
      action();
    }
  });
  addEventListener("resize", () => requestRender(250));
}
async function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function locationData() {
  return {
    format: "fractal-explorer/v1",
    view,
    palette,
    density,
    phase,
    renderSettings,
  };
}
function syncRenderSettings(settings) {
  for (const [field, id] of [
    ["arithmetic", "arithmetic"],
    ["range_mode", "range-mode"],
    ["acceleration", "acceleration"],
  ]) {
    if (
      Array.from($(id).options).some(
        (option) => option.value === settings?.[field],
      )
    )
      renderSettings[field] = settings[field];
    $(id).value = renderSettings[field];
  }
}
function setupControls() {
  $('toggle-ui').onclick = toggleUI;
  $('toggle-destinations').onclick = () => { setPlacesHidden(!placesHidden); saveSession(); };
  for (const [field, id] of [
    ["arithmetic", "arithmetic"],
    ["range_mode", "range-mode"],
    ["acceleration", "acceleration"],
  ]) {
    $(id).onchange = () => {
      renderSettings[field] = $(id).value;
      saveSession();
      requestRender();
    };
  }

  $("fractal").onchange = () => {
    const fractal = $("fractal").value;
    loadView({
      ...base,
      fractal,
      x:
        fractal === "mandelbrot"
          ? "-0.5"
          : fractal === "burning-ship"
            ? "-0.75"
            : "0",
      y: fractal === "burning-ship" ? "0.375" : "0",
      julia_x: fractal === "cubic" ? "-0.54" : base.julia_x,
      julia_y: fractal === "cubic" ? "0.196" : base.julia_y,
    });
    showLocationIntro();
  };
  $("density").oninput = () => {
    density = Number($("density").value);
    $("density-value").textContent = density.toFixed(1);
    paint();
    saveSession();
  };
  $("phase").oninput = () => {
    phase = Number($("phase").value);
    $("phase-value").textContent = phase.toFixed(2);
    paint();
    saveSession();
  };
  const applyIterations = () => {
    const n = Number($("iterations").value);
    if (!Number.isInteger(n) || n < 50 || n > 50000) {
      toast("Choose between 50 and 50,000 iterations.");
      $("iterations").value = view.iterations;
      return;
    }
    if (n === view.iterations) return;
    view.iterations = n;
    $('iterations-slider').value = String(n);
    saveSession();
    requestRender();
  };
  $('iterations').onchange = applyIterations;
  $('iterations').onblur = applyIterations;
  $('iterations').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); applyIterations(); } };
  $("quality").onchange = () => { saveSession(); requestRender(); };
  $('iterations-slider').oninput = () => loadView({ ...view, iterations: Number($('iterations-slider').value) }, -1, true);
  $('iterations-slider').onchange = finishParameterPreview;
  for (const axis of ["x", "y"]) {
    const input = $(`julia-${axis}`), field = `julia_${axis}`;
    const applyConstant = () => {
      if (input.value === view[field]) return;
      try { loadView(validate({ ...view, [field]: input.value })); }
      catch (error) { toast(error.message); syncView(); }
    };
    input.onchange = applyConstant;
    input.onblur = applyConstant;
    input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); applyConstant(); } };
    $(`julia-${axis}-slider`).oninput = () => loadView({ ...view, [`julia_${axis}`]: $(`julia-${axis}-slider`).value }, -1, true);
    $(`julia-${axis}-slider`).onchange = finishParameterPreview;
  }
  $("coordinates-toggle").onclick = () => {
    const hidden = !$("coordinates").hidden;
    $("coordinates").hidden = hidden;
    $("coordinates-toggle").setAttribute("aria-expanded", String(!hidden));
  };
  $("apply-coordinates").onclick = () =>
    validateAndLoad({
      ...view,
      x: $("center-x").value,
      y: $("center-y").value,
      span: $("span").value,
    });
  $("toggle-panel").onclick = () => {
    const hidden = !$("panel-content").hidden;
    $("panel-content").hidden = hidden;
    $('panel').classList.toggle('panel-collapsed', hidden);
    const button = $('toggle-panel');
    const label = hidden ? 'Expand controls' : 'Collapse controls';
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-expanded', String(!hidden));
    button.title = label;
  };
  $("help").onclick = () => $("help-dialog").showModal();
  $("fullscreen").onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else
      document.documentElement
        .requestFullscreen()
        .catch((e) => toast(e.message));
  };
  $("save-location").onclick = () => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("fractal-web-bookmarks") || "[]",
      );
      saved.push(locationData());
      localStorage.setItem(
        "fractal-web-bookmarks",
        JSON.stringify(saved.slice(-20)),
      );
      destinations.push({
        name: `Saved place ${saved.length}`,
        level: "YOUR OWN CORNER OF INFINITY",
        view: { ...view },
      });
      buildDestinations();
      toast(placesHidden ? "Location saved. Tap the places arrow to see it." : "Location saved. Find it in your destinations.");
    } catch {
      toast(
        "Browser storage is unavailable. Export the location as JSON instead.",
      );
    }
  };
  $("export").onclick = () => $("export-dialog").showModal();
  $("download-location").onclick = () =>
    downloadBlob(
      new Blob([JSON.stringify(locationData(), null, 2)], {
        type: "application/json",
      }),
      "fractal-location.json",
    );
  $("import-location").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (file.size > 256000) throw new Error("Location file is too large.");
      const data = JSON.parse(await file.text());
      if (
        data.format !== "fractal-explorer/v1" ||
        !data.view ||
        !descriptions[data.view.fractal]
      )
        throw new Error("This is not a Fractal Explorer location.");
      const validated = await localNavigation({ view: data.view });
      const imported = await validated.json();
      palette =
        Number.isInteger(data.palette) && palettes[data.palette]
          ? data.palette
          : 0;
      density = Number.isFinite(data.density)
        ? Math.max(0.2, Math.min(4, data.density))
        : 1;
      phase = Number.isFinite(data.phase) ? data.phase % 1 : 0;
      syncColorControls();
      syncPalette();
      syncRenderSettings(data.renderSettings);
      loadView(imported);
      $("export-dialog").close();
    } catch (error) {
      toast(error.message);
    }
    e.target.value = "";
  };
  $("download-png").onclick = async () => {
    const button = $("download-png"); button.disabled = true;
    $("export-status").textContent = "Rendering on your device…";
    let exporter;
    try {
      if (!engineReady) throw new Error('Wait for the browser renderer to start.');
      const selection = $("export-size").value;
      let values, metadata = meta;
      if (selection === 'current') {
        if (rendering || !paintingReady || !field || JSON.stringify(imageView) !== JSON.stringify(view) || JSON.stringify(imageSettings) !== JSON.stringify(renderSettings)) throw new Error('Wait for the current view to finish rendering.');
        values = await engine.readField();
      } else {
        const aspect = innerHeight / innerWidth, width = Math.max(16, Math.round(Number(selection) / Math.max(1, aspect))), height = Math.max(16, Math.round(width * aspect));
        exporter = new BrowserEngine(document.createElement('canvas'), palettes); await exporter.init({ forceCPU: !engine.gpu });
        metadata = (await exporter.render({ ...view }, width, height, { ...renderSettings })).metadata;
        values = await exporter.readField();
      }
      const output = document.createElement('canvas'); paint(output, values, metadata);
      const blob = await new Promise(resolve => output.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Could not encode the image.');
      await downloadBlob(blob, 'fractal-web-' + view.fractal + '-' + metadata.width + 'x' + metadata.height + '.png');
      $("export-status").textContent = "Your image is ready. Keep exploring.";
    } catch (error) { $("export-status").textContent = error.message; }
    finally { exporter?.destroy(); button.disabled = false; }
  };
  $("download-gif").onclick = async () => {
    const button = $("download-gif"); button.disabled = true;
    let exporter;
    try {
      const snapshot = { ...view }, settings = { ...renderSettings };
      const exportColors = {palette,density,phase};
      if (snapshot.iterations > 10000) throw new Error('GIF export supports up to 10,000 iterations.');
      const aspect = innerHeight / innerWidth, width = Math.max(16, Math.round(720 / Math.max(1, aspect))), height = Math.max(16, Math.round(width * aspect));
      exporter = new BrowserEngine(document.createElement('canvas'), palettes); await exporter.init({ forceCPU: !engine.gpu });
      const gif = GIFEncoder(), output = document.createElement('canvas');
      let current = snapshot, gifPalette;
      for (let frame = 0; frame < 24; frame++) {
        $("export-status").textContent = 'Rendering frame ' + (frame + 1) + ' / 24 on your device…';
        const metadata = (await exporter.render(current, width, height, settings)).metadata;
        paint(output, await exporter.readField(), metadata, exportColors);
        const rgba = output.getContext('2d').getImageData(0, 0, width, height).data;
        gifPalette ??= quantize(rgba, 256);
        gif.writeFrame(applyPalette(rgba, gifPalette), width, height, { palette: gifPalette, delay: 83, repeat: 0 });
        current = navigateLocal({ view: current, factor: 8 ** (1 / 23) });
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      gif.finish(); await downloadBlob(new Blob([gif.bytes()], { type: 'image/gif' }), 'fractal-web-zoom.gif');
      $("export-status").textContent = 'Your 8× zoom journey is ready.';
    } catch (error) { $("export-status").textContent = error.message; }
    finally { exporter?.destroy(); button.disabled = false; }
  };

  for (const dialog of document.querySelectorAll("dialog"))
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) {
        const r = dialog.getBoundingClientRect();
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        )
          dialog.close();
      }
    });
}
function syncColorControls() {
  $("density").value = density;
  $("density-value").textContent = density.toFixed(1);
  $("phase").value = phase;
  $("phase-value").textContent = phase.toFixed(2);
}
function animate(time) {
  if (
    $("animate").checked &&
    field &&
    time - lastPaint > (engine.gpu ? 16 : 65) &&
    !reducedMotion
  ) {
    phase = (phase + 0.002) % 1;
    $("phase").value = phase;
    $("phase-value").textContent = phase.toFixed(2);
    paint();
    lastPaint = time;
  }
  requestAnimationFrame(animate);
}
async function init() {
  try {
    const saved = JSON.parse(localStorage.getItem("fractal-web-session"));
    setPlacesHidden(saved?.placesHidden === true);
    if (saved?.view && descriptions[saved.view.fractal]) {
      view = { ...base, ...saved.view };
      palette = palettes[saved.palette] ? saved.palette : 0;
      density = Number(saved.density) || 1;
      phase = Number(saved.phase) || 0;
      if (qualityScales.includes(saved.quality)) $("quality").value = String(saved.quality);
      syncRenderSettings(saved.renderSettings);
      activeDestination = -1;
    }
    const bookmarks = JSON.parse(
      localStorage.getItem("fractal-web-bookmarks") || "[]",
    );
    for (const [i, b] of bookmarks.entries())
      if (b.view && descriptions[b.view.fractal])
        destinations.push({
          name: `Saved place ${i + 1}`,
          level: "YOUR OWN CORNER OF INFINITY",
          view: b.view,
        });
  } catch {}
  buildPalettes();
  buildDestinations();
  syncView();
  syncColorControls();
  showLocationIntro();
  setupNavigation();
  setupControls();
  if (matchMedia('(max-width:700px)').matches) $("toggle-panel").click();
  if (reducedMotion) {
    $("animate").disabled = true;
    $("animate").title = "Disabled by your reduced motion preference";
  }
  requestAnimationFrame(animate);
  try {
    const hardware = await engine.init({ forceCPU: new URLSearchParams(location.search).get('cpu') === '1' });
    engineReady = true;
    $("hardware").textContent = hardware.gpu ? hardware.device.toUpperCase() + ' · WEBGPU' : 'LOCAL CPU · WASM';
    $("hardware").title = hardware.gpu ? 'Computation runs on this device’s GPU; high-precision references run in its CPU worker.' : hardware.error;
    if (!hardware.gpu) toast('GPU unavailable. Using the local CPU worker at reduced resolution. ' + hardware.error);

    requestRender();
  } catch (error) {
    toast(error.message);
    $("render-status").textContent = "Browser renderer could not start";
  }
}
init();

async function offlineStatus() {
  const status = $('offline-status');
  if (!import.meta.env.PROD) return;
  status.textContent = 'Checking offline cache…';
  if (!('serviceWorker' in navigator)) { status.textContent = 'Offline caching is unavailable in this browser.'; return; }
  const timeout = setTimeout(() => { status.textContent = 'Offline caching is unavailable in this browser. Static hosting is still required for reloads.'; }, 8000);
  try {
    const registration = await navigator.serviceWorker.register(new URL('./sw.js', document.baseURI));
    const update = () => {
      if (registration.waiting) {
        clearTimeout(timeout); status.textContent = 'An offline update is ready.';
        const button = $('update-offline'); button.hidden = false;
        button.onclick = () => { saveSession(); navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});registration.waiting?.postMessage('activate'); };
        return;
      }
      if (registration.active || registration.waiting || registration.installing?.state === 'installed') {
        clearTimeout(timeout);
        status.textContent = navigator.serviceWorker.controller ? 'Available offline on this device.' : 'Offline cache ready. Reload once to activate.';
      }
    };
    registration.installing?.addEventListener('statechange', update);
    registration.addEventListener('updatefound',()=>registration.installing?.addEventListener('statechange',update));
    navigator.serviceWorker.addEventListener('controllerchange',update);
    update();
  } catch (error) { clearTimeout(timeout); status.textContent = 'Offline caching is unavailable in this browser.'; status.title = error.message; }
}
offlineStatus();
