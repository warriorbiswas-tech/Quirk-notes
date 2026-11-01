# Quire Notes

Handwriting notes for iPad and Android.

## Download

Get both apps from the [latest release](https://github.com/warriorbiswas-tech/Quire-notes/releases/latest).

- **iPad (`Quire-Notes.ipa`):** for iPadOS 17 or later. It has PencilKit ink, PDF annotation, audio recording with a live transcript, iCloud Drive sync, and AI study tools that use your own free NVIDIA key online and a downloadable on-device model otherwise. It is unsigned, so install it with [Sideloadly](https://sideloadly.io) or [AltStore](https://altstore.io) from a Windows PC or Mac, signing in with your Apple ID. With a free Apple ID it has to be reinstalled every 7 days. [ios/README.md](ios/README.md) has more.
- **Android (`Quire-Notes.apk`):** for Android 8 or later. Open the file on your device and allow the install when asked.

## Web version

The rest of this page is about the installable web version, in this folder, which the Android app is built from. It needs no App Store, Mac or Apple ID. Everything is included: no subscription, no ads, no account, and your notes stay on your device.

**Open it:** https://warriorbiswas-tech.github.io/Quire-notes/

## Install on iPad (A16 or any iPad)

1. Open the link above in **Safari** on the iPad. Other browsers can't install apps on iPadOS.
2. Tap the **Share** button (the square with an arrow), then **Add to Home Screen**, then **Add**.
3. Open **Quire** from the Home Screen. It runs full screen like a regular app and works offline.

Use the Home Screen icon from then on. A Home Screen app keeps its own storage, separate from Safari, so Safari's automatic clean-up of unused website data doesn't remove your notes. Deleting the app from the Home Screen does delete them, so make a backup first.

## Features

**Writing**
- Fountain pen, ballpoint, brush pen and textured pencil, with pressure and tapering
- Pressure from Apple Pencil (1st generation). Apple Pencil (USB-C) has no pressure sensor, so line width follows writing speed instead
- Palm rejection: once a Pencil is used, fingers scroll and zoom while the Pencil writes
- Highlighter that sits under the ink, with an optional straight-line mode
- Eraser: whole-stroke or precise, with a "highlighter only" option and auto switch-back
- Hold at the end of a stroke to snap it into a perfect line, circle, ellipse, triangle, rectangle or polygon, then keep moving to resize it. Snapping strength is adjustable, and there's also a dedicated Shapes tool
- Lasso: select ink, text, images and stickers; move, resize, rotate, recolour, copy, cut, duplicate, delete, bring to front
- Text boxes with five fonts, sizes, colours, bold and alignment. With Apple Pencil you can handwrite inside a text box and iPadOS Scribble turns it into typed text
- Images from Photos, Camera or Files; stickers, labels, washi tape and emoji
- Laser pointer for presenting
- Two-finger tap to undo, three-finger tap to redo (up to 250 steps while a notebook is open)

**Paper and pages**
- Blank, ruled (three spacings), grids, dot grid, Cornell notes, checklist, music staff, isometric, plus daily, weekly and monthly planners
- Adjustable line spacing for ruled, grid and dot pages, applied to one page or the whole notebook
- Seven paper colours including dark papers, five page sizes, portrait or landscape
- Page navigator with thumbnails, drag-to-reorder, bookmarks, duplicate, insert and delete
- Pinch zoom up to 600% with crisp vector ink at every zoom level

**PDFs and export**
- Import PDFs and annotate them; their text becomes searchable
- Import photos as pages
- Export a notebook, a page range or one page as PDF, or a page as a PNG image

**Library**
- Notebook covers (twelve colours, seven styles), folders, favourites, recently opened, trash
- Search across titles, typed text and text inside imported PDFs
- Light and dark mode
- One-file backup (.zip) and restore, for keeping copies in Files or iCloud Drive

## Good to know

- **Storage.** Notes are saved on the iPad as you write. Make a backup from Settings › Storage & backup now and then.
- **Updates.** The app updates itself in the background; the new version loads the next time you open it.
- **Offline.** After the first launch everything works without a connection. The handwriting font (Caveat) needs one online launch to be cached.

## Developing

There is no build step. Serve the folder with any static file server and open it:

```bash
python3 -m http.server 8000
```

- `index.html` loads the scripts in `js/` in order. Every module attaches to a global `Q` namespace.
- `js/ink.js` holds the stroke engine (smoothing, pressure, outlines, erasing, shape recognition).
- `js/render.js` holds the tiled page renderer. `js/editor.js` and `js/editor-ui.js` hold the notebook editor.
- `sw.js` is the offline service worker. Bump `VERSION` in it when you change the list of app files.
- `vendor/pdfjs/` is pdf.js 3.11.174 (Apache-2.0), used for PDF import.
- `android/` wraps these same files in an Android app. Run `gradle assembleDebug` in that folder, with the Android SDK and Gradle 8.13 installed.
