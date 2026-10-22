import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpdateMonitor, UPDATE_CHECK_INTERVAL, UPDATE_CHECK_COOLDOWN } from '../src/updates.mjs';

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const emit = (target, event) => target.dispatchEvent(new Event(event));
function worker(state = 'installed') {
  const target = new EventTarget();
  return Object.assign(target, { state, messages: [], postMessage(message) { this.messages.push(message); } });
}
function setup({ firstInstall = false, pending = null, save } = {}) {
  const old = firstInstall ? null : worker('activated');
  const registration = Object.assign(new EventTarget(), { active: old, waiting: pending, installing: null, updates: 0,
    async update() { this.updates++; } });
  const serviceWorker = Object.assign(new EventTarget(), { controller: old });
  const visibility = Object.assign(new EventTarget(), { hidden: false }), events = new EventTarget();
  const states = [], calls = [], timers = new Map(), intervals = new Map();
  let time = 0, online = true, nextId = 0;
  const monitor = createUpdateMonitor({ registration, serviceWorker, visibility, events,
    isOnline: () => online, now: () => time, onChange: state => states.push(state),
    saveSession: save ?? (() => { calls.push('save'); }), reload: () => calls.push('reload'),
    setTimer: (callback, delay) => { const id = ++nextId; timers.set(id, { callback, delay }); return id; },
    clearTimer: id => timers.delete(id),
    repeat: (callback, delay) => { const id = ++nextId; intervals.set(id, { callback, delay }); return id; },
    clearRepeat: id => intervals.delete(id),
  });
  return { registration, serviceWorker, visibility, events, monitor, calls, timers, intervals, states,
    get state() { return states.at(-1); },
    advance(ms) { time += ms; }, offline(value = true) { online = !value; },
    install(next = worker()) {
      registration.installing = next; emit(registration, 'updatefound');
      return next;
    },
    ready(next) { registration.installing = null; registration.waiting = next; next.state = 'installed'; emit(next, 'statechange'); },
    activate(next) {
      next.state = 'activated'; registration.active = next; registration.waiting = null;
      serviceWorker.controller = next; emit(serviceWorker, 'controllerchange');
    },
  };
}

test('an already downloaded newer worker shows a notice immediately without reloading', () => {
  const s = setup({ pending: worker() });
  assert.equal(s.state.available, true); assert.equal(s.state.notice, true);
  assert.equal(s.state.reloadOnly, false); assert.deepEqual(s.calls, []);
  assert.equal([...s.intervals.values()][0].delay, UPDATE_CHECK_INTERVAL);
});

test('a first installation is cached and claimed quietly', () => {
  const s = setup({ firstInstall: true }), next = s.install(worker('installing'));
  assert.equal(s.state.installing, true); assert.equal(s.state.notice, false);
  s.ready(next); assert.equal(s.state.notice, false);
  s.activate(next); assert.equal(s.state.notice, false); assert.deepEqual(s.calls, []);
});

test('notice appears only once a new worker has finished caching', () => {
  const s = setup(), next = s.install(worker('installing'));
  assert.equal(s.state.available, false); assert.equal(s.state.installing, true);
  s.ready(next); assert.equal(s.state.notice, true); assert.equal(s.state.installing, false);
  assert.deepEqual(next.messages, []); assert.deepEqual(s.calls, []);
});

test('Later stays dismissed for the same update but a manual check or newer worker can notify', async () => {
  const s = setup({ pending: worker() });
  s.monitor.dismiss(); assert.equal(s.state.notice, false); assert.equal(s.state.available, true);
  s.advance(UPDATE_CHECK_COOLDOWN); emit(s.events, 'focus'); await flush();
  assert.equal(s.state.notice, false);
  await s.monitor.check({ force: true, announce: true }); assert.equal(s.state.notice, true);
  s.monitor.dismiss(); s.ready(s.install(worker('installing'))); assert.equal(s.state.notice, true);
});

test('Update saves before activation, then reloads exactly once on controller change', async () => {
  const next = worker(), s = setup({ pending: next });
  next.postMessage = message => { assert.deepEqual(s.calls, ['save']); next.messages.push(message); };
  assert.equal(await s.monitor.apply(), true);
  assert.deepEqual(next.messages, ['activate']); assert.deepEqual(s.calls, ['save']);
  assert.equal(s.state.applying, true);
  assert.equal(await s.monitor.apply(), false);
  s.activate(next); emit(s.serviceWorker, 'controllerchange');
  assert.deepEqual(s.calls, ['save', 'reload']); assert.equal(s.timers.size, 0);
});

