(function (Q) {
  'use strict';
  const U = Q.util;
  const I = (Q.ink = {});

  const PROFILES = {
    fountain: { minW: 0.3, gamma: 1.15, taperS: 2.2, taperE: 4.0, streamline: 0.3, simRate: 0.3 },
    ball: { minW: 0.84, gamma: 1.0, taperS: 0, taperE: 0, streamline: 0.26, simRate: 0.2 },
    brush: { minW: 0.1, gamma: 1.35, taperS: 4.0, taperE: 6.5, streamline: 0.34, simRate: 0.32 },
    pencil: { minW: 0.6, gamma: 1.0, taperS: 1.2, taperE: 2.0, streamline: 0.28, simRate: 0.22 },
    hl: { minW: 1, gamma: 1, taperS: 0, taperE: 0, streamline: 0.45, simRate: 0 },
  };
  I.PROFILES = PROFILES;
  const NOMINAL_P = 0.6;

  function widthFactor(prof, p) {
    const f = (q) => prof.minW + (1 - prof.minW) * Math.pow(U.clamp(q, 0, 1), prof.gamma);
    return f(p) / f(NOMINAL_P);
  }

  class StrokeBuilder {
    constructor(o) {
      this.kind = o.kind;
      this.color = o.color;
      this.size = o.size;
      this.prof = PROFILES[o.kind] || PROFILES.ball;
      this.scale = o.scale || 1; // CSS px per pt when the stroke started
      this.pointerType = o.pointerType || 'mouse';
      this.sens = o.sens == null ? 0.7 : o.sens; // pressure sensitivity 0..1
      const sm = o.smoothing == null ? 0.5 : o.smoothing;
      this.streamline = U.clamp(this.prof.streamline * (0.4 + sm * 1.2), 0, 0.8);
      if (this.pointerType === 'touch') this.streamline = Math.min(0.85, this.streamline + 0.15);
      this.pts = [];
      this.raw = [];
      this.last = null;
      this.lastRaw = null;
      this.lastT = null;
      this.simP = 0.62;
      this.realP = false;
      this.pMin = Infinity;
      this.pMax = -Infinity;
      this.rp = null;
      this.version = 0;
    }
    mapReal(p) {
      return Math.pow(U.clamp(p / 0.55, 0, 1), 0.75);
    }
    add(x, y, pressure, t) {
      const isPen = this.pointerType === 'pen';
      if (isPen && pressure > 0) {
        if (pressure < this.pMin) this.pMin = pressure;
        if (pressure > this.pMax) this.pMax = pressure;
        if (!this.realP && this.pMax - this.pMin > 0.012) {
          this.realP = true;
          // rewrite earlier samples with their real pressure so the stroke start does not jump
          let rp = null;
          for (let i = 0; i < this.raw.length; i++) {
            const m = this.mapReal(this.raw[i]);
            rp = rp == null ? m : rp + (m - rp) * 0.45;
            this.pts[i * 3 + 2] = this.bake(rp);
          }
          this.rp = rp;
        }
      }
      const minD = 0.3 / this.scale;
      if (this.lastRaw && Math.abs(x - this.lastRaw.x) < minD && Math.abs(y - this.lastRaw.y) < minD) return false;
      let sx = x;
      let sy = y;
      if (this.last) {
        const k = 1 - this.streamline;
        sx = this.last.x + (x - this.last.x) * k;
        sy = this.last.y + (y - this.last.y) * k;
      }
      const dt = this.lastT == null ? 16 : U.clamp(t - this.lastT, 1, 80);
      const dPx = this.last ? Math.hypot(sx - this.last.x, sy - this.last.y) * this.scale : 0;
      const v = dPx / dt;
      const target = 1 - U.clamp((v - 0.12) / 2.2, 0, 1) * 0.68;
      this.simP += (target - this.simP) * U.clamp((this.prof.simRate * dt) / 16, 0, 1);
      let p;
      if (this.realP) {
        const m = this.mapReal(pressure);
        this.rp = this.rp == null ? m : this.rp + (m - this.rp) * 0.45;
        p = this.rp;
      } else p = this.simP;
      this.pts.push(sx, sy, this.bake(p));
      this.raw.push(isPen ? pressure : 0.5);
      this.last = { x: sx, y: sy };
      this.lastRaw = { x, y };
      this.lastT = t;
      this.version++;
      return true;
    }
    bake(p) {
      return NOMINAL_P + (p - NOMINAL_P) * this.sens;
    }
    // snap the tail onto the pen's real lift-off point
    finish(x, y) {
      if (!this.last) return;
      const minD = 0.3 / this.scale;
      if (Math.hypot(x - this.last.x, y - this.last.y) > minD) {
        const p = this.pts[this.pts.length - 1];
        this.pts.push(x, y, p);
        this.version++;
      }
    }
    get count() {
      return this.pts.length / 3;
    }
    toElement() {
      return {
        t: 's',
        id: U.uid('e'),
        k: this.kind,
        c: this.color,
        w: this.size,
        pts: new Float32Array(this.pts),
        ts: this.prof.taperS > 0 ? 1 : 0,
        te: this.prof.taperE > 0 ? 1 : 0,
      };
    }
  }
  I.StrokeBuilder = StrokeBuilder;

  // Densify with centripetal Catmull-Rom. Returns {x, y, p, n}.
  function densify(pts, maxStep) {
    const n0 = pts.length / 3;
    const X = [];
    const Y = [];
    const P = [];
    for (let i = 0; i < n0; i++) {
      const x = pts[i * 3];
      const y = pts[i * 3 + 1];
      const k = X.length;
      if (k && Math.abs(x - X[k - 1]) < 1e-3 && Math.abs(y - Y[k - 1]) < 1e-3) {
        P[k - 1] = Math.max(P[k - 1], pts[i * 3 + 2]);
        continue;
      }
      X.push(x);
      Y.push(y);
      P.push(pts[i * 3 + 2]);
    }
    const n = X.length;
    if (n < 3) return { x: X, y: Y, p: P, n };
    const ox = [X[0]];
    const oy = [Y[0]];
    const op = [P[0]];
    for (let i = 0; i < n - 1; i++) {
      const i0 = Math.max(0, i - 1);
      const i3 = Math.min(n - 1, i + 2);
      const x0 = X[i0], y0 = Y[i0], x1 = X[i], y1 = Y[i], x2 = X[i + 1], y2 = Y[i + 1], x3 = X[i3], y3 = Y[i3];
      const segLen = Math.hypot(x2 - x1, y2 - y1);
      const k = Math.min(24, Math.max(1, Math.ceil(segLen / maxStep)));
      if (k === 1) {
        ox.push(x2);
        oy.push(y2);
        op.push(P[i + 1]);
        continue;
      }
      const d01 = Math.sqrt(Math.hypot(x1 - x0, y1 - y0)) + 1e-4;
      const d12 = Math.sqrt(segLen) + 1e-4;
      const d23 = Math.sqrt(Math.hypot(x3 - x2, y3 - y2)) + 1e-4;
      const t0 = 0, t1 = d01, t2 = t1 + d12, t3 = t2 + d23;
      for (let j = 1; j <= k; j++) {
        if (j === k) {
          ox.push(x2);
          oy.push(y2);
          op.push(P[i + 1]);
          break;
        }
        const t = t1 + (d12 * j) / k;
        const a1x = ((t1 - t) / (t1 - t0)) * x0 + ((t - t0) / (t1 - t0)) * x1;
        const a1y = ((t1 - t) / (t1 - t0)) * y0 + ((t - t0) / (t1 - t0)) * y1;
        const a2x = ((t2 - t) / (t2 - t1)) * x1 + ((t - t1) / (t2 - t1)) * x2;
        const a2y = ((t2 - t) / (t2 - t1)) * y1 + ((t - t1) / (t2 - t1)) * y2;
        const a3x = ((t3 - t) / (t3 - t2)) * x2 + ((t - t2) / (t3 - t2)) * x3;
        const a3y = ((t3 - t) / (t3 - t2)) * y2 + ((t - t2) / (t3 - t2)) * y3;
        const b1x = ((t2 - t) / (t2 - t0)) * a1x + ((t - t0) / (t2 - t0)) * a2x;
        const b1y = ((t2 - t) / (t2 - t0)) * a1y + ((t - t0) / (t2 - t0)) * a2y;
        const b2x = ((t3 - t) / (t3 - t1)) * a2x + ((t - t1) / (t3 - t1)) * a3x;
        const b2y = ((t3 - t) / (t3 - t1)) * a2y + ((t - t1) / (t3 - t1)) * a3y;
        ox.push(((t2 - t) / (t2 - t1)) * b1x + ((t - t1) / (t2 - t1)) * b2x);
        oy.push(((t2 - t) / (t2 - t1)) * b1y + ((t - t1) / (t2 - t1)) * b2y);
        op.push(P[i] + ((P[i + 1] - P[i]) * j) / k);
      }
    }
    return { x: ox, y: oy, p: op, n: ox.length };
  }
  I.densify = densify;

  function ease(t) {
    t = U.clamp(t, 0, 1);
    return 1 - (1 - t) * (1 - t);
  }

  // Build the filled outline Path2D for a pen/pencil stroke.
  function buildInkPath(el, pathCtor) {
    const prof = PROFILES[el.k] || PROFILES.ball;
    const path = pathCtor ? new pathCtor() : new Path2D();
    const w = el.w;
    const d = densify(el.pts, U.clamp(w * 0.45, 0.25, 1.4));
    const n = d.n;
    const X = d.x;
    const Y = d.y;
    if (n === 0) return path;
    const R = new Array(n);
    for (let i = 0; i < n; i++) R[i] = (w / 2) * (el.sh ? 1 : widthFactor(prof, d.p[i]));
    if (n > 2 && !el.sh) {
      // light smoothing of radii kills pressure jitter
      const src = R.slice();
      for (let i = 1; i < n - 1; i++) R[i] = (src[i - 1] + 2 * src[i] + src[i + 1]) / 4;
    }
    const L = new Array(n);
    L[0] = 0;
    for (let i = 1; i < n; i++) L[i] = L[i - 1] + Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1]);
    const total = L[n - 1];
    if (n === 1 || total < Math.max(0.15, w * 0.08)) {
      const r = Math.max(0.35, (w / 2) * (el.sh ? 1 : widthFactor(prof, d.p[0])) * 1.05);
      path.moveTo(X[0] + r, Y[0]);
      path.arc(X[0], Y[0], r, 0, Math.PI * 2);
      return path;
    }
    if (!el.sh) {
      const tS = el.ts ? Math.min(prof.taperS * w, total * 0.38) : 0;
      const tE = el.te ? Math.min(prof.taperE * w, total * 0.45) : 0;
      for (let i = 0; i < n; i++) {
        if (tS > 0 && L[i] < tS) R[i] *= 0.16 + 0.84 * ease(L[i] / tS);
        const rem = total - L[i];
        if (tE > 0 && rem < tE) R[i] *= 0.1 + 0.9 * ease(rem / tE);
      }
    }
    for (let i = 0; i < n; i++) if (R[i] < 0.08) R[i] = 0.08;
    const DX = new Array(n - 1);
    const DY = new Array(n - 1);
    for (let i = 0; i < n - 1; i++) {
      const dx = X[i + 1] - X[i];
      const dy = Y[i + 1] - Y[i];
      const l = Math.hypot(dx, dy) || 1e-6;
      DX[i] = dx / l;
      DY[i] = dy / l;
    }
    // split points: sharp corners or curvature tighter than the radius
    const splits = [0];
    for (let i = 1; i < n - 1; i++) {
      const c = DX[i - 1] * DX[i] + DY[i - 1] * DY[i];
      if (c < 0.35) {
        splits.push(i);
        continue;
      }
      const ang = Math.acos(U.clamp(c, -1, 1));
      if (ang > 0.02) {
        const seg = (L[i + 1] - L[i - 1]) / 2;
        if (seg / ang < R[i] * 0.9) splits.push(i);
      }
    }
    splits.push(n - 1);
    const circle = (i) => {
      path.moveTo(X[i] + R[i], Y[i]);
      path.arc(X[i], Y[i], R[i], 0, Math.PI * 2);
    };
    const lx = new Array(n);
    const ly = new Array(n);
    const rx = new Array(n);
    const ry = new Array(n);
    for (let s = 0; s < splits.length - 1; s++) {
      const a = splits[s];
      const b = splits[s + 1];
      if (b <= a) continue;
      for (let i = a; i <= b; i++) {
        let nx;
        let ny;
        if (i === a) {
          nx = DY[a];
          ny = -DX[a];
        } else if (i === b) {
          nx = DY[b - 1];
          ny = -DX[b - 1];
        } else {
          const ax = DX[i - 1] + DX[i];
          const ay = DY[i - 1] + DY[i];
          const l = Math.hypot(ax, ay) || 1e-6;
          // miter correction keeps the width constant through gentle corners
          const m = Math.min(1.8, 2 / l);
          nx = (ay / l) * m;
          ny = (-ax / l) * m;
        }
        lx[i] = X[i] + nx * R[i];
        ly[i] = Y[i] + ny * R[i];
        rx[i] = X[i] - nx * R[i];
        ry[i] = Y[i] - ny * R[i];
      }
      path.moveTo(lx[a], ly[a]);
      if (b - a >= 2) {
        path.lineTo((lx[a] + lx[a + 1]) / 2, (ly[a] + ly[a + 1]) / 2);
        for (let i = a + 1; i < b; i++) path.quadraticCurveTo(lx[i], ly[i], (lx[i] + lx[i + 1]) / 2, (ly[i] + ly[i + 1]) / 2);
      }
      path.lineTo(lx[b], ly[b]);
      path.lineTo(rx[b], ry[b]);
      if (b - a >= 2) {
        path.lineTo((rx[b] + rx[b - 1]) / 2, (ry[b] + ry[b - 1]) / 2);
        for (let i = b - 1; i > a; i--) path.quadraticCurveTo(rx[i], ry[i], (rx[i] + rx[i - 1]) / 2, (ry[i] + ry[i - 1]) / 2);
      }
      path.lineTo(rx[a], ry[a]);
      path.closePath();
    }
    for (let s = 1; s < splits.length - 1; s++) circle(splits[s]);
    circle(0);
    circle(n - 1);
    return path;
  }

  function buildHlPath(el, pathCtor) {
    const path = pathCtor ? new pathCtor() : new Path2D();
    const pts = el.pts;
    if (pts.length < 6) {
      path.moveTo(pts[0], pts[1]);
      path.lineTo(pts[0] + 0.01, pts[1]);
      return path;
    }
    const d = densify(pts, 2);
    const X = d.x;
    const Y = d.y;
    const n = d.n;
    path.moveTo(X[0], Y[0]);
    if (n === 2) path.lineTo(X[1], Y[1]);
    else {
      for (let i = 1; i < n - 1; i++) path.quadraticCurveTo(X[i], Y[i], (X[i] + X[i + 1]) / 2, (Y[i] + Y[i + 1]) / 2);
      path.lineTo(X[n - 1], Y[n - 1]);
    }
    return path;
  }

  const pathCache = new WeakMap();
  I.path = function (el) {
    let p = pathCache.get(el);
    if (!p) {
      p = el.k === 'hl' ? buildHlPath(el) : buildInkPath(el);
      pathCache.set(el, p);
    }
    return p;
  };
  I.buildPath = (el) => (el.k === 'hl' ? buildHlPath(el) : buildInkPath(el));

  const patternCache = new Map();
  function grainCanvas(color) {
    const S = 64;
    const c = U.makeCanvas(S, S);
    const g = c.getContext('2d');
    const img = g.createImageData(S, S);
    const { r, g: gg, b } = U.hexToRgb(color);
    let seed = 1234567;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < S * S; i++) {
      const v = rnd();
      const a = v < 0.18 ? 0.25 + v : 0.62 + v * 0.38;
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = gg;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = Math.round(U.clamp(a, 0, 1) * 255);
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  I.pencilStyle = function (ctx, color) {
    let entry = patternCache.get(color);
    if (!entry) {
      entry = { canvas: grainCanvas(color), byCtx: new WeakMap() };
      patternCache.set(color, entry);
      if (patternCache.size > 40) patternCache.delete(patternCache.keys().next().value);
    }
    let pat = entry.byCtx.get(ctx);
    if (!pat) {
      pat = ctx.createPattern(entry.canvas, 'repeat');
      try {
        if (pat && pat.setTransform && typeof DOMMatrix !== 'undefined') pat.setTransform(new DOMMatrix().scale(0.3));
      } catch (e) {}
      entry.byCtx.set(ctx, pat);
    }
    return pat || color;
  };

  I.drawStroke = function (ctx, el, env, live) {
    const path = live ? I.buildPath(el) : I.path(el);
    if (el.k === 'hl') {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.globalCompositeOperation = env && env.dark ? 'screen' : 'multiply';
      ctx.strokeStyle = el.c;
      ctx.lineWidth = el.w;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(path);
      ctx.restore();
    } else if (el.k === 'pencil') {
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = I.pencilStyle(ctx, el.c);
      ctx.fill(path);
      ctx.restore();
    } else {
      ctx.fillStyle = el.c;
      ctx.fill(path);
    }
  };

  function halfW(el) {
    return el.k === 'hl' ? el.w / 2 : el.w * 0.55;
  }
  I.hitPoint = function (el, x, y, r) {
    const b = Q.model.elBBox(el);
    if (x < b[0] - r || x > b[2] + r || y < b[1] - r || y > b[3] + r) return false;
    const p = el.pts;
    const rr = (r + halfW(el)) * (r + halfW(el));
    if (p.length === 3) return (p[0] - x) ** 2 + (p[1] - y) ** 2 <= rr;
    for (let i = 0; i < p.length - 3; i += 3) {
      if (U.distSqToSeg(x, y, p[i], p[i + 1], p[i + 3], p[i + 4]) <= rr) return true;
    }
    return false;
  };
  I.hitSweep = function (el, x0, y0, x1, y1, r) {
    const b = Q.model.elBBox(el);
    const minX = Math.min(x0, x1) - r;
    const maxX = Math.max(x0, x1) + r;
    const minY = Math.min(y0, y1) - r;
    const maxY = Math.max(y0, y1) + r;
    if (maxX < b[0] || minX > b[2] || maxY < b[1] || minY > b[3]) return false;
    const p = el.pts;
    const rr = (r + halfW(el)) * (r + halfW(el));
    if (p.length === 3) return U.distSqToSeg(p[0], p[1], x0, y0, x1, y1) <= rr;
    for (let i = 0; i < p.length - 3; i += 3) {
      if (U.segSegDistSq(p[i], p[i + 1], p[i + 3], p[i + 4], x0, y0, x1, y1) <= rr) return true;
    }
    return false;
  };

  // Fraction of a stroke's points inside a lasso polygon.
  I.insideFraction = function (el, poly) {
    const p = el.pts;
    const n = p.length / 3;
    const step = Math.max(1, Math.floor(n / 160));
    let inside = 0;
    let total = 0;
    for (let i = 0; i < n; i += step) {
      total++;
      if (U.pointInPoly(p[i * 3], p[i * 3 + 1], poly)) inside++;
    }
    return total ? inside / total : 0;
  };

  /* Precise erase: remove the part of a stroke inside a circle. Returns null if the stroke is
   * untouched, else the array of remaining pieces (possibly empty). */
  I.eraseCircle = function (el, cx, cy, r) {
    const R = r + halfW(el) * 0.6;
    const b = Q.model.elBBox(el);
    if (cx + R < b[0] || cx - R > b[2] || cy + R < b[1] || cy - R > b[3]) return null;
    const p = el.pts;
    const n = p.length / 3;
    const R2 = R * R;
    const inside = (i) => (p[i * 3] - cx) ** 2 + (p[i * 3 + 1] - cy) ** 2 <= R2;
    const at = (i, j, t) => [p[i * 3] + (p[j * 3] - p[i * 3]) * t, p[i * 3 + 1] + (p[j * 3 + 1] - p[i * 3 + 1]) * t, p[i * 3 + 2] + (p[j * 3 + 2] - p[i * 3 + 2]) * t];
    const roots = (i, j) => {
      const ax = p[i * 3] - cx;
      const ay = p[i * 3 + 1] - cy;
      const dx = p[j * 3] - p[i * 3];
      const dy = p[j * 3 + 1] - p[i * 3 + 1];
      const A = dx * dx + dy * dy;
      if (A < 1e-12) return null;
      const B = 2 * (ax * dx + ay * dy);
      const C = ax * ax + ay * ay - R2;
      const disc = B * B - 4 * A * C;
      if (disc < 0) return null;
      const s = Math.sqrt(disc);
      return [(-B - s) / (2 * A), (-B + s) / (2 * A)];
    };
    if (n === 1) return inside(0) ? [] : null;
    const runs = [];
    let run = [];
    let changed = false;
    const runStartsAtOrigin = [];
    let curStartOrigin = false;
    if (!inside(0)) {
      run.push([p[0], p[1], p[2]]);
      curStartOrigin = true;
    } else changed = true;
    for (let i = 1; i < n; i++) {
      const pIn = inside(i - 1);
      const cIn = inside(i);
      const cur = [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
      if (!pIn && !cIn) {
        const rt = roots(i - 1, i);
        if (rt && rt[0] > 0 && rt[0] < 1 && rt[1] > 0 && rt[1] < 1) {
          run.push(at(i - 1, i, rt[0]));
          runs.push(run);
          runStartsAtOrigin.push(curStartOrigin);
          run = [at(i - 1, i, rt[1])];
          curStartOrigin = false;
          changed = true;
        }
        run.push(cur);
      } else if (!pIn && cIn) {
        const rt = roots(i - 1, i);
        run.push(at(i - 1, i, rt ? U.clamp(rt[0], 0, 1) : 1));
        runs.push(run);
        runStartsAtOrigin.push(curStartOrigin);
        run = [];
        changed = true;
      } else if (pIn && !cIn) {
        const rt = roots(i - 1, i);
        run = [at(i - 1, i, rt ? U.clamp(rt[1], 0, 1) : 0), cur];
        curStartOrigin = false;
        changed = true;
      }
    }
    const endsAtOrigin = run.length > 0 && !inside(n - 1);
    if (run.length) {
      runs.push(run);
      runStartsAtOrigin.push(curStartOrigin);
    }
    if (!changed) return null;
    const out = [];
    const minLen = Math.max(0.4, el.w * 0.35);
    for (let k = 0; k < runs.length; k++) {
      const rr = runs[k];
      if (rr.length < 2) continue;
      let len = 0;
      for (let i = 1; i < rr.length; i++) len += Math.hypot(rr[i][0] - rr[i - 1][0], rr[i][1] - rr[i - 1][1]);
      if (len < minLen) continue;
      const pts = new Float32Array(rr.length * 3);
      rr.forEach((q, i) => {
        pts[i * 3] = q[0];
        pts[i * 3 + 1] = q[1];
        pts[i * 3 + 2] = q[2];
      });
      const isLast = k === runs.length - 1;
      out.push(
        Object.assign({}, el, {
          id: U.uid('e'),
          pts,
          ts: el.ts && runStartsAtOrigin[k] ? 1 : 0,
          te: el.te && isLast && endsAtOrigin ? 1 : 0,
        })
      );
    }
    return out;
  };

  function resample(xs, ys, N) {
    const n = xs.length;
    let total = 0;
    for (let i = 1; i < n; i++) total += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
    if (total <= 0) return null;
    const step = total / (N - 1);
    const ox = [xs[0]];
    const oy = [ys[0]];
    let acc = 0;
    let px = xs[0];
    let py = ys[0];
    for (let i = 1; i < n && ox.length < N; i++) {
      let qx = xs[i];
      let qy = ys[i];
      let d = Math.hypot(qx - px, qy - py);
      while (acc + d >= step && ox.length < N) {
        const t = (step - acc) / d;
        px = px + (qx - px) * t;
        py = py + (qy - py) * t;
        ox.push(px);
        oy.push(py);
        d = Math.hypot(qx - px, qy - py);
        acc = 0;
      }
      acc += d;
      px = qx;
      py = qy;
    }
    while (ox.length < N) {
      ox.push(xs[n - 1]);
      oy.push(ys[n - 1]);
    }
    return { x: ox, y: oy, total };
  }

  function rdp(xs, ys, eps) {
    const n = xs.length;
    const keep = new Uint8Array(n);
    keep[0] = keep[n - 1] = 1;
    const stack = [[0, n - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let maxD = 0;
      let idx = -1;
      for (let i = a + 1; i < b; i++) {
        const d = U.distSqToSeg(xs[i], ys[i], xs[a], ys[a], xs[b], ys[b]);
        if (d > maxD) {
          maxD = d;
          idx = i;
        }
      }
      if (idx > 0 && maxD > eps * eps) {
        keep[idx] = 1;
        stack.push([a, idx], [idx, b]);
      }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
    return out;
  }

  function snapAngle(a, tolDeg) {
    const step = Math.PI / 4;
    const k = Math.round(a / step);
    return Math.abs(a - k * step) < (tolDeg * Math.PI) / 180 ? k * step : a;
  }

  I.recognize = function (pts, tol) {
    tol = tol || 1;
    const n = pts.length / 3;
    if (n < 4) return null;
    const xs = [];
    const ys = [];
    for (let i = 0; i < n; i++) {
      xs.push(pts[i * 3]);
      ys.push(pts[i * 3 + 1]);
    }
    const rs = resample(xs, ys, 72);
    if (!rs || rs.total < 10) return null;
    const X = rs.x;
    const Y = rs.y;
    const N = X.length;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < N; i++) {
      minX = Math.min(minX, X[i]);
      maxX = Math.max(maxX, X[i]);
      minY = Math.min(minY, Y[i]);
      maxY = Math.max(maxY, Y[i]);
    }
    const D = Math.hypot(maxX - minX, maxY - minY);
    const endGap = Math.hypot(X[N - 1] - X[0], Y[N - 1] - Y[0]);
    const closed = endGap < Math.max(0.24 * D * tol, 8) && rs.total > 1.8 * D;

    if (!closed) {
      const C = endGap;
      let dev = 0;
      for (let i = 0; i < N; i++) dev = Math.max(dev, Math.sqrt(U.distSqToSeg(X[i], Y[i], X[0], Y[0], X[N - 1], Y[N - 1])));
      if (C > 8 && dev < Math.max(0.07 * C * tol, 2.2)) {
        const ang = snapAngle(Math.atan2(Y[N - 1] - Y[0], X[N - 1] - X[0]), 5);
        return { kind: 'line', x0: X[0], y0: Y[0], x1: X[0] + Math.cos(ang) * C, y1: Y[0] + Math.sin(ang) * C };
      }
      const keep = rdp(X, Y, 0.05 * D);
      if (keep.length >= 3 && keep.length <= 5) {
        let err = 0;
        for (let i = 0; i < N; i++) {
          let best = Infinity;
          for (let k = 0; k < keep.length - 1; k++) best = Math.min(best, U.distSqToSeg(X[i], Y[i], X[keep[k]], Y[keep[k]], X[keep[k + 1]], Y[keep[k + 1]]));
          err += Math.sqrt(best);
        }
        if (err / N / D < 0.02 * tol) {
          const ptsOut = [];
          for (const k of keep) ptsOut.push(X[k], Y[k]);
          return { kind: 'poly', closed: false, pts: ptsOut };
        }
      }
      return null;
    }

    // closed: ellipse fit (principal axes)
    const M = N - 1;
    let mx = 0, my = 0;
    for (let i = 0; i < M; i++) {
      mx += X[i];
      my += Y[i];
    }
    mx /= M;
    my /= M;
    let sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < M; i++) {
      const dx = X[i] - mx;
      const dy = Y[i] - my;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
    sxx /= M;
    syy /= M;
    sxy /= M;
    let theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const tr = (sxx + syy) / 2;
    const det = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy));
    let a = Math.sqrt(2 * (tr + det));
    let b = Math.sqrt(Math.max(1e-6, 2 * (tr - det)));
    let eErr = 0;
    {
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      for (let i = 0; i < M; i++) {
        const dx = X[i] - mx;
        const dy = Y[i] - my;
        const u = dx * c + dy * s;
        const v = -dx * s + dy * c;
        eErr += Math.abs(Math.sqrt((u / a) ** 2 + (v / b) ** 2) - 1);
      }
      eErr /= M;
    }
    const cx = X.slice(0, M).concat([X[0]]);
    const cy = Y.slice(0, M).concat([Y[0]]);
    let keep = rdp(cx, cy, 0.06 * D);
    let vx = keep.slice(0, -1).map((k) => cx[k]);
    let vy = keep.slice(0, -1).map((k) => cy[k]);
    // drop near-straight vertices (e.g. where the pen started mid-edge)
    let changed = true;
    while (changed && vx.length > 3) {
      changed = false;
      for (let i = 0; i < vx.length; i++) {
        const pI = (i - 1 + vx.length) % vx.length;
        const nI = (i + 1) % vx.length;
        const ax = vx[i] - vx[pI], ay = vy[i] - vy[pI];
        const bx = vx[nI] - vx[i], by = vy[nI] - vy[i];
        const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
        const cosT = (ax * bx + ay * by) / ((la * lb) || 1);
        if (cosT > 0.94 || la < 0.1 * D || lb < 0.08 * D) {
          vx.splice(i, 1);
          vy.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    let pErr = 0;
    for (let i = 0; i < M; i++) {
      let best = Infinity;
      for (let k = 0; k < vx.length; k++) {
        const k2 = (k + 1) % vx.length;
        best = Math.min(best, U.distSqToSeg(X[i], Y[i], vx[k], vy[k], vx[k2], vy[k2]));
      }
      pErr += Math.sqrt(best);
    }
    pErr = pErr / M / D;
    const nv = vx.length;
    if ((nv === 3 || nv === 4) && pErr < 0.032 * tol) {
      if (nv === 4) {
        let rightish = true;
        for (let i = 0; i < 4; i++) {
          const pI = (i + 3) % 4, nI = (i + 1) % 4;
          const ax = vx[pI] - vx[i], ay = vy[pI] - vy[i];
          const bx = vx[nI] - vx[i], by = vy[nI] - vy[i];
          const cosT = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1);
          if (Math.abs(cosT) > 0.33) rightish = false;
        }
        if (rightish) {
          // orientation: circular mean of 4θ
          let sc = 0, ss = 0;
          for (let i = 0; i < 4; i++) {
            const j = (i + 1) % 4;
            const ang = Math.atan2(vy[j] - vy[i], vx[j] - vx[i]);
            sc += Math.cos(4 * ang);
            ss += Math.sin(4 * ang);
          }
          let phi = Math.atan2(ss, sc) / 4;
          if (Math.abs(phi) < (7 * Math.PI) / 180) phi = 0;
          const c = Math.cos(phi), s = Math.sin(phi);
          const us = [], ws = [];
          for (let i = 0; i < 4; i++) {
            us.push(vx[i] * c + vy[i] * s);
            ws.push(-vx[i] * s + vy[i] * c);
          }
          us.sort((p, q) => p - q);
          ws.sort((p, q) => p - q);
          const u0 = (us[0] + us[1]) / 2, u1 = (us[2] + us[3]) / 2;
          const w0 = (ws[0] + ws[1]) / 2, w1 = (ws[2] + ws[3]) / 2;
          const corners = [[u0, w0], [u1, w0], [u1, w1], [u0, w1]];
          const out = [];
          for (const [u, w] of corners) out.push(u * c - w * s, u * s + w * c);
          return { kind: 'poly', closed: true, pts: out };
        }
      }
      const out = [];
      for (let i = 0; i < nv; i++) out.push(vx[i], vy[i]);
      return { kind: 'poly', closed: true, pts: out };
    }
    if (eErr < 0.13 * tol) {
      if (Math.abs(theta) < (7 * Math.PI) / 180) theta = 0;
      else if (Math.abs(Math.abs(theta) - Math.PI / 2) < (7 * Math.PI) / 180) {
        theta = 0;
        const t = a;
        a = b;
        b = t;
      }
      if (a / b < 1.12) {
        const r = (a + b) / 2;
        a = b = r;
        theta = 0;
      }
      return { kind: 'ellipse', cx: mx, cy: my, a, b, rot: theta };
    }
    if (nv >= 5 && nv <= 8 && pErr < 0.03 * tol) {
      const out = [];
      for (let i = 0; i < nv; i++) out.push(vx[i], vy[i]);
      return { kind: 'poly', closed: true, pts: out };
    }
    return null;
  };

  I.shapeCenter = function (sh) {
    if (sh.kind === 'ellipse') return [sh.cx, sh.cy];
    if (sh.kind === 'line') return [sh.x0, sh.y0];
    let x = 0, y = 0;
    const n = sh.pts.length / 2;
    for (let i = 0; i < n; i++) {
      x += sh.pts[i * 2];
      y += sh.pts[i * 2 + 1];
    }
    return [x / n, y / n];
  };
  I.scaleShape = function (sh, k) {
    const [cx, cy] = I.shapeCenter(sh);
    if (sh.kind === 'ellipse') return Object.assign({}, sh, { a: sh.a * k, b: sh.b * k });
    if (sh.kind === 'line') return sh;
    return Object.assign({}, sh, { pts: sh.pts.map((v, i) => (i % 2 ? cy + (v - cy) * k : cx + (v - cx) * k)) });
  };

  // Dense point list (x, y, p) along a shape.
  I.shapePoints = function (sh) {
    const out = [];
    const P = NOMINAL_P;
    const seg = (x0, y0, x1, y1, first) => {
      const l = Math.hypot(x1 - x0, y1 - y0);
      const k = Math.max(1, Math.ceil(l / 2));
      for (let j = first ? 0 : 1; j <= k; j++) out.push(x0 + ((x1 - x0) * j) / k, y0 + ((y1 - y0) * j) / k, P);
    };
    if (sh.kind === 'line') seg(sh.x0, sh.y0, sh.x1, sh.y1, true);
    else if (sh.kind === 'ellipse') {
      const per = Math.PI * (3 * (sh.a + sh.b) - Math.sqrt((3 * sh.a + sh.b) * (sh.a + 3 * sh.b)));
      const k = Math.max(32, Math.ceil(per / 2));
      const c = Math.cos(sh.rot), s = Math.sin(sh.rot);
      for (let j = 0; j <= k; j++) {
        const t = (j / k) * Math.PI * 2;
        const u = sh.a * Math.cos(t), v = sh.b * Math.sin(t);
        out.push(sh.cx + u * c - v * s, sh.cy + u * s + v * c, P);
      }
    } else {
      const p = sh.pts;
      const n = p.length / 2;
      for (let i = 0; i < n - 1; i++) seg(p[i * 2], p[i * 2 + 1], p[i * 2 + 2], p[i * 2 + 3], i === 0);
      if (sh.closed) seg(p[(n - 1) * 2], p[(n - 1) * 2 + 1], p[0], p[1], false);
    }
    return new Float32Array(out);
  };

  // Sample stroke for menus/previews: draws a wavy line into a canvas.
  I.preview = function (canvas, kind, color, size, dark) {
    const g = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    g.clearRect(0, 0, w, h);
    const pts = [];
    const N = 60;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const x = w * 0.08 + t * w * 0.84;
      const y = h / 2 + Math.sin(t * Math.PI * 2) * h * 0.22;
      const p = 0.35 + 0.65 * Math.sin(t * Math.PI);
      pts.push(x, y, NOMINAL_P + (p - NOMINAL_P) * 0.9);
    }
    const scale = canvas.clientWidth ? canvas.width / canvas.clientWidth : 2;
    const el = { t: 's', k: kind, c: color, w: size * scale, pts: new Float32Array(pts), ts: 1, te: 1 };
    I.drawStroke(g, el, { dark }, true);
  };
})((window.Q = window.Q || {}));
