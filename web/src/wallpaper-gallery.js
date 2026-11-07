import { nativeBridge, nativeCall } from './native-bridge.mjs';
import { wallpaperScreenName } from './wallpaper.mjs';

const $ = id => document.getElementById(id);

export function setupWallpaperGallery({ canOpen, newWallpaper, editWallpaper, beforeOpen, getScreen }) {
  const dialog = $('wallpaper-gallery-dialog'), status = $('wallpaper-gallery-status');
  if (!nativeBridge()) return;
  const screenSelect = $('wallpaper-gallery-screen'); screenSelect.value = 'inner';
  const shuffleSupported = typeof nativeBridge().setWallpaperShuffle === 'function';
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
    const { wallpapers, shuffle = {} } = nativeCall('listWallpapers');
    pools = Object.fromEntries(['cover', 'inner'].map(screen => [screen, {
      enabled: !!shuffle[screen]?.enabled,
      ids: (shuffle[screen]?.ids ?? []).filter(id => wallpapers.some(entry => entry.id === id && (!entry.screen || entry.screen === screen))),
    }]));
    const screen = screenSelect.value, screenLabel = wallpaperScreenName(screen);
    const pool = pools[screen];
    shuffleToggle.checked = pool.enabled; shuffleToggle.disabled = !pool.ids.length && !pool.enabled;
    $('wallpaper-gallery-shuffle-note').textContent = `${pool.ids.length} selected for ${screenLabel.toLowerCase()}. When enabled, each arrival picks a design at random, avoiding the current design when possible. The transition plays into that design’s own loop. Current screen playback settings apply to all picks. Changes take effect on the next arrival.`;
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
      detail.textContent = `${active ? 'Selected · ' : ''}${screenLabel} · ${(entry.bytes / 1024 ** 2).toFixed(1)} MB${entry.editable ? '' : ' · imported videos only'}`;
      const actions = document.createElement('div'); actions.className = 'wallpaper-state-actions';
      const apply = button(pool.enabled ? 'Use only this' : active ? 'Selected' : `Use on ${screen === 'cover' ? 'cover' : 'main'}`, () => {
        nativeCall('applyWallpaperScreen', entry.id, screen); refresh();
        status.textContent = `${entry.name} selected for ${screenLabel.toLowerCase()}. The other screen is unchanged. Use Set up if Samsung still shows a different wallpaper.`;
      }); apply.disabled = active && !pool.enabled;
      const edit = button('Edit design', () => editWallpaper(nativeCall('wallpaperDraft', entry.id).draft, screen)); edit.disabled = !entry.editable;
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
      const question = document.createElement('p'); question.textContent = `Delete ${entry.name} and its rendered animations from this phone?`;
      confirm.append(question, button('Delete permanently', () => {
        nativeCall('deleteWallpaper', entry.id); refresh(); status.textContent = 'Wallpaper deleted.';
      }), button('Keep wallpaper', () => { confirm.hidden = true; }));
      const inShuffle = Object.values(pools).some(pool => pool.enabled && pool.ids.includes(entry.id));
      const remove = button('Delete', () => { confirm.hidden = false; }); remove.disabled = entry.active || inShuffle;
      remove.title = entry.active ? 'Select another wallpaper on every screen using this design before deleting it.' : inShuffle ? 'Remove this design from shuffle before deleting it.' : '';
      actions.append(apply, edit, rename, remove); content.append(heading, detail, actions, renameForm, confirm); card.append(image, content); container.append(card);
      if (shuffleSupported) {
        const label = document.createElement('label'); label.className = 'field-label';
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = pool.ids.includes(entry.id);
        checkbox.onchange = () => {
          const ids = checkbox.checked ? [...new Set([...pool.ids, entry.id])] : pool.ids.filter(id => id !== entry.id);
          saveShuffle(screen, ids, pool.enabled && ids.length > 0);
        };
        const text = document.createElement('span'); text.textContent = 'Include in shuffle'; label.append(checkbox, text); content.append(label);
      }
    }
  }
  function saveShuffle(screen, ids, enabled) {
    try {
      nativeCall('setWallpaperShuffle', screen, JSON.stringify(ids), enabled); refresh();
      status.textContent = enabled ? 'Shuffle enabled for the next arrival.' : 'Shuffle is off. The current design stays selected.';
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
