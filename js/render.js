(function (Q) {
  'use strict';
  const U = Q.util;
  const M = Q.model;
  const P = Q.paper;
  const I = Q.ink;
  const S = Q.stickers;
  const R = (Q.render = {});

  const TILE = 512;
  const GAP = 22;
  const PAD_X = 22;
  const MAX_TILES = 80;
  const THUMB_W = 320;
  R.GAP = GAP;

  const images = {
    map: new Map(),
    listeners: new Set(),
    budget: 36e6,
    get(key) {
      const e = this.map.get(key);
      if (e) {
        e.last = U.now();
        if (e.img) return e.img;
        return null;
      }
      this.load(key);
      return null;
    },
    put(key, img) {
      const { w, h } = U.imgSize(img);
      this.map.set(key, { img, w, h, last: U.now(), loading: null });
      this.evict();
    },
    load(key) {
      let e = this.map.get(key);
      if (e) return e.loading || Promise.resolve(e.img);
      e = { img: null, w: 0, h: 0, last: U.now(), loading: null, failed: false };
      this.map.set(key, e);
      e.loading = (async () => {
        try {
          const rec = await Q.store.getAsset(key);
          if (!rec || !rec.blob) throw new Error('missing asset');
          const img = await U.decodeImage(rec.blob);
          const sz = U.imgSize(img);
          e.img = img;
          e.w = sz.w;
          e.h = sz.h;
          this.evict();
          for (const f of this.listeners) f(key);
          return img;
        } catch (err) {
          e.failed = true;
          console.warn('[Quire] image unavailable', key, err);
          return null;
        } finally {
          e.loading = null;
        }
      })();
      return e.loading;
    },
    async ensure(keys) {
      await Promise.all(Array.from(new Set(keys)).map((k) => (this.map.get(k) && this.map.get(k).img ? null : this.load(k))));
    },
    evict() {
      let total = 0;
      const live = [];
      for (const [k, e] of this.map) if (e.img) {
        total += e.w * e.h;
        live.push([k, e]);
      }
      if (total <= this.budget) return;
      live.sort((a, b) => a[1].last - b[1].last);
      const now = U.now();
      for (const [k, e] of live) {
        if (total <= this.budget) break;
        if (now - e.last < 1500) continue;
        total -= e.w * e.h;
        try {
          if (e.img.close) e.img.close();
        } catch (er) {}
        this.map.delete(k);
      }
    },
    failed(key) {
      const e = this.map.get(key);
      return !!(e && e.failed);
    },
  };
  R.images = images;

  const mctx = U.makeCanvas(8, 8).getContext('2d');
  let textCache = new WeakMap();
  R.fontString = (el) => `${el.b ? '700 ' : ''}${el.s}px ${M.fontCss(el.f)}`;
  R.layoutText = function (el) {
    let L = textCache.get(el);
    if (L) return L;
    const font = R.fontString(el);
    mctx.font = font;
    const maxW = Math.max(el.s, el.w);
    const lines = [];
    const paras = String(el.txt || '').split('\n');
    for (const para of paras) {
      if (para === '') {
        lines.push({ t: '', w: 0 });
        continue;
      }
      const words = para.split(/(\s+)/);
      let line = '';
      for (const word of words) {
        if (!word) continue;
        const cand = line + word;
        if (mctx.measureText(cand).width <= maxW || line === '') {
          if (mctx.measureText(cand).width > maxW && line === '') {
            // break an over-long word
            let chunk = '';
            for (const ch of word) {
              if (mctx.measureText(chunk + ch).width > maxW && chunk) {
                lines.push({ t: chunk, w: mctx.measureText(chunk).width });
                chunk = ch;
              } else chunk += ch;
            }
            line = chunk;
          } else line = cand;
        } else {
          const trimmed = line.replace(/\s+$/, '');
          lines.push({ t: trimmed, w: mctx.measureText(trimmed).width });
          line = /^\s+$/.test(word) ? '' : word;
        }
      }
      const trimmed = line.replace(/\s+$/, '');
      lines.push({ t: trimmed, w: mctx.measureText(trimmed).width });
    }
    if (!lines.length) lines.push({ t: '', w: 0 });
    const m = mctx.measureText('Hg');
    const asc = m.fontBoundingBoxAscent || el.s * 0.95;
    const desc = m.fontBoundingBoxDescent || el.s * 0.24;
    const lh = el.s * 1.32;
    L = { lines, lh, font, base: (lh - (asc + desc)) / 2 + asc, h: lines.length * lh };
    textCache.set(el, L);
    return L;
  };
  R.textHeight = (el) => R.layoutText(el).h;
  R.drawText = function (ctx, el) {
    const L = R.layoutText(el);
    ctx.save();
    const h = el.h || L.h;
    ctx.translate(el.x + el.w / 2, el.y + h / 2);
    if (el.r) ctx.rotate(el.r);
    ctx.translate(-el.w / 2, -h / 2);
    ctx.font = L.font;
    ctx.fillStyle = el.c || '#1C1C1E';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    for (let i = 0; i < L.lines.length; i++) {
      const ln = L.lines[i];
      if (!ln.t) continue;
      const x = el.al === 'c' ? (el.w - ln.w) / 2 : el.al === 'r' ? el.w - ln.w : 0;
      ctx.fillText(ln.t, x, i * L.lh + L.base);
    }
    ctx.restore();
  };
  // Fonts that finish loading after first paint change text metrics.
  R.resetTextCache = function () {
    textCache = new WeakMap();
  };

  R.drawImageEl = function (ctx, el) {
    const img = images.get(el.a);
    ctx.save();
    ctx.translate(el.x + el.w / 2, el.y + el.h / 2);
    if (el.r) ctx.rotate(el.r);
    if (img) ctx.drawImage(img, -el.w / 2, -el.h / 2, el.w, el.h);
    else {
      ctx.fillStyle = 'rgba(128,128,128,0.12)';
      ctx.fillRect(-el.w / 2, -el.h / 2, el.w, el.h);
      ctx.strokeStyle = 'rgba(128,128,128,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(-el.w / 2, -el.h / 2, el.w, el.h);
    }
    ctx.restore();
  };

  R.drawEl = function (ctx, el, env) {
    if (el.t === 's') I.drawStroke(ctx, el, env);
    else if (el.t === 't') R.drawText(ctx, el);
    else if (el.t === 'i') R.drawImageEl(ctx, el);
    else if (el.t === 'k') S.draw(ctx, el);
  };

  // ctx already maps page points → pixels. rect: region in page points.
  R.drawPage = function (ctx, page, rect, ds, opts) {
    const hidden = opts && opts.hidden;
    const noTpl = opts && opts.noTemplate;
    if (noTpl) {
      ctx.fillStyle = P.paperHex(page);
      ctx.fillRect(Math.max(0, rect[0]), Math.max(0, rect[1]), Math.min(page.w, rect[2]) - Math.max(0, rect[0]), Math.min(page.h, rect[3]) - Math.max(0, rect[1]));
    } else P.draw(ctx, page, rect, ds);
    if (page.bg && page.bg.a) {
      const img = images.get(page.bg.a);
      if (img) {
        const { w: iw, h: ih } = U.imgSize(img);
        const x0 = Math.max(0, rect[0]);
        const y0 = Math.max(0, rect[1]);
        const x1 = Math.min(page.w, rect[2]);
        const y1 = Math.min(page.h, rect[3]);
        if (x1 > x0 && y1 > y0) {
          const sx = (x0 / page.w) * iw;
          const sy = (y0 / page.h) * ih;
          const sw = ((x1 - x0) / page.w) * iw;
          const sh = ((y1 - y0) / page.h) * ih;
          ctx.drawImage(img, sx, sy, sw, sh, x0, y0, x1 - x0, y1 - y0);
        }
      }
    }
    const env = { dark: P.isDark(page) };
    for (const el of page.els) {
      if (hidden && hidden.has(el.id)) continue;
      if (!U.bboxHit(M.elBBox(el), rect)) continue;
      R.drawEl(ctx, el, env);
    }
  };

  R.pageAssetKeys = function (page) {
    const keys = [];
    if (page.bg && page.bg.a) keys.push(page.bg.a);
    for (const el of page.els) if (el.t === 'i' && el.a) keys.push(el.a);
    return keys;
  };

  // Full-page raster (export, thumbnails). Make sure images are loaded first for exports.
  R.renderPage = function (page, scale, opts) {
    const c = U.makeCanvas(page.w * scale, page.h * scale);
    const g = c.getContext('2d');
    g.setTransform(c.width / page.w, 0, 0, c.height / page.h, 0, 0);
    R.drawPage(g, page, [0, 0, page.w, page.h], scale, opts);
    return c;
  };

  class Renderer {
    constructor(host) {
      this.host = host;
      this.base = U.h('canvas', { class: 'cv cv-base' });
      this.live = U.h('canvas', { class: 'cv cv-live' });
      host.appendChild(this.base);
      host.appendChild(this.live);
      this.bctx = this.base.getContext('2d', { alpha: false });
      this.lctx = this.live.getContext('2d');
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.vw = 1;
      this.vh = 1;
      this.view = { s: 1, x: 0, y: 0 };
      this.pages = [];
      this.layout = [];
      this.byId = new Map();
      this.totalH = 0;
      this.maxW = 595;
      this.tiles = new Map();
      this.pool = [];
      this.ver = new Map();
      this.thumbs = new Map();
      this.hidden = new Set();
      this.workspace = '#E4E7E2';
      this.shadow = 'rgba(20,30,25,0.10)';
      this.liveDraw = null;
      this.interacting = false;
      this.gestureLevel = 0;
      this.lastLevel = 0;
      this.frameReq = 0;
      this.baseDirty = true;
      this.liveDirty = true;
      this.frame = 0;
      this.lastChange = 0;
      this.onView = null;
      this.onFrame = null;
      this._unsub = (() => {
        const f = (key) => this.onAssetLoaded(key);
        images.listeners.add(f);
        return () => images.listeners.delete(f);
      })();
    }

    destroy() {
      cancelAnimationFrame(this.frameReq);
      clearTimeout(this._thumbTimer);
      this._unsub();
      for (const t of this.tiles.values()) U.freeCanvas(t.c);
      for (const c of this.pool) U.freeCanvas(c);
      for (const t of this.thumbs.values()) U.freeCanvas(t.c);
      this.tiles.clear();
      this.thumbs.clear();
      this.pool = [];
      U.freeCanvas(this.base);
      U.freeCanvas(this.live);
      this.base.remove();
      this.live.remove();
    }

    setPages(pages) {
      const old = this.byId;
      const next = new Map();
      for (const p of pages) next.set(p.id, p);
      for (const p of pages) {
        const o = old.get(p.id);
        if (!o) {
          if (!this.ver.has(p.id)) this.ver.set(p.id, 1);
          continue;
        }
        if (o === p) continue;
        if (o.w !== p.w || o.h !== p.h || o.tpl.k !== p.tpl.k || o.tpl.c !== p.tpl.c || o.tpl.sp !== p.tpl.sp || (o.bg && o.bg.a) !== (p.bg && p.bg.a) || (o.bg && o.bg.hideTpl) !== (p.bg && p.bg.hideTpl)) {
          this.invalidate(p.id, null);
          continue;
        }
        if (o.els === p.els) continue;
        const oe = o.els;
        const ne = p.els;
        let prefix = ne.length > oe.length;
        if (prefix) for (let i = 0; i < oe.length; i++) if (oe[i] !== ne[i]) {
          prefix = false;
          break;
        }
        if (prefix) {
          this.appendToTiles(p, ne.slice(oe.length));
          continue;
        }
        const os = new Set(oe);
        const ns = new Set(ne);
        let region = null;
        for (const e of oe) if (!ns.has(e)) region = U.bboxUnion(region, M.elBBox(e));
        for (const e of ne) if (!os.has(e)) region = U.bboxUnion(region, M.elBBox(e));
        // a pure reorder (bring to front) changes nothing in the sets
        if (!region) {
          let same = oe.length === ne.length;
          if (same) for (let i = 0; i < oe.length; i++) if (oe[i] !== ne[i]) {
            same = false;
            break;
          }
          if (!same) this.invalidate(p.id, null);
        } else this.invalidate(p.id, region);
      }
      for (const id of old.keys())
        if (!next.has(id)) {
          this.dropPage(id);
        }
      this.pages = pages;
      this.byId = next;
      this.relayout();
      this.requestDraw();
    }

    relayout() {
      let y = 0;
      let maxW = 1;
      const layout = [];
      for (const p of this.pages) {
        layout.push({ page: p, x: -p.w / 2, y, w: p.w, h: p.h });
        y += p.h + GAP;
        if (p.w > maxW) maxW = p.w;
      }
      this.layout = layout;
      this.totalH = Math.max(0, y - GAP);
      this.maxW = maxW;
    }

    dropPage(id) {
      for (const [k, t] of this.tiles)
        if (t.pid === id) {
          this.recycle(t.c);
          this.tiles.delete(k);
        }
      const th = this.thumbs.get(id);
      if (th) U.freeCanvas(th.c);
      this.thumbs.delete(id);
      this.ver.delete(id);
    }

    invalidate(pageId, region) {
      const v = this.ver.get(pageId) || 1;
      const nv = v + 1;
      for (const t of this.tiles.values()) {
        if (t.pid !== pageId || t.ver !== v) continue;
        if (region && !U.bboxHit(region, t.rect)) t.ver = nv;
      }
      this.ver.set(pageId, nv);
      this.lastChange = U.now();
      this.baseDirty = true;
      this.requestDraw();
    }
    invalidateAll() {
      for (const p of this.pages) this.invalidate(p.id, null);
    }

    appendToTiles(page, els) {
      const v = this.ver.get(page.id) || 1;
      const nv = v + 1;
      const env = { dark: P.isDark(page) };
      for (const t of this.tiles.values()) {
        if (t.pid !== page.id || t.ver !== v) continue;
        const g = t.c.getContext('2d');
        let drew = false;
        for (const el of els) {
          if (this.hidden.has(el.id)) continue;
          if (!U.bboxHit(M.elBBox(el), t.rect)) continue;
          if (!drew) {
            g.save();
            g.setTransform(t.L, 0, 0, t.L, -t.rect[0] * t.L, -t.rect[1] * t.L);
            g.beginPath();
            g.rect(0, 0, page.w, page.h);
            g.clip();
            drew = true;
          }
          R.drawEl(g, el, env);
        }
        if (drew) g.restore();
        t.ver = nv;
      }
      this.ver.set(page.id, nv);
      this.lastChange = U.now();
      this.baseDirty = true;
      this.requestDraw();
    }

    setHidden(ids) {
      const prev = this.hidden;
      const next = new Set(ids);
      const changed = new Set();
      for (const id of prev) if (!next.has(id)) changed.add(id);
      for (const id of next) if (!prev.has(id)) changed.add(id);
      this.hidden = next;
      if (!changed.size) return;
      for (const p of this.pages) {
        let region = null;
        for (const el of p.els) if (changed.has(el.id)) region = U.bboxUnion(region, M.elBBox(el));
        if (region) this.invalidate(p.id, region);
      }
    }

    onAssetLoaded(key) {
      for (const p of this.pages) {
        if (p.bg && p.bg.a === key) {
          this.invalidate(p.id, null);
          continue;
        }
        let region = null;
        for (const el of p.els) if (el.t === 'i' && el.a === key) region = U.bboxUnion(region, M.elBBox(el));
        if (region) this.invalidate(p.id, region);
      }
    }

    resize() {
      const r = this.host.getBoundingClientRect();
      this.vw = Math.max(1, r.width);
      this.vh = Math.max(1, r.height);
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (const c of [this.base, this.live]) {
        c.width = Math.round(this.vw * this.dpr);
        c.height = Math.round(this.vh * this.dpr);
        c.style.width = this.vw + 'px';
        c.style.height = this.vh + 'px';
      }
      this.clampView(this.view);
      this.baseDirty = this.liveDirty = true;
      this.draw();
    }
    fitScale() {
      return U.clamp((this.vw - PAD_X * 2) / this.maxW, 0.15, 2.4);
    }
    minScale() {
      return this.fitScale() * 0.3;
    }
    maxScale() {
      return Math.min(14, this.fitScale() * 6);
    }
    clampView(v) {
      const s = v.s;
      const vwPt = this.vw / s;
      const vhPt = this.vh / s;
      const padX = PAD_X / s;
      const contentW = this.maxW + padX * 2;
      if (contentW <= vwPt) v.x = -vwPt / 2;
      else v.x = U.clamp(v.x, -this.maxW / 2 - padX, this.maxW / 2 + padX - vwPt);
      const minY = -16 / s;
      const maxY = this.totalH + 160 / s - vhPt;
      v.y = maxY < minY ? minY : U.clamp(v.y, minY, maxY);
      return v;
    }
    setView(s, x, y, noClamp) {
      const v = { s: U.clamp(s, this.minScale(), this.maxScale()), x, y };
      if (!noClamp) this.clampView(v);
      const ch = v.s !== this.view.s || v.x !== this.view.x || v.y !== this.view.y;
      this.view = v;
      if (ch) {
        this.baseDirty = this.liveDirty = true;
        this.requestDraw();
        if (this.onView) this.onView(v);
      }
      return v;
    }
    // zoom so that screen point (sx, sy) stays fixed
    zoomAt(ns, sx, sy) {
      const v = this.view;
      const dx = sx / v.s + v.x;
      const dy = sy / v.s + v.y;
      ns = U.clamp(ns, this.minScale(), this.maxScale());
      return this.setView(ns, dx - sx / ns, dy - sy / ns);
    }
    toDoc(sx, sy) {
      return [sx / this.view.s + this.view.x, sy / this.view.s + this.view.y];
    }
    toScreen(dx, dy) {
      return [(dx - this.view.x) * this.view.s, (dy - this.view.y) * this.view.s];
    }
    pageAt(dx, dy, slop = 0) {
      const L = this.layout;
      let lo = 0;
      let hi = L.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const pv = L[mid];
        if (dy < pv.y - slop) hi = mid - 1;
        else if (dy > pv.y + pv.h + slop) lo = mid + 1;
        else return dx >= pv.x - slop && dx <= pv.x + pv.w + slop ? pv : null;
      }
      return null;
    }
    pvById(id) {
      return this.layout.find((pv) => pv.page.id === id) || null;
    }
    visible() {
      const v = this.view;
      const y0 = v.y;
      const y1 = v.y + this.vh / v.s;
      const out = [];
      for (const pv of this.layout) {
        if (pv.y > y1) break;
        if (pv.y + pv.h >= y0) out.push(pv);
      }
      return out;
    }
    currentIndex() {
      if (!this.layout.length) return 0;
      const cy = this.view.y + this.vh / this.view.s / 2;
      let best = 0;
      let bestD = Infinity;
      this.layout.forEach((pv, i) => {
        const d = cy < pv.y ? pv.y - cy : cy > pv.y + pv.h ? cy - pv.y - pv.h : 0;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return best;
    }
    // page-to-device transform for live drawing
    pageXform(ctx, pv) {
      const ds = this.view.s * this.dpr;
      ctx.setTransform(ds, 0, 0, ds, (pv.x - this.view.x) * ds, (pv.y - this.view.y) * ds);
    }

    levelFor(ds) {
      if (this.interacting && this.gestureLevel) {
        const r = ds / this.gestureLevel;
        if (r > 0.45 && r < 2.2) return this.gestureLevel;
      }
      const k = Math.ceil(Math.log2(ds) * 2 - 0.05);
      return U.clamp(Math.pow(2, k / 2), 0.125, 16);
    }
    beginInteraction() {
      this.interacting = true;
      this.gestureLevel = this.lastLevel || this.levelFor(this.view.s * this.dpr);
    }
    endInteraction() {
      this.interacting = false;
      this.gestureLevel = 0;
      this.baseDirty = true;
      this.requestDraw();
    }

    requestDraw(liveOnly) {
      if (!liveOnly) this.baseDirty = true;
      this.liveDirty = true;
      if (!this.frameReq) this.frameReq = requestAnimationFrame(() => this.draw());
    }
    requestLive() {
      this.liveDirty = true;
      if (!this.frameReq) this.frameReq = requestAnimationFrame(() => this.draw());
    }

    draw() {
      cancelAnimationFrame(this.frameReq);
      this.frameReq = 0;
      this.frame++;
      if (this.onFrame) this.onFrame();
      if (this.baseDirty) this.drawBase();
      if (this.liveDirty) {
        this.liveDirty = false;
        const g = this.lctx;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, this.live.width, this.live.height);
        if (this.liveDraw) this.liveDraw(g, this);
      }
    }

    tileRange(pv, L) {
      const v = this.view;
      const tpt = TILE / L;
      const x0 = Math.max(0, v.x - pv.x);
      const y0 = Math.max(0, v.y - pv.y);
      const x1 = Math.min(pv.w, v.x + this.vw / v.s - pv.x);
      const y1 = Math.min(pv.h, v.y + this.vh / v.s - pv.y);
      if (x1 <= x0 || y1 <= y0) return null;
      return [Math.floor(x0 / tpt), Math.floor(y0 / tpt), Math.floor((x1 - 1e-6) / tpt), Math.floor((y1 - 1e-6) / tpt)];
    }

    drawBase() {
      this.baseDirty = false;
      const t0 = U.now();
      const g = this.bctx;
      const v = this.view;
      const dpr = this.dpr;
      const ds = v.s * dpr;
      const W = this.base.width;
      const H = this.base.height;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = this.workspace;
      g.fillRect(0, 0, W, H);
      const L = this.levelFor(ds);
      const vis = this.visible();
      const tpt = TILE / L;
      const need = [];
      const cxDoc = v.x + this.vw / v.s / 2;
      const cyDoc = v.y + this.vh / v.s / 2;
      for (const pv of vis) {
        const r = this.tileRange(pv, L);
        if (!r) continue;
        const ver = this.ver.get(pv.page.id) || 1;
        for (let ty = r[1]; ty <= r[3]; ty++)
          for (let tx = r[0]; tx <= r[2]; tx++) {
            const key = pv.page.id + '|' + L + '|' + tx + '|' + ty;
            const t = this.tiles.get(key);
            if (t && t.ver === ver) {
              t.last = this.frame;
              continue;
            }
            const mx = pv.x + (tx + 0.5) * tpt;
            const my = pv.y + (ty + 0.5) * tpt;
            need.push({ pv, tx, ty, key, d: (mx - cxDoc) ** 2 + (my - cyDoc) ** 2 });
          }
      }
      const budget = 9;
      if (need.length && !this.interacting) {
        need.sort((a, b) => a.d - b.d);
        let i = 0;
        for (; i < need.length; i++) {
          if (i > 0 && U.now() - t0 > budget) break;
          this.renderTile(need[i].pv, L, need[i].tx, need[i].ty, need[i].key);
        }
        need.splice(0, i);
      }
      const missing = new Set(need.map((n) => n.pv.page.id));
      for (const pv of vis) {
        const X0 = (pv.x - v.x) * ds;
        const Y0 = (pv.y - v.y) * ds;
        const PW = pv.w * ds;
        const PH = pv.h * ds;
        g.fillStyle = this.shadow;
        g.fillRect(Math.round(X0) - 1, Math.round(Y0), Math.round(PW) + 2, Math.round(PH) + 2);
        g.fillRect(Math.round(X0), Math.round(Y0) + 2, Math.round(PW), Math.round(PH) + 1);
        if (missing.has(pv.page.id)) this.drawFallback(g, pv, X0, Y0, PW, PH, L);
        const r = this.tileRange(pv, L);
        if (!r) continue;
        const ver = this.ver.get(pv.page.id) || 1;
        const tds = (TILE * ds) / L;
        for (let ty = r[1]; ty <= r[3]; ty++)
          for (let tx = r[0]; tx <= r[2]; tx++) {
            const t = this.tiles.get(pv.page.id + '|' + L + '|' + tx + '|' + ty);
            if (!t || t.ver !== ver) continue;
            const dx0 = Math.round(X0 + tx * tds);
            const dy0 = Math.round(Y0 + ty * tds);
            const dx1 = Math.round(X0 + (tx + 1) * tds);
            const dy1 = Math.round(Y0 + (ty + 1) * tds);
            g.drawImage(t.c, 0, 0, TILE, TILE, dx0, dy0, dx1 - dx0, dy1 - dy0);
          }
      }
      this.lastLevel = L;
      if (need.length) {
        this.baseDirty = true;
        if (!this.frameReq) this.frameReq = requestAnimationFrame(() => this.draw());
      } else if (!this.interacting) {
        // idle: refresh one stale thumbnail (visible pages first), once edits have settled
        const left = 12 - (U.now() - t0);
        const quiet = U.now() - this.lastChange;
        if (quiet < 900) {
          clearTimeout(this._thumbTimer);
          this._thumbTimer = setTimeout(() => this.requestDraw(), 950 - quiet);
        } else if (left > 4) {
          const stale = this.staleThumb(vis);
          if (stale) {
            this.renderThumb(stale);
            if (this.onThumb) this.onThumb(stale);
            if (this.staleThumb(vis) && !this.frameReq) {
              this.baseDirty = true;
              this.frameReq = requestAnimationFrame(() => this.draw());
            }
          }
        }
      }
      this.evictTiles();
    }

    drawFallback(g, pv, X0, Y0, PW, PH, L) {
      const th = this.thumbs.get(pv.page.id);
      g.save();
      g.beginPath();
      g.rect(Math.max(0, X0), Math.max(0, Y0), Math.min(this.base.width, X0 + PW) - Math.max(0, X0), Math.min(this.base.height, Y0 + PH) - Math.max(0, Y0));
      g.clip();
      const thumb = th ? th.c : this.renderThumb(pv.page);
      g.imageSmoothingEnabled = true;
      g.drawImage(thumb, X0, Y0, PW, PH);
      // sharper stand-ins: valid tiles from other zoom levels, coarse first
      const ver = this.ver.get(pv.page.id) || 1;
      const ds = this.view.s * this.dpr;
      const alt = [];
      for (const t of this.tiles.values()) if (t.pid === pv.page.id && t.ver === ver && t.L !== L) alt.push(t);
      alt.sort((a, b) => a.L - b.L);
      for (const t of alt) {
        const tds = (TILE * ds) / t.L;
        const dx = X0 + t.tx * tds;
        const dy = Y0 + t.ty * tds;
        if (dx > this.base.width || dy > this.base.height || dx + tds < 0 || dy + tds < 0) continue;
        g.drawImage(t.c, dx, dy, tds, tds);
      }
      g.restore();
    }

    renderTile(pv, L, tx, ty, key) {
      const page = pv.page;
      let t = this.tiles.get(key);
      const c = t ? t.c : this.pool.pop() || U.makeCanvas(TILE, TILE);
      const g = c.getContext('2d');
      const tpt = TILE / L;
      const rect = [tx * tpt, ty * tpt, (tx + 1) * tpt, (ty + 1) * tpt];
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, TILE, TILE);
      g.setTransform(L, 0, 0, L, -rect[0] * L, -rect[1] * L);
      g.save();
      g.beginPath();
      g.rect(0, 0, page.w, page.h);
      g.clip();
      R.drawPage(g, page, rect, L, { hidden: this.hidden });
      g.restore();
      if (!t) {
        t = { c, pid: page.id, L, tx, ty, rect, ver: 0, last: 0 };
        this.tiles.set(key, t);
      }
      t.rect = rect;
      t.ver = this.ver.get(page.id) || 1;
      t.last = this.frame;
    }

    recycle(c) {
      if (this.pool.length < 10) this.pool.push(c);
      else U.freeCanvas(c);
    }

    evictTiles() {
      if (this.tiles.size <= MAX_TILES) return;
      const arr = Array.from(this.tiles.entries()).filter(([, t]) => t.last !== this.frame);
      arr.sort((a, b) => {
        // stale tiles first, then least recently used
        const sa = a[1].ver !== (this.ver.get(a[1].pid) || 1) ? 0 : 1;
        const sb = b[1].ver !== (this.ver.get(b[1].pid) || 1) ? 0 : 1;
        return sa - sb || a[1].last - b[1].last;
      });
      let n = this.tiles.size - MAX_TILES;
      for (const [k, t] of arr) {
        if (n <= 0) break;
        this.tiles.delete(k);
        this.recycle(t.c);
        n--;
      }
    }

    staleThumb(vis) {
      for (const pv of vis) {
        const th = this.thumbs.get(pv.page.id);
        if (!th || th.ver !== (this.ver.get(pv.page.id) || 1)) return pv.page;
      }
      return null;
    }
    renderThumb(page) {
      const scale = THUMB_W / Math.max(page.w, page.h * 0.75);
      let th = this.thumbs.get(page.id);
      const w = Math.round(page.w * scale);
      const h = Math.round(page.h * scale);
      const c = th ? th.c : U.makeCanvas(w, h);
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      const g = c.getContext('2d');
      g.setTransform(w / page.w, 0, 0, h / page.h, 0, 0);
      R.drawPage(g, page, [0, 0, page.w, page.h], scale);
      if (!th) {
        th = { c, ver: 0 };
        this.thumbs.set(page.id, th);
      }
      th.ver = this.ver.get(page.id) || 1;
      return c;
    }
    thumbCanvas(page) {
      const th = this.thumbs.get(page.id);
      if (th && th.ver === (this.ver.get(page.id) || 1)) return th.c;
      return this.renderThumb(page);
    }
  }
  R.Renderer = Renderer;
})((window.Q = window.Q || {}));
