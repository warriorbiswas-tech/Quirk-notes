(function (Q) {
  'use strict';
  const U = Q.util;
  const M = Q.model;
  const I = Q.ink;
  const R = Q.render;
  const UI = Q.ui;
  const h = U.h;
  const E = Q.Editor.prototype;

  const TOOLS = [
    { id: 'pen', icon: 'pen', label: 'Pen', key: 'P' },
    { id: 'hl', icon: 'highlighter', label: 'Highlighter', key: 'H' },
    { id: 'eraser', icon: 'eraser', label: 'Eraser', key: 'E' },
    { id: 'lasso', icon: 'lasso', label: 'Lasso', key: 'L' },
    { id: 'shape', icon: 'shapes', label: 'Shapes', key: 'S' },
    { id: 'text', icon: 'text', label: 'Text', key: 'T' },
  ];
  const LASER_COLORS = ['#FF3B30', '#34C759', '#0A84FF', '#FF9F0A'];
  const eqc = (a, b) => String(a).toUpperCase() === String(b).toUpperCase();
  const noFocus = (e) => e.preventDefault();

  E.buildChrome = function () {
    const back = h('button', { class: 'ed-back', 'aria-label': 'Back to library', onclick: () => this.app.closeEditor() }, Q.icon('back'), h('span', { class: 'ed-back-label' }, 'Library'));
    this.titleBtn = h('button', { class: 'ed-title', title: 'Rename notebook', onclick: () => this.renameNotebook() }, this.meta.title);
    this.saveDot = h('span', { class: 'save-state', 'aria-live': 'polite' });
    const left = h('div', { class: 'ed-left' }, back, h('div', { class: 'ed-title-wrap' }, this.titleBtn, this.saveDot));
    this.toolBtns = {};
    const tools = h('div', { class: 'ed-tools', role: 'toolbar', 'aria-label': 'Tools' });
    for (const t of TOOLS) {
      const b = h('button', { class: 'tool', 'aria-label': t.label, title: `${t.label} (${t.key})`, onclick: () => this.onToolButton(t.id, b) }, Q.icon(t.icon), h('span', { class: 'tool-dot' }));
      this.toolBtns[t.id] = b;
      tools.appendChild(b);
    }
    tools.appendChild(h('span', { class: 'tool-sep', 'aria-hidden': 'true' }));
    const imgBtn = h('button', { class: 'tool', 'aria-label': 'Insert image', title: 'Insert image', onclick: () => this.pickImage() }, Q.icon('image'));
    const stkBtn = h('button', { class: 'tool', 'aria-label': 'Stickers', title: 'Stickers', onclick: () => this.openStickers(stkBtn) }, Q.icon('sticker'));
    const lasBtn = h('button', { class: 'tool', 'aria-label': 'Laser pointer', title: 'Laser pointer (K)', onclick: () => this.onToolButton('laser', lasBtn) }, Q.icon('laser'));
    this.toolBtns.laser = lasBtn;
    tools.append(imgBtn, stkBtn, lasBtn);
    this.undoBtn = h('button', { class: 'icon-btn', 'aria-label': 'Undo', title: 'Undo (two-finger tap)', onclick: () => this.undo() }, Q.icon('undo'));
    this.redoBtn = h('button', { class: 'icon-btn', 'aria-label': 'Redo', title: 'Redo (three-finger tap)', onclick: () => this.redo() }, Q.icon('redo'));
    this.navBtn = h('button', { class: 'icon-btn', 'aria-label': 'Pages', title: 'Pages', onclick: () => this.toggleNav() }, Q.icon('pages'));
    const addBtn = h('button', { class: 'icon-btn', 'aria-label': 'Add page', title: 'Add page', onclick: () => this.openAddPage(addBtn) }, Q.icon('addPage'));
    const moreBtn = h('button', { class: 'icon-btn', 'aria-label': 'More', title: 'More', onclick: () => this.openMore(moreBtn) }, Q.icon('more'));
    const right = h('div', { class: 'ed-right' }, this.undoBtn, this.redoBtn, h('span', { class: 'tool-sep' }), this.navBtn, addBtn, moreBtn);
    this.bar = h('header', { class: 'ed-bar' }, left, tools, right);
    this.sub = h('div', { class: 'ed-sub', role: 'toolbar', 'aria-label': 'Tool options' });
    this.main = h('div', { class: 'ed-main' });
    this.nav = h('aside', { class: 'ed-nav', hidden: true, 'aria-label': 'Pages' });
    this.main.appendChild(this.nav);
    this.root.append(this.bar, this.sub, this.main);
  };

  E.buildOverlays = function () {
    this.selBar = h('div', { class: 'selbar', hidden: true, role: 'toolbar', 'aria-label': 'Selection' });
    this.zoomBadge = h('button', { class: 'zoom-badge', 'aria-label': 'Reset zoom', onclick: () => this.zoomTo(this.renderer.fitScale()) });
    this.pageBadge = h('button', { class: 'page-badge', 'aria-label': 'Pages', onclick: () => this.toggleNav() });
    this.flashEl = h('div', { class: 'ed-flash', 'aria-hidden': 'true' });
    this.view.append(this.selBar, this.zoomBadge, this.pageBadge, this.flashEl);
  };

  E.destroyChrome = function () {
    if (this.navIO) this.navIO.disconnect();
    UI.closeAll();
  };

  E.onToolButton = function (id, btn) {
    if (id === this.tool) {
      if (id === 'pen') this.openPenKinds(btn);
      return;
    }
    this.setTool(id);
  };

  E.updateChrome = function () {
    if (!this.toolBtns) return;
    const T = this.tools;
    for (const id in this.toolBtns) {
      const b = this.toolBtns[id];
      const on = id === this.tool;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      const dot = b.querySelector('.tool-dot');
      if (dot) {
        const c = id === 'pen' ? T.pen.color : id === 'hl' ? T.hl.color : id === 'shape' ? T.shape.color : null;
        dot.style.background = c || 'transparent';
        dot.hidden = !c;
      }
    }
    this.undoBtn.disabled = !this.history.canUndo;
    this.redoBtn.disabled = !this.history.canRedo;
    this.navBtn.classList.toggle('on', !this.nav.hidden);
    const key = [this.tool, JSON.stringify(T[this.tool === 'shape' ? 'shape' : this.tool] || {}), JSON.stringify(T.pen.colors), JSON.stringify(T.pen.sizes), !!Q.clipboard, !!this.textEdit, this.textEdit ? JSON.stringify([this.textEdit.el.f, this.textEdit.el.s, this.textEdit.el.c, this.textEdit.el.b, this.textEdit.el.al]) : ''].join('|');
    if (key !== this.subKey) {
      this.subKey = key;
      this.renderSub();
    }
    this.updatePageBadge();
  };

  E.updatePageBadge = function () {
    if (!this.pageBadge) return;
    const i = this.renderer.currentIndex();
    const txt = i + 1 + ' / ' + this.pages.length;
    if (this.pageBadge.textContent !== txt) this.pageBadge.textContent = txt;
    if (this.navCur !== i) {
      this.navCur = i;
      if (!this.nav.hidden) for (const it of this.nav.querySelectorAll('.nav-item')) it.classList.toggle('cur', it.dataset.id === (this.pages[i] && this.pages[i].id));
    }
  };

  E.showZoom = function () {
    const r = this.renderer;
    this.zoomBadge.textContent = Math.round((r.view.s / r.fitScale()) * 100) + '%';
    this.zoomBadge.classList.add('show');
    clearTimeout(this._zoomT);
    this._zoomT = setTimeout(() => this.zoomBadge.classList.remove('show'), 1100);
  };

  E.flash = function (txt) {
    this.flashEl.textContent = txt;
    this.flashEl.classList.remove('show');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('show');
  };

  E.setSaveState = function (st) {
    clearTimeout(this._saveT);
    this.saveDot.className = 'save-state ' + st;
    this.saveDot.textContent = st === 'error' ? 'Not saved' : 'Saved';
    if (st === 'saved') this._saveT = setTimeout(() => (this.saveDot.className = 'save-state'), 1400);
  };

  E.renameNotebook = async function () {
    const v = await UI.prompt({ title: 'Rename notebook', value: this.meta.title, ok: 'Rename' });
    if (!v) return;
    this.meta.title = v;
    this.titleBtn.textContent = v;
    this.metaDirty = true;
    this.saveSoon();
  };

  E.renderSub = function () {
    const T = this.tools;
    const sub = U.clear(this.sub);
    const save = () => {
      this.app.saveSettingsSoon();
      this.updateChrome();
    };
    const sep = () => h('span', { class: 'sub-sep' });
    const hint = (t) => h('span', { class: 'sub-hint' }, t);
    switch (this.tool) {
      case 'pen': {
        const kind = M.PEN_KINDS.find((k) => k.id === T.pen.kind) || M.PEN_KINDS[0];
        const pv = U.makeCanvas(88, 36);
        pv.className = 'kind-prev';
        const kb = h('button', { class: 'kind-btn', 'aria-label': 'Pen type: ' + kind.name, onclick: () => this.openPenKinds(kb) }, pv, h('span', { class: 'kind-name' }, kind.name), Q.icon('chevronDown'));
        sub.append(kb, sep());
        sub.appendChild(this.swatchRow(T.pen.colors, T.pen.color, (c) => { T.pen.color = c; save(); }, (i, c) => { T.pen.colors[i] = c; T.pen.color = c; save(); }));
        sub.appendChild(sep());
        sub.appendChild(this.sizeRow(T.pen.sizes, T.pen.size, T.pen.color, [0.3, 8, 0.1], (s) => { T.pen.size = s; save(); }, (i, s) => { T.pen.sizes[i] = s; T.pen.size = s; }, save));
        requestAnimationFrame(() => I.preview(pv, T.pen.kind, this.isDarkUI() ? '#E8EEEA' : T.pen.color, Math.min(2.6, T.pen.size), false));
        break;
      }
      case 'hl': {
        sub.appendChild(this.swatchRow(T.hl.colors, T.hl.color, (c) => { T.hl.color = c; save(); }, (i, c) => { T.hl.colors[i] = c; T.hl.color = c; save(); }, M.HL_COLORS));
        sub.appendChild(sep());
        sub.appendChild(this.sizeRow(T.hl.sizes, T.hl.size, T.hl.color, [4, 40, 1], (s) => { T.hl.size = s; save(); }, (i, s) => { T.hl.sizes[i] = s; T.hl.size = s; }, save, true));
        sub.appendChild(sep());
        sub.appendChild(this.chip('Straight lines', T.hl.straight, (v) => { T.hl.straight = v; save(); }, 'ruler'));
        break;
      }
      case 'shape': {
        sub.appendChild(this.swatchRow(T.pen.colors, T.shape.color, (c) => { T.shape.color = c; save(); }, (i, c) => { T.pen.colors[i] = c; T.shape.color = c; save(); }));
        sub.appendChild(sep());
        sub.appendChild(this.sizeRow(T.pen.sizes, T.shape.size, T.shape.color, [0.3, 8, 0.1], (s) => { T.shape.size = s; save(); }, (i, s) => { T.pen.sizes[i] = s; T.shape.size = s; }, save));
        sub.appendChild(sep());
        sub.appendChild(hint('Draw a line, circle, triangle or box. It snaps into shape when you lift.'));
        break;
      }
      case 'eraser': {
        sub.appendChild(UI.seg([{ id: 'stroke', label: 'Whole stroke' }, { id: 'precise', label: 'Precise' }], T.eraser.mode, (v) => { T.eraser.mode = v; save(); }, { small: true, label: 'Eraser type' }));
        sub.appendChild(sep());
        sub.appendChild(this.sizeRow(T.eraser.sizes, T.eraser.size, null, [2, 60, 1], (s) => { T.eraser.size = s; save(); }, (i, s) => { T.eraser.sizes[i] = s; T.eraser.size = s; }, save, false, true));
        sub.appendChild(sep());
        sub.appendChild(this.chip('Highlighter only', T.eraser.hlOnly, (v) => { T.eraser.hlOnly = v; save(); }, 'highlighter'));
        sub.appendChild(this.chip('Switch back after erasing', T.eraser.auto, (v) => { T.eraser.auto = v; save(); }, 'restore'));
        break;
      }
      case 'lasso': {
        sub.appendChild(hint('Circle anything to select it, or tap an item to pick it up.'));
        if (Q.clipboard) {
          sub.appendChild(sep());
          sub.appendChild(h('button', { class: 'chip', onclick: () => this.paste() }, Q.icon('copy'), h('span', null, 'Paste')));
        }
        break;
      }
      case 'text': {
        const te = this.textEdit;
        const cur = te ? te.el : { f: T.text.font, s: T.text.size, c: T.text.color, b: T.text.bold ? 1 : 0, al: T.text.align };
        const setStyle = (patch) => {
          if ('f' in patch) T.text.font = patch.f;
          if ('s' in patch) T.text.size = patch.s;
          if ('c' in patch) T.text.color = patch.c;
          if ('b' in patch) T.text.bold = !!patch.b;
          if ('al' in patch) T.text.align = patch.al;
          if (this.textEdit) {
            this.textEdit.el = Object.assign({}, this.textEdit.el, patch);
            this.styleText();
          }
          save();
        };
        const fb = h('button', { class: 'kind-btn', onpointerdown: noFocus, onclick: () => {
          UI.menu(fb, Object.keys(M.FONTS).map((k) => ({ label: M.FONTS[k].name, checked: k === cur.f, onClick: () => setStyle({ f: k }) })), { focus: false });
        } }, h('span', { class: 'kind-name', style: { fontFamily: M.fontCss(cur.f) } }, M.FONTS[cur.f] ? M.FONTS[cur.f].name : 'Sans'), Q.icon('chevronDown'));
        const sizes = [10, 12, 14, 16, 18, 21, 24, 28, 32, 40, 48, 60, 72];
        const step = (d) => {
          const i = sizes.findIndex((s) => s >= cur.s);
          const ni = U.clamp((i < 0 ? sizes.length - 1 : i) + d, 0, sizes.length - 1);
          setStyle({ s: sizes[ni] === cur.s ? sizes[U.clamp(ni + d, 0, sizes.length - 1)] : sizes[ni] });
        };
        const stepper = h('div', { class: 'stepper' },
          h('button', { class: 'icon-btn sm', 'aria-label': 'Smaller text', onpointerdown: noFocus, onclick: () => step(-1) }, '−'),
          h('span', { class: 'stepper-val' }, Math.round(cur.s) + ' pt'),
          h('button', { class: 'icon-btn sm', 'aria-label': 'Larger text', onpointerdown: noFocus, onclick: () => step(1) }, '+'));
        const colorBtn = h('button', { class: 'sw on', style: { '--c': cur.c }, 'aria-label': 'Text colour', onpointerdown: noFocus, onclick: () => this.editSwatch(colorBtn, cur.c, (c) => setStyle({ c })) });
        const boldBtn = h('button', { class: 'icon-btn sm' + (cur.b ? ' on' : ''), 'aria-label': 'Bold', 'aria-pressed': cur.b ? 'true' : 'false', onpointerdown: noFocus, onclick: () => setStyle({ b: cur.b ? 0 : 1 }) }, Q.icon('bold'));
        const al = UI.seg([{ id: 'l', icon: 'alignLeft', title: 'Align left', iconOnly: true }, { id: 'c', icon: 'alignCenter', title: 'Centre', iconOnly: true }, { id: 'r', icon: 'alignRight', title: 'Align right', iconOnly: true }], cur.al || 'l', (v) => setStyle({ al: v }), { small: true, label: 'Alignment' });
        for (const b of al.querySelectorAll('button')) b.addEventListener('pointerdown', noFocus);
        sub.append(fb, sep(), stepper, sep(), colorBtn, boldBtn, al);
        if (te) {
          sub.appendChild(sep());
          sub.appendChild(h('button', { class: 'chip primary', onpointerdown: noFocus, onclick: () => this.finishText() }, h('span', null, 'Done')));
        } else {
          sub.appendChild(sep());
          sub.appendChild(hint('Tap the page to type.'));
        }
        break;
      }
      case 'laser': {
        sub.appendChild(this.swatchRow(LASER_COLORS, T.laser.color, (c) => { T.laser.color = c; save(); }, null));
        sub.appendChild(sep());
        sub.appendChild(hint('Point things out. The trail fades on its own.'));
        break;
      }
    }
  };

  E.isDarkUI = () => document.documentElement.dataset.dark === '1';

  E.chip = function (label, on, onToggle, icon) {
    const b = h('button', { class: 'chip' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', onclick: () => onToggle(!on) }, icon ? Q.icon(icon) : null, h('span', null, label));
    return b;
  };

  E.swatchRow = function (colors, current, onPick, onEdit, palette) {
    const row = h('div', { class: 'sw-row' });
    colors.forEach((c, i) => {
      const b = h('button', {
        class: 'sw' + (eqc(c, current) ? ' on' : ''),
        style: { '--c': c },
        'aria-label': 'Colour ' + c + (eqc(c, current) && onEdit ? ', tap to change' : ''),
        title: c,
        onclick: () => {
          if (eqc(c, current) && onEdit) this.editSwatch(b, c, (nc) => onEdit(i, nc), palette);
          else onPick(c);
        },
      });
      row.appendChild(b);
    });
    if (onEdit) {
      const more = h('button', { class: 'sw sw-more', 'aria-label': 'More colours', title: 'More colours', onclick: () => this.editSwatch(more, current, (nc) => onPick(nc), palette) }, Q.icon('palette'));
      row.appendChild(more);
    }
    return row;
  };

  E.editSwatch = function (anchor, color, cb, palette) {
    const S = this.settings;
    UI.colorPicker(anchor, {
      color,
      palette: palette || M.INK,
      onChange: (c, final) => {
        if (final) cb(c);
      },
      custom: () => S.customColors,
      onSaveCustom: (c) => {
        S.customColors = [c].concat(S.customColors.filter((x) => !eqc(x, c))).slice(0, 11);
        this.app.saveSettingsSoon();
      },
    });
  };

  E.sizeRow = function (sizes, current, color, range, onPick, onEdit, onDone, hl, eraser) {
    const row = h('div', { class: 'size-row' });
    const max = Math.max(...sizes);
    sizes.forEach((s, i) => {
      const d = eraser ? 6 + (i / (sizes.length - 1)) * 12 : hl ? 6 + (s / max) * 12 : 3 + Math.min(1, s / max) * 12;
      const dot = h('span', { class: 'size-dot' + (eraser ? ' ring' : '') + (hl ? ' bar' : ''), style: { width: d + 'px', height: (hl ? Math.max(4, d * 0.55) : d) + 'px', background: eraser ? 'transparent' : color || 'currentColor' } });
      const on = Math.abs(s - current) < 1e-6;
      const b = h('button', {
        class: 'size' + (on ? ' on' : ''),
        'aria-label': 'Size ' + s + ' pt' + (on ? ', tap to adjust' : ''),
        title: s + ' pt',
        onclick: () => {
          if (on) this.sizePopover(b, s, range, (v) => onEdit(i, v), onDone);
          else onPick(s);
        },
      }, dot);
      row.appendChild(b);
    });
    return row;
  };

  E.sizePopover = function (anchor, value, range, onInput, onDone) {
    const label = h('div', { class: 'pop-title' }, 'Size');
    const slider = UI.slider(range[0], range[1], range[2], value, (v) => onInput(v), (v) => (range[2] < 1 ? v.toFixed(1) : String(Math.round(v))) + ' pt');
    UI.popover(anchor, h('div', { class: 'size-pop' }, label, slider), { onClose: () => onDone && onDone() });
  };

  E.openPenKinds = function (anchor) {
    const T = this.tools;
    const list = h('div', { class: 'kind-list' });
    let pop;
    for (const k of M.PEN_KINDS) {
      const c = U.makeCanvas(150, 40);
      c.className = 'kind-prev wide';
      const b = h('button', {
        class: 'kind-item' + (k.id === T.pen.kind ? ' on' : ''),
        onclick: () => {
          T.pen.kind = k.id;
          this.app.saveSettingsSoon();
          this.updateChrome();
          pop.close();
        },
      }, c, h('span', null, k.name), k.id === T.pen.kind ? Q.icon('check') : null);
      list.appendChild(b);
      requestAnimationFrame(() => I.preview(c, k.id, this.isDarkUI() ? '#E8EEEA' : T.pen.color, 2.4, false));
    }
    pop = UI.popover(anchor, h('div', null, h('div', { class: 'pop-title' }, 'Pen type'), list), { className: 'pop-kinds' });
  };

  E.showSelBar = function () {
    const sel = this.sel;
    if (!sel) return;
    const bar = U.clear(this.selBar);
    const btn = (icon, label, fn, cls) => h('button', { class: 'sb-btn' + (cls ? ' ' + cls : ''), 'aria-label': label, title: label, onclick: fn }, Q.icon(icon), h('span', null, label));
    const recolorable = sel.els.some((e) => e.t === 's' || e.t === 't');
    bar.append(btn('cut', 'Cut', () => this.cutSel()), btn('copy', 'Copy', () => this.copySel()), btn('duplicate', 'Duplicate', () => this.duplicateSel()));
    if (recolorable) {
      const first = sel.els.find((e) => e.t === 's' || e.t === 't');
      const cb = btn('drop', 'Colour', () => this.editSwatch(cb, first.c, (c) => this.recolorSel(c)));
      bar.appendChild(cb);
    }
    if (sel.single && sel.single.t === 't') bar.appendChild(btn('rename', 'Edit', () => {
      const el = sel.single;
      const pv = this.pvFor(sel.pageId);
      this.clearSelection();
      this.openText(pv, this.page(pv.page.id).els.find((e) => e.id === el.id));
    }));
    bar.appendChild(btn('front', 'To front', () => this.frontSel()));
    bar.appendChild(btn('trash', 'Delete', () => this.deleteSel(), 'danger'));
    bar.hidden = false;
    this.positionSelBar();
  };
  E.hideSelBar = function () {
    this.selBar.hidden = true;
  };
  E.positionSelBar = function () {
    if (!this.sel || this.selBar.hidden) return;
    const g = this.selScreenGeom();
    if (!g) return;
    let minY = Infinity;
    let maxY = -Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of g.pts.concat([g.rot])) {
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
    }
    const bw = this.selBar.offsetWidth;
    const bh = this.selBar.offsetHeight;
    const vw = this.renderer.vw;
    const vh = this.renderer.vh;
    let top = minY - bh - 12;
    if (top < 8) top = maxY + 14;
    if (top + bh > vh - 8) top = Math.max(8, Math.min(vh - bh - 8, (minY + maxY) / 2 - bh / 2));
    const left = U.clamp((minX + maxX) / 2 - bw / 2, 8, Math.max(8, vw - bw - 8));
    this.selBar.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  };

  E.positionOverlays = function () {
    this.positionSelBar();
    this.positionText();
  };

  E.offerPaste = function (sx, sy, pv, px, py) {
    const rect = this.view.getBoundingClientRect();
    const anchor = { left: rect.left + sx, right: rect.left + sx, top: rect.top + sy, bottom: rect.top + sy, width: 0, height: 0 };
    UI.menu(anchor, [{ label: 'Paste here', icon: 'copy', onClick: () => this.paste({ pageId: pv.page.id, x: px, y: py }) }]);
  };

  E.openText = function (pv, el, isNew) {
    this.finishText();
    if (this.sel) this.clearSelection();
    if (this.tool !== 'text' && isNew) this.setTool('text');
    const ta = h('textarea', { class: 'ed-text', spellcheck: true, autocapitalize: 'sentences', 'aria-label': 'Text box', rows: 1, placeholder: U.isTouch() && !U.isAndroid() ? 'Type, or write here with Apple Pencil' : 'Type here' });
    ta.value = el.txt || '';
    this.textEdit = { pvId: pv.page.id, el: Object.assign({}, el), isNew: !!isNew, ta, orig: el };
    if (!isNew) this.renderer.setHidden([el.id]);
    ta.addEventListener('input', () => this.styleText());
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.finishText();
      }
      e.stopPropagation();
    });
    ta.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.view.appendChild(ta);
    this.styleText();
    ta.focus({ preventScroll: true });
    const end = ta.value.length;
    try {
      ta.setSelectionRange(end, end);
    } catch (e) {}
    this.updateChrome();
    setTimeout(() => this.keepTextVisible(), 350);
  };
  E.styleText = function () {
    const te = this.textEdit;
    if (!te) return;
    const el = te.el;
    const ta = te.ta;
    const s = this.renderer.view.s;
    ta.style.fontFamily = M.fontCss(el.f);
    ta.style.fontWeight = el.b ? '700' : '400';
    ta.style.fontSize = el.s * s + 'px';
    ta.style.color = el.c;
    ta.style.textAlign = el.al === 'c' ? 'center' : el.al === 'r' ? 'right' : 'left';
    ta.style.width = el.w * s + 'px';
    ta.style.height = 'auto';
    // an empty box is taller so there is room to write into it with Apple Pencil (Scribble)
    ta.style.height = Math.max(el.s * 1.32 * s * (ta.value ? 1 : 2.6), ta.scrollHeight) + 'px';
    this.positionText();
  };
  E.positionText = function () {
    const te = this.textEdit;
    if (!te) return;
    const pv = this.pvFor(te.pvId);
    if (!pv) return;
    const el = te.el;
    const r = el.r || 0;
    // screen position of the box's (rotated) top-left corner
    const h0 = el.h || el.s * 1.32;
    const cx = el.x + el.w / 2;
    const cy = el.y + h0 / 2;
    const c = Math.cos(r);
    const s = Math.sin(r);
    const tlx = cx + (-el.w / 2) * c - (-h0 / 2) * s;
    const tly = cy + (-el.w / 2) * s + (-h0 / 2) * c;
    const [sx, sy] = this.pageToScreen(pv, tlx, tly);
    te.ta.style.transform = `translate(${sx}px, ${sy}px) rotate(${r}rad)`;
    if (Math.abs(parseFloat(te.ta.style.fontSize) - el.s * this.renderer.view.s) > 0.01) this.styleText();
  };
  E.keepTextVisible = function () {
    const te = this.textEdit;
    if (!te) return;
    const vv = window.visualViewport;
    const visibleBottom = vv ? vv.height + vv.offsetTop : window.innerHeight;
    const rect = te.ta.getBoundingClientRect();
    const over = rect.bottom + 24 - visibleBottom;
    if (over > 0) {
      const r = this.renderer;
      r.setView(r.view.s, r.view.x, r.view.y + over / r.view.s);
    }
  };
  E.finishText = function () {
    const te = this.textEdit;
    if (!te) return;
    this.textEdit = null;
    const raw = te.ta.value.replace(/\s+$/, '');
    te.ta.remove();
    this.renderer.setHidden(this.sel ? Array.from(this.sel.ids) : []);
    const page = this.page(te.pvId);
    if (!page) return;
    if (!raw.trim()) {
      if (!te.isNew) this.commit(this.replacePage(this.pages, M.withEls(page, page.els.filter((e) => e.id !== te.el.id))));
      this.updateChrome();
      return;
    }
    const n = Object.assign({}, te.el, { txt: raw });
    n.h = R.textHeight(n);
    if (te.isNew) this.commit(this.replacePage(this.pages, M.withEls(page, page.els.concat([n]))));
    else {
      const o = te.orig;
      const same = o.txt === n.txt && o.f === n.f && o.s === n.s && o.c === n.c && o.b === n.b && o.al === n.al;
      if (!same) this.commit(this.replacePage(this.pages, M.withEls(page, page.els.map((e) => (e.id === n.id ? n : e)))));
    }
    this.updateChrome();
  };

  E.openStickers = function (anchor) {
    const grid = h('div', { class: 'stk-grid' });
    let pop;
    const show = (cat) => {
      U.clear(grid);
      for (const def of Q.stickers.inCat(cat)) {
        const c = U.makeCanvas(cat === 'tape' || cat === 'labels' ? 200 : 112, cat === 'tape' || cat === 'labels' ? 80 : 112);
        Q.stickers.thumb(c, def);
        grid.appendChild(h('button', {
          class: 'stk' + (cat === 'tape' || cat === 'labels' ? ' wide' : ''),
          'aria-label': def.name,
          title: def.name,
          onclick: () => {
            pop.close();
            this.insertSticker(def);
          },
        }, c));
      }
      this.stickerCat = cat;
    };
    const seg = UI.seg(Q.stickers.CATS.map((c) => ({ id: c.id, label: c.name })), this.stickerCat || 'marks', show, { small: true, label: 'Sticker category' });
    pop = UI.popover(anchor, h('div', { class: 'stk-pop' }, seg, grid), { className: 'pop-stk' });
    show(this.stickerCat || 'marks');
    pop.reposition();
  };

  E.pickImage = async function () {
    const files = await Q.io.pickFiles('image/*', false);
    if (files[0]) await this.insertImageFile(files[0]);
  };

  E.openMore = function (anchor) {
    const page = this.currentPage();
    const idx = this.pageIndex(page.id);
    UI.menu(anchor, [
      { header: `Page ${idx + 1} of ${this.pages.length}` },
      { label: 'Export…', icon: 'share', onClick: () => this.openExport() },
      { label: page.bm ? 'Remove bookmark' : 'Bookmark page', icon: page.bm ? 'bookmarkFill' : 'bookmark', onClick: () => this.toggleBookmark(page.id) },
      { label: 'Change template…', icon: 'template', onClick: () => this.openTemplateSheet(page) },
      { label: 'Duplicate page', icon: 'duplicate', onClick: () => this.duplicatePage(page.id) },
      { label: 'Clear page', icon: 'clear', onClick: () => this.clearPage(page.id) },
      { label: 'Delete page', icon: 'trash', danger: true, onClick: () => this.deletePage(page.id) },
      { sep: true },
      Q.clipboard ? { label: 'Paste', icon: 'copy', onClick: () => this.paste() } : null,
      { label: 'Fit page width', icon: 'fit', hint: '⌘0', onClick: () => this.zoomTo(this.renderer.fitScale()) },
      { label: 'Draw with finger', icon: 'hand', checked: this.fingerDraws(), onClick: () => {
        this.settings.fingerDraw = this.fingerDraws() ? 'off' : 'on';
        this.app.saveSettings();
        Q.ui.toast(this.fingerDraws() ? 'Fingers draw. Use two fingers to scroll.' : `Fingers scroll and zoom. Draw with ${U.stylusName()}.`);
      } },
    ], { align: 'end' });
  };

  E.openAddPage = function (anchor) {
    const cur = this.currentPage();
    const i = this.pageIndex(cur.id);
    UI.menu(anchor, [
      { label: 'New page after this one', icon: 'addPage', onClick: () => this.addPage(null, i + 1) },
      { label: 'New page at the end', icon: 'plus', onClick: () => this.addPage(null, this.pages.length) },
      { label: 'Choose template…', icon: 'template', onClick: () => this.openNewPageSheet(i + 1) },
      { sep: true },
      { label: 'Insert PDF pages…', icon: 'pdf', onClick: () => this.importPdfPages(i + 1) },
      { label: 'Insert images as pages…', icon: 'image', onClick: () => this.importImagePages(i + 1) },
    ], { align: 'end' });
  };

  E.paperState = function (page) {
    const land = page.w > page.h;
    let size = 'a4';
    for (const k in M.PAGE_SIZES) {
      const s = M.PAGE_SIZES[k];
      if ((Math.abs(s.w - page.w) < 2 && Math.abs(s.h - page.h) < 2) || (Math.abs(s.h - page.w) < 2 && Math.abs(s.w - page.h) < 2)) size = k;
    }
    return { tpl: page.bg ? 'ruled' : page.tpl.k, paper: page.bg ? 'white' : page.tpl.c, size, orient: land ? 'l' : 'p', sp: page.bg ? undefined : page.tpl.sp };
  };

  E.openNewPageSheet = function (index) {
    let st = this.paperState(this.currentPage());
    UI.sheet({
      title: 'New page',
      wide: true,
      body: Q.pick.paperPicker(st, (v) => (st = v)),
      actions: [
        { label: 'Cancel' },
        { label: 'Add page', primary: true, onClick: () => { this.addPage({ size: st.size, orient: st.orient, tpl: st.tpl, paper: st.paper, sp: st.sp }, index); } },
      ],
    });
  };

  E.openTemplateSheet = function (page) {
    let st = this.paperState(page);
    let scope = 'page';
    const body = h('div', { class: 'stack' },
      Q.pick.paperPicker(st, (v) => (st = v), { noSize: true }),
      h('div', { class: 'pick-label' }, 'Apply to'),
      UI.seg([{ id: 'page', label: 'This page' }, { id: 'all', label: 'All pages' }], scope, (v) => (scope = v), { small: true }));
    UI.sheet({
      title: 'Page template',
      wide: true,
      body,
      actions: [
        { label: 'Cancel' },
        { label: 'Apply', primary: true, onClick: () => this.setTemplate(scope === 'all' ? this.pages.filter((p) => !p.bg).map((p) => p.id) : [page.id], st.tpl, st.paper, st.sp) },
      ],
    });
  };

  E.importPdfPages = async function (index) {
    const files = await Q.io.pickFiles('application/pdf,.pdf', false);
    if (!files[0]) return;
    const prog = UI.progress({ title: 'Importing PDF', text: 'Opening…', cancellable: true });
    try {
      const pages = await Q.io.importPDF(files[0], (f, t) => prog.set(f, t), prog.signal);
      prog.close();
      if (pages.length) this.insertPages(pages, index == null ? this.pages.length : index);
      UI.toast(U.plural(pages.length, 'page') + ' added');
    } catch (e) {
      prog.close();
      if (e && e.name === 'AbortError') return;
      console.error(e);
      UI.toast(/password/i.test(e && e.message) ? 'That PDF is password-protected.' : 'That PDF couldn’t be opened.', { error: true });
    }
  };
  E.importImagePages = async function (index) {
    const files = await Q.io.pickFiles('image/*', true);
    if (!files.length) return;
    const prog = UI.progress({ title: 'Adding images', text: '' });
    try {
      const pages = await Q.io.imagesToPages(files, (f, t) => prog.set(f, t));
      prog.close();
      this.insertPages(pages, index == null ? this.pages.length : index);
    } catch (e) {
      prog.close();
      UI.toast('Those images couldn’t be added.', { error: true });
    }
  };

  E.openExport = function () {
    const cur = this.renderer.currentIndex();
    const st = { fmt: 'pdf', range: 'all', from: 1, to: this.pages.length, q: 'std', tpl: true };
    const fromIn = h('input', { class: 'field num', type: 'number', min: 1, max: this.pages.length, value: '1', 'aria-label': 'From page' });
    const toIn = h('input', { class: 'field num', type: 'number', min: 1, max: this.pages.length, value: String(this.pages.length), 'aria-label': 'To page' });
    const rangeRow = h('div', { class: 'pick-row', hidden: true }, h('span', null, 'Pages'), fromIn, h('span', null, 'to'), toIn);
    const pdfOpts = h('div', { class: 'stack' },
      h('div', { class: 'pick-label' }, 'Pages'),
      UI.seg([{ id: 'all', label: 'All ' + this.pages.length }, { id: 'cur', label: 'This page' }, { id: 'range', label: 'Range' }], st.range, (v) => { st.range = v; rangeRow.hidden = v !== 'range'; }, { small: true }),
      rangeRow,
      h('div', { class: 'pick-label' }, 'Quality'),
      UI.seg([{ id: 'std', label: 'Standard' }, { id: 'hi', label: 'High' }], st.q, (v) => (st.q = v), { small: true }),
      UI.row('Include paper templates', UI.toggle(st.tpl, (v) => (st.tpl = v), 'Include paper templates')));
    const body = h('div', { class: 'stack' },
      h('div', { class: 'pick-label' }, 'Format'),
      UI.seg([{ id: 'pdf', label: 'PDF' }, { id: 'png', label: 'Image of this page' }], st.fmt, (v) => { st.fmt = v; pdfOpts.hidden = v !== 'pdf'; }, { small: true }),
      pdfOpts);
    UI.sheet({
      title: 'Export',
      body,
      actions: [
        { label: 'Cancel' },
        { label: 'Export', primary: true, onClick: () => { setTimeout(() => this.runExport(st, cur, fromIn, toIn), 50); } },
      ],
    });
  };
  E.runExport = async function (st, cur, fromIn, toIn) {
    await this.flush();
    const title = U.safeFileName(this.meta.title);
    if (st.fmt === 'png') {
      try {
        const blob = await Q.io.exportPNG(this.pages[cur]);
        Q.io.offerFile(blob, `${title} – page ${cur + 1}.png`);
      } catch (e) {
        UI.toast('Export failed.', { error: true });
      }
      return;
    }
    let pages = this.pages;
    if (st.range === 'cur') pages = [this.pages[cur]];
    else if (st.range === 'range') {
      const a = U.clamp(parseInt(fromIn.value, 10) || 1, 1, this.pages.length);
      const b = U.clamp(parseInt(toIn.value, 10) || this.pages.length, a, this.pages.length);
      pages = this.pages.slice(a - 1, b);
    }
    const prog = UI.progress({ title: 'Exporting PDF', text: '', cancellable: true });
    try {
      const blob = await Q.io.exportPDF(this.meta.title, pages, { dpi: st.q === 'hi' ? 260 : 170, noTemplate: !st.tpl, onProgress: (f, t) => prog.set(f, t), signal: prog.signal });
      prog.close();
      Q.io.offerFile(blob, title + '.pdf');
    } catch (e) {
      prog.close();
      if (e && e.name === 'AbortError') return;
      console.error(e);
      UI.toast('Export failed. Try fewer pages or Standard quality.', { error: true });
    }
  };

  E.toggleNav = function (force) {
    const show = force != null ? force : this.nav.hidden;
    this.nav.hidden = !show;
    this.navBtn.classList.toggle('on', show);
    if (show) this.renderNav();
    else if (this.navIO) {
      this.navIO.disconnect();
      this.navIO = null;
      U.clear(this.nav);
    }
  };
  E.renderNav = function () {
    const nav = U.clear(this.nav);
    if (this.navIO) this.navIO.disconnect();
    this.navMode = this.navMode || 'all';
    const list = h('div', { class: 'nav-list' });
    const head = h('div', { class: 'nav-head' },
      h('div', { class: 'nav-title' }, 'Pages', h('span', { class: 'nav-count' }, String(this.pages.length))),
      h('button', { class: 'icon-btn sm', 'aria-label': 'Close pages', onclick: () => this.toggleNav(false) }, Q.icon('close')));
    const seg = UI.seg([{ id: 'all', label: 'All' }, { id: 'bm', label: 'Bookmarks' }], this.navMode, (v) => { this.navMode = v; this.renderNav(); }, { small: true });
    nav.append(head, h('div', { class: 'nav-filter' }, seg), list);
    this.navIO = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const id = en.target.dataset.id;
        const page = this.page(id);
        if (page) this.drawNavThumb(en.target, page);
      }
    }, { root: list, rootMargin: '200px 0px' });
    const cur = this.renderer.currentIndex();
    const shown = this.pages.map((p, i) => [p, i]).filter(([p]) => this.navMode === 'all' || p.bm);
    if (!shown.length) list.appendChild(h('div', { class: 'nav-empty' }, 'No bookmarked pages yet. Use ⋯ › Bookmark page.'));
    for (const [p, i] of shown) {
      const c = U.makeCanvas(10, 10);
      const handle = h('span', { class: 'nav-handle', 'aria-label': 'Drag to reorder', title: 'Drag to reorder' }, Q.icon('menu'));
      const more = h('button', { class: 'icon-btn sm', 'aria-label': 'Page ' + (i + 1) + ' options', onclick: (e) => { e.stopPropagation(); this.pageMenu(more, p.id); } }, Q.icon('more'));
      const item = h('div', { class: 'nav-item' + (i === cur ? ' cur' : ''), dataset: { id: p.id }, role: 'button', tabIndex: 0, 'aria-label': 'Page ' + (i + 1), onclick: () => this.scrollToPage(this.pageIndex(p.id), true) },
        h('div', { class: 'nav-thumb', style: { aspectRatio: p.w + ' / ' + p.h } }, c, p.bm ? h('span', { class: 'nav-bm' }, Q.icon('bookmarkFill')) : null),
        h('div', { class: 'nav-meta' }, this.navMode === 'all' ? handle : null, h('span', { class: 'nav-num' }, String(i + 1)), more));
      item.addEventListener('keydown', (e) => { if (e.key === 'Enter') item.click(); });
      list.appendChild(item);
      this.navIO.observe(item);
      if (this.navMode === 'all') this.bindNavDrag(handle, item, list);
    }
    const add = h('button', { class: 'nav-add', onclick: () => this.addPage(null, this.pages.length) }, Q.icon('plus'), h('span', null, 'Add page'));
    list.appendChild(add);
    const curItem = list.querySelector('.nav-item.cur');
    if (curItem) requestAnimationFrame(() => curItem.scrollIntoView({ block: 'center' }));
  };
  E.drawNavThumb = function (item, page) {
    const c = item.querySelector('canvas');
    const box = item.querySelector('.nav-thumb');
    const w = Math.max(40, box.clientWidth) * Math.min(2, window.devicePixelRatio || 1);
    const src = this.renderer.thumbCanvas(page);
    const hh = Math.round((w * page.h) / page.w);
    if (c.width !== Math.round(w) || c.height !== hh) {
      c.width = Math.round(w);
      c.height = hh;
    }
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0, c.width, c.height);
  };
  E.onThumbUpdated = function (page) {
    if (this.nav.hidden) return;
    const item = this.nav.querySelector(`.nav-item[data-id="${page.id}"]`);
    if (item) this.drawNavThumb(item, page);
  };
  E.bindNavDrag = function (handle, item, list) {
    handle.addEventListener('click', (e) => e.stopPropagation());
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      const from = this.pageIndex(item.dataset.id);
      item.classList.add('dragging');
      const move = (ev) => {
        const items = Array.from(list.querySelectorAll('.nav-item')).filter((x) => x !== item);
        let before = null;
        for (const it of items) {
          const r = it.getBoundingClientRect();
          if (ev.clientY < r.top + r.height / 2) {
            before = it;
            break;
          }
        }
        if (before) list.insertBefore(item, before);
        else list.insertBefore(item, list.querySelector('.nav-add'));
        const lr = list.getBoundingClientRect();
        if (ev.clientY < lr.top + 40) list.scrollTop -= 12;
        else if (ev.clientY > lr.bottom - 40) list.scrollTop += 12;
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        item.classList.remove('dragging');
        const order = Array.from(list.querySelectorAll('.nav-item')).map((x) => x.dataset.id);
        const to = order.indexOf(item.dataset.id);
        if (to !== from && to >= 0) {
          this.movePage(from, to);
          this.renderNav();
        }
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  };
  E.pageMenu = function (anchor, id) {
    const i = this.pageIndex(id);
    const page = this.pages[i];
    UI.menu(anchor, [
      { header: 'Page ' + (i + 1) },
      { label: 'New page before', icon: 'addPage', onClick: () => this.addPage(null, i) },
      { label: 'New page after', icon: 'addPage', onClick: () => this.addPage(null, i + 1) },
      { label: 'Duplicate', icon: 'duplicate', onClick: () => { this.duplicatePage(id); this.renderNav(); } },
      { label: page.bm ? 'Remove bookmark' : 'Bookmark', icon: 'bookmark', onClick: () => { this.toggleBookmark(id); this.renderNav(); } },
      { label: 'Change template…', icon: 'template', onClick: () => this.openTemplateSheet(page) },
      { label: 'Clear page', icon: 'clear', onClick: () => this.clearPage(id) },
      { label: 'Delete page', icon: 'trash', danger: true, onClick: async () => { await this.deletePage(id); this.renderNav(); } },
    ]);
  };

  // keep navigator in sync with page list changes
  const baseChanged = E.changed;
  E.changed = function () {
    baseChanged.call(this);
    if (!this.nav.hidden) {
      const ids = Array.from(this.nav.querySelectorAll('.nav-item')).map((x) => x.dataset.id).join();
      const want = this.pages.filter((p) => this.navMode === 'all' || p.bm).map((p) => p.id).join();
      if (ids !== want) this.renderNav();
    }
  };

})((window.Q = window.Q || {}));
