import { zoomLabel } from "/numbers.mjs?v=1";
const $ = (id) => document.getElementById(id);
const canvas = $("fractal-canvas"),
  ctx = canvas.getContext("2d", { alpha: false });
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
const palettes = await (await fetch("/palettes.json")).json();
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
  fma: true,
};
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
async function api(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let error;
    try {
      error = await response.json();
    } catch {
      throw new Error(`Renderer returned ${response.status}`);
    }
    const detail = error.detail;
    throw new Error(
      typeof detail === "string"
        ? detail
        : detail?.map((e) => e.msg).join("; ") || "Invalid request",
    );
  }
  return response;
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
function colorTable() {
  const colors = palettes[palette].colors.map((c) =>
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
function paint(target = canvas, values = field, metadata = meta) {
  if (!values || !metadata) return;
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
  const context = target === canvas ? ctx : target.getContext("2d"),
    image = context.createImageData(metadata.width, metadata.height),
    bytes = image.data,
    table = colorTable();
  for (let i = 0; i < values.length; i++) {
    const n = values[i],
      o = i * 4;
    if (n < 0) {
      bytes[o] = 8;
      bytes[o + 1] = 17;
      bytes[o + 2] = 18;
    } else {
      let t =
        (Math.log1p(Math.max(0, n - metadata.color_origin)) * 0.2 * density +
          phase) %
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
    b.onclick = () => loadView(d.view, i);
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
  $("julia-controls").hidden = !["julia", "cubic"].includes(view.fractal);
  $("zoom-label").textContent = zoomLabel(view.span);
  $("location-number").textContent =
    `0${Object.keys(descriptions).indexOf(view.fractal) + 1} / 05`;
}
function saveSession() {
  try {
    localStorage.setItem(
      "fractal-session",
      JSON.stringify({ view, palette, density, phase, renderSettings }),
    );
  } catch {}
}
function loadView(next, index = -1) {
  viewEpoch++;
  view = { ...base, ...next };
  activeDestination = index;
  generation++;
  syncView();
  buildDestinations();
  saveSession();
  requestRender();
}
async function validateAndLoad(next) {
  try {
    const response = await api("/api/navigate", { view: next });
    loadView(await response.json());
  } catch (error) {
    toast(error.message);
    syncView();
  }
}
function requestRender(delay = 0) {
  generation++;
  dirty = true;
  clearTimeout(scheduled);
  scheduled = setTimeout(render, delay);
}
async function render() {
  if (rendering || !dirty) return;
  dirty = false;
  rendering = true;
  document.body.classList.add("busy");
  $("render-status").textContent = "Tracing the infinite…";
  const token = generation,
    snapshot = { ...view },
    settingsSnapshot = { ...renderSettings },
    ratio = Number($("quality").value),
    aspect = innerHeight / innerWidth;
  const width = Math.max(
      16,
      Math.min(2560, Math.round(innerWidth * ratio), Math.floor(4096 / aspect)),
    ),
    height = Math.max(16, Math.round(width * aspect));
  try {
    const response = await api("/api/render", {
      ...settingsSnapshot,
      view: snapshot,
      width,
      height,
    });
    const metadata = JSON.parse(response.headers.get("X-Render-Meta")),
      values = new Float32Array(await response.arrayBuffer());
    if (token === generation) {
      field = values;
      meta = metadata;
      imageView = snapshot;
      imageSettings = settingsSnapshot;
      paint();
      canvas.style.transform = "";
      $("render-status").textContent =
        `${meta.backend.toUpperCase()} · ${meta.elapsed_ms.toLocaleString()} ms`;
      $("render-resolution").textContent = `${width} × ${height}`;
      $("precision-mode").textContent =
        meta.mode === "perturbation"
          ? `${meta.digits}-digit reference orbit`
          : `${meta.arithmetic || "fp64"} direct iteration`;
      $("precision-detail").textContent =
        meta.mode === "perturbation"
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
    if (token === generation) {
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
      const response = await api("/api/navigate", { view, dx, dy, factor });
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
    drag = { x: e.clientX, y: e.clientY };
  });
  viewport.addEventListener("pointermove", (e) => {
    if (drag)
      canvas.style.transform = `translate(${e.clientX - drag.x}px, ${e.clientY - drag.y}px)`;
  });
  const end = (e) => {
    if (!drag) return;
    const dx = (drag.x - e.clientX) / innerWidth,
      dy = (e.clientY - drag.y) / innerWidth;
    drag = null;
    if (Math.abs(dx) + Math.abs(dy) > 0.001) navigate(dx, dy);
    else canvas.style.transform = "";
  };
  viewport.addEventListener("pointerup", end);
  viewport.addEventListener("pointercancel", () => {
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
    if (key === "h") action = () => document.body.classList.toggle("ui-hidden");
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
  if (typeof settings?.fma === "boolean") renderSettings.fma = settings.fma;
  $("fma").checked = renderSettings.fma;
}
function setupControls() {
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
  $("fma").onchange = () => {
    renderSettings.fma = $("fma").checked;
    saveSession();
    requestRender();
  };
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
  $("iterations").onchange = () => {
    const n = Number($("iterations").value);
    if (!Number.isInteger(n) || n < 50 || n > 50000) {
      toast("Choose between 50 and 50,000 iterations.");
      $("iterations").value = view.iterations;
      return;
    }
    view.iterations = n;
    saveSession();
    requestRender();
  };
  $("quality").onchange = () => requestRender();
  for (const axis of ["x", "y"])
    $(`julia-${axis}`).onchange = () =>
      validateAndLoad({ ...view, [`julia_${axis}`]: $(`julia-${axis}`).value });
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
    $("toggle-panel").textContent = hidden ? "+" : "−";
    $("toggle-panel").setAttribute(
      "aria-label",
      hidden ? "Expand controls" : "Collapse controls",
    );
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
        localStorage.getItem("fractal-bookmarks") || "[]",
      );
      saved.push(locationData());
      localStorage.setItem(
        "fractal-bookmarks",
        JSON.stringify(saved.slice(-20)),
      );
      destinations.push({
        name: `Saved place ${saved.length}`,
        level: "YOUR OWN CORNER OF INFINITY",
        view: { ...view },
      });
      buildDestinations();
      toast("Location saved. Find it in your destinations.");
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
      const validated = await api("/api/navigate", { view: data.view });
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
    const button = $("download-png");
    button.disabled = true;
    $("export-status").textContent = "Rendering your image…";
    try {
      const selection = $("export-size").value;
      let values = field,
        metadata = meta;
      if (selection === "current") {
        if (
          !field ||
          JSON.stringify(imageView) !== JSON.stringify(view) ||
          JSON.stringify(imageSettings) !== JSON.stringify(renderSettings)
        )
          throw new Error("Wait for the current view to finish rendering.");
      } else {
        const aspect = innerHeight / innerWidth,
          width = Math.round(Number(selection) / Math.max(1, aspect)),
          height = Math.max(16, Math.round(width * aspect));
        const response = await api("/api/render", {
          ...renderSettings,
          view: { ...view },
          width,
          height,
        });
        metadata = JSON.parse(response.headers.get("X-Render-Meta"));
        values = new Float32Array(await response.arrayBuffer());
      }
      const output = document.createElement("canvas");
      paint(output, values, metadata);
      const blob = await new Promise((resolve) =>
        output.toBlob(resolve, "image/png"),
      );
      if (!blob) throw new Error("Could not encode the image.");
      await downloadBlob(
        blob,
        `fractal-${view.fractal}-${metadata.width}x${metadata.height}.png`,
      );
      $("export-status").textContent = "Your image is ready. Keep exploring.";
    } catch (error) {
      $("export-status").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
  $("download-gif").onclick = async () => {
    const button = $("download-gif");
    button.disabled = true;
    $("export-status").textContent =
      "Rendering 24 frames locally. Deep views can take a little while…";
    try {
      const aspect = innerHeight / innerWidth,
        width = Math.round(720 / Math.max(1, aspect)),
        height = Math.max(16, Math.round(width * aspect));
      const response = await api("/api/animation.gif", {
        view: { ...view },
        width,
        height,
        palette,
        density,
        phase,
        render_options: renderSettings,
      });
      await downloadBlob(await response.blob(), "fractal-zoom.gif");
      $("export-status").textContent = "Your 8× zoom journey is ready.";
    } catch (error) {
      $("export-status").textContent = error.message;
    } finally {
      button.disabled = false;
    }
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
    time - lastPaint > 65 &&
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
    const saved = JSON.parse(localStorage.getItem("fractal-session"));
    if (saved?.view && descriptions[saved.view.fractal]) {
      view = { ...base, ...saved.view };
      palette = palettes[saved.palette] ? saved.palette : 0;
      density = Number(saved.density) || 1;
      phase = Number(saved.phase) || 0;
      syncRenderSettings(saved.renderSettings);
      activeDestination = -1;
    }
    const bookmarks = JSON.parse(
      localStorage.getItem("fractal-bookmarks") || "[]",
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
  setupNavigation();
  setupControls();
  if (reducedMotion) {
    $("animate").disabled = true;
    $("animate").title = "Disabled by your reduced motion preference";
  }
  requestAnimationFrame(animate);
  try {
    const response = await fetch("/api/capabilities");
    if (!response.ok) throw new Error("Local engine could not start");
    const hardware = await response.json();
    $("hardware").replaceChildren(
      document.createElement("i"),
      document.createTextNode(
        hardware.cuda
          ? `${hardware.device.toUpperCase()} · CUDA`
          : "LOCAL CPU · NUMBA",
      ),
    );
    $("hardware").title = hardware.cuda
      ? "All fractal computation runs on your local NVIDIA GPU"
      : `CUDA unavailable: ${hardware.cuda_error}. Run uv sync --extra cuda to enable it.`;
    requestRender();
  } catch (error) {
    toast(error.message);
    $("render-status").textContent = "Local engine is unavailable";
  }
}
init();
