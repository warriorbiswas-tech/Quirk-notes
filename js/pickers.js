(function (Q) {
  'use strict';
  const U = Q.util;
  const M = Q.model;
  const h = U.h;
  const PK = (Q.pick = {});

  // state: {tpl, paper, size, orient}; onChange(state)
  PK.paperPicker = function (state, onChange, opts = {}) {
    const st = Object.assign({}, state);
    const grid = h('div', { class: 'tpl-grid' });
    const cells = [];
    const spWrap = h('div', { class: 'sp-row' });
    const spaced = (id) => !!M.template(id).sp;
    const renderSp = () => {
      U.clear(spWrap);
      spWrap.hidden = !spaced(st.tpl);
      if (spWrap.hidden) return;
      const base = M.template(st.tpl).sp;
      const mm = (v) => (v * 0.3528).toFixed(1) + ' mm';
      spWrap.appendChild(h('div', { class: 'pick-label' }, 'Line spacing'));
      spWrap.appendChild(Q.ui.slider(Math.round(base * 0.6), Math.round(base * 1.8), 0.5, st.sp || base, (v, fin) => {
        st.sp = Math.abs(v - base) < 0.3 ? undefined : v;
        if (fin) {
          draw();
          onChange(Object.assign({}, st));
        }
      }, mm));
    };
    const draw = () => {
      for (const c of cells) Q.paper.thumb(c.canvas, c.id, st.paper, st.size, st.orient, c.id === st.tpl ? st.sp : undefined);
      for (const c of cells) c.btn.classList.toggle('on', c.id === st.tpl);
    };
    for (const t of M.TEMPLATES) {
      const canvas = U.makeCanvas(150, 150);
      const btn = h('button', {
        class: 'tpl-cell',
        'aria-label': t.name,
        onclick: () => {
          if (st.tpl !== t.id) st.sp = undefined;
          st.tpl = t.id;
          draw();
          renderSp();
          onChange(Object.assign({}, st));
        },
      }, h('div', { class: 'tpl-canvas' }, canvas), h('span', { class: 'tpl-name' }, t.name));
      cells.push({ id: t.id, canvas, btn });
      grid.appendChild(btn);
    }
    const papers = h('div', { class: 'paper-row', role: 'radiogroup', 'aria-label': 'Paper colour' });
    for (const p of M.PAPERS) {
      const b = h('button', {
        class: 'paper-sw' + (p.id === st.paper ? ' on' : ''),
        style: { background: p.c },
        title: p.name,
        'aria-label': p.name,
        onclick: () => {
          st.paper = p.id;
          for (const x of papers.children) x.classList.toggle('on', x === b);
          draw();
          onChange(Object.assign({}, st));
        },
      });
      papers.appendChild(b);
    }
    const parts = [h('div', { class: 'pick-label' }, 'Paper'), papers];
    if (!opts.noSize) {
      const sizeSeg = Q.ui.seg(
        Object.keys(M.PAGE_SIZES).map((k) => ({ id: k, label: M.PAGE_SIZES[k].name })),
        st.size,
        (v) => {
          st.size = v;
          draw();
          onChange(Object.assign({}, st));
        },
        { small: true, label: 'Page size' }
      );
      const oriSeg = Q.ui.seg(
        [
          { id: 'p', label: 'Portrait' },
          { id: 'l', label: 'Landscape' },
        ],
        st.orient,
        (v) => {
          st.orient = v;
          draw();
          onChange(Object.assign({}, st));
        },
        { small: true, label: 'Orientation' }
      );
      parts.push(h('div', { class: 'pick-label' }, 'Size'), h('div', { class: 'pick-row wrap' }, sizeSeg, oriSeg));
    }
    parts.push(h('div', { class: 'pick-label' }, 'Template'), grid, spWrap);
    const el = h('div', { class: 'paper-picker' }, parts);
    renderSp();
    requestAnimationFrame(draw);
    return el;
  };

  // cover: {color, style}; onChange(cover)
  PK.coverPicker = function (cover, title, onChange, firstPage) {
    const st = Object.assign({}, cover);
    const preview = h('div', { class: 'cover-preview' });
    const render = () => {
      U.clear(preview);
      preview.appendChild(PK.coverEl(st, title, firstPage));
    };
    const colors = h('div', { class: 'paper-row', role: 'radiogroup', 'aria-label': 'Cover colour' });
    for (const c of M.COVER_COLORS) {
      const b = h('button', {
        class: 'paper-sw round' + (c === st.color ? ' on' : ''),
        style: { background: c },
        'aria-label': c,
        onclick: () => {
          st.color = c;
          for (const x of colors.children) x.classList.toggle('on', x === b);
          render();
          onChange(Object.assign({}, st));
        },
      });
      colors.appendChild(b);
    }
    const styles = Q.ui.seg(
      M.COVER_STYLES.filter((s) => s.id !== 'page' || firstPage !== false).map((s) => ({ id: s.id, label: s.name })),
      st.style,
      (v) => {
        st.style = v;
        render();
        onChange(Object.assign({}, st));
      },
      { small: true, wrap: true, label: 'Cover style' }
    );
    render();
    return h('div', { class: 'cover-picker' }, preview, h('div', { class: 'cover-opts' }, h('div', { class: 'pick-label' }, 'Colour'), colors, h('div', { class: 'pick-label' }, 'Style'), h('div', { class: 'pick-row wrap' }, styles)));
  };

  // a notebook cover element; thumbUrl optional (first-page preview)
  PK.coverEl = function (cover, title, thumbUrl) {
    const style = cover.style || 'linen';
    const el = h('div', { class: 'cover cover-' + style, style: { '--cc': cover.color || '#1E5B4A' } });
    if (style === 'page') {
      el.appendChild(h('div', { class: 'cover-page' }, typeof thumbUrl === 'string' ? h('img', { src: thumbUrl, alt: '', draggable: false }) : null));
      return el;
    }
    el.appendChild(h('div', { class: 'cover-spine' }));
    el.appendChild(h('div', { class: 'cover-label' }, h('span', null, title || 'Untitled')));
    return el;
  };
})((window.Q = window.Q || {}));