test('a controller change during an asynchronous save waits for the save', async () => {
  let finishSave;
  const next = worker(), order = [], s = setup({ pending: next, save: () => new Promise(resolve => { order.push('saving'); finishSave = () => { order.push('saved'); resolve(); }; }) });
  const applying = s.monitor.apply(); s.activate(next);
  assert.deepEqual(s.calls, []); assert.deepEqual(order, ['saving']);
  finishSave(); await applying;
  assert.deepEqual(order, ['saving', 'saved']); assert.deepEqual(s.calls, ['reload']);
});

test('updates activated in another tab offer Reload instead of interrupting this tab', async () => {
  const s = setup(), next = worker('activated');
  s.activate(next);
  assert.equal(s.state.notice, true); assert.equal(s.state.reloadOnly, true);
  assert.deepEqual(s.calls, []);
  await s.monitor.apply(); assert.deepEqual(s.calls, ['save', 'reload']);
});

test('focus and visibility checks are throttled, and background/offline tabs do not poll', async () => {
  const s = setup(), tick = [...s.intervals.values()][0].callback;
  emit(s.events, 'focus'); await flush(); assert.equal(s.registration.updates, 0);
  s.advance(UPDATE_CHECK_COOLDOWN); emit(s.visibility, 'visibilitychange'); emit(s.events, 'focus'); await flush();
  assert.equal(s.registration.updates, 1);
  s.advance(UPDATE_CHECK_INTERVAL); s.visibility.hidden = true; tick(); await flush(); assert.equal(s.registration.updates, 1);
  s.visibility.hidden = false; s.offline(); tick(); await flush(); assert.equal(s.registration.updates, 1);
  s.offline(false); emit(s.events, 'online'); await flush(); assert.equal(s.registration.updates, 2);
  assert.equal(s.state.checked, true);
});

test('reconnecting checks immediately and concurrent update checks are coalesced', async () => {
  const s = setup(); let resolve;
  s.registration.update = () => { s.registration.updates++; return new Promise(done => { resolve = done; }); };
  emit(s.events, 'online'); emit(s.events, 'online');
  assert.equal(s.registration.updates, 1); assert.equal(s.state.checking, true);
  resolve(); await flush(); assert.equal(s.state.checking, false);
});

test('failed checks keep the app usable and do not activate anything', async () => {
  const s = setup(); s.registration.update = async () => { throw new Error('Offline'); };
  assert.equal(await s.monitor.check({ force: true }), false);
  assert.match(s.state.error, /Could not check/); assert.equal(s.state.notice, false);
  assert.deepEqual(s.calls, []);
});

test('failed installation does not offer a partial cache as an update', () => {
  const s = setup(), next = s.install(worker('installing'));
  s.registration.installing = null; next.state = 'redundant'; emit(next, 'statechange');
  assert.equal(s.state.available, false); assert.match(s.state.error, /could not be downloaded/);
});

test('a failed first cache installation does not claim offline readiness', () => {
  const s = setup({ firstInstall: true }), next = s.install(worker('installing'));
  s.registration.installing = null; next.state = 'redundant'; emit(next, 'statechange');
  assert.equal(s.state.available, false); assert.match(s.state.error, /Offline caching could not finish/);
});

test('save or activation failures restore the update controls for retry', async () => {
  let fail = true;
  const next = worker(), s = setup({ pending: next, save: () => { if (fail) throw new Error('Storage error'); } });
  assert.equal(await s.monitor.apply(), false); assert.equal(s.state.applying, false);
  assert.deepEqual(next.messages, []); assert.match(s.state.error, /Could not start/);
  fail = false; await s.monitor.apply();
  assert.equal(s.state.applying, true);
  const timeout = [...s.timers.values()][0]; assert.equal(timeout.delay, 15000); timeout.callback();
  assert.equal(s.state.applying, false); assert.match(s.state.error, /did not finish/);
  await s.monitor.apply(); s.activate(next); assert.deepEqual(s.calls, ['reload']);
});

test('destroy removes event handlers and scheduled checks', async () => {
  const s = setup({ pending: worker() }), states = s.states.length;
  s.monitor.destroy(); s.advance(UPDATE_CHECK_INTERVAL);
  emit(s.events, 'online'); emit(s.events, 'focus'); emit(s.visibility, 'visibilitychange');
  await flush();
  assert.equal(s.intervals.size, 0); assert.equal(s.registration.updates, 0); assert.equal(s.states.length, states);
  assert.equal(await s.monitor.apply(), false);
});
