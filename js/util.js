(function (Q) {
  'use strict';
  const U = (Q.util = {});

  U.uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  U.nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

  U.debounce = function (fn, ms) {
    let t = null;
    let lastArgs = null;
    const d = function (...args) {
      lastArgs = args;
      clearTimeout(t);
      t = setTimeout(() => {
        t = null;
        fn(...lastArgs);
      }, ms);
    };
    d.flush = () => {
      if (t) {
        clearTimeout(t);
        t = null;
        fn(...(lastArgs || []));
      }
    };
    d.cancel = () => {
      clearTimeout(t);
      t = null;
    };
    d.pending = () => !!t;
    return d;
  };

  U.h = function (tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style') {
          if (typeof v === 'string') el.style.cssText = v;
          else for (const sk in v) sk.startsWith('--') ? el.style.setProperty(sk, v[sk]) : (el.style[sk] = v[sk]);
        } else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    U.append(el, children);
    return el;
  };
  U.append = function (el, children) {
    for (const c of children) {
      if (c == null || c === false) continue;
      if (Array.isArray(c)) U.append(el, c);
      else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return el;
  };
  U.$ = (s, r = document) => r.querySelector(s);
  U.clear = (el) => {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  };
  U.on = (el, type, fn, opts) => {
    el.addEventListener(type, fn, opts);
    return () => el.removeEventListener(type, fn, opts);
  };

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  U.MONTHS = MONTHS;
  U.fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  U.fmtDate = function (ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const day = 86400000;
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (ts >= startToday) return 'Today, ' + U.fmtTime(d);
    if (ts >= startToday - day) return 'Yesterday, ' + U.fmtTime(d);
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + (sameYear ? '' : ' ' + d.getFullYear());
  };
  U.fmtBytes = function (n) {
    if (!isFinite(n)) return 'Unknown';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  };
  U.plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
  U.safeFileName = (s) => (String(s || 'Untitled').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled').slice(0, 120);

  U.bboxEmpty = () => [Infinity, Infinity, -Infinity, -Infinity];
  U.bboxAdd = (b, x, y) => {
    if (x < b[0]) b[0] = x;
    if (y < b[1]) b[1] = y;
    if (x > b[2]) b[2] = x;
    if (y > b[3]) b[3] = y;
    return b;
  };
  U.bboxUnion = (a, b) => (a ? (b ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] : a.slice()) : b ? b.slice() : null);
  U.bboxHit = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
  U.bboxInflate = (b, d) => [b[0] - d, b[1] - d, b[2] + d, b[3] + d];

  U.distSqToSeg = function (px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + t * dx - px;
    const qy = ay + t * dy - py;
    return qx * qx + qy * qy;
  };
  // squared distance between segments p1p2 and q1q2
  U.segSegDistSq = function (p1x, p1y, p2x, p2y, q1x, q1y, q2x, q2y) {
    if (U.segsIntersect(p1x, p1y, p2x, p2y, q1x, q1y, q2x, q2y)) return 0;
    return Math.min(
      U.distSqToSeg(p1x, p1y, q1x, q1y, q2x, q2y),
      U.distSqToSeg(p2x, p2y, q1x, q1y, q2x, q2y),
      U.distSqToSeg(q1x, q1y, p1x, p1y, p2x, p2y),
      U.distSqToSeg(q2x, q2y, p1x, p1y, p2x, p2y)
    );
  };
  U.segsIntersect = function (ax, ay, bx, by, cx, cy, dx, dy) {
    const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
    const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
    const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  // poly: flat array [x0,y0,x1,y1,...]
  U.pointInPoly = function (x, y, poly) {
    let inside = false;
    const n = poly.length;
    for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
      const xi = poly[i];
      const yi = poly[i + 1];
      const xj = poly[j];
      const yj = poly[j + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
    }
    return inside;
  };
  // 2D affine matrices as [a, b, c, d, e, f] (canvas order).
  U.mat = {
    ident: () => [1, 0, 0, 1, 0, 0],
    mul: (m, n) => [
      m[0] * n[0] + m[2] * n[1],
      m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3],
      m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4],
      m[1] * n[4] + m[3] * n[5] + m[5],
    ],
    translate: (x, y) => [1, 0, 0, 1, x, y],
    scale: (sx, sy) => [sx, 0, 0, sy == null ? sx : sy, 0, 0],
    rotate: (r) => {
      const c = Math.cos(r);
      const s = Math.sin(r);
      return [c, s, -s, c, 0, 0];
    },
    apply: (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]],
    invert: (m) => {
      const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
      return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
    },
  };

  U.hexToRgb = function (hex) {
    let h = String(hex || '').replace('#', '').trim();
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h.slice(0, 6), 16);
    if (isNaN(n)) return { r: 0, g: 0, b: 0 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };
  U.rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => U.clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase();
  U.normHex = function (hex) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    const c = U.hexToRgb(m[1]);
    return U.rgbToHex(c.r, c.g, c.b);
  };
  U.luminance = function (hex) {
    const { r, g, b } = U.hexToRgb(hex);
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  U.isDark = (hex) => U.luminance(hex) < 0.22;
  U.rgba = (hex, a) => {
    const { r, g, b } = U.hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  };
  U.hsvToRgb = function (h, s, v) {
    const f = (n) => {
      const k = (n + h / 60) % 6;
      return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return { r: f(5) * 255, g: f(3) * 255, b: f(1) * 255 };
  };
  U.rgbToHsv = function (r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h, s: max ? d / max : 0, v: max };
  };

  U.bytesToB64 = function (bytes) {
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  };
  U.b64ToBytes = function (b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  };
  U.f32ToB64 = (f) => U.bytesToB64(new Uint8Array(f.buffer, f.byteOffset, f.byteLength));
  U.b64ToF32 = (b) => {
    const bytes = U.b64ToBytes(b);
    return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2).slice();
  };
  U.dataURLToBlob = function (url) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
    if (!m) throw new Error('Bad data URL');
    const type = m[1] || 'application/octet-stream';
    const bytes = m[2] ? U.b64ToBytes(m[3]) : new TextEncoder().encode(decodeURIComponent(m[3]));
    return new Blob([bytes], { type });
  };
  U.canvasToBlob = (canvas, type = 'image/png', q) =>
    new Promise((res, rej) => {
      if (canvas.toBlob) canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), type, q);
      else res(U.dataURLToBlob(canvas.toDataURL(type, q)));
    });

  U.decodeImage = async function (blob) {
    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(blob);
      } catch (e) {
        // fall through to <img> (older Safari, some HEIC)
      }
    }
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };
  U.imgSize = (img) => ({ w: img.naturalWidth || img.width, h: img.naturalHeight || img.height });

  U.makeCanvas = function (w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  };
  // Safari keeps canvas memory until the backing store is shrunk.
  U.freeCanvas = function (c) {
    if (c) {
      c.width = 1;
      c.height = 1;
    }
  };

  U.isTouch = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  U.isIPad = () => /iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  U.isAndroid = () => /Android/.test(navigator.userAgent);
  U.stylusName = () => (U.isIPad() ? 'Apple Pencil' : 'your stylus');
  U.deviceName = () => (U.isIPad() ? 'iPad' : 'device');
  U.isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  // Serialized async queue: tasks run one after another.
  U.serial = function () {
    let chain = Promise.resolve();
    return (fn) => {
      const p = chain.then(fn, fn);
      chain = p.catch(() => {});
      return p;
    };
  };
})((window.Q = window.Q || {}));
