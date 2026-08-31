(function (Q) {
  'use strict';
  const U = Q.util;
  const M = Q.model;
  const P = (Q.paper = {});

  const SANS = '-apple-system, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  P.paperHex = (page) => M.paperColor(page.tpl && page.tpl.c);
  P.isDark = (page) => U.isDark(P.paperHex(page));

  P.colors = function (hex) {
    if (U.isDark(hex))
      return {
        line: 'rgba(255,255,255,0.17)',
        faint: 'rgba(255,255,255,0.09)',
        strong: 'rgba(255,255,255,0.28)',
        dot: 'rgba(255,255,255,0.34)',
        margin: 'rgba(255,128,140,0.42)',
        text: 'rgba(255,255,255,0.46)',
      };
    const legal = hex.toUpperCase() === '#FFF6C7';
    return {
      line: legal ? 'rgba(60,110,170,0.36)' : 'rgba(70,108,150,0.30)',
      faint: 'rgba(70,108,150,0.15)',
      strong: 'rgba(55,80,110,0.45)',
      dot: 'rgba(40,54,72,0.42)',
      margin: legal ? 'rgba(214,72,84,0.62)' : 'rgba(214,92,104,0.45)',
      text: 'rgba(55,66,78,0.56)',
    };
  };

  // ctx is already in page points. rect = [x0,y0,x1,y1] region to draw (page points). ds = device px per pt.
  P.draw = function (ctx, page, rect, ds) {
    const hex = P.paperHex(page);
    const col = P.colors(hex);
    const x0 = Math.max(0, rect[0]);
    const y0 = Math.max(0, rect[1]);
    const x1 = Math.min(page.w, rect[2]);
    const y1 = Math.min(page.h, rect[3]);
    if (x1 <= x0 || y1 <= y0) return;
    ctx.fillStyle = hex;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    if (page.bg && page.bg.hideTpl) return;
    const kind = (page.tpl && page.tpl.k) || 'blank';
    const t = page.tpl && page.tpl.sp ? Object.assign({}, M.template(kind), { sp: page.tpl.sp }) : M.template(kind);
    const lw = Math.max(0.45, 1 / ds);
    const W = page.w;
    const H = page.h;
    const r = { x0, y0, x1, y1 };
    ctx.save();
    ctx.lineCap = 'butt';
    const hline = (y, xa, xb, color, width) => {
      if (y < r.y0 - 2 || y > r.y1 + 2) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = width || lw;
      ctx.beginPath();
      ctx.moveTo(Math.max(xa, r.x0 - 1), y);
      ctx.lineTo(Math.min(xb, r.x1 + 1), y);
      ctx.stroke();
    };
    const vline = (x, ya, yb, color, width) => {
      if (x < r.x0 - 2 || x > r.x1 + 2) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = width || lw;
      ctx.beginPath();
      ctx.moveTo(x, Math.max(ya, r.y0 - 1));
      ctx.lineTo(x, Math.min(yb, r.y1 + 1));
      ctx.stroke();
    };
    const label = (txt, x, y, size, align) => {
      if (y < r.y0 - 20 || y > r.y1 + 20) return;
      ctx.fillStyle = col.text;
      ctx.font = `600 ${size || 7.5}px ${SANS}`;
      ctx.textAlign = align || 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(txt, x, y);
    };
    const ruled = (sp, top, bottom, xa, xb, color) => {
      const first = Math.max(0, Math.ceil((r.y0 - top) / sp));
      for (let i = first; ; i++) {
        const y = top + i * sp;
        if (y > bottom || y > r.y1 + 1) break;
        hline(y, xa, xb, color || col.line);
      }
    };
    const box = (bx, by, s) => {
      ctx.strokeStyle = col.strong;
      ctx.lineWidth = Math.max(0.6, 1 / ds);
      ctx.strokeRect(bx, by, s, s);
    };

    switch (kind) {
      case 'ruled':
      case 'narrow':
      case 'wide': {
        const sp = t.sp;
        const top = Math.round(Math.max(64, H * 0.085) / sp) * sp;
        ruled(sp, top, H - 30, 0, W);
        vline(Math.min(64, W * 0.11), 0, H, col.margin, Math.max(0.6, 1 / ds));
        break;
      }
      case 'grid':
      case 'grid-s': {
        const sp = t.sp;
        const ox = (W % sp) / 2;
        const oy = (H % sp) / 2;
        const c = kind === 'grid-s' ? col.faint : col.faint;
        const fx = Math.max(0, Math.floor((r.x0 - ox) / sp));
        const fy = Math.max(0, Math.floor((r.y0 - oy) / sp));
        for (let i = fx; ox + i * sp <= Math.min(W, r.x1 + 1); i++) {
          const major = kind === 'grid-s' && i % 5 === 0;
          vline(ox + i * sp, 0, H, major ? col.line : c);
        }
        for (let j = fy; oy + j * sp <= Math.min(H, r.y1 + 1); j++) {
          const major = kind === 'grid-s' && j % 5 === 0;
          hline(oy + j * sp, 0, W, major ? col.line : c);
        }
        break;
      }
      case 'dots': {
        const sp = t.sp;
        const ox = (W % sp) / 2 || sp / 2;
        const oy = (H % sp) / 2 || sp / 2;
        const rad = Math.max(0.62, 0.9 / ds);
        ctx.fillStyle = col.dot;
        ctx.beginPath();
        const fx = Math.max(0, Math.floor((r.x0 - ox) / sp));
        const fy = Math.max(0, Math.floor((r.y0 - oy) / sp));
        for (let j = fy; oy + j * sp <= Math.min(H, r.y1 + 1); j++) {
          const y = oy + j * sp;
          for (let i = fx; ox + i * sp <= Math.min(W, r.x1 + 1); i++) {
            const x = ox + i * sp;
            ctx.moveTo(x + rad, y);
            ctx.arc(x, y, rad, 0, Math.PI * 2);
          }
        }
        ctx.fill();
        break;
      }
      case 'cornell': {
        const sp = t.sp;
        const head = 66;
        const sumTop = Math.round(H * 0.78);
        const cue = Math.round(W * 0.29);
        ruled(sp, head + sp, sumTop - 4, cue, W);
        ruled(sp, sumTop + sp * 1.4, H - 24, 0, W, col.faint);
        hline(head, 0, W, col.strong, Math.max(0.9, 1.2 / ds));
        hline(sumTop, 0, W, col.strong, Math.max(0.9, 1.2 / ds));
        vline(cue, head, sumTop, col.strong, Math.max(0.9, 1.2 / ds));
        label('TOPIC', 24, 26);
        label('DATE', W * 0.68, 26);
        label('CUES', 24, head + 16);
        label('NOTES', cue + 14, head + 16);
        label('SUMMARY', 24, sumTop + 16);
        break;
      }
      case 'todo': {
        const sp = t.sp;
        const top = 84;
        label('TO-DO', 40, 46, 9);
        hline(56, 40, W - 40, col.strong, Math.max(0.8, 1.1 / ds));
        const first = Math.max(0, Math.floor((r.y0 - top) / sp));
        for (let i = first; ; i++) {
          const y = top + i * sp;
          if (y > H - 28 || y > r.y1 + sp) break;
          hline(y, 64, W - 40, col.line);
          if (y - sp * 0.5 > r.y0 - sp && y - sp < r.y1) box(42, y - 15, 12);
        }
        break;
      }
      case 'music': {
        const gap = 6.2;
        const period = 66;
        for (let s = 0; ; s++) {
          const top = 70 + s * period;
          if (top + gap * 4 > H - 30) break;
          if (top + gap * 4 < r.y0 - 2 || top > r.y1 + 2) continue;
          for (let k = 0; k < 5; k++) hline(top + k * gap, 36, W - 36, col.strong);
          vline(36, top, top + gap * 4, col.strong);
          vline(W - 36, top, top + gap * 4, col.strong);
        }
        break;
      }
      case 'iso': {
        const s = t.sp;
        const h = (s * Math.sqrt(3)) / 2;
        const diag = Math.hypot(W, H) + 10;
        ctx.strokeStyle = col.faint;
        ctx.lineWidth = lw;
        ctx.beginPath();
        for (const ang of [Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6]) {
          const dx = Math.cos(ang);
          const dy = Math.sin(ang);
          const nx = -dy;
          const ny = dx;
          const cs = [x0 * nx + y0 * ny, x1 * nx + y0 * ny, x0 * nx + y1 * ny, x1 * nx + y1 * ny];
          const k0 = Math.floor(Math.min(...cs) / h) - 1;
          const k1 = Math.ceil(Math.max(...cs) / h) + 1;
          for (let k = k0; k <= k1; k++) {
            const px = nx * k * h;
            const py = ny * k * h;
            ctx.moveTo(px - dx * diag, py - dy * diag);
            ctx.lineTo(px + dx * diag, py + dy * diag);
          }
        }
        ctx.stroke();
        break;
      }
      case 'daily': {
        const m = 36;
        label('DATE', m, 44, 9);
        hline(52, m + 34, W * 0.55, col.line);
        label('M  T  W  T  F  S  S', W - m, 44, 8, 'right');
        hline(64, m, W - m, col.strong, Math.max(0.9, 1.2 / ds));
        const colX = Math.round(W * 0.58);
        const top = 88;
        const bottom = H - 36;
        const hours = 15;
        const rowH = (bottom - top) / hours;
        for (let i = 0; i <= hours; i++) {
          const y = top + i * rowH;
          hline(y, m, colX - 16, i === 0 ? col.strong : col.line);
          if (i < hours) {
            hline(y + rowH / 2, m + 34, colX - 16, col.faint);
            const hr = 7 + i;
            const txt = (hr % 12 === 0 ? 12 : hr % 12) + (hr < 12 ? ' AM' : ' PM');
            label(txt, m, y + 11, 7);
          }
        }
        vline(m + 30, top, bottom, col.faint);
        label('SCHEDULE', m, top - 8, 8);
        const rx = colX + 4;
        label('PRIORITIES', rx, top - 8, 8);
        let y = top;
        for (let i = 0; i < 3; i++) {
          y += 26;
          box(rx, y - 13, 11);
          hline(y, rx + 18, W - m, col.line);
        }
        y += 34;
        label('TO-DO', rx, y, 8);
        for (let i = 0; i < 7; i++) {
          y += 26;
          box(rx, y - 13, 11);
          hline(y, rx + 18, W - m, col.line);
        }
        y += 34;
        label('NOTES', rx, y, 8);
        ruled(22, y + 22, bottom, rx, W - m);
        break;
      }
      case 'weekly': {
        const m = 32;
        label('WEEK OF', m, 42, 9);
        hline(50, m + 52, W * 0.5, col.line);
        const top = 66;
        const days = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY', 'NOTES'];
        const cols = 2;
        const rows = 4;
        const bw = (W - m * 2 - 12) / cols;
        const bh = (H - top - m - 12 * (rows - 1)) / rows;
        for (let i = 0; i < 8; i++) {
          const cx = m + (i % cols) * (bw + 12);
          const cy = top + Math.floor(i / cols) * (bh + 12);
          if (cy > r.y1 || cy + bh < r.y0) continue;
          ctx.strokeStyle = col.strong;
          ctx.lineWidth = Math.max(0.7, 1 / ds);
          ctx.strokeRect(cx, cy, bw, bh);
          label(days[i], cx + 10, cy + 17, 7.5);
          ruled(20, cy + 40, cy + bh - 8, cx + 10, cx + bw - 10, col.faint);
        }
        break;
      }
      case 'monthly': {
        const m = 30;
        label('MONTH', m, 44, 9);
        hline(52, m + 46, W * 0.5, col.line);
        const names = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
        const top = 82;
        const cw = (W - m * 2) / 7;
        const ch = (H - top - m) / 6;
        names.forEach((n, i) => label(n, m + i * cw + cw / 2, top - 8, 7.5, 'center'));
        for (let i = 0; i <= 7; i++) vline(m + i * cw, top, top + ch * 6, col.strong);
        for (let j = 0; j <= 6; j++) hline(top + j * ch, m, W - m, col.strong);
        break;
      }
      default:
        break;
    }
    ctx.restore();
  };

  // Small preview of a template into a canvas (for pickers).
  P.thumb = function (canvas, tplId, paperId, sizeKey, orient, sp) {
    const size = M.PAGE_SIZES[sizeKey] || M.PAGE_SIZES.a4;
    const land = orient === 'l';
    const page = { w: land ? size.h : size.w, h: land ? size.w : size.h, tpl: sp ? { k: tplId, c: paperId, sp } : { k: tplId, c: paperId } };
    const g = canvas.getContext('2d');
    const s = Math.min(canvas.width / page.w, canvas.height / page.h);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.setTransform(s, 0, 0, s, (canvas.width - page.w * s) / 2, (canvas.height - page.h * s) / 2);
    P.draw(g, page, [0, 0, page.w, page.h], s * 1.4);
    g.setTransform(1, 0, 0, 1, 0, 0);
  };
})((window.Q = window.Q || {}));
