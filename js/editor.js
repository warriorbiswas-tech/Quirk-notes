(function (Q) {
  'use strict';
  const U = Q.util;
  const M = Q.model;
  const I = Q.ink;
  const R = Q.render;
  const h = U.h;

  const HOLD_MS = 480;
  const TAP_MS = 320;
  const SLOP = 7;

  class Editor {
    constructor(app, meta, pages) {
      this.app = app;
      this.meta = meta;
      this.pages = pages.length ? pages : [M.newPage({ tpl: 'ruled' })];
      this.dirty = new Set(pages.length ? [] : [this.pages[0].id]);
      this.history = new M.History(250);
      this.tool = 'pen';
      this.prevTool = 'pen';
      this.sel = null;
      this.action = null;
      this.touches = new Map();
      this.gesture = null;
      this.penDown = false;
      this.removed = new Set();
      this.metaDirty = !pages.length;
      this.laser = [];
      this.textEdit = null;
      this.fling = 0;
      this.saveSoon = U.debounce(() => this.save(), 650);
      this.thumbSoon = U.debounce(() => this.app.updateThumb(this.meta, this.pages[0]), 2500);
      this.build();
    }

    get settings() {
      return this.app.settings;
    }
    get tools() {
      return this.app.settings.tools;
    }

    build() {
      this.root = h('div', { class: 'editor' });
      this.buildChrome();
      this.view = h('div', { class: 'ed-view', tabIndex: -1 });
      this.cv = h('div', { class: 'ed-canvas' });
      this.view.appendChild(this.cv);
      this.main.appendChild(this.view);
      this.renderer = new R.Renderer(this.cv);
      this.renderer.setPages(this.pages);
      this.renderer.liveDraw = (g) => this.drawLive(g);
      this.renderer.onView = () => this.onViewChanged();
      this.renderer.onThumb = (page) => this.onThumbUpdated(page);
      this.buildOverlays();
      this.bindInput();
      this.applyTheme();
    }

    mount(parent) {
      parent.appendChild(this.root);
      this.ro = new ResizeObserver(() => this.onResize());
      this.ro.observe(this.view);
      this.onResize(true);
      const startIdx = U.clamp(this.meta.lastPage || 0, 0, this.pages.length - 1);
      this.scrollToPage(startIdx, false);
      this.setTool(this.settings.lastTool && this.settings.lastTool !== 'laser' ? this.settings.lastTool : 'pen');
      this.updateChrome();
      this.view.focus({ preventScroll: true });
    }

    applyTheme() {
      const cs = getComputedStyle(document.documentElement);
      this.renderer.workspace = cs.getPropertyValue('--workspace').trim() || '#E4E7E2';
      this.renderer.shadow = cs.getPropertyValue('--page-shadow').trim() || 'rgba(20,30,25,0.10)';
      this.accent = cs.getPropertyValue('--accent').trim() || '#1E5B4A';
      this.renderer.requestDraw();
    }

    onResize(first) {
      const r = this.renderer;
      const oldFit = r.vw > 1 ? r.fitScale() : 0;
      const rel = oldFit ? r.view.s / oldFit : 1;
      const cy = r.view.y + r.vh / r.view.s / 2;
      r.resize();
      this.vr = this.view.getBoundingClientRect();
      if (first || !oldFit) {
        r.setView(r.fitScale(), 0, -16 / r.fitScale());
      } else {
        const ns = r.fitScale() * rel;
        r.setView(ns, r.view.x, cy - r.vh / ns / 2);
      }
      this.positionOverlays();
    }

    page(id) {
      return this.pages.find((p) => p.id === id) || null;
    }
    pageIndex(id) {
      return this.pages.findIndex((p) => p.id === id);
    }
    replacePage(pages, page) {
      return pages.map((p) => (p.id === page.id ? page : p));
    }
    markDiff(a, b) {
      const am = new Map(a.map((p) => [p.id, p]));
      const bm = new Map(b.map((p) => [p.id, p]));
      for (const [id, p] of bm) if (am.get(id) !== p) this.dirty.add(id);
      for (const id of am.keys()) if (!bm.has(id)) this.removed.add(id);
      if (a.length !== b.length || a.some((p, i) => b[i] && b[i].id !== p.id)) this.metaDirty = true;
    }
    // apply without history (live erasing etc.)
    applyPages(pages) {
      this.markDiff(this.pages, pages);
      this.pages = pages;
      this.renderer.setPages(pages);
    }
    commit(pages, before) {
      const prev = before || this.pages;
      this.markDiff(this.pages, pages);
      if (before) this.markDiff(before, pages);
      this.history.push({ before: prev, after: pages, sel: null });
      this.pages = pages;
      this.renderer.setPages(pages);
      this.changed();
    }
    changed() {
      this.saveSoon();
      if (this.dirty.has(this.pages[0] && this.pages[0].id)) this.thumbSoon();
      this.updateChrome();
    }
    undo() {
      this.finishText();
      if (this.action) this.cancelAction();
      const e = this.history.undo();
      if (!e) return;
      this.clearSelection();
      this.markDiff(this.pages, e.before);
      this.pages = e.before;
      this.renderer.setPages(this.pages);
      this.revealChange(e.after, e.before);
      this.changed();
      this.flash('Undo');
    }
    redo() {
      this.finishText();
      if (this.action) this.cancelAction();
      const e = this.history.redo();
      if (!e) return;
      this.clearSelection();
      this.markDiff(this.pages, e.after);
      this.pages = e.after;
      this.renderer.setPages(this.pages);
      this.revealChange(e.before, e.after);
      this.changed();
      this.flash('Redo');
    }
    // scroll to an undone change when it is off screen
    revealChange(a, b) {
      const am = new Map(a.map((p) => [p.id, p]));
      const changedPage = b.find((p) => am.get(p.id) !== p);
      if (!changedPage) return;
      const vis = this.renderer.visible().map((pv) => pv.page.id);
      if (!vis.includes(changedPage.id)) this.scrollToPage(this.pageIndex(changedPage.id), true);
    }

    async save() {
      if (!this.dirty.size && !this.removed.size && !this.metaDirty) return;
      const dirty = this.pages.filter((p) => this.dirty.has(p.id));
      const removed = Array.from(this.removed).filter((id) => !this.pages.some((p) => p.id === id));
      this.dirty.clear();
      this.removed.clear();
      this.metaDirty = false;
      const m = this.meta;
      m.modified = Date.now();
      m.pageCount = this.pages.length;
      m.lastPage = this.renderer.currentIndex();
      m.text = this.pages.map(M.pageText).join('\n').slice(0, 12000);
      try {
        await this.app.persistNotebook(m, this.pages, dirty, removed);
        this.setSaveState('saved');
      } catch (e) {
        console.error(e);
        for (const p of dirty) this.dirty.add(p.id);
        for (const id of removed) this.removed.add(id);
        this.setSaveState('error');
        Q.ui.toast('Couldn’t save. Free up storage on this iPad, then try again.', { error: true });
      }
    }
    async flush() {
      this.finishText();
      this.saveSoon.cancel();
      await this.save();
      this.thumbSoon.cancel();
      await this.app.updateThumb(this.meta, this.pages[0]);
    }

    async close() {
      this.clearSelection();
      await this.flush();
      this.meta.lastPage = this.renderer.currentIndex();
      this.destroy();
    }
    destroy() {
      cancelAnimationFrame(this.fling);
      if (this.ro) this.ro.disconnect();
      this.unbind && this.unbind();
      this.renderer.destroy();
      this.destroyChrome && this.destroyChrome();
      this.root.remove();
    }

    local(e) {
      const r = this.vr || (this.vr = this.view.getBoundingClientRect());
      return [e.clientX - r.left, e.clientY - r.top];
    }
    toPage(pv, sx, sy) {
      const [dx, dy] = this.renderer.toDoc(sx, sy);
      return [dx - pv.x, dy - pv.y];
    }
    pageToScreen(pv, x, y) {
      return this.renderer.toScreen(pv.x + x, pv.y + y);
    }
    pvAt(sx, sy, slop = 0) {
      const [dx, dy] = this.renderer.toDoc(sx, sy);
      return this.renderer.pageAt(dx, dy, slop);
    }
    pvFor(id) {
      return this.renderer.pvById(id);
    }
    currentPage() {
      return this.pages[this.renderer.currentIndex()] || this.pages[0];
    }
    scrollToPage(i, animate) {
      const r = this.renderer;
      const pv = r.layout[U.clamp(i, 0, r.layout.length - 1)];
      if (!pv) return;
      const s = r.view.s;
      const target = { s, x: r.view.x, y: pv.y - 14 / s };
      r.clampView(target);
      if (animate) this.animateView(target);
      else r.setView(target.s, target.x, target.y);
    }
    animateView(target, ms = 300) {
      cancelAnimationFrame(this.fling);
      const r = this.renderer;
      const from = Object.assign({}, r.view);
      const t0 = U.now();
      const step = () => {
        const t = U.clamp((U.now() - t0) / ms, 0, 1);
        const e = 1 - Math.pow(1 - t, 3);
        const s = from.s + (target.s - from.s) * e;
        r.setView(s, from.x + (target.x - from.x) * e, from.y + (target.y - from.y) * e);
        if (t < 1) this.fling = requestAnimationFrame(step);
        else this.renderer.endInteraction();
      };
      if (target.s !== from.s) r.beginInteraction();
      this.fling = requestAnimationFrame(step);
    }
    zoomTo(ns, animate = true) {
      const r = this.renderer;
      const cx = r.vw / 2;
      const cy = r.vh / 2;
      const dx = cx / r.view.s + r.view.x;
      const dy = cy / r.view.s + r.view.y;
      const s = U.clamp(ns, r.minScale(), r.maxScale());
      const t = r.clampView({ s, x: dx - cx / s, y: dy - cy / s });
      if (animate) this.animateView(t, 260);
      else r.setView(t.s, t.x, t.y);
    }
    onViewChanged() {
      this.positionOverlays();
      this.updatePageBadge();
    }

    fingerDraws() {
      const f = this.settings.fingerDraw;
      if (f === 'on') return true;
      if (f === 'off') return false;
      return !this.settings.penSeen;
    }
    notePen() {
      if (!this.settings.penSeen) {
        this.settings.penSeen = true;
        this.app.saveSettings();
        if (this.settings.fingerDraw === 'auto') Q.ui.toast('Apple Pencil detected. Fingers now scroll, zoom and tap.');
        this.updateChrome();
      }
    }

    bindInput() {
      const v = this.cv;
      const offs = [];
      const on = (el, t, f, o) => offs.push(U.on(el, t, f, o));
      on(v, 'pointerdown', (e) => this.onDown(e));
      on(v, 'pointermove', (e) => this.onMove(e));
      on(v, 'pointerup', (e) => this.onUp(e, false));
      on(v, 'pointercancel', (e) => this.onUp(e, true));
      on(v, 'lostpointercapture', (e) => {
        if (this.action && this.action.pid === e.pointerId) this.onUp(e, true);
      });
      // stop Safari from scrolling, zooming, selecting text or showing the loupe
      const stop = (e) => {
        if (e.cancelable) e.preventDefault();
      };
      on(v, 'touchstart', stop, { passive: false });
      on(v, 'touchmove', stop, { passive: false });
      on(v, 'gesturestart', stop, { passive: false });
      on(v, 'gesturechange', stop, { passive: false });
      on(v, 'contextmenu', stop);
      on(v, 'dblclick', stop);
      on(v, 'wheel', (e) => this.onWheel(e), { passive: false });
      on(window, 'keydown', (e) => this.onKey(e));
      on(window, 'keyup', (e) => {
        if (e.code === 'Space') this.spaceDown = false;
      });
      on(document, 'paste', (e) => this.onPaste(e));
      on(window, 'blur', () => {
        if (this.action) this.onUp({ pointerId: this.action.pid, clientX: 0, clientY: 0, timeStamp: U.now() }, true);
      });
      this.unbind = () => offs.forEach((f) => f());
    }

    onDown(e) {
      if (this.textEdit && e.pointerType !== 'touch') this.finishText();
      this.vr = this.view.getBoundingClientRect();
      const [x, y] = this.local(e);
      const type = e.pointerType || 'mouse';
      try {
        this.cv.setPointerCapture(e.pointerId);
      } catch (er) {}
      if (type === 'pen') {
        this.notePen();
        if (this.action && this.action.pid !== e.pointerId) this.cancelAction();
        this.endNavigation();
        this.penDown = true;
        this.startTool(e, x, y, type);
        return;
      }
      if (type === 'mouse') {
        if (e.button === 1 || e.button === 2 || this.spaceDown) {
          this.startMousePan(e, x, y);
          return;
        }
        if (e.button !== 0) return;
        this.startTool(e, x, y, type);
        return;
      }
      if (this.penDown) return; // palm resting while the Pencil writes
      if ((e.width > 60 && e.height > 60) || (this.lastPenUp && U.now() - this.lastPenUp < 220)) return; // palm-sized contact
      this.touches.set(e.pointerId, { x, y, x0: x, y0: y, t0: U.now() });
      cancelAnimationFrame(this.fling);
      const n = this.touches.size;
      if (n === 1) {
        this.gesture = { t0: U.now(), max: 1, moved: false, drew: false };
        if (this.textEdit) {
          this.finishText();
          this.gesture.consumed = true;
        }
        if (this.fingerDraws() && !this.selHitCheck(x, y)) {
          this.startTool(e, x, y, 'touch');
          this.gesture.drew = true;
        } else if (this.sel && this.selHitCheck(x, y)) {
          this.startTool(e, x, y, 'touch');
          this.gesture.drew = true;
        } else this.gesture.pan = { id: e.pointerId, x, y, samples: [{ t: U.now(), x, y }], active: false };
      } else {
        if (this.gesture) this.gesture.max = Math.max(this.gesture.max, n);
        if (this.action && this.action.touch) {
          this.cancelAction();
          if (this.gesture) this.gesture.drew = false;
        }
        if (n >= 2 && this.gesture && !this.gesture.pinch) this.startPinch();
      }
    }

    onMove(e) {
      const [x, y] = this.local(e);
      if (this.action && this.action.pid === e.pointerId) {
        this.moveTool(e, x, y);
        return;
      }
      if (this.mousePan && this.mousePan.id === e.pointerId) {
        const r = this.renderer;
        r.setView(r.view.s, r.view.x - (x - this.mousePan.x) / r.view.s, r.view.y - (y - this.mousePan.y) / r.view.s);
        this.mousePan.x = x;
        this.mousePan.y = y;
        return;
      }
      const t = this.touches.get(e.pointerId);
      if (!t) return;
      t.x = x;
      t.y = y;
      const g = this.gesture;
      if (!g) return;
      if (Math.hypot(x - t.x0, y - t.y0) > SLOP) g.moved = true;
      if (g.pinch) this.movePinch();
      else if (g.pan && g.pan.id === e.pointerId) {
        const p = g.pan;
        if (!p.active && Math.hypot(x - t.x0, y - t.y0) > SLOP) {
          p.active = true;
          p.x = x;
          p.y = y;
        }
        if (p.active) {
          const r = this.renderer;
          r.setView(r.view.s, r.view.x - (x - p.x) / r.view.s, r.view.y - (y - p.y) / r.view.s);
          p.x = x;
          p.y = y;
          const now = U.now();
          p.samples.push({ t: now, x, y });
          while (p.samples.length > 2 && now - p.samples[0].t > 90) p.samples.shift();
        }
      }
    }

    onUp(e, cancelled) {
      if (this.action && this.action.pid === e.pointerId) {
        // iPadOS can cancel a Pencil stroke (edge swipes, system gestures): keep the ink
        if (this.action.type === 'draw') this.endTool(e, cancelled && this.action.b.count < 2);
        else this.endTool(e, cancelled);
        if (e.pointerType === 'pen') {
          this.penDown = false;
          this.lastPenUp = U.now();
        }
        if (!this.touches.has(e.pointerId)) return;
      }
      if (e.pointerType === 'pen') {
        this.penDown = false;
        this.lastPenUp = U.now();
      }
      if (this.mousePan && this.mousePan.id === e.pointerId) {
        this.mousePan = null;
        return;
      }
      const t = this.touches.get(e.pointerId);
      if (!t) return;
      this.touches.delete(e.pointerId);
      const g = this.gesture;
      if (!g) return;
      if (g.pinch) {
        if (this.touches.size < 2) this.endPinch();
        if (this.touches.size === 1) {
          const [id, rest] = this.touches.entries().next().value;
          g.pan = { id, x: rest.x, y: rest.y, samples: [{ t: U.now(), x: rest.x, y: rest.y }], active: true };
        }
      } else if (g.pan && g.pan.id === e.pointerId && g.pan.active && !cancelled) this.startFling(g.pan);
      if (this.touches.size === 0) {
        const dur = U.now() - g.t0;
        if (!g.moved && !cancelled && dur < TAP_MS && !g.consumed) {
          if (g.max === 2 && this.settings.tapUndo) this.undo();
          else if (g.max === 3 && this.settings.tapUndo) this.redo();
          else if (g.max === 1 && !g.drew) {
            const [x, y] = this.local(e);
            this.fingerTap(x, y);
          }
        }
        this.gesture = null;
      }
    }

    startMousePan(e, x, y) {
      this.mousePan = { id: e.pointerId, x, y };
    }

    startPinch() {
      const g = this.gesture;
      const pts = Array.from(this.touches.values()).slice(0, 2);
      const r = this.renderer;
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      g.pan = null;
      g.pinch = {
        d0: Math.max(10, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
        s0: r.view.s,
        anchor: r.toDoc(cx, cy),
      };
      r.beginInteraction();
    }
    movePinch() {
      const g = this.gesture;
      const pts = Array.from(this.touches.values()).slice(0, 2);
      if (pts.length < 2) return;
      const r = this.renderer;
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      if (Math.abs(d / g.pinch.d0 - 1) > 0.06) g.moved = true;
      const ns = U.clamp(g.pinch.s0 * (d / g.pinch.d0), r.minScale(), r.maxScale());
      r.setView(ns, g.pinch.anchor[0] - cx / ns, g.pinch.anchor[1] - cy / ns);
      this.showZoom();
    }
    endPinch() {
      const g = this.gesture;
      if (!g || !g.pinch) return;
      g.pinch = null;
      const r = this.renderer;
      r.endInteraction();
      const fit = r.fitScale();
      if (Math.abs(r.view.s / fit - 1) < 0.05) this.zoomTo(fit);
    }
    startFling(p) {
      const s = p.samples;
      if (s.length < 2) return;
      const a = s[0];
      const b = s[s.length - 1];
      const dt = Math.max(1, b.t - a.t);
      let vx = (b.x - a.x) / dt;
      let vy = (b.y - a.y) / dt;
      if (U.now() - b.t > 60 || Math.hypot(vx, vy) < 0.25) return;
      const r = this.renderer;
      let last = U.now();
      const step = () => {
        const now = U.now();
        const dtt = Math.min(40, now - last);
        last = now;
        const before = r.view;
        r.setView(r.view.s, r.view.x - (vx * dtt) / r.view.s, r.view.y - (vy * dtt) / r.view.s);
        const decay = Math.pow(0.9945, dtt);
        vx *= decay;
        vy *= decay;
        const stuck = before.x === r.view.x && before.y === r.view.y;
        if (Math.hypot(vx, vy) > 0.03 && !stuck) this.fling = requestAnimationFrame(step);
      };
      this.fling = requestAnimationFrame(step);
    }
    endNavigation() {
      cancelAnimationFrame(this.fling);
      if (this.gesture && this.gesture.pinch) this.endPinch();
      this.touches.clear();
      this.gesture = null;
    }

    onWheel(e) {
      e.preventDefault();
      const [x, y] = this.local(e);
      const r = this.renderer;
      if (e.ctrlKey || e.metaKey) {
        const k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0075));
        r.zoomAt(r.view.s * k, x, y);
        this.showZoom();
        clearTimeout(this._wheelEnd);
        r.beginInteraction();
        this._wheelEnd = setTimeout(() => r.endInteraction(), 160);
      } else {
        const m = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? r.vh : 1;
        r.setView(r.view.s, r.view.x + (e.deltaX * m) / r.view.s, r.view.y + (e.deltaY * m) / r.view.s);
      }
    }

    onKey(e) {
      if (!this.root.isConnected || Q.ui.isOpen()) return;
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;
      if (typing) {
        if (e.key === 'Escape' && this.textEdit) {
          e.preventDefault();
          this.finishText();
        }
        return;
      }
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        e.shiftKey ? this.redo() : this.undo();
      } else if (mod && k === 'y') {
        e.preventDefault();
        this.redo();
      } else if (mod && k === 'c' && this.sel) {
        e.preventDefault();
        this.copySel();
      } else if (mod && k === 'x' && this.sel) {
        e.preventDefault();
        this.cutSel();
      } else if (mod && k === 'd' && this.sel) {
        e.preventDefault();
        this.duplicateSel();
      } else if (mod && k === 'v' && Q.clipboard) {
        e.preventDefault();
        this.paste();
      } else if (mod && (k === '=' || k === '+')) {
        e.preventDefault();
        this.zoomTo(this.renderer.view.s * 1.25);
      } else if (mod && k === '-') {
        e.preventDefault();
        this.zoomTo(this.renderer.view.s / 1.25);
      } else if (mod && k === '0') {
        e.preventDefault();
        this.zoomTo(this.renderer.fitScale());
      } else if ((k === 'backspace' || k === 'delete') && this.sel) {
        e.preventDefault();
        this.deleteSel();
      } else if (k === 'escape') {
        if (this.sel) this.clearSelection();
      } else if (e.code === 'Space') {
        this.spaceDown = true;
      } else if (!mod && !e.altKey) {
        const map = { p: 'pen', h: 'hl', e: 'eraser', l: 'lasso', s: 'shape', t: 'text', k: 'laser' };
        if (map[k]) this.setTool(map[k]);
        else if (k === 'pagedown') this.scrollToPage(this.renderer.currentIndex() + 1, true);
        else if (k === 'pageup') this.scrollToPage(this.renderer.currentIndex() - 1, true);
      }
    }

    async onPaste(e) {
      if (!this.root.isConnected || this.textEdit) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (const it of items) {
        if (it.kind === 'file' && /^image\//.test(it.type)) {
          e.preventDefault();
          const f = it.getAsFile();
          if (f) await this.insertImageFile(f);
          return;
        }
      }
      if (Q.clipboard) {
        e.preventDefault();
        this.paste();
      }
    }

    setTool(tool) {
      if (tool === this.tool && this.toolBtns) {
        this.updateChrome();
        return;
      }
      this.finishText();
      if (tool !== 'lasso' && this.sel) this.clearSelection();
      if (this.tool !== 'eraser') this.prevTool = this.tool;
      this.tool = tool;
      this.settings.lastTool = tool;
      this.app.saveSettingsSoon();
      this.updateChrome();
      this.renderer.requestLive();
    }

    startTool(e, x, y, type) {
      const t = this.tool;
      const touch = type === 'touch';
      const now = e.timeStamp || U.now();
      // a live selection takes precedence for any tool
      if (this.sel) {
        const hit = this.selHit(x, y);
        if (hit) {
          this.beginTransform(e, x, y, hit, touch);
          return;
        }
        this.clearSelection();
      }
      if (t === 'pen' || t === 'hl' || t === 'shape') {
        const pv = this.pvAt(x, y, 0);
        if (!pv) return;
        const conf = t === 'hl' ? this.tools.hl : t === 'shape' ? this.tools.shape : this.tools.pen;
        const kind = t === 'hl' ? 'hl' : t === 'shape' ? 'ball' : this.tools.pen.kind;
        const b = new I.StrokeBuilder({
          kind,
          color: conf.color,
          size: conf.size,
          scale: this.renderer.view.s,
          pointerType: type,
          sens: kind === 'hl' ? 0 : this.settings.pressure,
          smoothing: this.settings.smoothing,
        });
        const [px, py] = this.toPage(pv, x, y);
        b.add(px, py, e.pressure || 0.5, now);
        this.action = { type: 'draw', pid: e.pointerId, pv, b, touch, shape: null, anchor: [x, y], hl: t === 'hl', straightHl: t === 'hl' && this.tools.hl.straight };
        this.armHold(x, y);
        this.renderer.requestLive();
      } else if (t === 'eraser') {
        const pv = this.pvAt(x, y, 30);
        if (!pv) return;
        const [px, py] = this.toPage(pv, x, y);
        this.action = { type: 'erase', pid: e.pointerId, pv, before: this.pages, last: [px, py], cur: [x, y], touch, changed: false };
        this.eraseSweep(px, py, px, py);
        this.renderer.requestLive();
      } else if (t === 'lasso') {
        const pv = this.pvAt(x, y, 40);
        if (!pv) return;
        const [px, py] = this.toPage(pv, x, y);
        this.action = { type: 'lasso', pid: e.pointerId, pv, poly: [px, py], screen: [x, y], touch, t0: U.now() };
        this.renderer.requestLive();
      } else if (t === 'text') {
        const pv = this.pvAt(x, y, 0);
        if (!pv) return;
        this.action = { type: 'tap', pid: e.pointerId, pv, x0: x, y0: y, touch };
      } else if (t === 'laser') {
        this.action = { type: 'laser', pid: e.pointerId, touch };
        this.laserPoint(x, y);
      }
    }

    moveTool(e, x, y) {
      const a = this.action;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      const list = evs && evs.length ? evs : [e];
      if (a.type === 'draw') {
        if (a.shape) {
          this.adjustShape(x, y);
          return;
        }
        for (const ev of list) {
          const [lx, ly] = this.local(ev);
          const [px, py] = this.toPage(a.pv, lx, ly);
          a.b.add(px, py, ev.pressure || 0.5, ev.timeStamp || U.now());
        }
        if (Math.hypot(x - a.anchor[0], y - a.anchor[1]) > 2.5) this.armHold(x, y);
        this.renderer.requestLive();
      } else if (a.type === 'erase') {
        for (const ev of list) {
          const [lx, ly] = this.local(ev);
          const [px, py] = this.toPage(a.pv, lx, ly);
          this.eraseSweep(a.last[0], a.last[1], px, py);
          a.last = [px, py];
        }
        a.cur = [x, y];
        this.renderer.requestLive();
      } else if (a.type === 'lasso') {
        const [px, py] = this.toPage(a.pv, x, y);
        const n = a.poly.length;
        if (Math.hypot(px - a.poly[n - 2], py - a.poly[n - 1]) * this.renderer.view.s > 2) a.poly.push(px, py);
        this.renderer.requestLive();
      } else if (a.type === 'transform') {
        this.moveTransform(x, y);
      } else if (a.type === 'laser') {
        for (const ev of list) {
          const [lx, ly] = this.local(ev);
          this.laserPoint(lx, ly);
        }
      } else if (a.type === 'tap') {
        if (Math.hypot(x - a.x0, y - a.y0) > SLOP * 1.5) a.moved = true;
      }
    }

    endTool(e, cancelled) {
      const a = this.action;
      this.action = null;
      clearTimeout(this.holdTimer);
      if (!a) return;
      const [x, y] = e.clientX || e.clientY ? this.local(e) : [0, 0];
      if (a.type === 'draw') {
        if (cancelled) {
          this.renderer.requestLive();
          return;
        }
        let el;
        if (a.shape) el = this.shapeElement(a);
        else {
          if (e.clientX || e.clientY) {
            const [px, py] = this.toPage(a.pv, x, y);
            a.b.finish(px, py);
          }
          el = a.b.toElement();
          if (this.tool === 'shape' || a.straightHl) {
            const sh = I.recognize(el.pts, this.snapTol() * 1.15);
            if (sh && (!a.hl || sh.kind === 'line')) {
              a.shape = sh;
              el = this.shapeElement(a);
            } else if (a.straightHl) {
              const p = el.pts;
              const n = p.length;
              a.shape = { kind: 'line', x0: p[0], y0: p[1], x1: p[n - 3], y1: p[n - 2] };
              el = this.shapeElement(a);
            }
          }
        }
        const page = this.page(a.pv.page.id);
        if (!page) return;
        this.commit(this.replacePage(this.pages, M.withEls(page, page.els.concat([el]))));
        this.renderer.requestLive();
      } else if (a.type === 'erase') {
        if (a.changed) {
          const after = this.pages;
          this.history.push({ before: a.before, after });
          this.changed();
        }
        this.renderer.requestLive();
        if (this.tools.eraser.auto && this.prevTool && this.prevTool !== 'eraser') this.setTool(this.prevTool);
      } else if (a.type === 'lasso') {
        this.finishLasso(a);
      } else if (a.type === 'transform') {
        this.endTransform(cancelled);
      } else if (a.type === 'tap') {
        if (!a.moved && !cancelled) this.textTap(a.pv, a.x0, a.y0);
      } else if (a.type === 'laser') {
        this.renderer.requestLive();
      }
    }

    cancelAction() {
      const a = this.action;
      this.action = null;
      clearTimeout(this.holdTimer);
      if (!a) return;
      if (a.type === 'erase' && a.changed) {
        this.applyPages(a.before);
      } else if (a.type === 'transform') this.endTransform(true);
      this.renderer.requestLive();
    }

    // finger taps when fingers don't draw
    fingerTap(x, y) {
      if (this.tool === 'text') {
        const pv = this.pvAt(x, y, 0);
        if (pv) this.textTap(pv, x, y);
        return;
      }
      if (this.tool === 'lasso') {
        const pv = this.pvAt(x, y, 0);
        if (pv) this.tapSelect(pv, x, y);
        return;
      }
      if (this.sel) this.clearSelection();
      else {
        // tap a box element to pick it up
        const pv = this.pvAt(x, y, 0);
        if (!pv) return;
        const [px, py] = this.toPage(pv, x, y);
        const page = this.page(pv.page.id);
        for (let i = page.els.length - 1; i >= 0; i--) {
          const el = page.els[i];
          if (el.t !== 's' && M.boxHit(el, px, py, 2)) {
            this.setTool('lasso');
            this.setSelection(page.id, [el.id]);
            return;
          }
        }
      }
    }

    armHold(x, y) {
      const a = this.action;
      if (!a) return;
      a.anchor = [x, y];
      clearTimeout(this.holdTimer);
      if (!this.settings.shapeHold && this.tool !== 'shape') return;
      const snap = this.settings.snap == null ? 0.5 : this.settings.snap;
      this.holdTimer = setTimeout(() => this.onHold(), Math.round(HOLD_MS + 220 - snap * 440));
    }
    onHold() {
      const a = this.action;
      if (!a || a.type !== 'draw' || a.shape || a.b.count < 5) return;
      const p = a.b.pts;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < p.length; i += 3) {
        x0 = Math.min(x0, p[i]);
        x1 = Math.max(x1, p[i]);
        y0 = Math.min(y0, p[i + 1]);
        y1 = Math.max(y1, p[i + 1]);
      }
      if (Math.hypot(x1 - x0, y1 - y0) * this.renderer.view.s < 36) return;
      const sh = I.recognize(new Float32Array(a.b.pts), this.snapTol());
      if (!sh) return;
      if (a.hl && sh.kind !== 'line') return;
      a.shape = sh;
      a.shapeBase = sh;
      a.shapeAnchor = this.toPage(a.pv, a.anchor[0], a.anchor[1]);
      if (navigator.vibrate) {
        try {
          navigator.vibrate(8);
        } catch (e) {}
      }
      this.snapFlash = U.now();
      this.renderer.requestLive();
    }
    adjustShape(x, y) {
      const a = this.action;
      const [px, py] = this.toPage(a.pv, x, y);
      const base = a.shapeBase;
      if (base.kind === 'line') {
        let ang = Math.atan2(py - base.y0, px - base.x0);
        const len = Math.hypot(px - base.x0, py - base.y0);
        const step = Math.PI / 4;
        const k = Math.round(ang / step);
        if (Math.abs(ang - k * step) < (5 * Math.PI) / 180) ang = k * step;
        a.shape = Object.assign({}, base, { x1: base.x0 + Math.cos(ang) * len, y1: base.y0 + Math.sin(ang) * len });
      } else {
        const [cx, cy] = I.shapeCenter(base);
        const d0 = Math.hypot(a.shapeAnchor[0] - cx, a.shapeAnchor[1] - cy) || 1;
        const d1 = Math.hypot(px - cx, py - cy);
        a.shape = I.scaleShape(base, U.clamp(d1 / d0, 0.1, 10));
      }
      this.renderer.requestLive();
    }
    snapTol() {
      const snap = this.settings.snap == null ? 0.5 : this.settings.snap;
      return 0.6 + snap * 0.8;
    }
    shapeElement(a) {
      const conf = a.hl ? this.tools.hl : this.tool === 'shape' ? this.tools.shape : this.tools.pen;
      const kind = a.hl ? 'hl' : this.tool === 'shape' ? 'ball' : this.tools.pen.kind === 'pencil' ? 'pencil' : 'ball';
      return { t: 's', id: U.uid('e'), k: kind, c: conf.color, w: conf.size, pts: I.shapePoints(a.shape), ts: 0, te: 0, sh: 1 };
    }

    eraseSweep(x0, y0, x1, y1) {
      const a = this.action;
      const page = this.page(a.pv.page.id);
      if (!page) return;
      const conf = this.tools.eraser;
      const r = conf.size / 2;
      const ok = (el) => el.t === 's' && (!conf.hlOnly || el.k === 'hl');
      let changed = false;
      let els;
      if (conf.mode === 'stroke') {
        els = page.els.filter((el) => {
          if (ok(el) && I.hitSweep(el, x0, y0, x1, y1, r)) {
            changed = true;
            return false;
          }
          return true;
        });
      } else {
        const d = Math.hypot(x1 - x0, y1 - y0);
        const n = Math.max(1, Math.ceil(d / (r * 0.5)));
        els = page.els;
        for (let i = d ? 1 : 0; i <= n; i++) {
          const sx = x0 + ((x1 - x0) * i) / n;
          const sy = y0 + ((y1 - y0) * i) / n;
          const next = [];
          let any = false;
          for (const el of els) {
            if (!ok(el)) {
              next.push(el);
              continue;
            }
            const res = I.eraseCircle(el, sx, sy, r);
            if (res === null) next.push(el);
            else {
              any = true;
              for (const piece of res) next.push(piece);
            }
          }
          if (any) {
            els = next;
            changed = true;
          }
        }
      }
      if (changed) {
        a.changed = true;
        this.applyPages(this.replacePage(this.pages, M.withEls(page, els)));
      }
    }

    laserPoint(x, y) {
      const [dx, dy] = this.renderer.toDoc(x, y);
      this.laser.push({ x: dx, y: dy, t: U.now() });
      if (this.laser.length > 400) this.laser.splice(0, this.laser.length - 400);
      this.renderer.requestLive();
    }

    textTap(pv, x, y) {
      const page = this.page(pv.page.id);
      const [px, py] = this.toPage(pv, x, y);
      for (let i = page.els.length - 1; i >= 0; i--) {
        const el = page.els[i];
        if (el.t === 't' && M.boxHit(el, px, py, 4)) {
          this.openText(pv, el);
          return;
        }
      }
      const conf = this.tools.text;
      const w = Math.max(80, Math.min(300, page.w - px - 16));
      const el = { t: 't', id: U.uid('e'), x: U.clamp(px, 4, page.w - 40), y: U.clamp(py - conf.size * 0.75, 2, page.h - conf.size * 1.4), w, h: conf.size * 1.32, s: conf.size, f: conf.font, c: conf.color, b: conf.bold ? 1 : 0, al: conf.align || 'l', r: 0, txt: '' };
      this.openText(pv, el, true);
    }

    finishLasso(a) {
      const page = this.page(a.pv.page.id);
      if (!page) return;
      const poly = a.poly;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < poly.length; i += 2) {
        minX = Math.min(minX, poly[i]);
        maxX = Math.max(maxX, poly[i]);
        minY = Math.min(minY, poly[i + 1]);
        maxY = Math.max(maxY, poly[i + 1]);
      }
      const s = this.renderer.view.s;
      if ((maxX - minX) * s < 12 && (maxY - minY) * s < 12) {
        const [sx, sy] = this.pageToScreen(a.pv, poly[0], poly[1]);
        if (!this.tapSelect(a.pv, sx, sy) && Q.clipboard) this.offerPaste(sx, sy, a.pv, poly[0], poly[1]);
        this.renderer.requestLive();
        return;
      }
      const ids = [];
      for (const el of page.els) {
        if (el.t === 's') {
          if (I.insideFraction(el, poly) >= 0.5) ids.push(el.id);
        } else {
          const c = M.boxCorners(el);
          let n = 0;
          for (let i = 0; i < 8; i += 2) if (U.pointInPoly(c[i], c[i + 1], poly)) n++;
          const cx = el.x + el.w / 2;
          const cy = el.y + el.h / 2;
          if (n >= 2 || U.pointInPoly(cx, cy, poly)) ids.push(el.id);
        }
      }
      if (ids.length) this.setSelection(page.id, ids);
      else this.renderer.requestLive();
    }
    tapSelect(pv, sx, sy) {
      const page = this.page(pv.page.id);
      const [px, py] = this.toPage(pv, sx, sy);
      const tol = 7 / this.renderer.view.s;
      for (let i = page.els.length - 1; i >= 0; i--) {
        const el = page.els[i];
        const hit = el.t === 's' ? I.hitPoint(el, px, py, tol) : M.boxHit(el, px, py, tol);
        if (hit) {
          this.setSelection(page.id, [el.id]);
          return true;
        }
      }
      if (this.sel) this.clearSelection();
      return false;
    }

    setSelection(pageId, ids) {
      const page = this.page(pageId);
      if (!page) return;
      const set = new Set(ids);
      const els = page.els.filter((e) => set.has(e.id));
      if (!els.length) return this.clearSelection();
      let frame;
      if (els.length === 1 && els[0].t !== 's') {
        const el = els[0];
        frame = { cx: el.x + el.w / 2, cy: el.y + el.h / 2, w: el.w, h: el.h, r: el.r || 0 };
      } else {
        let b = null;
        for (const el of els) b = U.bboxUnion(b, M.elBBox(el));
        frame = { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, w: b[2] - b[0], h: b[3] - b[1], r: 0 };
      }
      this.sel = { pageId, ids: set, els, frame, single: els.length === 1 && els[0].t !== 's' ? els[0] : null };
      this.selXf = null;
      this.freeSelBitmap();
      this.renderer.setHidden(ids);
      this.renderer.requestLive();
      this.showSelBar();
    }
    clearSelection() {
      if (!this.sel) return;
      this.sel = null;
      this.selXf = null;
      this.freeSelBitmap();
      this.renderer.setHidden([]);
      this.renderer.requestLive();
      this.hideSelBar();
    }
    freeSelBitmap() {
      if (this.selBmp) U.freeCanvas(this.selBmp.c);
      this.selBmp = null;
    }

    // selection frame corners in screen px (current transform applied)
    selScreenGeom() {
      const sel = this.sel;
      const pv = this.pvFor(sel.pageId);
      if (!pv) return null;
      const { frame: f, m } = this.liveFrame();
      const c = Math.cos(f.r);
      const s = Math.sin(f.r);
      const pts = [];
      for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const lx = (dx * f.w) / 2;
        const ly = (dy * f.h) / 2;
        const [qx, qy] = U.mat.apply(m, f.cx + lx * c - ly * s, f.cy + lx * s + ly * c);
        pts.push(this.pageToScreen(pv, qx, qy));
      }
      const [tcx, tcy] = U.mat.apply(m, f.cx, f.cy);
      const center = this.pageToScreen(pv, tcx, tcy);
      // rotation handle: beyond the top edge midpoint
      const tmx = (pts[0][0] + pts[1][0]) / 2;
      const tmy = (pts[0][1] + pts[1][1]) / 2;
      let ux = tmx - center[0];
      let uy = tmy - center[1];
      const ul = Math.hypot(ux, uy) || 1;
      ux /= ul;
      uy /= ul;
      const rot = [tmx + ux * 30, tmy + uy * 30];
      const emx = (pts[1][0] + pts[2][0]) / 2;
      const emy = (pts[1][1] + pts[2][1]) / 2;
      return { pts, center, rot, top: [tmx, tmy], east: [emx, emy], pv };
    }
    liveFrame() {
      const sel = this.sel;
      const xf = this.selXf;
      if (xf && xf.w != null && sel.single) {
        const n = this.textWidthEl(sel.single, xf.w);
        return { frame: { cx: n.x + n.w / 2, cy: n.y + n.h / 2, w: n.w, h: n.h, r: n.r || 0 }, m: U.mat.ident() };
      }
      return { frame: sel.frame, m: xf ? xf.m : U.mat.ident() };
    }
    // text box with a new wrap width; its top-left corner stays put (also when rotated)
    textWidthEl(el, newW) {
      const n = Object.assign({}, el, { w: newW });
      n.h = R.textHeight(n);
      const r = el.r || 0;
      const ux = Math.cos(r);
      const uy = Math.sin(r);
      const dw = newW - el.w;
      const dh = n.h - el.h;
      const cx = el.x + el.w / 2 + (ux * dw) / 2 - (uy * dh) / 2;
      const cy = el.y + el.h / 2 + (uy * dw) / 2 + (ux * dh) / 2;
      n.x = cx - newW / 2;
      n.y = cy - n.h / 2;
      return n;
    }
    selHit(x, y) {
      if (!this.sel) return null;
      const g = this.selScreenGeom();
      if (!g) return null;
      const R2 = 22 * 22;
      if ((x - g.rot[0]) ** 2 + (y - g.rot[1]) ** 2 < R2) return 'rotate';
      const names = ['nw', 'ne', 'se', 'sw'];
      for (let i = 0; i < 4; i++) if ((x - g.pts[i][0]) ** 2 + (y - g.pts[i][1]) ** 2 < R2) return names[i];
      if (this.sel.single && this.sel.single.t === 't' && (x - g.east[0]) ** 2 + (y - g.east[1]) ** 2 < R2) return 'e';
      const poly = [];
      for (const p of g.pts) poly.push(p[0], p[1]);
      if (U.pointInPoly(x, y, poly)) return 'move';
      // small selections: generous move area
      const minDim = Math.min(Math.hypot(g.pts[1][0] - g.pts[0][0], g.pts[1][1] - g.pts[0][1]), Math.hypot(g.pts[3][0] - g.pts[0][0], g.pts[3][1] - g.pts[0][1]));
      if (minDim < 44 && (x - g.center[0]) ** 2 + (y - g.center[1]) ** 2 < 30 * 30) return 'move';
      return null;
    }
    selHitCheck(x, y) {
      return !!(this.sel && this.selHit(x, y));
    }

    beginTransform(e, x, y, hit, touch) {
      const sel = this.sel;
      const g = this.selScreenGeom();
      const [px, py] = this.toPage(g.pv, x, y);
      const f = sel.frame;
      const corners = [];
      const c = Math.cos(f.r);
      const s = Math.sin(f.r);
      for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const lx = (dx * f.w) / 2;
        const ly = (dy * f.h) / 2;
        corners.push([f.cx + lx * c - ly * s, f.cy + lx * s + ly * c]);
      }
      const opp = { nw: 2, ne: 3, se: 0, sw: 1 };
      this.hideSelBar();
      this.action = { type: 'transform', pid: e.pointerId, hit, start: [px, py], pv: g.pv, corners, anchor: opp[hit] != null ? corners[opp[hit]] : null, touch, moved: false, sx: x, sy: y };
      this.selXf = { m: U.mat.ident(), k: 1, rot: 0, w: null };
      if (sel.els.length > 250) this.makeSelBitmap();
    }
    moveTransform(x, y) {
      const a = this.action;
      const sel = this.sel;
      if (!sel) return;
      if (!a.moved && Math.hypot(x - a.sx, y - a.sy) < 3) return;
      a.moved = true;
      const [px, py] = this.toPage(a.pv, x, y);
      const f = sel.frame;
      const xf = this.selXf;
      if (a.hit === 'move') {
        xf.m = U.mat.translate(px - a.start[0], py - a.start[1]);
        xf.k = 1;
        xf.rot = 0;
      } else if (a.hit === 'rotate') {
        const a0 = Math.atan2(a.start[1] - f.cy, a.start[0] - f.cx);
        const a1 = Math.atan2(py - f.cy, px - f.cx);
        let d = a1 - a0;
        const total = f.r + d;
        const step = Math.PI / 12;
        const k = Math.round(total / step);
        if (Math.abs(total - k * step) < (3.5 * Math.PI) / 180) d = k * step - f.r;
        xf.rot = d;
        xf.k = 1;
        xf.m = U.mat.mul(U.mat.translate(f.cx, f.cy), U.mat.mul(U.mat.rotate(d), U.mat.translate(-f.cx, -f.cy)));
      } else if (a.hit === 'e') {
        const el = sel.single;
        const ux = Math.cos(f.r);
        const uy = Math.sin(f.r);
        const delta = (px - a.start[0]) * ux + (py - a.start[1]) * uy;
        xf.w = Math.max(30, el.w + delta);
        xf.m = U.mat.ident();
        xf.k = 1;
        xf.rot = 0;
      } else {
        const an = a.anchor;
        const v0x = a.start[0] - an[0];
        const v0y = a.start[1] - an[1];
        const v1x = px - an[0];
        const v1y = py - an[1];
        const k = U.clamp((v1x * v0x + v1y * v0y) / (v0x * v0x + v0y * v0y || 1), 0.05, 40);
        xf.k = k;
        xf.rot = 0;
        xf.m = U.mat.mul(U.mat.translate(an[0], an[1]), U.mat.mul(U.mat.scale(k), U.mat.translate(-an[0], -an[1])));
      }
      this.renderer.requestLive();
    }
    endTransform(cancelled) {
      const sel = this.sel;
      const xf = this.selXf;
      this.selXf = null;
      this.freeSelBitmap();
      if (!sel || !xf) return;
      const a = this.action;
      if (cancelled || (a && !a.moved)) {
        this.renderer.requestLive();
        this.showSelBar();
        return;
      }
      const page = this.page(sel.pageId);
      const map = new Map();
      for (const el of sel.els) {
        let n;
        if (xf.w != null && el.t === 't') {
          n = this.textWidthEl(el, xf.w);
        } else {
          n = M.transformEl(el, xf.m, xf.k, xf.rot);
          if (n.t === 't') n.h = R.textHeight(n);
        }
        map.set(el.id, n);
      }
      const els = page.els.map((e) => map.get(e.id) || e);
      this.commit(this.replacePage(this.pages, M.withEls(page, els)));
      this.setSelection(sel.pageId, Array.from(sel.ids));
    }
    makeSelBitmap() {
      const sel = this.sel;
      const pv = this.pvFor(sel.pageId);
      let b = null;
      for (const el of sel.els) b = U.bboxUnion(b, M.elBBox(el));
      const ds = Math.min(this.renderer.view.s * this.renderer.dpr, 4096 / Math.max(1, b[2] - b[0]), 4096 / Math.max(1, b[3] - b[1]));
      const c = U.makeCanvas((b[2] - b[0]) * ds + 4, (b[3] - b[1]) * ds + 4);
      const g = c.getContext('2d');
      g.setTransform(ds, 0, 0, ds, -b[0] * ds + 2, -b[1] * ds + 2);
      const env = { dark: Q.paper.isDark(pv.page) };
      for (const el of sel.els) R.drawEl(g, el, env);
      this.selBmp = { c, b, ds };
    }

    deleteSel() {
      const sel = this.sel;
      if (!sel) return;
      const page = this.page(sel.pageId);
      this.clearSelection();
      this.commit(this.replacePage(this.pages, M.withEls(page, page.els.filter((e) => !sel.ids.has(e.id)))));
    }
    copySel() {
      if (!this.sel) return;
      Q.clipboard = { els: this.sel.els.map((e) => M.cloneEl(e)), pageId: this.sel.pageId };
      Q.ui.toast(U.plural(this.sel.els.length, 'item') + ' copied');
    }
    cutSel() {
      this.copySel();
      this.deleteSel();
    }
    duplicateSel() {
      const sel = this.sel;
      if (!sel) return;
      const page = this.page(sel.pageId);
      const clones = sel.els.map((e) => M.cloneEl(e, 14, 14));
      this.commit(this.replacePage(this.pages, M.withEls(page, page.els.concat(clones))));
      this.setSelection(page.id, clones.map((e) => e.id));
    }
    recolorSel(color) {
      const sel = this.sel;
      if (!sel) return;
      const page = this.page(sel.pageId);
      const els = page.els.map((e) => (sel.ids.has(e.id) && (e.t === 's' || e.t === 't') ? Object.assign({}, e, { c: color }) : e));
      this.commit(this.replacePage(this.pages, M.withEls(page, els)));
      this.setSelection(page.id, Array.from(sel.ids));
    }
    frontSel() {
      const sel = this.sel;
      if (!sel) return;
      const page = this.page(sel.pageId);
      const rest = page.els.filter((e) => !sel.ids.has(e.id));
      const mine = page.els.filter((e) => sel.ids.has(e.id));
      this.commit(this.replacePage(this.pages, M.withEls(page, rest.concat(mine))));
      this.setSelection(page.id, Array.from(sel.ids));
    }
    paste(target) {
      const cb = Q.clipboard;
      if (!cb || !cb.els.length) return;
      const page = target ? this.page(target.pageId) : this.page((this.sel && this.sel.pageId) || this.currentPage().id);
      let b = null;
      for (const el of cb.els) b = U.bboxUnion(b, M.elBBox(el));
      let dx = 0;
      let dy = 0;
      if (target) {
        dx = target.x - (b[0] + b[2]) / 2;
        dy = target.y - (b[1] + b[3]) / 2;
      } else if (cb.pageId === page.id) {
        dx = dy = 14;
      } else {
        dx = U.clamp(0, -b[0], page.w - b[2]);
        dy = U.clamp(0, -b[1], page.h - b[3]);
      }
      const clones = cb.els.map((e) => M.cloneEl(e, dx, dy));
      cb.els = clones.map((e) => M.cloneEl(e));
      cb.pageId = page.id;
      this.setTool('lasso');
      this.commit(this.replacePage(this.pages, M.withEls(page, page.els.concat(clones))));
      this.setSelection(page.id, clones.map((e) => e.id));
    }

    visibleCenterOn(page) {
      const pv = this.pvFor(page.id);
      const r = this.renderer;
      const [cx, cy] = r.toDoc(r.vw / 2, r.vh / 2);
      return [U.clamp(cx - pv.x, page.w * 0.2, page.w * 0.8), U.clamp(cy - pv.y, page.h * 0.15, page.h * 0.85)];
    }
    insertEl(el, page) {
      page = page || this.currentPage();
      this.setTool('lasso');
      this.commit(this.replacePage(this.pages, M.withEls(page, page.els.concat([el]))));
      this.setSelection(page.id, [el.id]);
    }
    async insertImageFile(file) {
      try {
        const prep = await Q.io.prepareImage(file, 2400);
        const key = await Q.io.storeImage(prep);
        const page = this.currentPage();
        const [cx, cy] = this.visibleCenterOn(page);
        const maxW = page.w * 0.6;
        const maxH = page.h * 0.5;
        const k = Math.min(maxW / prep.w, maxH / prep.h, 1);
        const w = prep.w * k;
        const h2 = prep.h * k;
        this.insertEl({ t: 'i', id: U.uid('e'), x: cx - w / 2, y: cy - h2 / 2, w, h: h2, r: 0, a: key }, page);
      } catch (e) {
        console.error(e);
        Q.ui.toast('That image couldn’t be opened. Try a JPEG or PNG.', { error: true });
      }
    }
    insertSticker(def) {
      const page = this.currentPage();
      const [cx, cy] = this.visibleCenterOn(page);
      const sz = Q.stickers.defaultSize(def);
      this.insertEl({ t: 'k', id: U.uid('e'), x: cx - sz.w / 2, y: cy - sz.h / 2, w: sz.w, h: sz.h, r: def.cat === 'tape' ? -0.06 : 0, n: def.id }, page);
    }

    addPage(opts, index) {
      const cur = this.currentPage();
      const at = index == null ? this.pageIndex(cur.id) + 1 : index;
      const base = opts || { w: cur.w, h: cur.h, tpl: cur.bg ? 'ruled' : cur.tpl.k, paper: cur.bg ? 'white' : cur.tpl.c, sp: cur.bg ? undefined : cur.tpl.sp };
      const p = M.newPage(base);
      const pages = this.pages.slice();
      pages.splice(at, 0, p);
      this.commit(pages);
      this.scrollToPage(at, true);
      return p;
    }
    insertPages(newPages, index) {
      const pages = this.pages.slice();
      pages.splice(index, 0, ...newPages);
      this.commit(pages);
      this.scrollToPage(index, true);
    }
    duplicatePage(id) {
      const i = this.pageIndex(id);
      const copy = M.clonePage(this.pages[i]);
      const pages = this.pages.slice();
      pages.splice(i + 1, 0, copy);
      this.commit(pages);
      this.scrollToPage(i + 1, true);
    }
    async deletePage(id) {
      if (this.pages.length <= 1) {
        const ok = await Q.ui.confirm({ title: 'Clear the only page?', message: 'A notebook needs at least one page, so this page will be emptied instead.', ok: 'Clear page', danger: true });
        if (ok) this.clearPage(id);
        return;
      }
      if (this.sel && this.sel.pageId === id) this.clearSelection();
      const i = this.pageIndex(id);
      this.commit(this.pages.filter((p) => p.id !== id));
      Q.ui.toast('Page ' + (i + 1) + ' deleted', { action: { label: 'Undo', fn: () => this.undo() } });
    }
    clearPage(id) {
      const page = this.page(id);
      if (!page || (!page.els.length && !page.bg)) return;
      if (this.sel && this.sel.pageId === id) this.clearSelection();
      this.commit(this.replacePage(this.pages, Object.assign({}, page, { els: [] })));
      Q.ui.toast('Page cleared', { action: { label: 'Undo', fn: () => this.undo() } });
    }
    movePage(from, to) {
      if (from === to) return;
      const pages = this.pages.slice();
      const [p] = pages.splice(from, 1);
      pages.splice(to, 0, p);
      this.commit(pages);
    }
    setTemplate(ids, tpl, paper, sp) {
      const set = new Set(ids);
      const pages = this.pages.map((p) => (set.has(p.id) ? Object.assign({}, p, { tpl: sp ? { k: tpl, c: paper, sp } : { k: tpl, c: paper } }) : p));
      this.commit(pages);
    }
    toggleBookmark(id) {
      const page = this.page(id);
      const pages = this.replacePage(this.pages, Object.assign({}, page, { bm: !page.bm }));
      this.commit(pages);
      Q.ui.toast(page.bm ? 'Bookmark removed' : 'Page bookmarked');
    }

    drawLive(g) {
      const r = this.renderer;
      const ds = r.view.s * r.dpr;
      const a = this.action;
      if (this.sel) this.drawSelection(g);
      if (a && a.type === 'draw') {
        r.pageXform(g, a.pv);
        g.save();
        g.beginPath();
        g.rect(0, 0, a.pv.w, a.pv.h);
        g.clip();
        const env = { dark: Q.paper.isDark(a.pv.page) };
        if (a.shape) {
          const el = this.shapeElement(a);
          if (el.k === 'hl') {
            // multiply needs the paper below; approximate on the transparent layer
            g.globalAlpha = 0.5;
            g.strokeStyle = el.c;
            g.lineWidth = el.w;
            g.lineCap = 'round';
            g.lineJoin = 'round';
            g.stroke(I.buildPath(el));
          } else I.drawStroke(g, el, env, true);
        } else if (a.b.count) {
          const el = { t: 's', k: a.b.kind, c: a.b.color, w: a.b.size, pts: new Float32Array(a.b.pts), ts: a.b.prof.taperS > 0 ? 1 : 0, te: 0 };
          if (el.k === 'hl') {
            g.globalAlpha = 0.5;
            g.strokeStyle = el.c;
            g.lineWidth = el.w;
            g.lineCap = 'round';
            g.lineJoin = 'round';
            g.stroke(I.buildPath(el));
          } else I.drawStroke(g, el, env, true);
        }
        g.restore();
        if (this.snapFlash && U.now() - this.snapFlash < 260) r.requestLive();
      } else if (a && a.type === 'erase') {
        const rad = (this.tools.eraser.size / 2) * ds;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.beginPath();
        g.arc(a.cur[0] * r.dpr, a.cur[1] * r.dpr, Math.max(3 * r.dpr, rad), 0, Math.PI * 2);
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.fill();
        g.lineWidth = 1.5 * r.dpr;
        g.strokeStyle = 'rgba(60,70,80,0.75)';
        g.stroke();
      } else if (a && a.type === 'lasso') {
        r.pageXform(g, a.pv);
        const p = a.poly;
        g.beginPath();
        g.moveTo(p[0], p[1]);
        for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
        g.closePath();
        g.fillStyle = U.rgba(this.accentHex(), 0.07);
        g.fill();
        g.setLineDash([5 / r.view.s, 4 / r.view.s]);
        g.lineDashOffset = -(U.now() / 40) / r.view.s;
        g.lineWidth = 1.4 / r.view.s;
        g.strokeStyle = this.accentHex();
        g.stroke();
        g.setLineDash([]);
        r.requestLive();
      }
      if (this.laser.length) this.drawLaser(g);
    }
    accentHex() {
      return U.normHex(this.accent) || '#1E5B4A';
    }
    drawSelection(g) {
      const r = this.renderer;
      const sel = this.sel;
      const pv = this.pvFor(sel.pageId);
      if (!pv) return;
      const ds = r.view.s * r.dpr;
      const xf = this.selXf;
      r.pageXform(g, pv);
      g.save();
      g.beginPath();
      g.rect(0, 0, pv.w, pv.h);
      g.clip();
      const widthMode = xf && xf.w != null && sel.single;
      if (xf && !widthMode) g.transform(xf.m[0], xf.m[1], xf.m[2], xf.m[3], xf.m[4], xf.m[5]);
      const env = { dark: Q.paper.isDark(pv.page) };
      if (this.selBmp && xf) {
        const bm = this.selBmp;
        g.drawImage(bm.c, bm.b[0] - 2 / bm.ds, bm.b[1] - 2 / bm.ds, bm.c.width / bm.ds, bm.c.height / bm.ds);
      } else {
        const halo = sel.els.length <= 400;
        if (halo) {
          g.save();
          g.strokeStyle = U.rgba(this.accentHex(), 0.38);
          g.lineWidth = 4 / ds;
          g.lineJoin = 'round';
          for (const el of sel.els) if (el.t === 's' && el.k !== 'hl') g.stroke(I.path(el));
          g.restore();
        }
        for (const el of sel.els) {
          if (widthMode) R.drawText(g, this.textWidthEl(el, xf.w));
          else R.drawEl(g, el, env);
        }
      }
      g.restore();
      const geo = this.selScreenGeom();
      if (!geo) return;
      const dpr = r.dpr;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const acc = this.accentHex();
      g.beginPath();
      geo.pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      g.closePath();
      g.setLineDash([6, 4]);
      g.lineWidth = 1.25;
      g.strokeStyle = acc;
      g.stroke();
      g.setLineDash([]);
      if (this.action && this.action.type === 'transform' && this.action.moved) return;
      g.beginPath();
      g.moveTo(geo.top[0], geo.top[1]);
      g.lineTo(geo.rot[0], geo.rot[1]);
      g.lineWidth = 1.25;
      g.strokeStyle = acc;
      g.stroke();
      const knob = (x, y, rad) => {
        g.beginPath();
        g.arc(x, y, rad, 0, Math.PI * 2);
        g.fillStyle = '#FFFFFF';
        g.fill();
        g.lineWidth = 1.6;
        g.strokeStyle = acc;
        g.stroke();
      };
      for (const p of geo.pts) knob(p[0], p[1], 6.5);
      if (sel.single && sel.single.t === 't') knob(geo.east[0], geo.east[1], 5.5);
      knob(geo.rot[0], geo.rot[1], 7.5);
      g.beginPath();
      g.arc(geo.rot[0], geo.rot[1], 3.4, -Math.PI * 0.9, Math.PI * 0.5);
      g.lineWidth = 1.4;
      g.strokeStyle = acc;
      g.stroke();
    }
    drawLaser(g) {
      const r = this.renderer;
      const now = U.now();
      const life = 750;
      while (this.laser.length && now - this.laser[0].t > life) this.laser.shift();
      if (!this.laser.length) return;
      const color = this.tools.laser.color;
      g.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      const pts = this.laser.map((p) => [...r.toScreen(p.x, p.y), p.t]);
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 1; i < pts.length; i++) {
          const age = (now - pts[i][2]) / life;
          if (pts[i][2] - pts[i - 1][2] > 120) continue;
          g.globalAlpha = Math.max(0, 1 - age) * (pass ? 1 : 0.35);
          g.strokeStyle = pass ? '#FFFFFF' : color;
          g.lineWidth = pass ? 2.2 : 9;
          g.beginPath();
          g.moveTo(pts[i - 1][0], pts[i - 1][1]);
          g.lineTo(pts[i][0], pts[i][1]);
          g.stroke();
        }
      }
      g.globalAlpha = 1;
      const last = pts[pts.length - 1];
      if (now - last[2] < life) {
        g.beginPath();
        g.arc(last[0], last[1], 5, 0, Math.PI * 2);
        g.fillStyle = color;
        g.shadowColor = color;
        g.shadowBlur = 12;
        g.fill();
        g.shadowBlur = 0;
      }
      r.requestLive();
    }
  }
  Q.Editor = Editor;
})((window.Q = window.Q || {}));
