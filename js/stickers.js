(function (Q) {
  'use strict';
  const S = (Q.stickers = {});
  const TAU = Math.PI * 2;
  const SANS = '-apple-system, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  function rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function disc(g, x, y, r, fill) {
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fillStyle = fill;
    g.fill();
  }
  function shine(g, x, y, rx, ry) {
    g.save();
    g.globalAlpha = 0.28;
    g.fillStyle = '#FFFFFF';
    g.beginPath();
    g.ellipse(x, y, rx, ry, -0.5, 0, TAU);
    g.fill();
    g.restore();
  }

  const MARKS = [
    {
      id: 'star',
      name: 'Star',
      draw(g) {
        g.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const r = i % 2 ? 21 : 46;
          g.lineTo(50 + Math.cos(a) * r, 54 + Math.sin(a) * r);
        }
        g.closePath();
        g.fillStyle = '#F7C948';
        g.fill();
        g.lineJoin = 'round';
        g.lineWidth = 4;
        g.strokeStyle = '#C98F22';
        g.stroke();
        shine(g, 40, 40, 7, 4);
      },
    },
    {
      id: 'heart',
      name: 'Heart',
      draw(g) {
        g.beginPath();
        g.moveTo(50, 88);
        g.bezierCurveTo(12, 62, 4, 38, 18, 22);
        g.bezierCurveTo(31, 8, 47, 14, 50, 29);
        g.bezierCurveTo(53, 14, 69, 8, 82, 22);
        g.bezierCurveTo(96, 38, 88, 62, 50, 88);
        g.closePath();
        g.fillStyle = '#EF4E68';
        g.fill();
        shine(g, 30, 32, 9, 5);
      },
    },
    {
      id: 'check',
      name: 'Done',
      draw(g) {
        disc(g, 50, 50, 44, '#2FA866');
        g.strokeStyle = '#FFFFFF';
        g.lineWidth = 10;
        g.lineCap = 'round';
        g.lineJoin = 'round';
        g.beginPath();
        g.moveTo(29, 52);
        g.lineTo(44, 66);
        g.lineTo(72, 36);
        g.stroke();
      },
    },
    {
      id: 'cross',
      name: 'No',
      draw(g) {
        disc(g, 50, 50, 44, '#E5484D');
        g.strokeStyle = '#FFFFFF';
        g.lineWidth = 10;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(34, 34);
        g.lineTo(66, 66);
        g.moveTo(66, 34);
        g.lineTo(34, 66);
        g.stroke();
      },
    },
    {
      id: 'warn',
      name: 'Warning',
      draw(g) {
        g.beginPath();
        g.moveTo(50, 8);
        g.lineTo(94, 86);
        g.lineTo(6, 86);
        g.closePath();
        g.lineJoin = 'round';
        g.lineWidth = 10;
        g.strokeStyle = '#F5B800';
        g.fillStyle = '#F5B800';
        g.stroke();
        g.fill();
        g.fillStyle = '#2B2B2B';
        rr(g, 45, 34, 10, 30, 5);
        g.fill();
        disc(g, 50, 74, 6, '#2B2B2B');
      },
    },
    {
      id: 'idea',
      name: 'Idea',
      draw(g) {
        g.fillStyle = '#9AA3AE';
        rr(g, 37, 66, 26, 22, 5);
        g.fill();
        g.strokeStyle = '#7B848F';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(38, 74);
        g.lineTo(62, 74);
        g.moveTo(38, 81);
        g.lineTo(62, 81);
        g.stroke();
        g.beginPath();
        g.arc(50, 40, 29, 0.8 * Math.PI, 0.2 * Math.PI);
        g.lineTo(62, 66);
        g.lineTo(38, 66);
        g.closePath();
        g.fillStyle = '#FFE066';
        g.fill();
        g.strokeStyle = '#D9A400';
        g.lineWidth = 4;
        g.stroke();
        shine(g, 40, 30, 8, 5);
      },
    },
    {
      id: 'pin',
      name: 'Pin',
      draw(g) {
        g.strokeStyle = '#8A8F98';
        g.lineWidth = 5;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(50, 54);
        g.lineTo(50, 94);
        g.stroke();
        disc(g, 50, 34, 26, '#E5484D');
        disc(g, 50, 34, 14, '#F27A7E');
        shine(g, 42, 26, 6, 4);
      },
    },
    {
      id: 'note',
      name: 'Sticky note',
      draw(g) {
        g.save();
        g.shadowColor = 'rgba(0,0,0,0.18)';
        g.shadowBlur = 6;
        g.shadowOffsetY = 3;
        g.beginPath();
        g.moveTo(8, 8);
        g.lineTo(92, 8);
        g.lineTo(92, 72);
        g.lineTo(72, 92);
        g.lineTo(8, 92);
        g.closePath();
        g.fillStyle = '#FFE98A';
        g.fill();
        g.restore();
        g.beginPath();
        g.moveTo(92, 72);
        g.lineTo(72, 72);
        g.lineTo(72, 92);
        g.closePath();
        g.fillStyle = '#EED05A';
        g.fill();
      },
    },
    {
      id: 'bubble',
      name: 'Speech',
      draw(g) {
        rr(g, 6, 10, 88, 62, 16);
        g.moveTo(26, 70);
        g.lineTo(22, 92);
        g.lineTo(44, 72);
        g.fillStyle = '#FFFFFF';
        g.fill();
        g.lineWidth = 4;
        g.lineJoin = 'round';
        g.strokeStyle = '#2E3A46';
        rr(g, 6, 10, 88, 62, 16);
        g.stroke();
        g.fillStyle = '#FFFFFF';
        g.beginPath();
        g.moveTo(25, 69);
        g.lineTo(22, 92);
        g.lineTo(45, 70);
        g.fill();
        g.beginPath();
        g.moveTo(25, 72);
        g.lineTo(22, 92);
        g.lineTo(45, 72);
        g.stroke();
      },
    },
    {
      id: 'arrow',
      name: 'Arrow',
      draw(g) {
        g.beginPath();
        g.moveTo(8, 38);
        g.lineTo(56, 38);
        g.lineTo(56, 18);
        g.lineTo(94, 50);
        g.lineTo(56, 82);
        g.lineTo(56, 62);
        g.lineTo(8, 62);
        g.closePath();
        g.lineJoin = 'round';
        g.fillStyle = '#3B82F6';
        g.strokeStyle = '#2F6CD6';
        g.lineWidth = 4;
        g.fill();
        g.stroke();
      },
    },
    {
      id: 'sun',
      name: 'Sun',
      draw(g) {
        g.strokeStyle = '#FDB022';
        g.lineWidth = 7;
        g.lineCap = 'round';
        g.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          g.moveTo(50 + Math.cos(a) * 31, 50 + Math.sin(a) * 31);
          g.lineTo(50 + Math.cos(a) * 44, 50 + Math.sin(a) * 44);
        }
        g.stroke();
        disc(g, 50, 50, 22, '#FDB022');
        shine(g, 43, 43, 6, 4);
      },
    },
    {
      id: 'cloud',
      name: 'Cloud',
      draw(g) {
        g.beginPath();
        g.arc(32, 60, 18, Math.PI * 0.5, Math.PI * 1.5);
        g.arc(46, 40, 20, Math.PI, Math.PI * 1.85);
        g.arc(68, 46, 18, Math.PI * 1.3, Math.PI * 0.2);
        g.arc(70, 64, 14, Math.PI * 1.6, Math.PI * 0.5);
        g.closePath();
        g.fillStyle = '#CFE3F7';
        g.fill();
        g.lineWidth = 4;
        g.strokeStyle = '#86AED6';
        g.lineJoin = 'round';
        g.stroke();
      },
    },
    {
      id: 'bolt',
      name: 'Lightning',
      draw(g) {
        g.beginPath();
        g.moveTo(58, 6);
        g.lineTo(20, 56);
        g.lineTo(46, 56);
        g.lineTo(38, 94);
        g.lineTo(80, 40);
        g.lineTo(54, 40);
        g.closePath();
        g.lineJoin = 'round';
        g.fillStyle = '#FFC83D';
        g.strokeStyle = '#D99A00';
        g.lineWidth = 4;
        g.fill();
        g.stroke();
      },
    },
    {
      id: 'flower',
      name: 'Flower',
      draw(g) {
        g.fillStyle = '#FF8FB8';
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + (i * TAU) / 5;
          g.beginPath();
          g.ellipse(50 + Math.cos(a) * 24, 50 + Math.sin(a) * 24, 19, 14, a, 0, TAU);
          g.fill();
        }
        disc(g, 50, 50, 15, '#FFD34E');
      },
    },
    {
      id: 'ribbon',
      name: 'Bookmark',
      draw(g) {
        g.beginPath();
        g.moveTo(26, 4);
        g.lineTo(74, 4);
        g.lineTo(74, 94);
        g.lineTo(50, 74);
        g.lineTo(26, 94);
        g.closePath();
        g.fillStyle = '#E5484D';
        g.fill();
        g.fillStyle = 'rgba(0,0,0,0.12)';
        g.fillRect(26, 4, 48, 8);
      },
    },
    {
      id: 'smile',
      name: 'Smile',
      draw(g) {
        disc(g, 50, 50, 44, '#FFD34E');
        disc(g, 36, 40, 6, '#3A2A12');
        disc(g, 64, 40, 6, '#3A2A12');
        g.strokeStyle = '#3A2A12';
        g.lineWidth = 6;
        g.lineCap = 'round';
        g.beginPath();
        g.arc(50, 52, 22, 0.2 * Math.PI, 0.8 * Math.PI);
        g.stroke();
      },
    },
    {
      id: 'question',
      name: 'Question',
      draw(g) {
        disc(g, 50, 50, 44, '#6B3FC4');
        g.fillStyle = '#FFFFFF';
        g.font = `800 60px ${SANS}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('?', 50, 54);
      },
    },
    {
      id: 'target',
      name: 'Goal',
      draw(g) {
        disc(g, 50, 50, 44, '#E5484D');
        disc(g, 50, 50, 33, '#FFFFFF');
        disc(g, 50, 50, 22, '#E5484D');
        disc(g, 50, 50, 11, '#FFFFFF');
      },
    },
  ].map((d) => Object.assign({ w: 100, h: 100, cat: 'marks' }, d));

  const LABELS = [
    ['To-do', '#2453C6', '#FFFFFF'],
    ['Done', '#1E8A4C', '#FFFFFF'],
    ['Important', '#D2343C', '#FFFFFF'],
    ['Idea', '#F5B800', '#2B2209'],
    ['Due', '#B5652B', '#FFFFFF'],
    ['Review', '#6B3FC4', '#FFFFFF'],
    ['Exam', '#33373D', '#FFFFFF'],
    ['Note', '#2F6F7A', '#FFFFFF'],
  ].map(([txt, bg, fg]) => ({
    id: 'label-' + txt.toLowerCase(),
    name: txt,
    cat: 'labels',
    w: 200,
    h: 60,
    draw(g) {
      rr(g, 3, 3, 194, 54, 27);
      g.fillStyle = bg;
      g.fill();
      g.fillStyle = fg;
      g.font = `700 28px ${SANS}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(txt, 100, 31.5);
    },
  }));

  function tapePath(g, w, h) {
    const z = 6;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(w, 0);
    for (let y = 0, k = 0; y < h; y += z, k++) g.lineTo(w - (k % 2 ? 0 : 5), Math.min(h, y + z));
    g.lineTo(0, h);
    for (let y = h, k = 0; y > 0; y -= z, k++) g.lineTo(k % 2 ? 0 : 5, Math.max(0, y - z));
    g.closePath();
  }
  const TAPES = [
    ['mint', '#A8E6CF', (g, w, h) => stripes(g, w, h, 'rgba(255,255,255,0.55)', 14)],
    ['rose', '#F7C3D0', (g, w, h) => dots(g, w, h, 'rgba(255,255,255,0.75)', 12)],
    ['sky', '#BBD7F5', (g, w, h) => gridLines(g, w, h, 'rgba(255,255,255,0.7)', 10)],
    ['kraft', '#D7BF9A', (g, w, h) => stripes(g, w, h, 'rgba(120,85,40,0.18)', 5)],
    ['lemon', '#FFE48A', (g, w, h) => stripes(g, w, h, 'rgba(255,255,255,0.6)', 18)],
    ['masking', '#E9E2D2', () => {}],
    ['lilac', '#D9C8F5', (g, w, h) => dots(g, w, h, 'rgba(120,80,190,0.25)', 9)],
    ['coral', '#FFB4A2', (g, w, h) => gridLines(g, w, h, 'rgba(255,255,255,0.6)', 14)],
  ].map(([name, base, pat]) => ({
    id: 'tape-' + name,
    name: name[0].toUpperCase() + name.slice(1) + ' tape',
    cat: 'tape',
    w: 240,
    h: 46,
    draw(g) {
      g.save();
      g.globalAlpha = 0.86;
      tapePath(g, 240, 46);
      g.clip();
      g.fillStyle = base;
      g.fillRect(0, 0, 240, 46);
      pat(g, 240, 46);
      g.restore();
    },
  }));
  function stripes(g, w, h, color, gap) {
    g.strokeStyle = color;
    g.lineWidth = gap * 0.45;
    g.beginPath();
    for (let x = -h; x < w + h; x += gap) {
      g.moveTo(x, h);
      g.lineTo(x + h, 0);
    }
    g.stroke();
  }
  function dots(g, w, h, color, gap) {
    g.fillStyle = color;
    g.beginPath();
    for (let y = gap / 2, row = 0; y < h; y += gap, row++)
      for (let x = (row % 2 ? gap / 2 : 0) + gap / 2; x < w; x += gap) {
        g.moveTo(x + gap * 0.18, y);
        g.arc(x, y, gap * 0.18, 0, TAU);
      }
    g.fill();
  }
  function gridLines(g, w, h, color, gap) {
    g.strokeStyle = color;
    g.lineWidth = 1.6;
    g.beginPath();
    for (let x = gap / 2; x < w; x += gap) {
      g.moveTo(x, 0);
      g.lineTo(x, h);
    }
    for (let y = gap / 2; y < h; y += gap) {
      g.moveTo(0, y);
      g.lineTo(w, y);
    }
    g.stroke();
  }

  const EMOJI = ['😀', '😊', '😍', '🥳', '🤔', '😎', '😴', '😭', '👍', '👏', '🙌', '💪', '🎉', '🔥', '⭐️', '✨', '❤️', '💡', '📌', '📎', '📅', '⏰', '🎯', '🚀', '🌈', '☕️', '🍀', '🎵', '✅', '❗️'];

  S.CATS = [
    { id: 'marks', name: 'Marks' },
    { id: 'labels', name: 'Labels' },
    { id: 'tape', name: 'Washi tape' },
    { id: 'emoji', name: 'Emoji' },
  ];
  S.list = MARKS.concat(LABELS, TAPES);
  const byId = new Map(S.list.map((d) => [d.id, d]));
  S.emoji = EMOJI;

  S.get = function (id) {
    if (byId.has(id)) return byId.get(id);
    if (typeof id === 'string' && id.startsWith('e:')) {
      const ch = id.slice(2);
      const d = {
        id,
        name: 'Emoji',
        cat: 'emoji',
        w: 100,
        h: 100,
        draw(g) {
          g.font = '84px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillStyle = '#000';
          g.fillText(ch, 50, 54);
        },
      };
      byId.set(id, d);
      return d;
    }
    return null;
  };
  S.inCat = (cat) => (cat === 'emoji' ? EMOJI.map((e) => S.get('e:' + e)) : S.list.filter((d) => d.cat === cat));

  S.draw = function (ctx, el) {
    const def = S.get(el.n);
    ctx.save();
    ctx.translate(el.x + el.w / 2, el.y + el.h / 2);
    if (el.r) ctx.rotate(el.r);
    if (!def) {
      ctx.strokeStyle = 'rgba(120,120,120,0.6)';
      ctx.strokeRect(-el.w / 2, -el.h / 2, el.w, el.h);
      ctx.restore();
      return;
    }
    ctx.scale(el.w / def.w, el.h / def.h);
    ctx.translate(-def.w / 2, -def.h / 2);
    def.draw(ctx);
    ctx.restore();
  };

  S.defaultSize = function (def) {
    if (def.cat === 'tape') return { w: 170, h: 32.6 };
    if (def.cat === 'labels') return { w: 92, h: 27.6 };
    return { w: 64, h: 64 };
  };

  S.thumb = function (canvas, def) {
    const g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    const pad = 6;
    const s = Math.min((canvas.width - pad * 2) / def.w, (canvas.height - pad * 2) / def.h);
    g.setTransform(s, 0, 0, s, (canvas.width - def.w * s) / 2, (canvas.height - def.h * s) / 2);
    def.draw(g);
    g.setTransform(1, 0, 0, 1, 0, 0);
  };
})((window.Q = window.Q || {}));
