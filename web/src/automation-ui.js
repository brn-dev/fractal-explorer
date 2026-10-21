import { animationParameters, cycleShapes, defaultAutomation, validateAutomation } from './animation.mjs';
import { decimal, plainText } from './decimal.mjs';

const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M19 8a8 8 0 1 0 1 7M19 3v5h-5"/><path d="m10 8 5 4-5 4z"/></svg>';
function positionMarker(item, value) {
  const min = Number(item.slider.min), max = Number(item.slider.max);
  const position = (Number(value) - min) / (max - min);
  item.marker.style.setProperty('--animation-position', `${100 * Math.max(0, Math.min(1, position))}%`);
}
export function setupAutomationControls({ getView, getSettings, change, report }) {
  const items = new Map();
  function sync() {
    const view = getView(), settings = getSettings(), parameters = animationParameters(view);
    const wanted = new Set(parameters.map(p => p.key));
    for (const [key, item] of items) if (!wanted.has(key) || !item.button.isConnected) {
      if (item.row.isConnected) item.row.before(item.slider);
      item.row.remove(); item.fields.remove(); items.delete(key);
    }
    for (const p of parameters) {
      const slider = document.getElementById(p.slider);
      if (!slider) continue;
      let item = items.get(p.key);
      if (!item) {
        const row = document.createElement('div'); row.className = 'automatable-slider';
        slider.before(row); row.append(slider);
        const button = document.createElement('button');
        button.className = 'automation-toggle'; button.type = 'button'; button.id = `automate-${p.key}`;
        button.innerHTML = icon; row.append(button);
        const marker = document.createElement('span'); marker.className = 'automation-playhead'; marker.hidden = true;
        marker.setAttribute('aria-hidden', 'true'); row.append(marker);
        const fields = document.createElement('div'); fields.className = 'automation-fields'; fields.id = `automation-${p.key}`;
        const targetLabel = document.createElement('label'); targetLabel.className = 'field-label'; targetLabel.textContent = 'Target';
        const target = document.createElement('input'); target.id = `automation-target-${p.key}`;
        target.type = p.decimal ? 'text' : 'number'; target.spellcheck = false; target.inputMode = 'decimal';
        if (!p.decimal) Object.assign(target, { min: p.min, max: p.max, step: p.step });
        const targetSlider = document.createElement('input');
        Object.assign(targetSlider, { id: `automation-target-${p.key}-slider`, type: 'range', className: 'parameter-slider' });
        targetSlider.setAttribute('aria-controls', target.id);
        targetLabel.append(target);
        const targetRow = document.createElement('div'); targetRow.className = 'automatable-slider automation-target-slider';
        targetRow.append(targetSlider);
        const speedLabel = document.createElement('label'); speedLabel.className = 'field-label'; speedLabel.textContent = 'Cycles / second';
        const speed = document.createElement('input');
        Object.assign(speed, { id: `automation-speed-${p.key}`, type: 'number', min: .05, max: 2, step: .05 });
        speedLabel.append(speed);
        const shapeLabel = document.createElement('label'); shapeLabel.className = 'field-label automation-shape'; shapeLabel.textContent = 'Cycle shape';
        const shape = document.createElement('select'); shape.id = `automation-shape-${p.key}`;
        for (const [value, curve] of Object.entries(cycleShapes)) {
          const option = document.createElement('option'); option.value = value; option.textContent = curve.label; shape.append(option);
        }
        shapeLabel.append(shape);
        const live = document.createElement('output'); live.className = 'automation-now';
        fields.append(targetLabel, speedLabel, targetRow, shapeLabel, live); row.after(fields);
        target.setAttribute('aria-label', `${p.label} automation target`);
        speed.setAttribute('aria-label', `${p.label} cycles per second`);
        button.setAttribute('aria-controls', fields.id);
        button.onclick = () => {
          const current = getSettings(), entry = current[p.key];
          const next = { ...current };
          if (entry?.enabled) delete next[p.key]; else next[p.key] = defaultAutomation(getView(), p);
          change(next);
        };
        let timer;
        const apply = (quiet = false) => {
          clearTimeout(timer);
          if (!button.isConnected || !getSettings()[p.key]?.enabled) return;
          try {
            const next = validateAutomation(getView(), { ...getSettings(), [p.key]: { enabled: true, target: target.value, speed: Number(speed.value), shape: shape.value } });
            if (JSON.stringify(next) !== JSON.stringify(getSettings())) change(next);
          } catch (error) { if (!quiet) { report(error.message); sync(); } }
        };
        target.onchange = speed.onchange = () => apply();
        target.onblur = speed.onblur = () => apply();
        shape.onchange = () => apply();
        target.oninput = speed.oninput = () => { clearTimeout(timer); timer = setTimeout(() => apply(true), 180); };
        targetSlider.oninput = () => {
          target.value = targetSlider.value;
          clearTimeout(timer); timer = setTimeout(() => apply(true), 180);
        };
        targetSlider.onchange = () => apply();
        for (const input of [target, speed]) input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); apply(); } };
        item = { row, button, marker, fields, target, targetSlider, speed, shape, live, slider, p }; items.set(p.key, item);
      }
      const entry = settings[p.key];
      item.target.setAttribute('aria-label', `${p.label} automation target`);
      item.targetSlider.setAttribute('aria-label', `${p.label} automation target slider`);
      item.speed.setAttribute('aria-label', `${p.label} cycles per second`);
      item.shape.setAttribute('aria-label', `${p.label} cycle shape`);
      item.button.setAttribute('aria-label', `${entry?.enabled ? 'Disable' : 'Enable'} ${p.label} automation`);
      item.button.title = `${entry?.enabled ? 'Disable' : 'Enable'} automation`;
      item.button.setAttribute('aria-pressed', String(!!entry?.enabled));
      item.fields.hidden = !entry?.enabled;
      item.marker.hidden = !entry?.enabled;
      // Playback has its own marker; the editable thumb always marks the start.
      item.slider.value = String(view[p.key]);
      if (entry?.enabled) {
        positionMarker(item, view[p.key]);
        item.target.value = plainText(decimal(entry.target)); item.speed.value = String(entry.speed);
        item.shape.value = entry.shape ?? 'sine';
        if (document.activeElement !== item.targetSlider) {
          const extent = Math.max(2, Math.abs(Number(slider.min)), Math.abs(Number(slider.max)), Math.ceil(Math.abs(Number(entry.target))));
          item.targetSlider.min = p.decimal ? String(-extent) : slider.min;
          item.targetSlider.max = p.decimal ? String(extent) : slider.max;
          item.targetSlider.step = slider.step;
        }
        // Only the thumb is approximate; syncing never changes the exact target.
        item.targetSlider.value = entry.target;
      }
    }
  }
  function showValues(view) {
    for (const [key, item] of items) if (getSettings()[key]?.enabled) {
      const value = view[key], numeric = Number(value);
      item.live.textContent = `Now ${Number.isFinite(numeric) ? Number(numeric.toPrecision(7)) : value}`;
      positionMarker(item, value);
    }
  }
  return { sync, showValues };
}
