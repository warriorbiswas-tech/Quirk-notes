(function (Q) {
  'use strict';
  const DB_NAME = 'quire-notes';
  const DB_VER = 1;
  const STORES = ['kv', 'notebooks', 'pages', 'assets', 'thumbs'];

  const S = (Q.store = { available: true, persisted: false });
  let dbp = null;
  let mem = null;

  function openDB() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      let req;
      try {
        if (!window.indexedDB) throw new Error('IndexedDB unavailable');
        req = indexedDB.open(DB_NAME, DB_VER);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbp = null;
        };
        db.onclose = () => {
          dbp = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error || new Error('Could not open storage'));
      req.onblocked = () => {};
    });
    dbp.catch(() => {
      dbp = null;
    });
    return dbp;
  }

  function memStore(name) {
    if (!mem) mem = {};
    return mem[name] || (mem[name] = new Map());
  }

  // Run fn(storesByName) inside one transaction; resolves with fn's return value once committed.
  async function tx(names, mode, fn, retry = true) {
    if (!S.available) {
      const fake = {};
      for (const n of names) {
        const m = memStore(n);
        fake[n] = {
          get: (k) => m.get(k),
          put: (v, k) => m.set(k, v),
          delete: (k) => m.delete(k),
          getAll: () => Array.from(m.values()),
          getAllKeys: () => Array.from(m.keys()),
        };
      }
      return fn(fake, true);
    }
    const db = await openDB();
    try {
      return await new Promise((resolve, reject) => {
        let result;
        const t = db.transaction(names, mode);
        const stores = {};
        for (const n of names) stores[n] = t.objectStore(n);
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('Storage transaction aborted'));
        try {
          result = fn(stores, false);
        } catch (e) {
          try {
            t.abort();
          } catch (_) {}
          reject(e);
        }
      });
    } catch (e) {
      // Safari sometimes drops the connection after the app was in the background.
      if (retry && e && (e.name === 'InvalidStateError' || e.name === 'UnknownError' || /connection|closing/i.test(e.message || ''))) {
        dbp = null;
        return tx(names, mode, fn, false);
      }
      throw e;
    }
  }

  const req = (r, isMem) =>
    isMem
      ? Promise.resolve(r)
      : new Promise((res, rej) => {
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });

  S.init = async function () {
    try {
      await openDB();
      // probe a write so private modes that throw on write are detected early
      await tx(['kv'], 'readwrite', (s) => {
        s.kv.put(Date.now(), '__probe');
      });
      S.available = true;
    } catch (e) {
      console.warn('[Quire] storage unavailable, using memory only', e);
      S.available = false;
    }
    try {
      if (navigator.storage && navigator.storage.persisted) S.persisted = await navigator.storage.persisted();
    } catch (e) {}
    return S.available;
  };

  S.requestPersist = async function () {
    try {
      if (navigator.storage && navigator.storage.persist) S.persisted = await navigator.storage.persist();
    } catch (e) {}
    return S.persisted;
  };

  S.estimate = async function () {
    try {
      if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
    } catch (e) {}
    return null;
  };

  S.put = (store, key, val) => tx([store], 'readwrite', (s) => void s[store].put(val, key));

  async function getOne(store, key) {
    let p;
    await tx([store], 'readonly', (s, m) => {
      p = req(s[store].get(key), m);
    });
    return p;
  }
  S.get = getOne;

  S.getMany = async function (store, keys) {
    const ps = [];
    await tx([store], 'readonly', (s, m) => {
      for (const k of keys) ps.push(req(s[store].get(k), m));
    });
    return Promise.all(ps);
  };

  S.getAll = async function (store) {
    let p;
    await tx([store], 'readonly', (s, m) => {
      p = Promise.all([req(s[store].getAll(), m), req(s[store].getAllKeys(), m)]);
    });
    const [vals, keys] = await p;
    return keys.map((k, i) => ({ key: k, value: vals[i] }));
  };

  // ops: [{ store, key, val }]; leaving out val deletes the key
  S.batch = function (ops) {
    if (!ops.length) return Promise.resolve();
    const names = Array.from(new Set(ops.map((o) => o.store)));
    return tx(names, 'readwrite', (s) => {
      for (const o of ops) {
        if (o.val === undefined) s[o.store].delete(o.key);
        else s[o.store].put(o.val, o.key);
      }
    });
  };

  S.loadLibrary = async function () {
    const lib = await getOne('kv', 'library');
    if (lib && Array.isArray(lib.notebooks)) {
      lib.folders = lib.folders || [];
      return lib;
    }
    return null;
  };
  S.saveLibrary = (lib) => S.put('kv', 'library', lib);
  S.loadSettings = async () => (await getOne('kv', 'settings')) || null;
  S.saveSettings = (s) => S.put('kv', 'settings', s);

  S.loadNotebook = async function (id) {
    const rec = await getOne('notebooks', id);
    if (!rec) return null;
    const pages = await S.getMany('pages', rec.pageIds);
    return { rec, pages: pages.filter(Boolean) };
  };

  S.putAsset = (key, rec) => S.put('assets', key, rec);
  S.getAsset = (key) => getOne('assets', key);
  S.putThumb = (id, blob) => S.put('thumbs', id, blob);
  S.getThumb = (id) => getOne('thumbs', id);

  // Remove assets no page references any more (mark & sweep).
  S.gcAssets = async function () {
    const pages = await S.getAll('pages');
    const used = new Set();
    for (const { value: p } of pages) {
      if (!p) continue;
      if (p.bg && p.bg.a) used.add(p.bg.a);
      for (const el of p.els || []) if (el.t === 'i' && el.a) used.add(el.a);
    }
    let keys;
    await tx(['assets'], 'readonly', (s, m) => {
      keys = req(s.assets.getAllKeys(), m);
    });
    keys = await keys;
    const dead = keys.filter((k) => !used.has(k));
    if (dead.length) await S.batch(dead.map((k) => ({ store: 'assets', key: k })));
    return dead.length;
  };
})((window.Q = window.Q || {}));
