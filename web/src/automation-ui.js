import { animationParameters, cycleShapes, defaultAutomation, validateAutomation } from './animation.mjs';
import { decimal, plainText } from './decimal.mjs';
import { sliderDomain } from './slider-domain.mjs';

const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M19 8a8 8 0 1 0 1 7M19 3v5h-5"/><path d="m10 8 5 4-5 4z"/></svg>';
const magnifier = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 5.5 5.5"/><path class="precision-plus" d="M7 10h6m-3-3v6"/><path class="precision-minus" d="M7 10h6"/></svg>';
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
      clearTimeout(item.timer);
      if (item.group.isConnected) {
        item.header.before(item.label); item.values.before(item.input); item.row.before(item.slider);
        item.group.classList.remove('automation-enabled');
      }
      item.header.remove(); item.values.remove(); item.row.remove(); item.fields.remove(); items.delete(key);
    }
    for (const p of parameters) {
      const slider = document.getElementById(p.slider);
      if (!slider) continue;
      let item = items.get(p.key);
      if (!item) {
        const group = slider.closest('.parameter-control');
        const input = document.getElementById(slider.getAttribute('aria-controls'));
        const label = group.querySelector(`label[for="${input.id}"]`);
        const header = document.createElement('div'); header.className = 'parameter-header';
        label.before(header); header.append(label);
        const values = document.createElement('div'); values.className = 'parameter-values';
        input.before(values);
        const startLabel = document.createElement('label'); startLabel.className = 'field-label parameter-endpoint';
        const startCaption = document.createElement('span'); startCaption.textContent = 'Start';
        startLabel.append(startCaption, input); values.append(startLabel);
        const row = document.createElement('div'); row.className = 'parameter-sliders';
        slider.before(row); row.append(slider);
        const button = document.createElement('button');
        button.className = 'automation-toggle'; button.type = 'button'; button.id = `automate-${p.key}`;
        button.innerHTML = icon; header.append(button);
        const precision = document.createElement('button');
        precision.className = 'slider-precision'; precision.type = 'button'; precision.id = `precision-${p.key}`;
        precision.innerHTML = magnifier; row.append(precision);
        const marker = document.createElement('span'); marker.className = 'automation-playhead'; marker.hidden = true;
        marker.setAttribute('aria-hidden', 'true'); row.append(marker);
        const fields = document.createElement('div'); fields.className = 'automation-fields'; fields.id = `automation-${p.key}`;
        const targetLabel = document.createElement('label'); targetLabel.className = 'field-label parameter-endpoint'; targetLabel.textContent = 'Target';
        const target = document.createElement('input'); target.id = `automation-target-${p.key}`;
        target.type = p.decimal ? 'text' : 'number'; target.spellcheck = false; target.inputMode = 'decimal';
        if (!p.decimal) Object.assign(target, { min: p.min, max: p.max, step: p.step });
        const targetSlider = document.createElement('input');
        Object.assign(targetSlider, { id: `automation-target-${p.key}-slider`, type: 'range', className: 'parameter-slider' });
        targetSlider.setAttribute('aria-controls', target.id);
        targetLabel.append(target);
        targetSlider.classList.add('automation-target-slider');
        values.append(targetLabel); row.append(targetSlider);
        const speedLabel = document.createElement('label'); speedLabel.className = 'field-label automation-speed'; speedLabel.textContent = 'Cycles / second';
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
        fields.append(speedLabel, shapeLabel, live); row.after(fields);
        target.setAttribute('aria-label', `${p.label} automation target`);
        speed.setAttribute('aria-label', `${p.label} cycles per second`);
        values.id = `parameter-values-${p.key}`; row.id = `parameter-sliders-${p.key}`;
        button.setAttribute('aria-controls', `${values.id} ${row.id} ${fields.id}`);
        precision.setAttribute('aria-controls', `${slider.id} ${targetSlider.id}`);
        precision.onclick = () => {
          const shownValue = item.shownValue;
          item.precise = !item.precise; item.domain = null; sync();
          if (item.enabled && shownValue !== undefined) positionMarker(item, shownValue);
        };
        button.onclick = () => {
          const current = getSettings(), entry = current[p.key];
          const next = { ...current };
          if (entry?.enabled) delete next[p.key]; else next[p.key] = defaultAutomation(getView(), p);
          change(next);
        };
        const apply = (quiet = false) => {
          clearTimeout(item.timer);
          if (!button.isConnected || !getSettings()[p.key]?.enabled) return;
          try {
            const next = validateAutomation(getView(), { ...getSettings(), [p.key]: { enabled: true, target: target.value, speed: Number(speed.value), shape: shape.value } });
            if (JSON.stringify(next) !== JSON.stringify(getSettings())) change(next);
          } catch (error) { if (!quiet) { report(error.message); sync(); } }
        };
        target.onchange = speed.onchange = () => apply();
        target.onblur = speed.onblur = () => apply();
        shape.onchange = () => apply();
        target.oninput = speed.oninput = () => { clearTimeout(item.timer); item.timer = setTimeout(() => apply(true), 180); };
        targetSlider.oninput = () => {
          target.value = targetSlider.value;
          clearTimeout(item.timer); item.timer = setTimeout(() => apply(true), 180);
        };
        targetSlider.onchange = () => apply();
        for (const input of [target, speed]) input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); apply(); } };
        item = { group, header, label, input, values, startCaption, targetLabel, row, button, precision, marker, fields, target, targetSlider, speed, shape, live, slider, p, precise: false }; items.set(p.key, item);
      }
      const entry = settings[p.key];
      const enabled = !!entry?.enabled;
      const start = Number(view[p.key]), end = enabled ? Number(entry.target) : start;
      // Keep the axis fixed during a drag. Typed endpoints outside it refit both tracks.
      if (!item.domain || item.enabled !== enabled || Math.min(start, end) < item.domain.min || Math.max(start, end) > item.domain.max) {
        item.domain = sliderDomain(p, start, end, item.precise);
      }
      item.enabled = enabled;
      for (const track of [slider, item.targetSlider]) {
        for (const name of ['min', 'max', 'step']) track[name] = String(item.domain[name]);
      }
      item.group.classList.toggle('automation-enabled', enabled);
      item.startCaption.hidden = item.targetLabel.hidden = item.targetSlider.hidden = !enabled;
      item.input.setAttribute('aria-label', `${p.label}${enabled ? ' start' : ''}`);
      item.slider.setAttribute('aria-label', `${p.label}${enabled ? ' start' : ''} slider`);
      item.target.setAttribute('aria-label', `${p.label} automation target`);
      item.targetSlider.setAttribute('aria-label', `${p.label} automation target slider`);
      item.speed.setAttribute('aria-label', `${p.label} cycles per second`);
      item.shape.setAttribute('aria-label', `${p.label} cycle shape`);
      item.button.setAttribute('aria-label', `${entry?.enabled ? 'Disable' : 'Enable'} ${p.label} automation`);
      item.button.title = `${entry?.enabled ? 'Disable' : 'Enable'} automation`;
      item.button.setAttribute('aria-pressed', String(!!entry?.enabled));
      item.button.setAttribute('aria-expanded', String(enabled));
      item.precision.setAttribute('aria-pressed', String(item.precise));
      item.precision.setAttribute('aria-label', `${item.precise ? 'Restore full' : 'Narrow'} ${p.label} slider range`);
      item.precision.title = item.precise ? 'Restore full slider range' : 'Precision mode · narrow slider range';
      item.fields.hidden = !entry?.enabled;
      item.marker.hidden = !entry?.enabled;
      // Playback has its own marker; the editable thumb always marks the start.
      item.slider.value = String(view[p.key]);
      if (entry?.enabled) {
        positionMarker(item, view[p.key]);
        item.target.value = plainText(decimal(entry.target)); item.speed.value = String(entry.speed);
        item.shape.value = entry.shape ?? 'sine';
        // Only the thumb is approximate; syncing never changes the exact target.
        item.targetSlider.value = entry.target;
      }
    }
  }
  function showValues(view) {
    for (const [key, item] of items) if (getSettings()[key]?.enabled) {
      const value = view[key], numeric = Number(value);
      item.shownValue = value;
      item.live.textContent = `Now ${Number.isFinite(numeric) ? Number(numeric.toPrecision(7)) : value}`;
      positionMarker(item, value);
    }
  }
  return { sync, showValues };
}
