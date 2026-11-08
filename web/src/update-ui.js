import { createUpdateMonitor } from './updates.mjs';
import { createNativeUpdateMonitor } from './native-updates.mjs';
import { nativeCall } from './native-bridge.mjs';

export async function setupAppUpdates({ saveSession, canReload }) {
  const $ = id => document.getElementById(id), status = $('offline-status');
  if (globalThis.FractalNative?.info) {
    if(typeof globalThis.FractalNative.webUpdates!=='function'){status.textContent='Available offline. Install an APK update to enable separate explorer updates.';return;}
    const monitor=createNativeUpdateMonitor({saveSession,canReload,
      call:(action,version='')=>nativeCall('webUpdates',action,version),
      identity:async()=>{const response=await fetch(new URL('./android-web-info.json',document.baseURI),{cache:'no-store'});if(!response.ok)throw new Error('Explorer identity unavailable.');return response.json();},
      onChange(state){
        $('app-update').hidden=!state.notice;$('update-offline').hidden=!state.available;$('check-updates').hidden=false;
        $('check-updates').disabled=state.checking||state.applying;
        for(const id of ['app-update-now','update-offline'])$(id).disabled=state.applying;
        $('app-update-later').disabled=state.applying;
        $('app-update-now').textContent=state.applying?'Reloading…':'Reload update';
        $('update-offline').textContent='Reload explorer update';
        $('app-update-message').textContent=state.error||'The explorer update is downloaded and ready. Reload when you finish editing or exporting. Your saved wallpapers stay.';
        status.textContent=state.checking?'Checking and downloading explorer updates…':state.applying?'Reloading the explorer…':state.available?'An explorer update is ready.':state.requiresApk>0?'The latest explorer needs an Android APK update. Your current version works offline.':state.error?`Available offline. ${state.error}`:'Explorer available offline. Web updates arrive separately from Android app updates.';
      },
    });
    $('app-update-now').onclick=$('update-offline').onclick=()=>{void monitor.apply();};
    $('app-update-later').onclick=()=>monitor.dismiss();$('check-updates').onclick=()=>monitor.check();
    await monitor.started;return monitor;
  }
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
