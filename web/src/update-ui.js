import { createUpdateMonitor } from './updates.mjs';

export async function setupAppUpdates({ saveSession }) {
  const $ = id => document.getElementById(id), status = $('offline-status');
  if (!('serviceWorker' in navigator)) { status.textContent = 'Offline caching is unavailable in this browser.'; return; }
  status.textContent = 'Checking offline cache…';
  const timeout = setTimeout(() => { status.textContent = 'Offline caching is unavailable in this browser. Static hosting is still required for reloads.'; }, 8000);
  try {
    const registration = await navigator.serviceWorker.register(new URL('./sw.js', document.baseURI), { updateViaCache: 'none' });
    clearTimeout(timeout);
    const monitor = createUpdateMonitor({ registration, serviceWorker: navigator.serviceWorker,
      visibility: document, events: window, isOnline: () => navigator.onLine !== false,
      saveSession, reload: () => location.reload(),
      onChange(state) {
        $('app-update').hidden = !state.notice;
        $('update-offline').hidden = !state.available;
        $('check-updates').hidden = false;
        $('check-updates').disabled = state.checking || state.applying || state.installing;
        for (const id of ['app-update-now', 'update-offline']) $(id).disabled = state.applying;
        $('app-update-later').disabled = state.applying;
        $('app-update-now').textContent = state.applying ? 'Updating…' : state.reloadOnly ? 'Reload now' : 'Update now';
        $('app-update-message').textContent = state.error || (state.applying
          ? 'Saving your current view and loading the latest version…'
          : 'Reload to get the latest features. Your saved places will stay.');
        status.textContent = state.available ? state.applying ? 'Updating the app…' : 'A newer version is ready.'
          : state.checking ? 'Checking for updates…'
          : state.installing ? state.controlled ? 'Downloading an app update…' : 'Preparing the offline cache…'
          : state.error || (state.controlled ? `${state.checked ? 'You’re up to date. ' : ''}Available offline on this device.` : 'Offline cache ready. Reload once to activate.');
      },
    });
    $('app-update-now').onclick = $('update-offline').onclick = () => { void monitor.apply(); };
    $('app-update-later').onclick = () => {
      monitor.dismiss(); $('app-update-later').blur();
    };
    $('check-updates').onclick = () => { void monitor.check({ force: true, announce: true }); };
    return monitor;
  } catch (error) {
    clearTimeout(timeout); status.textContent = 'Offline caching is unavailable in this browser.'; status.title = error.message;
  }
}
