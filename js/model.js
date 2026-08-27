(function (Q) {
  'use strict';
  const U = Q.util;
  const M = (Q.model = {});

  M.PAGE_SIZES = {
    a4: { name: 'A4', w: 595, h: 842 },
    letter: { name: 'US Letter', w: 612, h: 792 },
    a5: { name: 'A5', w: 420, h: 595 },
    ipad: { name: 'iPad screen', w: 600, h: 864 },
    square: { name: 'Square', w: 640, h: 640 },
  };

  M.PAPERS = [
    { id: 'white', name: 'White', c: '#FFFFFF' },
    { id: 'ivory', name: 'Ivory', c: '#FBF8F0' },
    { id: 'legal', name: 'Legal pad', c: '#FFF6C7' },
    { id: 'mist', name: 'Mist', c: '#EDF1F4' },
    { id: 'sage', name: 'Sage', c: '#EDF2EA' },
    { id: 'slate', name: 'Slate', c: '#2B2F34' },
    { id: 'night', name: 'Night', c: '#151719' },
  ];
  M.paperColor = (id) => (M.PAPERS.find((p) => p.id === id) || M.PAPERS[0]).c;

  M.TEMPLATES = [
    { id: 'blank', name: 'Blank' },
    { id: 'ruled', name: 'Ruled', sp: 22 },
    { id: 'narrow', name: 'Narrow ruled', sp: 18 },
    { id: 'wide', name: 'Wide ruled', sp: 26 },
    { id: 'grid', name: 'Grid 5 mm', sp: 14.173 },
    { id: 'grid-s', name: 'Fine grid', sp: 8.504 },
    { id: 'dots', name: 'Dot grid', sp: 14.173 },
    { id: 'cornell', name: 'Cornell notes', sp: 22 },
    { id: 'todo', name: 'Checklist', sp: 28 },
    { id: 'music', name: 'Music staff' },
    { id: 'iso', name: 'Isometric', sp: 17 },
    { id: 'daily', name: 'Daily planner' },
    { id: 'weekly', name: 'Weekly planner' },
    { id: 'monthly', name: 'Monthly calendar' },
  ];
  M.template = (id) => M.TEMPLATES.find((t) => t.id === id) || M.TEMPLATES[0];

  M.COVER_COLORS = ['#1E5B4A', '#2E4A7A', '#7A2E3A', '#B5652B', '#C9A23F', '#5B4A8A', '#2F6F7A', '#3A3D42', '#8C5A7B', '#6E7F3A', '#B84A3A', '#D9D3C4'];
  M.COVER_STYLES = [
    { id: 'linen', name: 'Linen' },
    { id: 'band', name: 'Elastic band' },
    { id: 'stripe', name: 'Stripes' },
    { id: 'dots', name: 'Dots' },
    { id: 'grid', name: 'Grid' },
    { id: 'plain', name: 'Plain' },
    { id: 'page', name: 'First page' },
  ];

  // Ink palette: 6 rows × 6, dark → light.
  M.INK = [
    '#000000', '#1C1C1E', '#48484A', '#8E8E93', '#C7C7CC', '#FFFFFF',
    '#7F1D1D', '#D2343C', '#F05A3F', '#F28C28', '#F5B800', '#FFE066',
    '#0F4D33', '#1E8A4C', '#34C759', '#8FD17E', '#00A39A', '#7DD8D0',
    '#0B2A6F', '#2453C6', '#3B82F6', '#5AC8FA', '#8EA8FF', '#BCD6FF',
    '#3D1F7A', '#6B3FC4', '#AF52DE', '#DB3E96', '#FF6FA8', '#FFC3DB',
    '#3F2716', '#7B4B2A', '#A0703F', '#C9A27E', '#E3CDA8', '#F3EADB',
  ];
  M.HL_COLORS = ['#FFE45C', '#A6F09A', '#9FD8FF', '#FFB3D9', '#FFC27A', '#D4B8FF', '#FF8A80', '#C8C8C8'];

  M.PEN_KINDS = [
    { id: 'fountain', name: 'Fountain pen' },
    { id: 'ball', name: 'Ballpoint' },
    { id: 'brush', name: 'Brush pen' },
    { id: 'pencil', name: 'Pencil' },
  ];

  M.FONTS = {
    sans: { name: 'Sans', css: '-apple-system, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
    serif: { name: 'Serif', css: 'ui-serif, "New York", "Iowan Old Style", Georgia, "Times New Roman", serif' },
    rounded: { name: 'Rounded', css: 'ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif' },
    mono: { name: 'Mono', css: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
    hand: { name: 'Handwriting', css: '"Caveat", "Bradley Hand", "Segoe Print", "Comic Sans MS", cursive' },
  };
  M.fontCss = (key) => (M.FONTS[key] || M.FONTS.sans).css;

  M.defaultTools = () => ({
    pen: { kind: 'fountain', color: '#1C1C1E', colors: ['#1C1C1E', '#2453C6', '#D2343C', '#1E8A4C', '#6B3FC4'], size: 1.6, sizes: [0.9, 1.6, 2.8] },
    hl: { color: '#FFE45C', colors: ['#FFE45C', '#A6F09A', '#9FD8FF', '#FFB3D9', '#FFC27A'], size: 14, sizes: [8, 14, 24], straight: false },
    eraser: { mode: 'stroke', size: 14, sizes: [6, 14, 32], hlOnly: false, auto: false },
    shape: { color: '#1C1C1E', size: 1.8, fill: false },
    text: { font: 'sans', size: 16, color: '#1C1C1E', bold: false, align: 'l' },
    laser: { color: '#FF3B30' },
  });

  M.defaultSettings = () => ({
    v: 1,
    theme: 'system',
    fingerDraw: 'auto',
    penSeen: false,
    pressure: 0.7,
    smoothing: 0.5,
    shapeHold: true,
    snap: 0.5,
    tapUndo: true,
    sort: 'modified',
    newNotebook: { size: 'a4', orient: 'p', tpl: 'ruled', paper: 'white', coverColor: '#1E5B4A', coverStyle: 'linen' },
    tools: M.defaultTools(),
    customColors: [],
  });

  M.mergeSettings = function (s) {
    const d = M.defaultSettings();
    if (!s || typeof s !== 'object') return d;
    const out = Object.assign(d, s);
    // Settings from the online AI features, which were removed.
    delete out.aiKey;
    delete out.liveDelay;
    out.newNotebook = Object.assign(M.defaultSettings().newNotebook, s.newNotebook || {});
    const dt = M.defaultTools();
    out.tools = {};
    for (const k in dt) out.tools[k] = Object.assign(dt[k], (s.tools || {})[k] || {});
    delete out.tools.pen.liveText;
    delete out.tools.pen.liveFont;
    return out;
  };

  M.newPage = function (opts = {}) {
    const size = M.PAGE_SIZES[opts.size] || M.PAGE_SIZES.a4;
    const land = opts.orient === 'l';
    const w = opts.w || (land ? size.h : size.w);
    const h = opts.h || (land ? size.w : size.h);
    return {
      id: U.uid('p'),
      w,
      h,
      tpl: opts.sp ? { k: opts.tpl || 'ruled', c: opts.paper || 'white', sp: opts.sp } : { k: opts.tpl || 'ruled', c: opts.paper || 'white' },
      bg: opts.bg || null,
      els: opts.els || [],
      bm: false,
      txt: opts.txt || '',
    };
  };

  M.newMeta = function (opts = {}) {
    const now = Date.now();
    return {
      id: U.uid('n'),
      title: opts.title || 'Untitled',
      folderId: opts.folderId || null,
      cover: opts.cover || { color: '#1E5B4A', style: 'linen' },
      created: now,
      modified: now,
      opened: now,
      favorite: false,
      trashed: null,
      pageCount: 1,
      text: '',
    };
  };

  M.withEls = (page, els) => Object.assign({}, page, { els });

  const bboxCache = new WeakMap();
  function rotRectBBox(x, y, w, h, r) {
    if (!r) return [x, y, x + w, y + h];
    const cx = x + w / 2;
    const cy = y + h / 2;
    const c = Math.abs(Math.cos(r));
    const s = Math.abs(Math.sin(r));
    const hw = (w * c + h * s) / 2;
    const hh = (w * s + h * c) / 2;
    return [cx - hw, cy - hh, cx + hw, cy + hh];
  }
  M.rotRectBBox = rotRectBBox;

  M.strokeReach = (el) => (el.k === 'hl' ? el.w * 0.55 : el.k === 'brush' ? el.w * 1.0 : el.w * 0.8) + 0.75;

  M.elBBox = function (el) {
    let b = bboxCache.get(el);
    if (b) return b;
    if (el.t === 's') {
      b = U.bboxEmpty();
      const p = el.pts;
      for (let i = 0; i < p.length; i += 3) U.bboxAdd(b, p[i], p[i + 1]);
      b = U.bboxInflate(b, M.strokeReach(el));
    } else {
      b = rotRectBBox(el.x, el.y, el.w, el.h || 10, el.r || 0);
    }
    bboxCache.set(el, b);
    return b;
  };

  // corners of a (possibly rotated) box element, flat array
  M.boxCorners = function (el) {
    const cx = el.x + el.w / 2;
    const cy = el.y + el.h / 2;
    const r = el.r || 0;
    const c = Math.cos(r);
    const s = Math.sin(r);
    const out = [];
    for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const lx = (dx * el.w) / 2;
      const ly = (dy * el.h) / 2;
      out.push(cx + lx * c - ly * s, cy + lx * s + ly * c);
    }
    return out;
  };

  // Does a box element contain the point (px,py)?
  M.boxHit = function (el, px, py, pad = 0) {
    const cx = el.x + el.w / 2;
    const cy = el.y + el.h / 2;
    const r = -(el.r || 0);
    const dx = px - cx;
    const dy = py - cy;
    const lx = dx * Math.cos(r) - dy * Math.sin(r);
    const ly = dx * Math.sin(r) + dy * Math.cos(r);
    return Math.abs(lx) <= el.w / 2 + pad && Math.abs(ly) <= el.h / 2 + pad;
  };

  /* Apply an affine matrix (page space) to elements.
   * scale = uniform size factor for stroke widths and font sizes; rot = rotation delta (radians).
   * localScale: optional {sx, sy} for single box elements scaled along their own axes. */
  M.transformEl = function (el, m, scale, rot, localScale) {
    if (el.t === 's') {
      const src = el.pts;
      const pts = new Float32Array(src.length);
      for (let i = 0; i < src.length; i += 3) {
        const x = src[i];
        const y = src[i + 1];
        pts[i] = m[0] * x + m[2] * y + m[4];
        pts[i + 1] = m[1] * x + m[3] * y + m[5];
        pts[i + 2] = src[i + 2];
      }
      return Object.assign({}, el, { pts, w: Math.max(0.2, el.w * scale) });
    }
    const cx = el.x + el.w / 2;
    const cy = el.y + el.h / 2;
    const [ncx, ncy] = U.mat.apply(m, cx, cy);
    const sx = localScale ? localScale.sx : scale;
    const sy = localScale ? localScale.sy : scale;
    const w = Math.max(4, el.w * sx);
    const h = Math.max(4, el.h * sy);
    const out = Object.assign({}, el, { x: ncx - w / 2, y: ncy - h / 2, w, h, r: normAngle((el.r || 0) + rot) });
    if (el.t === 't') out.s = Math.max(4, el.s * (localScale ? Math.sqrt(sx * sy) : scale));
    return out;
  };
  function normAngle(a) {
    a = a % (Math.PI * 2);
    if (a > Math.PI) a -= Math.PI * 2;
    if (a < -Math.PI) a += Math.PI * 2;
    return Math.abs(a) < 1e-4 ? 0 : a;
  }

  M.cloneEl = (el, dx = 0, dy = 0) => {
    const c = Object.assign({}, el, { id: U.uid('e') });
    if (el.t === 's') {
      const p = new Float32Array(el.pts);
      if (dx || dy)
        for (let i = 0; i < p.length; i += 3) {
          p[i] += dx;
          p[i + 1] += dy;
        }
      c.pts = p;
    } else {
      c.x += dx;
      c.y += dy;
    }
    return c;
  };

  M.clonePage = (page) => Object.assign({}, page, { id: U.uid('p'), els: page.els.map((e) => M.cloneEl(e)), tpl: Object.assign({}, page.tpl), bg: page.bg ? Object.assign({}, page.bg) : null });

  M.pageText = function (page) {
    const parts = [];
    for (const el of page.els) if (el.t === 't' && el.txt) parts.push(el.txt);
    if (page.txt) parts.push(page.txt);
    if (page.ai) parts.push(page.ai);
    return parts.join('\n');
  };

  M.History = class {
    constructor(limit = 200) {
      this.u = [];
      this.r = [];
      this.limit = limit;
    }
    push(entry) {
      this.u.push(entry);
      if (this.u.length > this.limit) this.u.shift();
      this.r.length = 0;
    }
    undo() {
      const e = this.u.pop();
      if (e) this.r.push(e);
      return e || null;
    }
    redo() {
      const e = this.r.pop();
      if (e) this.u.push(e);
      return e || null;
    }
    get canUndo() {
      return this.u.length > 0;
    }
    get canRedo() {
      return this.r.length > 0;
    }
    clear() {
      this.u.length = 0;
      this.r.length = 0;
    }
  };

  M.serializePage = function (p) {
    return Object.assign({}, p, {
      els: p.els.map((e) => (e.t === 's' ? Object.assign({}, e, { pts: U.f32ToB64(e.pts) }) : e)),
    });
  };
  M.deserializePage = function (p) {
    return Object.assign({}, p, {
      els: (p.els || []).map((e) => (e.t === 's' ? Object.assign({}, e, { pts: typeof e.pts === 'string' ? U.b64ToF32(e.pts) : new Float32Array(e.pts) }) : e)),
    });
  };
})((window.Q = window.Q || {}));
