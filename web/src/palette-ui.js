import { MAX_PALETTE_COLORS, validateCustomPalette, customPaletteDefinition } from './palettes.mjs';

const $ = id => document.getElementById(id);
const gradient = palette => `linear-gradient(90deg, ${palette.colors.join(',')})`;

export function setupPaletteEditor({ palettes, getCustom, getSelected, apply }) {
  const dialog = $('palette-dialog'), stops = $('palette-stops'), name = $('custom-palette-name');
  let colors = [];
  for (const [i, palette] of palettes.entries()) {
    const option = document.createElement('option'); option.value = String(i); option.textContent = palette.name;
    $('palette-start').append(option);
  }
  function preview() {
    const valid = colors.every(color => /^#[0-9a-f]{6}$/i.test(color));
    $('use-custom-palette').disabled = !valid;
    $('palette-editor-error').hidden = valid;
    if (valid) $('custom-palette-preview').style.background = gradient(customPaletteDefinition({ name: name.value, colors, loop: $('palette-loop').checked }));
    $('add-palette-color').disabled = colors.length >= MAX_PALETTE_COLORS;
    $('palette-color-count').textContent = `${colors.length} / ${MAX_PALETTE_COLORS} colors`;
  }
  function render() {
    stops.replaceChildren();
    colors.forEach((color, index) => {
      const row = document.createElement('div'); row.className = 'palette-stop';
      const label = document.createElement('span'); label.className = 'palette-stop-number'; label.textContent = String(index + 1).padStart(2, '0'); label.setAttribute('aria-hidden', 'true');
      const picker = document.createElement('input'); picker.type = 'color'; picker.value = /^#[0-9a-f]{6}$/i.test(color) ? color : '#000000'; picker.setAttribute('aria-label', `Color ${index + 1}`);
      const hex = document.createElement('input'); hex.type = 'text'; hex.value = color; hex.maxLength = 7; hex.spellcheck = false; hex.setAttribute('aria-label', `Color ${index + 1} hex`);
      hex.setAttribute('aria-invalid', String(!/^#[0-9a-f]{6}$/i.test(color)));
      picker.oninput = () => { colors[index] = hex.value = picker.value; hex.setAttribute('aria-invalid', 'false'); preview(); };
      hex.oninput = () => {
        colors[index] = hex.value.trim();
        const valid = /^#[0-9a-f]{6}$/i.test(colors[index]); hex.setAttribute('aria-invalid', String(!valid));
        if (valid) picker.value = colors[index];
        preview();
      };
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'palette-stop-remove'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove color ${index + 1}`); remove.disabled = colors.length <= 2;
      remove.onclick = () => { colors.splice(index, 1); render(); stops.querySelectorAll('input[type=color]')[Math.min(index, colors.length - 1)].focus(); };
      row.append(label, picker, hex, remove); stops.append(row);
    });
    preview();
  }
  $('edit-palette').onclick = () => {
    const custom = getCustom(), selected = getSelected();
    const seed = custom ?? { name: 'My palette', colors: palettes[selected]?.colors ?? palettes[0].colors, loop: true };
    colors = [...seed.colors];
    if (!custom && colors.at(-1) === colors[0]) colors.pop();
    name.value = seed.name; $('palette-loop').checked = seed.loop;
    $('palette-start').value = '';
    render(); dialog.showModal();
  };
  $('palette-start').onchange = () => {
    if ($('palette-start').value === '') return;
    colors = [...palettes[Number($('palette-start').value)].colors];
    if (colors.at(-1) === colors[0]) colors.pop();
    render();
  };
  $('add-palette-color').onclick = () => {
    if (colors.length >= MAX_PALETTE_COLORS) return;
    colors.push(colors.at(-1)); render(); stops.querySelectorAll('input[type=color]')[colors.length - 1].focus();
  };
  $('reverse-palette').onclick = () => { colors.reverse(); render(); };
  $('palette-loop').onchange = preview;
  $('cancel-palette').onclick = () => dialog.close();
  $('palette-editor-form').onsubmit = event => {
    event.preventDefault();
    try { apply(validateCustomPalette({ name: name.value, colors, loop: $('palette-loop').checked })); dialog.close(); }
    catch (error) { $('palette-editor-error').textContent = error.message; $('palette-editor-error').hidden = false; }
  };
}
