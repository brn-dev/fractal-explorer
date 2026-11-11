import { nativeBridge, nativeCall } from './native-bridge.mjs';
import { wallpaperScreenName } from './wallpaper.mjs';

const $ = id => document.getElementById(id);

export function setupWallpaperGallery({ canOpen, newWallpaper, editWallpaper, beforeOpen, getScreen }) {
  const dialog = $('wallpaper-gallery-dialog'), status = $('wallpaper-gallery-status');
  if (!nativeBridge()) return;
  const previewSupported = typeof nativeBridge().previewWallpaper === 'function';
  const previewNote = $('wallpaper-gallery-preview-note');
  if (previewNote) previewNote.textContent = previewSupported ? 'Preview plays the saved entry transition, then the steady loop or still image. Tap anywhere to return. Your wallpaper selection stays unchanged.'
    : 'Install Android app 0.17.0 or newer to enable full-screen wallpaper previews.';
  const screenSelect = $('wallpaper-gallery-screen'); screenSelect.value = 'inner';
  const shuffleSupported = typeof nativeBridge().setWallpaperShuffle === 'function';
  const rulesSupported = typeof nativeBridge().setWallpaperShuffleRule === 'function';
  const shuffleToggle = $('wallpaper-gallery-shuffle');
  $('wallpaper-gallery-shuffle-options').hidden = !shuffleSupported;
  let pools = {};
  const report = action => {
    try { action(); } catch (error) { status.textContent = error.message; }
  };
  const button = (label, action) => {
    const node = document.createElement('button'); node.type = 'button';
    node.className = 'secondary-button'; node.textContent = label;
    node.onclick = () => report(action); return node;
  };
  function refresh() {
    const { wallpapers, shuffle = {}, sun } = nativeCall('listWallpapers');
    pools = Object.fromEntries(['cover', 'inner'].map(screen => [screen, {
      enabled: !!shuffle[screen]?.enabled,
      ids: (shuffle[screen]?.ids ?? []).filter(id => wallpapers.some(entry => entry.id === id && (!entry.screen || entry.screen === screen))),
      rules: shuffle[screen]?.rules ?? {},
    }]));
    const screen = screenSelect.value, screenLabel = wallpaperScreenName(screen);
    const pool = pools[screen];
    shuffleToggle.checked = pool.enabled; shuffleToggle.disabled = !pool.ids.length && !pool.enabled;
    $('wallpaper-gallery-shuffle-note').textContent = `${pool.ids.length} selected for ${screenLabel.toLowerCase()}. Equal weights avoid the current design when possible; unequal weights use relative odds and may repeat. Static images stay still; animated entries follow this screen's playback settings.`;
    const sunNote = $('wallpaper-gallery-sun-note');
    if (sunNote) {
      sunNote.hidden = !rulesSupported;
      const validSun = sun && Number.isFinite(sun.sunrise) && Number.isFinite(sun.sunset);
      const time = millis => new Intl.DateTimeFormat(undefined, { hour:'2-digit', minute:'2-digit', hourCycle:'h23', timeZone:'Europe/Vienna' }).format(new Date(millis));
      const eligible = pool.ids.filter(id => !pool.rules[id]?.period || pool.rules[id].period === 'any' || pool.rules[id].period === (sun?.daytime ? 'day' : 'night')).length;
      sunNote.textContent = validSun ? `Vienna area · ${sun.date}: sunrise ${time(sun.sunrise)}, sunset ${time(sun.sunset)} (Vienna local time). ${eligible} eligible now (${sun.daytime ? 'daytime' : 'nighttime'}). Times follow the seasons and daylight saving time, calculated offline. If none qualify, the wallpaper shows plain black until one becomes eligible.`
        : 'Time filters use estimated sunrise and sunset near Vienna, calculated offline for each date. With no eligible wallpaper, the screen stays plain black.';
    }
    const container = $('wallpaper-gallery-cards'); container.replaceChildren();
    const visible = wallpapers.filter(entry => !entry.screen || entry.screen === screen);
    if (!visible.length) status.textContent = `No ${screenLabel.toLowerCase()} designs yet. Create a wallpaper to save your first design.`;
    for (const entry of visible) {
      const active = (screen === 'cover' ? entry.activeCover : entry.activeInner) ?? entry.active;
      const card = document.createElement('section'); card.className = 'wallpaper-gallery-card';
      const image = document.createElement('img'); image.alt = `${entry.name} preview`; image.width = 240; image.height = 240;
      try { image.src = nativeCall('wallpaperThumbnailForScreen', entry.id, screen).image; } catch { image.hidden = true; }
      const content = document.createElement('div'), heading = document.createElement('h3'); heading.textContent = entry.name;
      const detail = document.createElement('p'); detail.className = 'export-note';
      detail.textContent = `${active ? 'Selected · ' : ''}${screenLabel} · ${entry.kind === 'static' ? 'Static image' : entry.kind === 'loop' ? 'Steady loop · no entry transition' : 'Animated'} · ${(entry.bytes / 1024 ** 2).toFixed(1)} MB${entry.editable ? '' : entry.kind === 'static' ? ' · imported image' : ' · imported videos only'}`;
      const actions = document.createElement('div'); actions.className = 'wallpaper-state-actions';
      const apply = button(pool.enabled ? 'Use only this' : active ? 'Selected' : `Use on ${screen === 'cover' ? 'cover' : 'main'}`, () => {
        nativeCall('applyWallpaperScreen', entry.id, screen); refresh();
        status.textContent = `${entry.name} selected for ${screenLabel.toLowerCase()}. The other screen is unchanged. Use Set up if Samsung still shows a different wallpaper.`;
      }); apply.disabled = active && !pool.enabled;
      const edit = button('Edit design', () => editWallpaper(nativeCall('wallpaperDraft', entry.id).draft, screen)); edit.disabled = !entry.editable;
      const duplicate = button('Duplicate & edit', () => {
        const next = structuredClone(nativeCall('wallpaperDraft', entry.id).draft);
        const names = new Set(wallpapers.filter(item => !item.screen || item.screen === screen).map(item => item.name));
        const base = entry.name || next.name || 'My fractal wallpaper';
        for (let number = 1; ; number++) {
          const suffix = number === 1 ? ' (copy)' : ` (copy ${number})`;
          next.name = base.slice(0, 80 - suffix.length).trimEnd() + suffix;
          if (!names.has(next.name)) break;
        }
        editWallpaper(next, screen, { copyOf: entry.name });
      });
      duplicate.disabled = !entry.editable;
      duplicate.title = entry.editable ? 'Open an editable copy. Create the wallpaper to save it as a new gallery entry.' : 'This imported wallpaper has no editable fractal design.';
      const renameForm = document.createElement('form'); renameForm.className = 'wallpaper-gallery-rename'; renameForm.hidden = true;
      const label = document.createElement('label'); label.className = 'field-label'; label.textContent = 'Wallpaper name';
      const name = document.createElement('input'); name.value = entry.name; name.maxLength = 80; name.required = true; label.append(name);
      const save = button('Save name', () => {
        nativeCall('renameWallpaper', entry.id, name.value); refresh(); status.textContent = 'Wallpaper renamed.';
      });
      renameForm.onsubmit = event => { event.preventDefault(); save.click(); };
      renameForm.append(label, save, button('Cancel', () => { renameForm.hidden = true; }));
      const rename = button('Rename', () => { renameForm.hidden = false; name.focus(); });
      const confirm = document.createElement('div'); confirm.hidden = true;
      const question = document.createElement('p'); question.textContent = `Delete ${entry.name} and its rendered wallpaper from this phone?`;
      confirm.append(question, button('Delete permanently', () => {
        nativeCall('deleteWallpaper', entry.id); refresh(); status.textContent = 'Wallpaper deleted.';
      }), button('Keep wallpaper', () => { confirm.hidden = true; }));
      const inShuffle = Object.values(pools).some(pool => pool.enabled && pool.ids.includes(entry.id));
      const remove = button('Delete', () => { confirm.hidden = false; }); remove.disabled = entry.active || inShuffle;
      remove.title = entry.active ? 'Select another wallpaper on every screen using this design before deleting it.' : inShuffle ? 'Remove this design from shuffle before deleting it.' : '';
      const preview = button('Preview', () => nativeCall('previewWallpaper', entry.id, screen));
      preview.disabled = !previewSupported;
      preview.title = preview.disabled ? 'Install Android app 0.17.0 or newer for full-screen previews.' : 'Play this saved wallpaper full screen. Tap anywhere to return.';
      actions.append(preview, apply, edit, duplicate, rename, remove); content.append(heading, detail, actions, renameForm, confirm); card.append(image, content); container.append(card);
      if (shuffleSupported) {
        const label = document.createElement('label'); label.className = 'field-label';
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = pool.ids.includes(entry.id);
        checkbox.onchange = () => {
          const ids = checkbox.checked ? [...new Set([...pool.ids, entry.id])] : pool.ids.filter(id => id !== entry.id);
          saveShuffle(screen, ids, pool.enabled && ids.length > 0);
        };
        const text = document.createElement('span'); text.textContent = 'Include in shuffle'; label.append(checkbox, text); content.append(label);
        if (rulesSupported && pool.ids.includes(entry.id)) {
          const settings = pool.rules[entry.id] ?? { weight:1, period:'any' };
          const form = document.createElement('form'); form.className = 'wallpaper-shuffle-rule';
          const fields = document.createElement('div'); fields.className = 'two-fields';
          const weightLabel = document.createElement('label'); weightLabel.className = 'field-label'; weightLabel.textContent = 'Shuffle weight · default 1';
          const weight = document.createElement('input'); weight.type = 'number'; weight.min = '.1'; weight.max = '100'; weight.step = '.1'; weight.required = true; weight.value = settings.weight; weightLabel.append(weight);
          const periodLabel = document.createElement('label'); periodLabel.className = 'field-label'; periodLabel.textContent = 'Time filter';
          const period = document.createElement('select');
          for (const [value, text] of [['any','Any time'],['day','Daytime'],['night','Nighttime']]) {
            const option = document.createElement('option'); option.value = value; option.textContent = text; period.append(option);
          }
          period.value = settings.period; periodLabel.append(period); fields.append(weightLabel, periodLabel);
          const save = button('Save shuffle settings', () => {
            const value = Number(weight.value);
            if (!Number.isFinite(value) || value < .1 || value > 100) { status.textContent = 'Choose a weight between 0.1 and 100.'; weight.focus(); return; }
            try {
              nativeCall('setWallpaperShuffleRule', screen, entry.id, JSON.stringify({ weight:value, period:period.value }));
              refresh(); status.textContent = 'Shuffle weight and time filter saved for this screen.';
            } catch (error) { try { refresh(); } catch {} status.textContent = error.message; }
          });
          form.onsubmit = event => { event.preventDefault(); save.click(); };
          const help = document.createElement('p'); help.className = 'export-note'; help.textContent = 'Weight 2 has twice the chance of weight 1 when both qualify. Daytime is sunrise to sunset; nighttime is sunset to sunrise.';
          form.append(fields, help, save); content.append(form);
        }
      }
    }
  }
  function saveShuffle(screen, ids, enabled) {
    try {
      nativeCall('setWallpaperShuffle', screen, JSON.stringify(ids), enabled); refresh();
      status.textContent = enabled ? 'Shuffle enabled for the next reveal.' : 'Shuffle is off. The current design stays selected.';
    } catch (error) {
      try { refresh(); } catch { /* Preserve the original failure. */ }
      status.textContent = error.message;
    }
  }
  shuffleToggle.onchange = () => { const screen = screenSelect.value; saveShuffle(screen, pools[screen].ids, shuffleToggle.checked); };
  function open() {
    window.fractalGalleryRequested = false;
    if (!canOpen()) return;
    report(() => {
      if (getScreen) screenSelect.value = getScreen();
      beforeOpen(); status.textContent = '';
      $('export-dialog').close(); if (!dialog.open) dialog.showModal();
      refresh();
    });
  }
  for (const id of ['open-wallpaper-gallery', 'wallpaper-gallery']) { $(id).hidden = false; $(id).onclick = open; }
  screenSelect.onchange = () => report(() => { status.textContent = ''; refresh(); });
  $('wallpaper-gallery-new').onclick = () => report(() => newWallpaper(screenSelect.value));
  $('wallpaper-gallery-set').onclick = () => report(() => nativeCall('openWallpaperPicker'));
  window.addEventListener('open-wallpaper-gallery', open);
  if (window.fractalGalleryRequested) open();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && dialog.open) report(refresh); });
}
