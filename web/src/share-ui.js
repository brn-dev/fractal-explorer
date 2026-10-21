import { createShareURL, shareBaseURL } from './share.mjs';

const $ = id => document.getElementById(id);
export function setupShareLinks({ getState, paletteCount }) {
  const dialog = $('share-dialog'), link = $('share-link'), copy = $('copy-share-link'), native = $('native-share-link'), status = $('share-status');
  let generation = 0;
  dialog.addEventListener('close', () => generation++);
  native.hidden = typeof navigator.share !== 'function';
  $('share-location').onclick = async () => {
    const snapshot = getState();
    const token = ++generation;
    dialog.showModal(); link.value = ''; copy.disabled = native.disabled = true; status.textContent = 'Creating link…';
    try {
      const url = await createShareURL(shareBaseURL(location.href, import.meta.env.VITE_SHARE_BASE_URL), snapshot, paletteCount);
      if (token !== generation || !dialog.open) return;
      link.value = url;
      copy.disabled = native.disabled = false;
      status.textContent = `Ready · ${link.value.length.toLocaleString()} characters. Your friend renders the animation on their device.`;
    } catch (error) { if (token === generation) status.textContent = error.message; }
  };
  link.onclick = () => link.select();
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(link.value); status.textContent = 'Link copied. Send it to a friend.'; }
    catch { link.focus(); link.select(); status.textContent = 'Select and copy the link above.'; }
  };
  native.onclick = async () => {
    try { await navigator.share({ title: 'Fractal Explorer', text: 'Explore this fractal and its animation.', url: link.value }); status.textContent = 'Link shared.'; }
    catch (error) { if (error.name !== 'AbortError') status.textContent = 'Sharing is unavailable here. Use Copy link instead.'; }
  };
}
