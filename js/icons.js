(function (Q) {
  'use strict';
  const P = {
    back: '<path d="M15 5l-7 7 7 7"/>',
    chevronDown: '<path d="M6 9l6 6 6-6"/>',
    pen: '<path d="M4 20l1.1-4.2L15.7 5.2a2.1 2.1 0 0 1 3 0l.1.1a2.1 2.1 0 0 1 0 3L8.2 18.9z"/><path d="M13.6 7.3l3.1 3.1"/>',
    highlighter: '<path d="M9.2 14.8l7.4-7.4a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8l-7.4 7.4"/><path d="M9.2 14.8l3 3-1.7 1.7H7.2l-.8-.8v-2.2z"/><path d="M4 21h8"/>',
    eraser: '<path d="M8.6 19.5H19"/><path d="M5.4 14.9l8.7-8.7a2 2 0 0 1 2.8 0l2.4 2.4a2 2 0 0 1 0 2.8l-7.6 7.6a2 2 0 0 1-1.4.6H9.6a2 2 0 0 1-1.4-.6l-2.8-2.8a.9.9 0 0 1 0-1.3z"/><path d="M9.6 10.7l5.2 5.2"/>',
    lasso: '<path d="M7.2 15.4C5 14.3 3.6 12.6 3.6 10.6 3.6 7 7.4 4.2 12 4.2s8.4 2.8 8.4 6.4-3.8 6.4-8.4 6.4c-1.1 0-2.1-.1-3.1-.4" stroke-dasharray="2.2 2.4"/><path d="M8.5 15.5c0 1.6-1.2 2.4-1.2 3.6 0 1 .8 1.7 1.9 1.7"/>',
    shapes: '<rect x="3.5" y="10" width="9.5" height="9.5" rx="1.6"/><circle cx="15.6" cy="8.4" r="4.9"/>',
    text: '<path d="M5 7V4.8h14V7"/><path d="M12 4.8v14.4"/><path d="M9.2 19.2h5.6"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.2"/><circle cx="9" cy="9.8" r="1.7"/><path d="M20.5 15.7l-4.6-4.6L6 19.4"/>',
    sticker: '<path d="M20 12.6V6.2a2.2 2.2 0 0 0-2.2-2.2H6.2A2.2 2.2 0 0 0 4 6.2v11.6A2.2 2.2 0 0 0 6.2 20h6.4z"/><path d="M20 12.6h-4.2a3.2 3.2 0 0 0-3.2 3.2V20"/>',
    laser: '<circle cx="12" cy="12" r="2.6"/><path d="M12 3.2v2.6M12 18.2v2.6M3.2 12h2.6M18.2 12h2.6M5.8 5.8l1.8 1.8M16.4 16.4l1.8 1.8M5.8 18.2l1.8-1.8M16.4 7.6l1.8-1.8"/>',
    undo: '<path d="M9 14L4.2 9.2 9 4.4"/><path d="M4.4 9.2h10.1a5.4 5.4 0 0 1 0 10.8H11"/>',
    redo: '<path d="M15 14l4.8-4.8L15 4.4"/><path d="M19.6 9.2H9.5a5.4 5.4 0 0 0 0 10.8H13"/>',
    pages: '<rect x="4" y="4" width="6.6" height="7.4" rx="1.2"/><rect x="13.4" y="4" width="6.6" height="7.4" rx="1.2"/><rect x="4" y="13.6" width="6.6" height="6.4" rx="1.2"/><rect x="13.4" y="13.6" width="6.6" height="6.4" rx="1.2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    addPage: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5"/><path d="M12 11v6M9 14h6"/>',
    more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="M20 20l-4.6-4.6"/>',
    folder: '<path d="M3.5 7.6a2 2 0 0 1 2-2h3.8l2.1 2.2h7.1a2 2 0 0 1 2 2v7.6a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
    folderPlus: '<path d="M3.5 7.6a2 2 0 0 1 2-2h3.8l2.1 2.2h7.1a2 2 0 0 1 2 2v7.6a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>',
    star: '<path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.1-4 5.7-.8z"/>',
    starFill: '<path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.1-4 5.7-.8z" fill="currentColor"/>',
    trash: '<path d="M4.5 7h15"/><path d="M9.5 7V5h5v2"/><path d="M6.6 7l.9 12.5h9l.9-12.5"/><path d="M10 11v5.5M14 11v5.5"/>',
    sliders: '<path d="M4 7h9M17.5 7H20M4 17h3.5M12 17h8"/><circle cx="15.3" cy="7" r="2.2"/><circle cx="9.7" cy="17" r="2.2"/>',
    share: '<path d="M12 15V3.8"/><path d="M7.6 8.2L12 3.8l4.4 4.4"/><path d="M5 12v6.4A1.6 1.6 0 0 0 6.6 20h10.8a1.6 1.6 0 0 0 1.6-1.6V12"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    check: '<path d="M5 12.6l4.4 4.4L19 7.4"/>',
    sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.2"/><path d="M9.5 4.5v15"/>',
    bookmark: '<path d="M7 4.5h10v15.4l-5-3.6-5 3.6z"/>',
    bookmarkFill: '<path d="M7 4.5h10v15.4l-5-3.6-5 3.6z" fill="currentColor"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
    cut: '<circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/><path d="M8.3 15.7L17.6 4.5M15.7 15.7L6.4 4.5"/>',
    duplicate: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/><path d="M14 11.5v5M11.5 14h5"/>',
    drop: '<path d="M12 3.6s6 6.3 6 10.4a6 6 0 0 1-12 0c0-4.1 6-10.4 6-10.4z"/>',
    hand: '<path d="M8.2 12.6V6.4a1.5 1.5 0 0 1 3 0v4.8"/><path d="M11.2 10.6V4.9a1.5 1.5 0 0 1 3 0v5.7"/><path d="M14.2 10.8V6.6a1.5 1.5 0 0 1 3 0v7.2a6.2 6.2 0 0 1-6.2 6.2h-.4a6.2 6.2 0 0 1-4.8-2.3l-2.3-2.8a1.5 1.5 0 0 1 2.3-1.9l2.2 2.4"/>',
    file: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5"/>',
    pdf: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5"/><path d="M8.6 16.6v-4.2h1.3a1.2 1.2 0 0 1 0 2.4H8.6M12.6 16.6v-4.2h.9a2.1 2.1 0 0 1 0 4.2zM16.4 12.4h-1.6v4.2M14.8 14.5h1.3"/>',
    notebook: '<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M9 3.5v17"/><path d="M12 8.2h4M12 11.2h4"/>',
    quick: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5"/><path d="M12.6 10.5l-2.6 3.7h3.6l-2.4 3.4"/>',
    restore: '<path d="M4.6 12a7.6 7.6 0 1 0 2.2-5.4L4.5 8.8"/><path d="M4.5 4.4v4.4h4.4"/>',
    rename: '<path d="M4 20h4.1L18.6 9.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.6 8.4l2.9 2.9"/>',
    move: '<path d="M3.5 7.6a2 2 0 0 1 2-2h3.8l2.1 2.2h7.1a2 2 0 0 1 2 2v7.6a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M10 13.5h5M13 11l2.5 2.5L13 16"/>',
    fit: '<path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4"/>',
    sort: '<path d="M7 4.5v15M4 16.5l3 3 3-3"/><path d="M13.5 6h6.5M13.5 10h4.6M13.5 14h3"/>',
    palette: '<path d="M12 3.6a8.4 8.4 0 1 0 0 16.8c1.2 0 1.8-.8 1.8-1.7 0-1.3-1.1-1.6-1.1-2.7 0-.9.7-1.6 1.7-1.6h2a4 4 0 0 0 4-4c0-3.7-3.8-6.8-8.4-6.8z"/><circle cx="7.6" cy="11.2" r="1.1"/><circle cx="10.3" cy="7.4" r="1.1"/><circle cx="14.8" cy="7.6" r="1.1"/>',
    clear: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5"/><path d="M9.5 12.5l5 5M14.5 12.5l-5 5"/>',
    template: '<rect x="4.5" y="3.5" width="15" height="17" rx="2"/><path d="M7.5 8h9M7.5 11.5h9M7.5 15h9"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".9" fill="currentColor" stroke="none"/>',
    download: '<path d="M12 3.8V15"/><path d="M7.6 10.6L12 15l4.4-4.4"/><path d="M5 19.5h14"/>',
    grid: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16"/>',
    bold: '<path d="M7.5 5h5.2a3.4 3.4 0 0 1 0 6.8H7.5zM7.5 11.8h6.1a3.6 3.6 0 0 1 0 7.2H7.5z"/>',
    alignLeft: '<path d="M4.5 6h15M4.5 10h10M4.5 14h15M4.5 18h10"/>',
    alignCenter: '<path d="M4.5 6h15M7 10h10M4.5 14h15M7 18h10"/>',
    alignRight: '<path d="M4.5 6h15M9.5 10h10M4.5 14h15M9.5 18h10"/>',
    front: '<rect x="8.5" y="8.5" width="11" height="11" rx="1.6" fill="currentColor" fill-opacity=".25"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
    cloud: '<path d="M7.4 18.5h9.8a3.8 3.8 0 0 0 .5-7.6 5.6 5.6 0 0 0-10.9 1.5 3.1 3.1 0 0 0 .6 6.1z"/>',
    menu: '<path d="M4.5 7h15M4.5 12h15M4.5 17h15"/>',
    ruler: '<path d="M3.8 16.2L16.2 3.8l4 4L7.8 20.2z"/><path d="M7 13l1.8 1.8M9.6 10.4l1.2 1.2M12.2 7.8l1.8 1.8M14.8 5.2l1.2 1.2"/>',
  };
  Q.icon = function (name, cls) {
    const span = document.createElement('span');
    span.className = 'ic' + (cls ? ' ' + cls : '');
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML =
      '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      (P[name] || P.info) +
      '</svg>';
    return span;
  };
})((window.Q = window.Q || {}));
