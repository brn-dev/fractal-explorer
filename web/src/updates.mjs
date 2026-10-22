export const UPDATE_CHECK_INTERVAL = 5 * 60 * 1000;
export const UPDATE_CHECK_COOLDOWN = 60 * 1000;

// A waiting worker has finished caching the entire new bundle. Keep it waiting
// until the user chooses to reload; detecting an update never interrupts work.
export function createUpdateMonitor({
  registration, serviceWorker, visibility, events, isOnline = () => true,
  saveSession, reload, onChange, now = Date.now,
  setTimer = setTimeout, clearTimer = clearTimeout,
  repeat = setInterval, clearRepeat = clearInterval,
}) {
  const initialActive = registration.active;
  let controller = serviceWorker.controller, dismissed = null, activated = false;
  let checking = false, applying = false, saved = false, reloaded = false, destroyed = false;
  let checked = false, checkError = '', applyError = '', lastCheck = now(), activationTimer;
  const listeners = [], watched = new WeakSet();
  const listen = (target, name, callback) => {
    target.addEventListener(name, callback);
    listeners.push(() => target.removeEventListener(name, callback));
  };
  const waiting = () => {
    const worker = registration.waiting;
    return worker && worker.state !== 'redundant' && (serviceWorker.controller || registration.active) ? worker : null;
  };
  const available = () => waiting() || (activated ? controller : null);
  function publish() {
    if (destroyed) return;
    const worker = available();
    onChange({ available: !!worker, notice: !!worker && dismissed !== worker,
      reloadOnly: !waiting() && activated, checking, applying, checked,
      installing: !!registration.installing, controlled: !!serviceWorker.controller,
      error: applyError || (!worker ? checkError : '') });
  }
  function watch(worker) {
    if (!worker || watched.has(worker)) return;
    watched.add(worker);
    listen(worker, 'statechange', () => {
      if (worker.state === 'redundant') checkError = registration.active
        ? 'The update could not be downloaded. The current version is still available.'
        : 'Offline caching could not finish. Reload to try again.';
      publish();
    });
  }
  function reloadOnce() {
    if (reloaded || destroyed) return;
    reloaded = true; clearTimer(activationTimer); reload();
  }
  listen(registration, 'updatefound', () => { checkError = ''; watch(registration.installing); publish(); });
  listen(serviceWorker, 'controllerchange', () => {
    const next = serviceWorker.controller;
    if (!next || next === controller) return;
    const hadController = !!controller || (!!initialActive && next !== initialActive); controller = next;
    // Claiming a first install does not mean the page is out of date.
    if (hadController || applying) activated = true;
    if (applying && saved) reloadOnce(); else publish();
  });

  async function check({ force = false, announce = false } = {}) {
    if (destroyed || checking || applying || visibility.hidden || !isOnline()) return false;
    if (announce) dismissed = null;
    if (registration.installing) { watch(registration.installing); publish(); return false; }
    if (!force && now() - lastCheck < UPDATE_CHECK_COOLDOWN) { publish(); return false; }
    checking = true; lastCheck = now(); checkError = ''; publish();
    try { await registration.update(); checked = true; watch(registration.installing); return true; }
    catch { checkError = 'Could not check for updates. Try again when connected.'; return false; }
    finally { checking = false; publish(); }
  }
  async function apply() {
    if (destroyed || applying || !available()) return false;
    const worker = waiting();
    applying = true; saved = false; applyError = ''; dismissed = null; publish();
    try {
      await saveSession(); saved = true;
      if (destroyed) return false;
      if (activated || serviceWorker.controller === worker || worker?.state === 'activated') reloadOnce();
      else {
        worker.postMessage('activate');
        if (!reloaded) activationTimer = setTimer(() => {
          applying = false; applyError = 'The update did not finish. Please try Update now again.'; publish();
        }, 15000);
      }
      return true;
    } catch {
      applying = false; applyError = 'Could not start the update. Please try again.'; publish(); return false;
    }
  }
  listen(visibility, 'visibilitychange', () => { if (!visibility.hidden) void check(); });
  listen(events, 'focus', () => { void check(); });
  listen(events, 'online', () => { void check({ force: true }); });
  const interval = repeat(() => { void check(); }, UPDATE_CHECK_INTERVAL);
  watch(registration.installing); publish();
  return { check, apply,
    dismiss() { if (!applying) { dismissed = available(); publish(); } },
    destroy() { destroyed = true; clearTimer(activationTimer); clearRepeat(interval); listeners.forEach(remove => remove()); },
  };
}
