# Splat Journal

A 3D scrapbook. Each Gaussian-splat scan of a place is a journal page: float through it, pin thought-bubble or single-line notes (typed or handwritten), and doodle straight onto the scene. Sketchbook look: hand-drawn pen lines, one red seal.

Stack: Vite · React 18 · TypeScript · three.js · [Spark](https://sparkjs.dev) (splat renderer).

## Run it

You need [Node.js](https://nodejs.org) 18 or newer (`node -v` to check).

1. Unzip this folder somewhere, e.g. `~/Documents/splat-journal`.
2. Open VS Code → **File → Open Folder…** → pick that folder.
3. Open the built-in terminal (**Terminal → New Terminal**, or `` Ctrl+` ``) and run:

   ```bash
   npm install
   npm run dev
   ```

4. Open the URL it prints, usually **http://localhost:5173**.

Edits to anything in `src/` reload in the browser instantly.

### On your iPhone (same Wi-Fi)

`npm run dev` already listens on your network. The terminal prints a second URL starting with `http://192.168…`. Open that on your phone, including the `http://` part. If your Mac asks whether Node may accept connections, allow it.

### Install on iPhone

After deploying the production build to an HTTPS host, open the site in Safari and choose **Share → Add to Home Screen**. The app includes a web app manifest and local app icons. It does not cache scenes or promise offline use; uploaded scans and journal notes stay in that browser's local storage.

### Production build

```bash
npm run build      # type-checks, then writes dist/
npm run preview    # serves dist/ locally
```

`dist/` is a static site: drop it on Vercel, Netlify, GitHub Pages or any host.

For Vercel, `vercel.json` pins the Vite build and `dist/` output. Once this folder is linked to a Vercel project and the CLI is authenticated, deploy with `npx vercel --prod`.

## Using it

- **open** – load a `.spz` or `.ply` scan (export from Scaniverse, Polycam, KIRI, Scantic). Upside down? tap **flip**.
- **float** (default) – drag to look · W A S D or joystick to move · Q/E down and up · scroll or pinch to glide · Shift for speed. Tap **float** again for spin-around mode.
- **note** – tap a spot on the scan. Choose a **thought** bubble or **line** annotation, then type a note or switch to **handwrite** and draw it.
- **draw** – doodle onto the scene; strokes stay fixed in 3D. One finger draws, two fingers move. **undo** removes the last stroke.
- Tap a bubble to edit or remove it. Tap the title to rename the page.

Notes, doodles, title and flip state are saved per scan in the browser's localStorage, so they come back when you reopen the same file on the same device.

## Project layout

```
index.html              page shell, loads the pen fonts
src/main.tsx            React entry
src/App.tsx             the page layout (JSX); mounts the engine
src/journal/engine.ts   all behaviour: renderer, camera modes, notes, handwriting, drawing, storage
src/styles.css          the sketchbook look (design tokens at the top of :root)
public/manifest.webmanifest · public/icons/   PWA metadata and local app icons
public/design_ref/papertexture.avif            paper texture used by the interface
design-references/                              art-direction references (kept out of the public build)
vite.config.ts · tsconfig.json · package.json
```

`engine.ts` is the prototype's engine ported as-is and runs with type checking off (`// @ts-nocheck` at the top). The React side is strictly typed. Typing the engine and splitting it into modules (camera, notes, ink, storage) is the natural next refactor.

## Known limits

- Scans are not shared: a scan lives in the browser you opened it in, and localStorage only remembers your notes for it. Sharing a page with someone else needs a backend (planned).
- The sample scene on first load is a small café table generated in code, so there is always something to pin a note on.
- Fonts load from Google Fonts, so the pen lettering needs internet the first time.
