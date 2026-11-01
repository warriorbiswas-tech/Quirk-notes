(function (Q) {
  'use strict';
  const U = Q.util;
  const M = Q.model;
  const IO = (Q.io = {});

  // Hands a file to the Android app in pieces, which then asks where to save it.
  async function saveOnAndroid(blob, filename) {
    const CHUNK = 3 * 1024 * 1024; // a multiple of 3, so each piece is valid base64 by itself
    const bridge = window.QuireAndroid;
    bridge.begin(filename, blob.type || 'application/octet-stream');
    for (let at = 0; at < blob.size; at += CHUNK) {
      const dataUrl = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = () => rej(r.error);
        r.readAsDataURL(blob.slice(at, at + CHUNK));
      });
      bridge.append(dataUrl.slice(dataUrl.indexOf(',') + 1));
    }
    return new Promise((res) => {
      IO.androidSaved = res;
      bridge.finish();
    });
  }

  async function deliver(blob, filename) {
    if (window.QuireAndroid) {
      const r = await saveOnAndroid(blob, filename).catch(() => 'failed');
      if (r === 'failed') Q.ui.toast('Couldn’t save ' + filename, { error: true });
      return r;
    }
    try {
      const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
      if (navigator.canShare && navigator.canShare({ files: [file] }) && U.isTouch()) {
        await navigator.share({ files: [file], title: filename });
        return 'shared';
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
    const url = URL.createObjectURL(blob);
    const a = U.h('a', { href: url, download: filename, style: 'display:none' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return 'downloaded';
  }
  IO.deliver = deliver;

  // Show a "ready" sheet so the share sheet opens from a fresh tap (iPad requires it).
  IO.offerFile = function (blob, filename, label) {
    const name = U.h('div', { class: 'file-name' }, filename);
    const size = U.h('div', { class: 'file-size' }, U.fmtBytes(blob.size));
    Q.ui.sheet({
      title: label || 'Export ready',
      className: 'sheet-alert',
      body: U.h('div', { class: 'file-card' }, Q.icon(/\.pdf$/i.test(filename) ? 'pdf' : 'file'), U.h('div', null, name, size)),
      actions: [
        { label: 'Close' },
        {
          label: window.QuireAndroid ? 'Save…' : U.isTouch() ? 'Save or share…' : 'Download',
          primary: true,
          onClick: async () => {
            const r = await deliver(blob, filename);
            if (r === 'downloaded' || r === 'saved') Q.ui.toast('Saved ' + filename);
          },
        },
      ],
    });
  };

  IO.prepareImage = async function (file, maxDim = 2400) {
    const img = await U.decodeImage(file);
    const { w, h } = U.imgSize(img);
    if (!w || !h) throw new Error('Unreadable image');
    const k = Math.min(1, maxDim / Math.max(w, h));
    const type = /png|gif|webp/i.test(file.type) ? 'image/png' : 'image/jpeg';
    if (k === 1 && (file.type === 'image/jpeg' || file.type === 'image/png') && file.size < 6e6) {
      return { blob: file, w, h, img, type: file.type };
    }
    const c = U.makeCanvas(w * k, h * k);
    const g = c.getContext('2d');
    if (type === 'image/jpeg') {
      g.fillStyle = '#FFFFFF';
      g.fillRect(0, 0, c.width, c.height);
    }
    g.drawImage(img, 0, 0, c.width, c.height);
    const blob = await U.canvasToBlob(c, type, 0.9);
    const out = await U.decodeImage(blob);
    const { width, height } = c;
    U.freeCanvas(c);
    try {
      if (img.close) img.close();
    } catch (e) {}
    return { blob, w: width, h: height, img: out, type };
  };

  IO.storeImage = async function (prep) {
    const key = U.uid('a');
    await Q.store.putAsset(key, { blob: prep.blob, type: prep.type, w: prep.w, h: prep.h });
    if (prep.img) Q.render.images.put(key, prep.img);
    return key;
  };

  IO.pickFiles = function (accept, multiple) {
    return new Promise((resolve) => {
      const input = U.h('input', { type: 'file', accept, multiple: !!multiple, style: 'position:fixed;left:-1000px;top:0;opacity:0' });
      let done = false;
      input.addEventListener('change', () => {
        done = true;
        resolve(Array.from(input.files || []));
        input.remove();
      });
      input.addEventListener('cancel', () => {
        done = true;
        resolve([]);
        input.remove();
      });
      // iPad fires no event on cancel; resolve empty when focus returns
      window.addEventListener(
        'focus',
        () =>
          setTimeout(() => {
            if (!done) {
              resolve([]);
              input.remove();
            }
          }, 1200),
        { once: true }
      );
      document.body.appendChild(input);
      input.click();
    });
  };

  // pages from images (one image per page, page sized to the image's aspect)
  IO.imagesToPages = async function (files, onProgress) {
    const pages = [];
    for (let i = 0; i < files.length; i++) {
      onProgress && onProgress(i / files.length, `Image ${i + 1} of ${files.length}`);
      const prep = await IO.prepareImage(files[i], 2600);
      const key = await IO.storeImage(prep);
      const w = 595;
      const h = Math.round((595 * prep.h) / prep.w);
      pages.push(M.newPage({ w, h, tpl: 'blank', paper: 'white', bg: { a: key, kind: 'image' } }));
    }
    return pages;
  };

  let pdfjsP = null;
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => res();
      s.onerror = () => rej(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }
  IO.loadPdfJs = function () {
    if (pdfjsP) return pdfjsP;
    pdfjsP = (async () => {
      await loadScript('vendor/pdfjs/pdf.min.js');
      if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
      if (!window.pdfjsLib) throw new Error('PDF engine failed to load');
      return window.pdfjsLib;
    })();
    pdfjsP.catch(() => {
      pdfjsP = null;
    });
    return pdfjsP;
  };

  IO.importPDF = async function (file, onProgress, signal) {
    const pdfjs = await IO.loadPdfJs();
    const data = new Uint8Array(await file.arrayBuffer());
    const task = pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true });
    const doc = await task.promise;
    const pages = [];
    try {
      for (let i = 1; i <= doc.numPages; i++) {
        if (signal && signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        onProgress && onProgress((i - 1) / doc.numPages, `Page ${i} of ${doc.numPages}`);
        const pg = await doc.getPage(i);
        const vp1 = pg.getViewport({ scale: 1 });
        const scale = Math.min(2.6, Math.sqrt(9.5e6 / (vp1.width * vp1.height)));
        const vp = pg.getViewport({ scale });
        const c = U.makeCanvas(vp.width, vp.height);
        const g = c.getContext('2d');
        g.fillStyle = '#FFFFFF';
        g.fillRect(0, 0, c.width, c.height);
        await pg.render({ canvasContext: g, viewport: vp }).promise;
        const blob = await U.canvasToBlob(c, 'image/jpeg', 0.9);
        const key = U.uid('a');
        await Q.store.putAsset(key, { blob, type: 'image/jpeg', w: c.width, h: c.height });
        U.freeCanvas(c);
        let txt = '';
        try {
          const tc = await pg.getTextContent();
          txt = tc.items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim().slice(0, 20000);
        } catch (e) {}
        pages.push(M.newPage({ w: Math.round(vp1.width * 100) / 100, h: Math.round(vp1.height * 100) / 100, tpl: 'blank', paper: 'white', bg: { a: key, kind: 'pdf' }, txt }));
        pg.cleanup();
        await U.nextFrame();
      }
    } finally {
      try {
        doc.destroy();
      } catch (e) {}
    }
    onProgress && onProgress(1, 'Done');
    return pages;
  };

  const enc = new TextEncoder();
  function pdfString(s) {
    let ascii = true;
    for (const ch of s) if (ch.charCodeAt(0) > 126 || ch.charCodeAt(0) < 32) ascii = false;
    if (ascii) return '(' + s.replace(/[\\()]/g, (m) => '\\' + m) + ')';
    let hex = 'FEFF';
    for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
    return '<' + hex + '>';
  }
  IO.buildPDF = function (pages, title) {
    const parts = [];
    const offsets = [];
    let pos = 0;
    const push = (x) => {
      const b = typeof x === 'string' ? enc.encode(x) : x;
      parts.push(b);
      pos += b.length;
    };
    const obj = (n, body) => {
      offsets[n] = pos;
      push(`${n} 0 obj\n`);
      for (const b of body) push(b);
      push('\nendobj\n');
    };
    push('%PDF-1.4\n%âãÏÓ\n');
    const n = pages.length;
    const kids = [];
    for (let i = 0; i < n; i++) kids.push(3 + i * 3 + ' 0 R');
    obj(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
    obj(2, [`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${n} >>`]);
    pages.forEach((p, i) => {
      const po = 3 + i * 3;
      const w = p.w.toFixed(2);
      const h = p.h.toFixed(2);
      const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
      obj(po, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${po + 1} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${po + 2} 0 R >>`]);
      obj(po + 1, [`<< /Type /XObject /Subtype /Image /Width ${p.iw} /Height ${p.ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`, p.jpeg, '\nendstream']);
      obj(po + 2, [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
    });
    const info = 3 + n * 3;
    const d = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    const date = `D:${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    obj(info, [`<< /Title ${pdfString(title || 'Notes')} /Producer (Quire Notes) /CreationDate (${date}) >>`]);
    const xref = pos;
    let x = `xref\n0 ${info + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= info; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    push(x);
    push(`trailer\n<< /Size ${info + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  };

  IO.exportPDF = async function (title, pages, opts = {}) {
    const dpi = opts.dpi || 200;
    const out = [];
    for (let i = 0; i < pages.length; i++) {
      if (opts.signal && opts.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      opts.onProgress && opts.onProgress(i / pages.length, `Page ${i + 1} of ${pages.length}`);
      const page = pages[i];
      await Q.render.images.ensure(Q.render.pageAssetKeys(page));
      let scale = dpi / 72;
      const maxPx = 15e6;
      if (page.w * page.h * scale * scale > maxPx) scale = Math.sqrt(maxPx / (page.w * page.h));
      const c = Q.render.renderPage(page, scale, { noTemplate: opts.noTemplate });
      const blob = await U.canvasToBlob(c, 'image/jpeg', 0.9);
      out.push({ w: page.w, h: page.h, iw: c.width, ih: c.height, jpeg: new Uint8Array(await blob.arrayBuffer()) });
      U.freeCanvas(c);
      await U.nextFrame();
    }
    opts.onProgress && opts.onProgress(1, 'Finishing');
    return IO.buildPDF(out, title);
  };

  IO.exportPNG = async function (page, scale = 2.5) {
    await Q.render.images.ensure(Q.render.pageAssetKeys(page));
    const c = Q.render.renderPage(page, scale);
    const blob = await U.canvasToBlob(c, 'image/png');
    U.freeCanvas(c);
    return blob;
  };

  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  IO.zip = function (files) {
    const parts = [];
    const central = [];
    let offset = 0;
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = f.data;
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true);
      lh.setUint16(10, time, true);
      lh.setUint16(12, date, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true);
      lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, time, true);
      ch.setUint16(14, date, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true);
      ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    let cdSize = 0;
    for (const c of central) cdSize += c.length;
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/zip' });
  };
  IO.unzip = async function (blob) {
    const tailLen = Math.min(blob.size, 66000);
    const tail = new DataView(await blob.slice(blob.size - tailLen).arrayBuffer());
    let eocd = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--)
      if (tail.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    if (eocd < 0) throw new Error('Not a backup file');
    const count = tail.getUint16(eocd + 10, true);
    const cdSize = tail.getUint32(eocd + 12, true);
    const cdOff = tail.getUint32(eocd + 16, true);
    const cd = new DataView(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
    const dec = new TextDecoder();
    const out = new Map();
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt backup');
      const method = cd.getUint16(p + 10, true);
      const size = cd.getUint32(p + 20, true);
      const nameLen = cd.getUint16(p + 28, true);
      const extraLen = cd.getUint16(p + 30, true);
      const commentLen = cd.getUint16(p + 32, true);
      const local = cd.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(cd.buffer, p + 46, nameLen));
      const lh = new DataView(await blob.slice(local, local + 30).arrayBuffer());
      const start = local + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      if (method === 0) out.set(name, blob.slice(start, start + size));
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  };

  IO.exportBackup = async function (library, onProgress) {
    const files = [];
    const assetsMeta = {};
    const assetKeys = new Set();
    const nbs = library.notebooks;
    for (let i = 0; i < nbs.length; i++) {
      onProgress && onProgress(i / (nbs.length + 1), `Notebook ${i + 1} of ${nbs.length}`);
      const data = await Q.store.loadNotebook(nbs[i].id);
      if (!data) continue;
      for (const p of data.pages) for (const k of Q.render.pageAssetKeys(p)) assetKeys.add(k);
      files.push({ name: `notebooks/${nbs[i].id}.json`, data: enc.encode(JSON.stringify({ rec: data.rec, pages: data.pages.map(M.serializePage) })) });
    }
    let k = 0;
    for (const key of assetKeys) {
      k++;
      if (k % 10 === 0) onProgress && onProgress(0.9, `Images ${k} of ${assetKeys.size}`);
      const rec = await Q.store.getAsset(key);
      if (!rec || !rec.blob) continue;
      assetsMeta[key] = { type: rec.type, w: rec.w, h: rec.h };
      files.push({ name: `assets/${key}`, data: new Uint8Array(await rec.blob.arrayBuffer()) });
    }
    files.unshift({ name: 'quire.json', data: enc.encode(JSON.stringify({ app: 'quire', v: 1, exported: Date.now(), library, assets: assetsMeta })) });
    return IO.zip(files);
  };

  // Merges a backup into the current library. Newer copies win. Returns counts.
  IO.importBackup = async function (file, library, onProgress) {
    const entries = await IO.unzip(file);
    const head = entries.get('quire.json');
    if (!head) throw new Error('This file is not a Quire backup');
    const meta = JSON.parse(await head.text());
    if (meta.app !== 'quire') throw new Error('This file is not a Quire backup');
    let added = 0;
    let updated = 0;
    const folders = meta.library.folders || [];
    for (const f of folders) if (!library.folders.find((x) => x.id === f.id)) library.folders.push(f);
    const list = meta.library.notebooks || [];
    for (let i = 0; i < list.length; i++) {
      const nb = list[i];
      onProgress && onProgress(i / list.length, `Notebook ${i + 1} of ${list.length}`);
      const local = library.notebooks.find((x) => x.id === nb.id);
      if (local && local.modified >= nb.modified) continue;
      const blob = entries.get(`notebooks/${nb.id}.json`);
      if (!blob) continue;
      const data = JSON.parse(await blob.text());
      const pages = data.pages.map(M.deserializePage);
      const ops = [];
      for (const p of pages) {
        for (const key of Q.render.pageAssetKeys(p)) {
          const ab = entries.get(`assets/${key}`);
          const am = meta.assets[key];
          if (ab && am) {
            const exists = await Q.store.getAsset(key);
            if (!exists) ops.push({ store: 'assets', key, val: { blob: new Blob([await ab.arrayBuffer()], { type: am.type }), type: am.type, w: am.w, h: am.h } });
          }
        }
        ops.push({ store: 'pages', key: p.id, val: p });
      }
      if (local) {
        const oldRec = await Q.store.get('notebooks', nb.id).catch(() => null);
        if (oldRec) for (const pid of oldRec.pageIds) if (!data.rec.pageIds.includes(pid)) ops.push({ store: 'pages', key: pid });
      }
      ops.push({ store: 'notebooks', key: nb.id, val: data.rec });
      await Q.store.batch(ops);
      if (local) {
        Object.assign(local, nb);
        updated++;
      } else {
        library.notebooks.push(nb);
        added++;
      }
    }
    return { added, updated };
  };
})((window.Q = window.Q || {}));
