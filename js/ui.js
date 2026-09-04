(function (Q) {
  'use strict';
  const U = Q.util;
  const h = U.h;
  const UI = (Q.ui = {});
  const stack = [];

  function layer() {
    let el = document.getElementById('overlays');
    if (!el) {
      el = h('div', { id: 'overlays' });
      document.body.appendChild(el);
    }
    return el;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stack.length) {
      const top = stack[stack.length - 1];
      if (top && top.close && !top.modalLock) {
        e.preventDefault();
        e.stopPropagation();
        top.close();
      }
    }
  }, true);
  UI.isOpen = () => stack.length > 0;
  UI.closeAll = () => {
    while (stack.length) stack[stack.length - 1].close();
  };

  let toastEl = null;
  let toastTimer = 0;
  UI.toast = function (msg, opts = {}) {
    if (!toastEl) {
      toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
      layer().appendChild(toastEl);
    }
    U.clear(toastEl);
    toastEl.appendChild(h('span', { class: 'toast-msg' }, msg));
    if (opts.action) {
      toastEl.appendChild(
        h('button', {
          class: 'toast-btn',
          onclick: () => {
            hide();
            opts.action.fn();
          },
        }, opts.action.label)
      );
    }
    toastEl.classList.toggle('error', !!opts.error);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    const hide = () => toastEl.classList.remove('show');
    toastTimer = setTimeout(hide, opts.ms || (opts.action ? 5000 : 2600));
  };

  UI.popover = function (anchor, content, opts = {}) {
    const back = h('div', { class: 'pop-back' + (opts.dim ? ' dim' : '') });
    const box = h('div', { class: 'pop ' + (opts.className || ''), role: opts.role || 'dialog' }, content);
    const api = {
      el: box,
      close() {
        if (api.closed) return;
        api.closed = true;
        const i = stack.indexOf(api);
        if (i >= 0) stack.splice(i, 1);
        back.remove();
        box.remove();
        if (opts.onClose) opts.onClose();
      },
      reposition: () => place(),
    };
    back.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      api.close();
    });
    layer().appendChild(back);
    layer().appendChild(box);
    stack.push(api);
    function place() {
      const vw = window.innerWidth;
      const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor || { left: vw / 2, right: vw / 2, top: vh / 3, bottom: vh / 3, width: 0, height: 0 };
      box.style.maxHeight = vh - 24 + 'px';
      const bw = box.offsetWidth;
      const bh = box.offsetHeight;
      let left = (opts.align === 'start' ? r.left : opts.align === 'end' ? r.right - bw : r.left + r.width / 2 - bw / 2);
      left = U.clamp(left, 10, vw - bw - 10);
      let top;
      const below = r.bottom + 8;
      const above = r.top - 8 - bh;
      if (opts.placement === 'top') top = above >= 10 ? above : below;
      else top = below + bh <= vh - 10 ? below : above >= 10 ? above : Math.max(10, vh - bh - 10);
      box.style.left = Math.round(left) + 'px';
      box.style.top = Math.round(top) + 'px';
    }
    place();
    requestAnimationFrame(() => box.classList.add('in'));
    return api;
  };

  UI.menu = function (anchor, items, opts = {}) {
    let pop;
    const list = h('div', { class: 'menu', role: 'menu' });
    for (const it of items) {
      if (!it) continue;
      if (it.sep) {
        list.appendChild(h('div', { class: 'menu-sep', role: 'separator' }));
        continue;
      }
      if (it.header) {
        list.appendChild(h('div', { class: 'menu-head' }, it.header));
        continue;
      }
      const btn = h(
        'button',
        {
          class: 'menu-item' + (it.danger ? ' danger' : '') + (it.checked ? ' checked' : ''),
          role: 'menuitem',
          disabled: !!it.disabled,
          onclick: (e) => {
            e.stopPropagation();
            if (!it.keepOpen) pop.close();
            it.onClick && it.onClick(e);
          },
        },
        it.icon ? Q.icon(it.icon) : h('span', { class: 'ic ic-empty' }),
        h('span', { class: 'menu-label' }, it.label),
        it.hint ? h('span', { class: 'menu-hint' }, it.hint) : null,
        it.checked ? Q.icon('check', 'menu-check') : null
      );
      list.appendChild(btn);
    }
    pop = UI.popover(anchor, list, Object.assign({ className: 'pop-menu', role: 'menu' }, opts));
    const first = list.querySelector('.menu-item:not([disabled])');
    if (first && opts.focus !== false) setTimeout(() => first.focus({ preventScroll: true }), 30);
    return pop;
  };

  UI.sheet = function (o) {
    const back = h('div', { class: 'sheet-back' });
    const actions = h('div', { class: 'sheet-actions' });
    const closeBtn = h('button', { class: 'icon-btn sheet-x', 'aria-label': 'Close', onclick: () => api.close() }, Q.icon('close'));
    const titleId = U.uid('t');
    const card = h(
      'div',
      { class: 'sheet' + (o.wide ? ' wide' : '') + (o.className ? ' ' + o.className : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h('div', { class: 'sheet-head' }, h('h2', { id: titleId, class: 'sheet-title' }, o.title || ''), o.headExtra || null, closeBtn),
      h('div', { class: 'sheet-body' }, o.body),
      o.actions && o.actions.length ? actions : null
    );
    const api = {
      el: card,
      body: card.querySelector('.sheet-body'),
      close(val) {
        if (api.closed) return;
        api.closed = true;
        const i = stack.indexOf(api);
        if (i >= 0) stack.splice(i, 1);
        back.classList.remove('in');
        card.classList.remove('in');
        setTimeout(() => {
          back.remove();
          card.remove();
        }, 180);
        if (o.onClose) o.onClose(val);
      },
    };
    for (const a of o.actions || []) {
      actions.appendChild(
        h('button', {
          class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''),
          onclick: async () => {
            if (a.onClick) {
              const r = await a.onClick(api);
              if (r === false) return;
            }
            api.close(a.value);
          },
        }, a.label)
      );
    }
    back.addEventListener('pointerdown', (e) => {
      if (e.target === back && !o.modalLock) api.close();
    });
    api.modalLock = !!o.modalLock;
    layer().appendChild(back);
    layer().appendChild(card);
    stack.push(api);
    requestAnimationFrame(() => {
      back.classList.add('in');
      card.classList.add('in');
    });
    return api;
  };

  UI.confirm = function (o) {
    return new Promise((resolve) => {
      let done = false;
      const s = UI.sheet({
        title: o.title,
        className: 'sheet-alert',
        body: h('p', { class: 'sheet-msg' }, o.message || ''),
        actions: [
          { label: o.cancel || 'Cancel', value: false },
          { label: o.ok || 'OK', primary: !o.danger, danger: !!o.danger, value: true },
        ],
        onClose: (v) => {
          if (!done) {
            done = true;
            resolve(!!v);
          }
        },
      });
      setTimeout(() => {
        const b = s.el.querySelector('.btn.primary, .btn.danger');
        if (b) b.focus();
      }, 60);
    });
  };

  UI.prompt = function (o) {
    return new Promise((resolve) => {
      const input = h('input', { class: 'field', type: 'text', value: o.value || '', placeholder: o.placeholder || '', 'aria-label': o.label || o.title, maxlength: 200 });
      let result = null;
      const s = UI.sheet({
        title: o.title,
        className: 'sheet-alert',
        body: h('div', { class: 'stack' }, o.label ? h('label', { class: 'field-label' }, o.label) : null, input),
        actions: [
          { label: 'Cancel' },
          {
            label: o.ok || 'Save',
            primary: true,
            onClick: () => {
              result = input.value.trim();
              if (!result && !o.allowEmpty) {
                input.focus();
                return false;
              }
            },
          },
        ],
        onClose: () => resolve(result),
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          result = input.value.trim();
          if (result || o.allowEmpty) s.close();
        }
      });
      setTimeout(() => {
        input.focus();
        input.select();
      }, 80);
    });
  };

  UI.progress = function (o) {
    const bar = h('div', { class: 'prog-fill' });
    const txt = h('div', { class: 'prog-text' }, o.text || '');
    const ctl = new AbortController();
    const s = UI.sheet({
      title: o.title,
      className: 'sheet-alert',
      modalLock: true,
      body: h('div', { class: 'stack' }, h('div', { class: 'prog' }, bar), txt),
      actions: o.cancellable ? [{ label: 'Cancel', onClick: () => ctl.abort() }] : [],
    });
    s.el.querySelector('.sheet-x').hidden = true;
    return {
      signal: ctl.signal,
      set(frac, text) {
        bar.style.width = Math.round(U.clamp(frac, 0, 1) * 100) + '%';
        if (text != null) txt.textContent = text;
      },
      close: () => s.close(),
    };
  };

  UI.seg = function (options, value, onChange, opts = {}) {
    const el = h('div', { class: 'seg' + (opts.small ? ' small' : '') + (opts.wrap ? ' wrap' : ''), role: 'radiogroup', 'aria-label': opts.label || '' });
    const set = (v) => {
      value = v;
      for (const b of el.children) {
        const on = b.dataset.v === String(v);
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      }
    };
    for (const o of options) {
      el.appendChild(
        h('button', {
          class: 'seg-btn',
          role: 'radio',
          dataset: { v: String(o.id) },
          title: o.title || o.label || '',
          'aria-label': o.title || o.label || '',
          onclick: () => {
            set(o.id);
            onChange(o.id);
          },
        }, o.icon ? Q.icon(o.icon) : null, o.label && !o.iconOnly ? h('span', null, o.label) : null)
      );
    }
    set(value);
    el.setValue = set;
    return el;
  };

  UI.toggle = function (checked, onChange, label) {
    const input = h('input', { type: 'checkbox', class: 'switch-input', checked: !!checked, 'aria-label': label || '' });
    input.addEventListener('change', () => onChange(input.checked));
    return h('label', { class: 'switch' }, input, h('span', { class: 'switch-track' }, h('span', { class: 'switch-knob' })));
  };

  UI.row = (label, control, hint) =>
    h('div', { class: 'set-row' }, h('div', { class: 'set-text' }, h('div', { class: 'set-label' }, label), hint ? h('div', { class: 'set-hint' }, hint) : null), control);

  UI.slider = function (min, max, step, value, onInput, fmt) {
    const out = h('span', { class: 'slider-val' }, fmt ? fmt(value) : String(value));
    const input = h('input', { type: 'range', class: 'slider', min, max, step, value: String(value) });
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      out.textContent = fmt ? fmt(v) : String(v);
      onInput(v, false);
    });
    input.addEventListener('change', () => onInput(parseFloat(input.value), true));
    return h('div', { class: 'slider-wrap' }, input, out);
  };

  UI.colorPicker = function (anchor, o) {
    let color = U.normHex(o.color) || '#1C1C1E';
    let hsv = (() => {
      const c = U.hexToRgb(color);
      return U.rgbToHsv(c.r, c.g, c.b);
    })();
    const palette = o.palette || Q.model.INK;
    const grid = h('div', { class: 'cp-grid' });
    const swatch = (c) =>
      h('button', {
        class: 'cp-sw' + (c.toUpperCase() === color.toUpperCase() ? ' on' : ''),
        style: { background: c },
        'aria-label': c,
        title: c,
        onclick: () => {
          setColor(c, true);
          if (o.closeOnPick !== false) pop.close();
        },
      });
    palette.forEach((c) => grid.appendChild(swatch(c)));

    const sv = U.makeCanvas(440, 260);
    sv.className = 'cp-sv';
    const hue = U.makeCanvas(440, 28);
    hue.className = 'cp-hue';
    const svDot = h('div', { class: 'cp-dot' });
    const hueDot = h('div', { class: 'cp-hdot' });
    const hex = h('input', { class: 'field cp-hex', value: color, maxlength: 7, 'aria-label': 'Hex colour', spellcheck: false, autocapitalize: 'off' });
    const preview = h('div', { class: 'cp-prev', style: { background: color } });
    const custom = h('div', { class: 'cp-custom' });

    function drawSV() {
      const g = sv.getContext('2d');
      const base = U.hsvToRgb(hsv.h, 1, 1);
      g.fillStyle = `rgb(${base.r},${base.g},${base.b})`;
      g.fillRect(0, 0, sv.width, sv.height);
      const wg = g.createLinearGradient(0, 0, sv.width, 0);
      wg.addColorStop(0, '#fff');
      wg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = wg;
      g.fillRect(0, 0, sv.width, sv.height);
      const bg = g.createLinearGradient(0, 0, 0, sv.height);
      bg.addColorStop(0, 'rgba(0,0,0,0)');
      bg.addColorStop(1, '#000');
      g.fillStyle = bg;
      g.fillRect(0, 0, sv.width, sv.height);
    }
    function drawHue() {
      const g = hue.getContext('2d');
      const gr = g.createLinearGradient(0, 0, hue.width, 0);
      for (let i = 0; i <= 6; i++) gr.addColorStop(i / 6, `hsl(${i * 60},100%,50%)`);
      g.fillStyle = gr;
      g.fillRect(0, 0, hue.width, hue.height);
    }
    function syncDots() {
      svDot.style.left = hsv.s * 100 + '%';
      svDot.style.top = (1 - hsv.v) * 100 + '%';
      svDot.style.background = color;
      hueDot.style.left = (hsv.h / 360) * 100 + '%';
    }
    function setColor(c, final, keepHsv) {
      color = U.normHex(c) || color;
      if (!keepHsv) {
        const r = U.hexToRgb(color);
        const n = U.rgbToHsv(r.r, r.g, r.b);
        if (n.s > 0.001 && n.v > 0.001) hsv = n;
        else hsv = { h: hsv.h, s: n.s, v: n.v };
        drawSV();
      }
      hex.value = color;
      preview.style.background = color;
      for (const b of grid.children) b.classList.toggle('on', b.title.toUpperCase() === color.toUpperCase());
      syncDots();
      o.onChange && o.onChange(color, !!final);
    }
    function fromHsv(final) {
      const c = U.hsvToRgb(hsv.h, hsv.s, hsv.v);
      setColor(U.rgbToHex(c.r, c.g, c.b), final, true);
    }
    function drag(el, fn) {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        const move = (ev) => {
          const r = el.getBoundingClientRect();
          fn(U.clamp((ev.clientX - r.left) / r.width, 0, 1), U.clamp((ev.clientY - r.top) / r.height, 0, 1), false);
        };
        const up = (ev) => {
          move(ev);
          const r = el.getBoundingClientRect();
          fn(U.clamp((ev.clientX - r.left) / r.width, 0, 1), U.clamp((ev.clientY - r.top) / r.height, 0, 1), true);
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
        move(e);
      });
    }
    const svWrap = h('div', { class: 'cp-svwrap' }, sv, svDot);
    const hueWrap = h('div', { class: 'cp-huewrap' }, hue, hueDot);
    drag(svWrap, (x, y, fin) => {
      hsv.s = x;
      hsv.v = 1 - y;
      fromHsv(fin);
    });
    drag(hueWrap, (x, y, fin) => {
      hsv.h = Math.min(359.9, x * 360);
      drawSV();
      fromHsv(fin);
    });
    hex.addEventListener('change', () => {
      const n = U.normHex(hex.value);
      if (n) setColor(n, true);
      else hex.value = color;
    });
    function renderCustom() {
      U.clear(custom);
      const list = (o.custom && o.custom()) || [];
      list.slice(0, 11).forEach((c) => custom.appendChild(swatch(c)));
      if (o.onSaveCustom)
        custom.appendChild(
          h('button', {
            class: 'cp-add',
            'aria-label': 'Save colour',
            title: 'Save colour',
            onclick: () => {
              o.onSaveCustom(color);
              renderCustom();
            },
          }, Q.icon('plus'))
        );
    }
    renderCustom();
    const tabs = h('div', { class: 'cp-tabs' });
    const panes = { grid: h('div', { class: 'cp-pane' }, grid), custom: h('div', { class: 'cp-pane', hidden: true }, svWrap, hueWrap, h('div', { class: 'cp-hexrow' }, preview, hex)) };
    const segc = UI.seg([{ id: 'grid', label: 'Palette' }, { id: 'custom', label: 'Custom' }], 'grid', (v) => {
      panes.grid.hidden = v !== 'grid';
      panes.custom.hidden = v !== 'custom';
      pop.reposition();
    }, { small: true });
    tabs.appendChild(segc);
    const body = h('div', { class: 'cp' }, tabs, panes.grid, panes.custom, h('div', { class: 'cp-sub' }, 'Saved colours'), custom);
    drawSV();
    drawHue();
    syncDots();
    const pop = UI.popover(anchor, body, { className: 'pop-cp', onClose: o.onClose });
    return pop;
  };
})((window.Q = window.Q || {}));
