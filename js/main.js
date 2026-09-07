(function (Q) {
  'use strict';
  const U = Q.util;
  const M = Q.model;
  const UI = Q.ui;

  const queue = U.serial();

  const App = {
    library: null,
    settings: null,
    editor: null,
    thumbs: new Map(),

    async start() {
      await Q.store.init();
      const saved = await Q.store.loadSettings().catch(() => null);
      this.settings = M.mergeSettings(saved);
      if (saved && 'aiKey' in saved) Q.store.saveSettings(this.settings).catch(() => {});
      this.library = await Q.store.loadLibrary().catch(() => null);
      let fresh = false;
      if (!this.library) {
        this.library = { v: 1, folders: [], notebooks: [] };
        fresh = true;
      }
      this.applyTheme();
      this.root = document.getElementById('app');
      this.libView = new Q.Library(this);
      this.root.appendChild(this.libView.el);
      if (fresh) await this.seed();
      this.libView.render();
      document.body.classList.add('ready');
      const splash = document.getElementById('splash');
      if (splash) setTimeout(() => splash.remove(), 400);
      this.bindGlobal();
      Q.store.requestPersist();
      if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
      }
      const last = this.settings.openNb && this.library.notebooks.find((n) => n.id === this.settings.openNb && !n.trashed);
      if (last) this.openNotebook(last.id);
    },

    bindGlobal() {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onTheme = () => this.applyTheme();
      if (mq.addEventListener) mq.addEventListener('change', onTheme);
      new MutationObserver(() => {
        const dark = this.isDark();
        if (String(dark ? 1 : 0) !== document.documentElement.dataset.dark) this.applyTheme();
      }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.flushAll();
      });
      window.addEventListener('pagehide', () => this.flushAll());
      if (document.fonts) {
        const refresh = U.debounce(() => {
          Q.render.resetTextCache();
          if (this.editor) this.editor.renderer.invalidateAll();
        }, 120);
        document.fonts.addEventListener && document.fonts.addEventListener('loadingdone', refresh);
        if (document.fonts.load) document.fonts.load('16px Caveat').then(refresh, () => {});
      }
      window.addEventListener('error', (e) => console.error('[Quire]', e.error || e.message));
      window.addEventListener('unhandledrejection', (e) => console.error('[Quire]', e.reason));
    },

    isDark() {
      const t = document.documentElement.dataset.theme;
      if (t === 'dark') return true;
      if (t === 'light') return false;
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    },
    applyTheme() {
      const root = document.documentElement;
      if (this.settings.theme === 'system') delete root.dataset.theme;
      else root.dataset.theme = this.settings.theme;
      const dark = this.isDark();
      root.dataset.dark = dark ? '1' : '0';
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', dark ? '#151917' : '#F3F4F1');
      if (this.editor) this.editor.applyTheme();
    },

    flushAll() {
      if (this.editor) this.editor.flush().catch(() => {});
      this.saveLibrary.flush && this.saveLibrary.flush();
      this.saveSettingsSoon.flush && this.saveSettingsSoon.flush();
    },

    saveLibrary: null,
    writeLibrary() {
      return queue(() => Q.store.saveLibrary(this.library)).catch((e) => {
        console.error(e);
        UI.toast('Couldn’t save the library.', { error: true });
      });
    },
    saveSettings() {
      this.saveSettingsSoon.cancel();
      return queue(() => Q.store.saveSettings(this.settings)).catch(() => {});
    },
    saveSettingsSoon: null,

    persistNotebook(meta, pages, dirtyPages, removedIds) {
      return queue(() => {
        const ops = [];
        for (const p of dirtyPages) ops.push({ store: 'pages', key: p.id, val: p });
        for (const id of removedIds) ops.push({ store: 'pages', key: id });
        ops.push({ store: 'notebooks', key: meta.id, val: { id: meta.id, pageIds: pages.map((p) => p.id) } });
        ops.push({ store: 'kv', key: 'library', val: this.library });
        return Q.store.batch(ops);
      });
    },

    async updateThumb(meta, page) {
      if (!page) return;
      try {
        await Q.render.images.ensure(Q.render.pageAssetKeys(page));
        const scale = 360 / page.w;
        const c = Q.render.renderPage(page, scale);
        const blob = await U.canvasToBlob(c, 'image/jpeg', 0.82);
        U.freeCanvas(c);
        await Q.store.putThumb(meta.id, blob);
        const old = this.thumbs.get(meta.id);
        if (old) URL.revokeObjectURL(old);
        this.thumbs.set(meta.id, URL.createObjectURL(blob));
      } catch (e) {
        console.warn('thumb failed', e);
      }
    },
    async thumbURL(id) {
      if (this.thumbs.has(id)) return this.thumbs.get(id);
      const blob = await Q.store.getThumb(id).catch(() => null);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      this.thumbs.set(id, url);
      return url;
    },

    async createNotebook(o) {
      const meta = M.newMeta({ title: o.title, cover: o.cover, folderId: o.folderId });
      const pages = o.pages || [M.newPage(o.page || {})];
      meta.pageCount = pages.length;
      meta.text = pages.map(M.pageText).join('\n').slice(0, 12000);
      this.library.notebooks.push(meta);
      await this.persistNotebook(meta, pages, pages, []);
      if (meta.cover.style === 'page') await this.updateThumb(meta, pages[0]);
      return meta;
    },

    async openNotebook(id) {
      if (this.opening || this.editor) return;
      this.opening = true;
      try {
        const meta = this.library.notebooks.find((n) => n.id === id);
        const data = meta && (await Q.store.loadNotebook(id));
        if (!meta || !data) {
          UI.toast('That notebook couldn’t be opened.', { error: true });
          this.settings.openNb = null;
          this.saveSettings();
          return;
        }
        UI.closeAll();
        meta.opened = Date.now();
        this.saveLibrary();
        this.settings.openNb = id;
        this.saveSettingsSoon();
        this.libView.el.hidden = true;
        this.editor = new Q.Editor(this, meta, data.pages);
        this.editor.mount(this.root);
      } catch (e) {
        console.error(e);
        UI.toast('That notebook couldn’t be opened.', { error: true });
        this.libView.el.hidden = false;
      } finally {
        this.opening = false;
      }
    },

    async closeEditor() {
      const ed = this.editor;
      if (!ed) return;
      this.editor = null;
      await ed.close();
      this.settings.openNb = null;
      this.saveSettings();
      this.libView.el.hidden = false;
      this.libView.render();
    },

    async deleteNotebookForever(id, skipGC) {
      const rec = await Q.store.get('notebooks', id).catch(() => null);
      const ops = [{ store: 'notebooks', key: id }, { store: 'thumbs', key: id }];
      if (rec) for (const pid of rec.pageIds) ops.push({ store: 'pages', key: pid });
      this.library.notebooks = this.library.notebooks.filter((n) => n.id !== id);
      ops.push({ store: 'kv', key: 'library', val: this.library });
      await queue(() => Q.store.batch(ops));
      const url = this.thumbs.get(id);
      if (url) URL.revokeObjectURL(url);
      this.thumbs.delete(id);
      if (!skipGC) Q.store.gcAssets().catch(() => {});
    },

    async duplicateNotebook(id) {
      const src = this.library.notebooks.find((n) => n.id === id);
      const data = await Q.store.loadNotebook(id);
      if (!src || !data) return;
      const pages = data.pages.map(M.clonePage);
      const meta = await this.createNotebook({ title: 'Copy of ' + src.title, cover: Object.assign({}, src.cover), folderId: src.folderId, pages });
      await this.updateThumb(meta, pages[0]);
      UI.toast('Duplicated “' + src.title + '”');
    },

    async exportNotebookPDF(id) {
      const meta = this.library.notebooks.find((n) => n.id === id);
      const data = await Q.store.loadNotebook(id);
      if (!meta || !data) return;
      const prog = UI.progress({ title: 'Exporting PDF', cancellable: true });
      try {
        const blob = await Q.io.exportPDF(meta.title, data.pages, { dpi: 170, onProgress: (f, t) => prog.set(f, t), signal: prog.signal });
        prog.close();
        Q.io.offerFile(blob, U.safeFileName(meta.title) + '.pdf');
      } catch (e) {
        prog.close();
        if (!(e && e.name === 'AbortError')) UI.toast('Export failed.', { error: true });
      }
    },

    async importPDFNotebook(file, folderId) {
      const prog = UI.progress({ title: 'Importing ' + file.name, text: 'Opening…', cancellable: true });
      try {
        const pages = await Q.io.importPDF(file, (f, t) => prog.set(f, t), prog.signal);
        if (!pages.length) throw new Error('empty');
        const title = file.name.replace(/\.pdf$/i, '') || 'PDF';
        const meta = await this.createNotebook({ title, cover: { color: '#2E4A7A', style: 'page' }, folderId, pages });
        prog.close();
        UI.toast('Imported “' + title + '” · ' + U.plural(pages.length, 'page'), { action: { label: 'Open', fn: () => this.openNotebook(meta.id) } });
      } catch (e) {
        prog.close();
        if (e && e.name === 'AbortError') return;
        console.error(e);
        UI.toast(/password/i.test((e && e.message) || '') ? 'That PDF is password-protected.' : 'That PDF couldn’t be opened.', { error: true });
      }
    },

    async importImagesNotebook(files, folderId) {
      const prog = UI.progress({ title: 'Importing images' });
      try {
        const pages = await Q.io.imagesToPages(files, (f, t) => prog.set(f, t));
        const meta = await this.createNotebook({ title: files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') : 'Images', cover: { color: '#2F6F7A', style: 'page' }, folderId, pages });
        prog.close();
        UI.toast('Imported ' + U.plural(pages.length, 'image'), { action: { label: 'Open', fn: () => this.openNotebook(meta.id) } });
      } catch (e) {
        prog.close();
        UI.toast('Those images couldn’t be imported.', { error: true });
      }
    },

    async backup() {
      if (this.editor) await this.editor.flush();
      await this.writeLibrary();
      const prog = UI.progress({ title: 'Creating backup' });
      try {
        const blob = await Q.io.exportBackup(this.library, (f, t) => prog.set(f, t));
        prog.close();
        const d = new Date();
        Q.io.offerFile(blob, `Quire backup ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.zip`, 'Backup ready');
      } catch (e) {
        prog.close();
        console.error(e);
        UI.toast('Backup failed. Free up some space and try again.', { error: true });
      }
    },
    async restore() {
      const files = await Q.io.pickFiles('.zip,application/zip', false);
      if (!files[0]) return;
      const prog = UI.progress({ title: 'Restoring backup' });
      try {
        const r = await Q.io.importBackup(files[0], this.library, (f, t) => prog.set(f, t));
        await this.writeLibrary();
        prog.close();
        UI.closeAll();
        this.libView.render();
        UI.toast(r.added || r.updated ? `Restored ${U.plural(r.added, 'notebook')}${r.updated ? `, updated ${r.updated}` : ''}` : 'Everything in that backup is already here.');
      } catch (e) {
        prog.close();
        UI.toast(e && e.message ? e.message : 'Restore failed.', { error: true });
      }
    },

    async seed() {
      const T = (x, y, w, txt, s, extra) => Object.assign({ t: 't', id: U.uid('e'), x, y, w, h: 0, s, f: 'sans', c: '#1C1C1E', b: 0, al: 'l', r: 0, txt }, extra || {});
      const fix = (el) => {
        if (el.t === 't') el.h = Q.render.textHeight(el);
        return el;
      };
      const shape = (sh, color, w) => ({ t: 's', id: U.uid('e'), k: 'ball', c: color, w, pts: Q.ink.shapePoints(sh), ts: 0, te: 0, sh: 1 });
      const hl = (x0, y, x1, color) => ({ t: 's', id: U.uid('e'), k: 'hl', c: color, w: 13, pts: new Float32Array([x0, y, 0.6, x1, y, 0.6]), ts: 0, te: 0, sh: 1 });
      // a little handwritten-looking underline: wavy fountain stroke
      const wave = (x0, y0, len, color) => {
        const pts = [];
        for (let i = 0; i <= 40; i++) {
          const t = i / 40;
          pts.push(x0 + t * len, y0 + Math.sin(t * Math.PI * 3) * 2.2, 0.45 + 0.35 * Math.sin(t * Math.PI));
        }
        return { t: 's', id: U.uid('e'), k: 'fountain', c: color, w: 1.8, pts: new Float32Array(pts), ts: 1, te: 1 };
      };
      const p1 = M.newPage({ size: 'a4', tpl: 'dots', paper: 'white' });
      p1.els = [
        T(56, 58, 420, 'Welcome to Quire', 30, { f: 'serif', b: 1 }),
        wave(58, 104, 248, '#2453C6'),
        T(56, 122, 470, 'A notebook for Apple Pencil. Everything is unlocked: pens, shapes, PDFs, planners, stickers and export.', 13, { c: '#48484A' }),
        T(56, 186, 220, 'Write', 17, { b: 1 }),
        T(56, 210, 220, 'Pick the pen in the toolbar. Tap the selected colour or size again to fine-tune it.', 12),
        T(316, 186, 220, 'Navigate', 17, { b: 1 }),
        T(316, 210, 220, 'One finger scrolls, two fingers pinch to zoom. Two-finger tap undoes, three-finger tap redoes.', 12),
        T(56, 300, 220, 'Perfect shapes', 17, { b: 1 }),
        T(56, 324, 220, 'Draw a circle or box and keep the Pencil down for a moment. It snaps into shape.', 12),
        T(316, 300, 220, 'Move anything', 17, { b: 1 }),
        T(316, 324, 220, 'The lasso circles ink, text and images. Drag to move, use the corners to resize, the top dot to rotate.', 12),
        shape({ kind: 'ellipse', cx: 120, cy: 440, a: 52, b: 34, rot: 0 }, '#D2343C', 1.8),
        shape({ kind: 'poly', closed: true, pts: [208, 404, 300, 404, 300, 476, 208, 476] }, '#1E8A4C', 1.8),
        shape({ kind: 'poly', closed: true, pts: [370, 478, 410, 404, 450, 478] }, '#6B3FC4', 1.8),
        shape({ kind: 'line', x0: 470, y0: 440, x1: 540, y1: 440 }, '#1C1C1E', 1.6),
        hl(56, 540, 236, '#FFE45C'),
        T(56, 530, 480, 'Highlight, then erase only the highlighter.', 13),
        T(56, 586, 480, 'PDFs & export', 17, { b: 1 }),
        T(56, 610, 470, 'Import a PDF from Files to annotate it. Export any notebook or page as a PDF or image from the ⋯ menu.', 12),
        { t: 'k', id: U.uid('e'), x: 470, y: 560, w: 64, h: 64, r: 0.12, n: 'star' },
        { t: 'k', id: U.uid('e'), x: 56, y: 680, w: 92, h: 27.6, r: 0, n: 'label-idea' },
        T(160, 684, 380, 'Your notes are saved on this iPad as you write.', 12, { c: '#48484A' }),
      ].map(fix);
      const p2 = M.newPage({ size: 'a4', tpl: 'ruled', paper: 'ivory' });
      p2.els = [T(70, 40, 400, 'Try it here', 22, { f: 'hand', c: '#2453C6' })].map(fix);
      const welcome = await this.createNotebook({ title: 'Welcome to Quire', cover: { color: '#1E5B4A', style: 'linen' }, pages: [p1, p2] });
      const plan = M.newPage({ size: 'a4', tpl: 'weekly', paper: 'white' });
      await this.createNotebook({ title: 'Week planner', cover: { color: '#C9A23F', style: 'band' }, pages: [plan, M.newPage({ size: 'a4', tpl: 'daily', paper: 'white' })] });
      await this.createNotebook({ title: 'Notes', cover: { color: '#2E4A7A', style: 'linen' }, page: { size: 'a4', tpl: 'ruled', paper: 'white' } });
      welcome.modified = Date.now() + 1;
      await this.writeLibrary();
    },
  };

  App.saveLibrary = U.debounce(() => App.writeLibrary(), 250);
  App.saveSettingsSoon = U.debounce(() => queue(() => Q.store.saveSettings(App.settings)).catch(() => {}), 600);
  Q.app = App;

  const boot = () =>
    App.start().catch((e) => {
      console.error(e);
      const el = document.getElementById('splash');
      if (el) el.textContent = 'Quire couldn’t start: ' + (e && e.message ? e.message : e);
    });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})((window.Q = window.Q || {}));
