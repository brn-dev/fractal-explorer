const check = signal => { if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError'); };
export const exportCacheBudget = mobile => (mobile ? 64 : 256) * 1024 ** 2;
const cachePrefix = 'fractal-export-cache-';

function removeDatabase(indexedDB, name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('The temporary export cache is still in use.'));
  });
}

async function removeAbandonedCaches(indexedDB) {
  const locks = globalThis.navigator?.locks;
  if (!locks || !indexedDB.databases) return;
  const databases = await indexedDB.databases();
  await Promise.all(databases.filter(db => db.name?.startsWith(cachePrefix)).map(db =>
    locks.request(db.name, { ifAvailable: true }, lock => lock ? removeDatabase(indexedDB, db.name) : undefined).catch(() => {})
  ));
}

async function holdCacheLock(name) {
  const locks = globalThis.navigator?.locks;
  if (!locks) return () => {};
  let acquired, release;
  const ready = new Promise(resolve => { acquired = resolve; });
  const held = locks.request(name, () => new Promise(resolve => { release = resolve; acquired(); }));
  await Promise.race([ready, held]);
  return async () => { release(); await held; };
}

// A fresh database belongs to one export only. Closing or cancelling that job
// removes it; cached fractal fields never become saved locations or app data.
export async function temporaryFieldStore(signal) {
  check(signal);
  const indexedDB = globalThis.indexedDB;
  if (!indexedDB) throw new Error('Temporary browser storage is unavailable.');
  const name = `${cachePrefix}${globalThis.crypto.randomUUID()}`;
  let database, release = () => {};
  try {
    // Locks disappear with a crashed/reloaded page. Only unowned caches can be
    // removed, so another tab's running export is left alone.
    await removeAbandonedCaches(indexedDB); check(signal);
    release = await holdCacheLock(name); check(signal);
    database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('fields');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    check(signal);
  } catch (error) {
    database?.close(); await removeDatabase(indexedDB, name).catch(() => {}); await release(); throw error;
  }
  function transaction(mode, action) {
    check(signal);
    return new Promise((resolve, reject) => {
      const tx = database.transaction('fields', mode), request = action(tx.objectStore('fields'));
      let result;
      const abort = () => { try { tx.abort(); } catch {} };
      signal?.addEventListener('abort', abort, { once: true });
      const finish = () => signal?.removeEventListener('abort', abort);
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => { finish(); resolve(result); };
      tx.onabort = tx.onerror = () => { finish(); reject(tx.error ?? new DOMException('Export cancelled.', 'AbortError')); };
    });
  }
  return {
    name,
    get: key => transaction('readonly', store => store.get(key)),
    put: (key, frame) => transaction('readwrite', store => store.put(frame, key)),
    dispose: async () => { database.close(); try { await removeDatabase(indexedDB, name); } finally { await release(); } },
  };
}

export class ExportFieldCache {
  constructor({ memoryBudget = exportCacheBudget(false), createStore = temporaryFieldStore, signal } = {}) {
    Object.assign(this, { memoryBudget, createStore, signal });
    this.memory = new Map(); this.diskKeys = new Set(); this.memoryBytes = 0;
    this.readable = this.writable = true; this.limited = false;
  }
  async get(key) {
    check(this.signal);
    if (this.memory.has(key)) return this.memory.get(key);
    if (!this.readable || !this.diskKeys.has(key)) return null;
    try {
      const frame = await (await this.store).get(key); check(this.signal);
      if (frame) return frame;
      this.limited = true; return null;
    } catch (error) {
      check(this.signal); this.readable = this.writable = false; this.limited = true; return null;
    }
  }
  async put(key, frame) {
    check(this.signal);
    if (this.memory.has(key) || this.diskKeys.has(key)) return;
    if (this.memoryBytes + frame.values.buffer.byteLength <= this.memoryBudget) {
      this.memory.set(key, frame); this.memoryBytes += frame.values.buffer.byteLength; return;
    }
    if (!this.writable) return;
    try {
      this.store ??= this.createStore(this.signal);
      await (await this.store).put(key, frame); check(this.signal); this.diskKeys.add(key);
    } catch (error) {
      check(this.signal); this.writable = false; this.limited = true;
    }
  }
  async dispose() {
    this.memory.clear(); this.diskKeys.clear(); this.memoryBytes = 0;
    if (this.store) {
      // Store creation may have failed (private mode, exhausted quota, etc.).
      const store = await this.store.catch(() => null);
      await store?.dispose(); this.store = null;
    }
  }
}
