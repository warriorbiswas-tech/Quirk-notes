(function (Q) {
  'use strict';
  const U = Q.util;
  const UI = Q.ui;
  const h = U.h;

  class Library {
    constructor(app) {
      this.app = app;
      this.section = 'all';
      this.query = '';
      this.el = h('div', { class: 'library' });
      this.build();
    }
    get lib() {
      return this.app.library;
    }

    build() {
      const brand = h('div', { class: 'brand' }, h('span', { class: 'brand-mark', html: BRAND_SVG }), h('span', { class: 'brand-name' }, 'Quire'), h('span', { class: 'brand-pro' }, 'Pro'));
      this.navEl = h('nav', { class: 'side-nav', 'aria-label': 'Library sections' });
      this.storageEl = h('div', { class: 'side-storage' });
      const settingsBtn = h('button', { class: 'side-link', onclick: () => this.openSettings() }, Q.icon('sliders'), h('span', null, 'Settings'));
      this.side = h('aside', { class: 'lib-side' }, brand, this.navEl, h('div', { class: 'side-foot' }, settingsBtn, this.storageEl));
      this.scrim = h('div', { class: 'side-scrim', onclick: () => this.toggleSide(false) });
      const sideBtn = h('button', { class: 'icon-btn side-toggle', 'aria-label': 'Show sidebar', onclick: () => this.toggleSide() }, Q.icon('sidebar'));
      this.titleEl = h('h1', { class: 'lib-title' });
      this.countEl = h('span', { class: 'lib-count' });
      this.search = h('input', { class: 'search-input', type: 'search', placeholder: 'Search', 'aria-label': 'Search', autocomplete: 'off', spellcheck: false });
      this.search.addEventListener('input', () => {
        this.query = this.search.value.trim();
        this.renderGrid();
      });
      const searchWrap = h('label', { class: 'search' }, Q.icon('search'), this.search);
      this.sortBtn = h('button', { class: 'icon-btn', 'aria-label': 'Sort', title: 'Sort', onclick: () => this.openSort() }, Q.icon('sort'));
      this.newBtn = h('button', { class: 'btn primary new-btn', onclick: () => this.openNewMenu() }, Q.icon('plus'), h('span', null, 'New'));
      const head = h('header', { class: 'lib-head' }, sideBtn, h('div', { class: 'lib-heading' }, this.titleEl, this.countEl), h('div', { class: 'lib-actions' }, searchWrap, this.sortBtn, this.newBtn));
      this.banner = h('div', { class: 'lib-banner', hidden: true });
      this.grid = h('div', { class: 'nb-grid' });
      this.mainEl = h('main', { class: 'lib-main' }, head, this.banner, this.grid);
      this.el.append(this.side, this.scrim, this.mainEl);
      this.thumbUrls = new Map();
    }

    toggleSide(force) {
      const open = force != null ? force : !this.el.classList.contains('side-open');
      this.el.classList.toggle('side-open', open);
    }

    render() {
      this.renderNav();
      this.renderGrid();
      this.renderBanner();
      this.renderStorage();
    }

    renderBanner() {
      const b = this.banner;
      U.clear(b);
      if (!Q.store.available) {
        b.hidden = false;
        b.className = 'lib-banner warn';
        b.append(Q.icon('info'), h('span', null, window.QuireAndroid ? 'Storage isn’t available, so notes will be lost when you close the app.' : 'This browser is blocking storage, so notes will be lost when you close the page. Open Quire in Safari (not a private window) and add it to your Home Screen.'));
        return;
      }
      if (U.isIPad() && !U.isStandalone() && !this.app.settings.dismissInstall) {
        b.hidden = false;
        b.className = 'lib-banner';
        b.append(
          Q.icon('download'),
          h('span', null, 'For full-screen writing and reliable storage, add Quire to your Home Screen: tap Share, then “Add to Home Screen”.'),
          h('button', { class: 'icon-btn sm', 'aria-label': 'Dismiss', onclick: () => { this.app.settings.dismissInstall = true; this.app.saveSettings(); this.renderBanner(); } }, Q.icon('close'))
        );
        return;
      }
      b.hidden = true;
    }

    async renderStorage() {
      const est = await Q.store.estimate();
      if (!est || !est.usage) {
        this.storageEl.textContent = '';
        return;
      }
      this.storageEl.textContent = U.fmtBytes(est.usage) + ' used on this device';
    }

    counts() {
      const live = this.lib.notebooks.filter((n) => !n.trashed);
      const c = { all: live.length, fav: live.filter((n) => n.favorite).length, trash: this.lib.notebooks.length - live.length, folders: {} };
      for (const n of live) if (n.folderId) c.folders[n.folderId] = (c.folders[n.folderId] || 0) + 1;
      return c;
    }

    renderNav() {
      const nav = U.clear(this.navEl);
      const c = this.counts();
      const link = (id, icon, label, count, extra) => {
        const b = h('button', {
          class: 'side-link' + (this.section === id ? ' on' : ''),
          'aria-current': this.section === id ? 'page' : null,
          onclick: () => {
            this.section = id;
            this.toggleSide(false);
            this.render();
          },
        }, Q.icon(icon), h('span', { class: 'side-label' }, label), count != null ? h('span', { class: 'side-count' }, String(count)) : null, extra || null);
        nav.appendChild(b);
        return b;
      };
      link('all', 'notebook', 'All notebooks', c.all);
      link('recent', 'restore', 'Recently opened');
      link('fav', 'star', 'Favourites', c.fav || null);
      nav.appendChild(h('div', { class: 'side-head' }, h('span', null, 'Folders'), h('button', { class: 'icon-btn xs', 'aria-label': 'New folder', title: 'New folder', onclick: () => this.newFolder() }, Q.icon('plus'))));
      const folders = this.lib.folders.slice().sort((a, b) => a.name.localeCompare(b.name));
      if (!folders.length) nav.appendChild(h('button', { class: 'side-link dim', onclick: () => this.newFolder() }, Q.icon('folderPlus'), h('span', { class: 'side-label' }, 'New folder')));
      for (const f of folders) {
        const more = h('span', { class: 'side-more', role: 'button', tabIndex: 0, 'aria-label': 'Folder options', onclick: (e) => { e.stopPropagation(); this.folderMenu(more, f); } }, Q.icon('more'));
        link('folder:' + f.id, 'folder', f.name, c.folders[f.id] || null, more);
      }
      nav.appendChild(h('div', { class: 'side-gap' }));
      link('trash', 'trash', 'Trash', c.trash || null);
    }

    sectionTitle() {
      if (this.section === 'all') return 'All notebooks';
      if (this.section === 'fav') return 'Favourites';
      if (this.section === 'recent') return 'Recently opened';
      if (this.section === 'trash') return 'Trash';
      const f = this.lib.folders.find((x) => 'folder:' + x.id === this.section);
      return f ? f.name : 'Notebooks';
    }

    visibleNotebooks() {
      let list = this.lib.notebooks.slice();
      const s = this.section;
      if (s === 'trash') list = list.filter((n) => n.trashed);
      else {
        list = list.filter((n) => !n.trashed);
        if (s === 'fav') list = list.filter((n) => n.favorite);
        else if (s.startsWith('folder:')) list = list.filter((n) => 'folder:' + n.folderId === s);
      }
      const q = this.query.toLowerCase();
      if (q) list = list.filter((n) => n.title.toLowerCase().includes(q) || (n.text || '').toLowerCase().includes(q));
      const sort = s === 'recent' ? 'opened' : this.app.settings.sort;
      list.sort((a, b) => {
        if (sort === 'name') return a.title.localeCompare(b.title, undefined, { numeric: true });
        if (sort === 'created') return b.created - a.created;
        if (sort === 'opened') return (b.opened || 0) - (a.opened || 0);
        return b.modified - a.modified;
      });
      if (s === 'recent') list = list.slice(0, 12);
      return list;
    }

    renderGrid() {
      const grid = U.clear(this.grid);
      this.titleEl.textContent = this.sectionTitle();
      const list = this.visibleNotebooks();
      this.countEl.textContent = list.length ? U.plural(list.length, 'notebook') : '';
      this.sortBtn.hidden = this.section === 'recent';
      if (this.section === 'trash' && list.length) {
        grid.appendChild(h('div', { class: 'trash-bar' }, h('span', null, 'Notebooks in Trash stay here until you delete them.'), h('button', { class: 'btn danger sm', onclick: () => this.emptyTrash() }, 'Empty Trash')));
      }
      if (!list.length) {
        grid.appendChild(this.emptyState());
        return;
      }
      for (const nb of list) grid.appendChild(this.card(nb));
    }

    emptyState() {
      if (this.query) return h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, `Nothing matches “${this.query}”`), h('p', null, 'Search looks at notebook titles, typed text and text inside imported PDFs.'));
      if (this.section === 'trash') return h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, 'Trash is empty'), h('p', null, 'Deleted notebooks wait here until you empty the Trash.'));
      if (this.section === 'fav') return h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, 'No favourites yet'), h('p', null, 'Tap the star on a notebook to keep it here.'));
      return h('div', { class: 'empty' },
        h('div', { class: 'empty-title' }, 'Start a notebook'),
        h('p', null, `Write with ${U.stylusName()} on ruled, grid, dotted or planner paper, or bring in a PDF to annotate.`),
        h('div', { class: 'empty-actions' },
          h('button', { class: 'btn primary', onclick: () => this.openNewNotebook() }, Q.icon('notebook'), h('span', null, 'New notebook')),
          h('button', { class: 'btn', onclick: () => this.importPDF() }, Q.icon('pdf'), h('span', null, 'Import PDF'))));
    }

    card(nb) {
      const cover = Q.pick.coverEl(nb.cover || {}, nb.title, null);
      const coverWrap = h('div', { class: 'card-cover' }, cover);
      if ((nb.cover || {}).style === 'page') {
        this.app.thumbURL(nb.id).then((url) => {
          if (!url) return;
          const pg = cover.querySelector('.cover-page');
          if (pg && !pg.firstChild) pg.appendChild(h('img', { src: url, alt: '', draggable: false }));
        });
      }
      const star = h('button', {
        class: 'card-star' + (nb.favorite ? ' on' : ''),
        'aria-label': nb.favorite ? 'Remove from favourites' : 'Add to favourites',
        'aria-pressed': nb.favorite ? 'true' : 'false',
        onclick: (e) => {
          e.stopPropagation();
          nb.favorite = !nb.favorite;
          this.app.saveLibrary();
          this.render();
        },
      }, Q.icon(nb.favorite ? 'starFill' : 'star'));
      const more = h('button', { class: 'card-more', 'aria-label': 'Options for ' + nb.title, onclick: (e) => { e.stopPropagation(); this.notebookMenu(more, nb); } }, Q.icon('more'));
      let snippet = null;
      if (this.query && !nb.title.toLowerCase().includes(this.query.toLowerCase())) {
        const t = nb.text || '';
        const i = t.toLowerCase().indexOf(this.query.toLowerCase());
        if (i >= 0) snippet = h('div', { class: 'card-snip' }, '…' + t.slice(Math.max(0, i - 24), i + this.query.length + 40).replace(/\s+/g, ' ') + '…');
      }
      const folder = nb.folderId ? this.lib.folders.find((f) => f.id === nb.folderId) : null;
      const card = h('div', {
        class: 'card',
        role: 'button',
        tabIndex: 0,
        'aria-label': nb.title,
        onclick: () => {
          if (card._lp && Date.now() - card._lp < 800) return;
          if (nb.trashed) this.notebookMenu(more, nb);
          else this.app.openNotebook(nb.id);
        },
        onkeydown: (e) => {
          if (e.key === 'Enter') card.click();
        },
      },
      coverWrap,
      h('div', { class: 'card-info' },
        h('div', { class: 'card-title' }, nb.title),
        h('div', { class: 'card-meta' }, U.fmtDate(nb.modified) + ' · ' + U.plural(nb.pageCount || 1, 'page') + (folder && !this.section.startsWith('folder:') ? ' · ' + folder.name : '')),
        snippet),
      nb.trashed ? null : star,
      more);
      // long press → menu
      let lp = 0;
      let sx = 0;
      let sy = 0;
      const cancelLp = () => {
        clearTimeout(lp);
        lp = 0;
      };
      card.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' || e.target.closest('button')) return;
        sx = e.clientX;
        sy = e.clientY;
        lp = setTimeout(() => {
          lp = 0;
          card._lp = Date.now();
          this.notebookMenu(more, nb);
        }, 520);
      });
      card.addEventListener('pointermove', (e) => {
        if (lp && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) cancelLp();
      });
      card.addEventListener('pointerup', cancelLp);
      card.addEventListener('pointercancel', cancelLp);
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.notebookMenu(more, nb);
      });
      return card;
    }

    notebookMenu(anchor, nb) {
      if (nb.trashed) {
        UI.menu(anchor, [
          { label: 'Restore', icon: 'restore', onClick: () => { nb.trashed = null; this.app.saveLibrary(); this.render(); UI.toast('Restored “' + nb.title + '”'); } },
          { label: 'Delete forever', icon: 'trash', danger: true, onClick: async () => {
            if (await UI.confirm({ title: 'Delete “' + nb.title + '” forever?', message: 'This can’t be undone.', ok: 'Delete', danger: true })) {
              await this.app.deleteNotebookForever(nb.id);
              this.render();
            }
          } },
        ]);
        return;
      }
      UI.menu(anchor, [
        { label: 'Open', icon: 'notebook', onClick: () => this.app.openNotebook(nb.id) },
        { label: 'Rename', icon: 'rename', onClick: () => this.renameNotebook(nb) },
        { label: 'Change cover…', icon: 'palette', onClick: () => this.editCover(nb) },
        { label: nb.favorite ? 'Remove from favourites' : 'Add to favourites', icon: nb.favorite ? 'starFill' : 'star', onClick: () => { nb.favorite = !nb.favorite; this.app.saveLibrary(); this.render(); } },
        { label: 'Move to folder…', icon: 'move', onClick: () => this.moveMenu(anchor, nb) },
        { label: 'Duplicate', icon: 'duplicate', onClick: async () => { await this.app.duplicateNotebook(nb.id); this.render(); } },
        { label: 'Export PDF', icon: 'share', onClick: () => this.app.exportNotebookPDF(nb.id) },
        { sep: true },
        { label: 'Move to Trash', icon: 'trash', danger: true, onClick: () => {
          nb.trashed = Date.now();
          this.app.saveLibrary();
          this.render();
          UI.toast('Moved to Trash', { action: { label: 'Undo', fn: () => { nb.trashed = null; this.app.saveLibrary(); this.render(); } } });
        } },
      ].filter(Boolean));
    }

    moveMenu(anchor, nb) {
      const items = [{ header: 'Move “' + nb.title + '” to' }];
      items.push({ label: 'No folder', icon: 'notebook', checked: !nb.folderId, onClick: () => this.moveTo(nb, null) });
      for (const f of this.lib.folders) items.push({ label: f.name, icon: 'folder', checked: nb.folderId === f.id, onClick: () => this.moveTo(nb, f.id) });
      items.push({ sep: true }, { label: 'New folder…', icon: 'folderPlus', onClick: async () => { const f = await this.newFolder(true); if (f) this.moveTo(nb, f.id); } });
      UI.menu(anchor, items);
    }
    moveTo(nb, folderId) {
      nb.folderId = folderId;
      this.app.saveLibrary();
      this.render();
    }

    async renameNotebook(nb) {
      const v = await UI.prompt({ title: 'Rename notebook', value: nb.title, ok: 'Rename' });
      if (!v) return;
      nb.title = v;
      this.app.saveLibrary();
      this.render();
    }

    editCover(nb) {
      let cover = Object.assign({}, nb.cover);
      const picker = Q.pick.coverPicker(cover, nb.title, (c) => (cover = c), null);
      this.app.thumbURL(nb.id).then((url) => {
        if (url) {
          const prev = picker.querySelector('.cover-page');
          if (prev && !prev.firstChild) prev.appendChild(h('img', { src: url, alt: '' }));
        }
        picker.dataset.thumb = url || '';
      });
      UI.sheet({
        title: 'Cover',
        body: picker,
        actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: () => { nb.cover = cover; this.app.saveLibrary(); this.render(); } }],
      });
    }

    async newFolder(returnIt) {
      const name = await UI.prompt({ title: 'New folder', placeholder: 'Folder name', ok: 'Create' });
      if (!name) return null;
      const f = { id: U.uid('f'), name, created: Date.now() };
      this.lib.folders.push(f);
      this.app.saveLibrary();
      if (!returnIt) this.section = 'folder:' + f.id;
      this.render();
      return f;
    }
    folderMenu(anchor, f) {
      UI.menu(anchor, [
        { label: 'Rename folder', icon: 'rename', onClick: async () => { const v = await UI.prompt({ title: 'Rename folder', value: f.name, ok: 'Rename' }); if (v) { f.name = v; this.app.saveLibrary(); this.render(); } } },
        { label: 'Delete folder', icon: 'trash', danger: true, onClick: async () => {
          if (!(await UI.confirm({ title: 'Delete folder “' + f.name + '”?', message: 'Notebooks inside are kept and moved out of the folder.', ok: 'Delete folder', danger: true }))) return;
          for (const n of this.lib.notebooks) if (n.folderId === f.id) n.folderId = null;
          this.lib.folders = this.lib.folders.filter((x) => x.id !== f.id);
          if (this.section === 'folder:' + f.id) this.section = 'all';
          this.app.saveLibrary();
          this.render();
        } },
      ]);
    }

    openSort() {
      const s = this.app.settings;
      const set = (v) => { s.sort = v; this.app.saveSettings(); this.renderGrid(); };
      UI.menu(this.sortBtn, [
        { header: 'Sort by' },
        { label: 'Last edited', checked: s.sort === 'modified', onClick: () => set('modified') },
        { label: 'Date created', checked: s.sort === 'created', onClick: () => set('created') },
        { label: 'Title', checked: s.sort === 'name', onClick: () => set('name') },
      ], { align: 'end' });
    }

    openNewMenu() {
      UI.menu(this.newBtn, [
        { label: 'Notebook…', icon: 'notebook', onClick: () => this.openNewNotebook() },
        { label: 'Quick note', icon: 'quick', hint: 'Opens right away', onClick: () => this.quickNote() },
        { sep: true },
        { label: 'Import PDF…', icon: 'pdf', onClick: () => this.importPDF() },
        { label: 'Import images…', icon: 'image', onClick: () => this.importImages() },
        { sep: true },
        { label: 'Folder…', icon: 'folderPlus', onClick: () => this.newFolder() },
      ], { align: 'end' });
    }

    currentFolderId() {
      return this.section.startsWith('folder:') ? this.section.slice(7) : null;
    }

    openNewNotebook() {
      const d = this.app.settings.newNotebook;
      let paper = { tpl: d.tpl, paper: d.paper, size: d.size, orient: d.orient };
      let cover = { color: d.coverColor, style: d.coverStyle === 'page' ? 'linen' : d.coverStyle };
      const n = this.lib.notebooks.filter((x) => !x.trashed).length + 1;
      const titleIn = h('input', { class: 'field title-field', value: 'Notebook ' + n, 'aria-label': 'Title', maxlength: 120 });
      const cp = Q.pick.coverPicker(cover, titleIn.value, (c) => (cover = c), false);
      titleIn.addEventListener('input', () => {
        const lbl = cp.querySelector('.cover-label span');
        if (lbl) lbl.textContent = titleIn.value || 'Untitled';
      });
      const body = h('div', { class: 'new-nb' },
        h('div', { class: 'new-nb-left' }, h('label', { class: 'pick-label' }, 'Title'), titleIn, cp),
        h('div', { class: 'new-nb-right' }, Q.pick.paperPicker(paper, (v) => (paper = v))));
      UI.sheet({
        title: 'New notebook',
        wide: true,
        className: 'sheet-new',
        body,
        actions: [
          { label: 'Cancel' },
          { label: 'Create', primary: true, onClick: async () => {
            Object.assign(this.app.settings.newNotebook, { tpl: paper.tpl, paper: paper.paper, size: paper.size, orient: paper.orient, coverColor: cover.color, coverStyle: cover.style });
            this.app.saveSettings();
            const meta = await this.app.createNotebook({ title: titleIn.value.trim() || 'Untitled', cover, folderId: this.currentFolderId(), page: paper });
            this.app.openNotebook(meta.id);
          } },
        ],
      });
      setTimeout(() => titleIn.select(), 100);
    }

    async quickNote() {
      const d = this.app.settings.newNotebook;
      const now = new Date();
      const title = 'Quick note ' + now.getDate() + ' ' + U.MONTHS[now.getMonth()] + ', ' + U.fmtTime(now);
      const meta = await this.app.createNotebook({ title, cover: { color: '#C9A23F', style: 'plain' }, folderId: this.currentFolderId(), page: { tpl: d.tpl, paper: d.paper, size: d.size, orient: d.orient } });
      this.app.openNotebook(meta.id);
    }

    async importPDF() {
      const files = await Q.io.pickFiles('application/pdf,.pdf', true);
      for (const f of files) await this.app.importPDFNotebook(f, this.currentFolderId());
      this.render();
    }
    async importImages() {
      const files = await Q.io.pickFiles('image/*', true);
      if (!files.length) return;
      await this.app.importImagesNotebook(files, this.currentFolderId());
      this.render();
    }

    async emptyTrash() {
      const list = this.lib.notebooks.filter((n) => n.trashed);
      if (!(await UI.confirm({ title: 'Empty Trash?', message: U.plural(list.length, 'notebook') + ' will be deleted forever.', ok: 'Empty Trash', danger: true }))) return;
      for (const nb of list) await this.app.deleteNotebookForever(nb.id, true);
      await Q.store.gcAssets().catch(() => {});
      this.render();
    }

    openSettings() {
      const s = this.app.settings;
      const app = this.app;
      const save = () => app.saveSettings();
      const sec = (title, ...rows) => h('section', { class: 'set-sec' }, h('h3', { class: 'set-title' }, title), h('div', { class: 'set-card' }, rows));
      const finger = UI.seg([{ id: 'auto', label: 'Automatic' }, { id: 'on', label: 'Always' }, { id: 'off', label: 'Never' }], s.fingerDraw, (v) => { s.fingerDraw = v; save(); }, { small: true });
      const theme = UI.seg([{ id: 'system', label: 'System' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }], s.theme, (v) => { s.theme = v; save(); app.applyTheme(); }, { small: true });
      const persistedTxt = h('span', { class: 'set-hint' }, Q.store.persisted ? 'Protected from automatic clean-up' : (U.isIPad() ? 'Not protected yet. Safari may clear it if the iPad runs low on space.' : 'Not protected yet. It may be cleared if the device runs low on space.'));
      const est = h('span', { class: 'set-val' }, '…');
      Q.store.estimate().then((e) => { est.textContent = e && e.usage != null ? U.fmtBytes(e.usage) + (e.quota ? ' of ' + U.fmtBytes(e.quota) : '') : 'Unknown'; });
      const body = h('div', { class: 'settings' },
        sec('Writing',
          UI.row('Draw with finger', finger, `Automatic: fingers draw until you use ${U.stylusName()}, then they scroll and zoom.`),
          UI.row('Pressure sensitivity', UI.slider(0, 1, 0.05, s.pressure, (v) => { s.pressure = v; app.saveSettingsSoon(); }, (v) => Math.round(v * 100) + '%'), (U.isIPad() ? 'Apple Pencil (1st generation) reports pressure. Apple Pencil (USB-C) doesn’t, so line width follows your writing speed instead.' : 'Styluses that report pressure use it. For others, line width follows your writing speed instead.')),
          UI.row('Smoothing', UI.slider(0, 1, 0.05, s.smoothing, (v) => { s.smoothing = v; app.saveSettingsSoon(); }, (v) => Math.round(v * 100) + '%'), 'Higher values steady shaky lines but add a little lag.'),
          UI.row('Hold to draw shapes', UI.toggle(s.shapeHold, (v) => { s.shapeHold = v; save(); }, 'Hold to draw shapes'), 'Pause at the end of a stroke to turn it into a perfect line, circle or box.'),
          UI.row('Shape snapping strength', UI.slider(0, 1, 0.05, s.snap == null ? 0.5 : s.snap, (v) => { s.snap = v; app.saveSettingsSoon(); }, (v) => Math.round(v * 100) + '%'), 'Higher snaps sooner and accepts rougher shapes.'),
          UI.row('Two-finger tap to undo', UI.toggle(s.tapUndo, (v) => { s.tapUndo = v; save(); }, 'Two-finger tap to undo'), 'Three-finger tap redoes.')),
        sec('Appearance', UI.row('Theme', theme)),
        sec('Storage & backup',
          UI.row('Space used', est),
          UI.row('Storage', h('button', { class: 'btn sm', onclick: async () => { const ok = await Q.store.requestPersist(); persistedTxt.textContent = ok ? 'Protected from automatic clean-up' : 'Safari declined. Adding Quire to the Home Screen protects it.'; } }, 'Protect'), persistedTxt),
          UI.row('Back up everything', h('button', { class: 'btn sm', onclick: () => app.backup() }, 'Create backup'), 'Saves all notebooks, folders and images into one .zip file you can keep in Files or iCloud Drive.'),
          UI.row('Restore from backup', h('button', { class: 'btn sm', onclick: () => app.restore() }, 'Choose file…'), 'Adds notebooks from a Quire backup. Newer copies replace older ones.')),
        sec('About',
          h('div', { class: 'about' },
            h('p', null, h('strong', null, 'Quire Pro'), '. Every feature is unlocked. No account, no ads, and your notes stay on this device.'),
            h('p', { class: 'set-hint' }, 'Tips: two-finger tap to undo · pinch to zoom · hold at the end of a stroke to snap a shape · tap the selected colour or size again to change it.'))));
      UI.sheet({ title: 'Settings', wide: true, body, className: 'sheet-settings' });
    }

  }

  const BRAND_SVG =
    '<svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="8" fill="var(--accent)"/><path d="M9 8.5h9.5a4 4 0 0 1 4 4V23.5H13a4 4 0 0 1-4-4z" fill="var(--accent-ink)" opacity=".95"/><path d="M12 13h7.5M12 16.5h7.5M12 20h4.5" stroke="var(--accent)" stroke-width="1.4" stroke-linecap="round"/><path d="M19.6 21.6l4.9-8.6 1.9 1.1-4.9 8.6-2.3 1.2z" fill="var(--brass)"/></svg>';
  Q.BRAND_SVG = BRAND_SVG;
  Q.Library = Library;
})((window.Q = window.Q || {}));
