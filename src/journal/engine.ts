// Splat Journal engine: three.js + Spark splat rendering, floating notes,
// handwriting, drawing on the scene and float/spin camera controls.
// Ported from the single-page prototype; attaches to the elements App.tsx renders.
// @ts-nocheck
// Type checking is off for this file: it is the prototype's engine ported as-is.
// Public surface is typed (mountJournal); the internals are plain JS. Typing them
// properly is a good next step once the design settles.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { SparkRenderer, SplatMesh, dyno } from "@sparkjsdev/spark";
import { normalizeNoteStyle } from "./note-style.js";
import { listPages, getPage, createPage, savePage, deletePage, takeLegacy, getLines, setLines, getSong, saveSong, deleteSong } from "./store";
import { PenLine, rng, hash, f1, openCurve, loopPts, overLine, linePts, rectStrokes, inkOutline, keepSketching, reducedMotion, setLineFeel, getLineFeel } from "./pen";

type Vec3 = [number, number, number];
interface Note { id: string; p: Vec3; text: string; strokes: number[][][] | null; style?: "pencil" | "whisper"; scale?: number; reach?: number; color?: "black" | "white"; el?: HTMLElement }
interface Doodle { pts: Vec3[]; d: number; color?: "black" | "white"; el?: SVGPathElement }
interface Page { key: string; title: string; flipped: boolean; notes: Note[]; doodles: Doodle[]; date?: string }
interface Source { fileBytes: Uint8Array; key: string; label: string; flipped?: boolean; title?: string; start?: Vec3; target?: Vec3 }

export function mountJournal(): () => void {
const $ = (id: string) => document.getElementById(id) as any;
const lifecycle = new AbortController();
let disposed = false;

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

// ---------- chrome: every line in the interface is drawn by the pen (see pen.ts) ----------
const lines = new Map();      // name -> PenLine for the fixed pieces of chrome
const marks = new WeakMap();  // button -> { line, key }
function penIn(host, name, opts) {
  let l = lines.get(name);
  if (!l || l.g.parentNode !== host) { l?.dispose(); l = new PenLine(host, opts); lines.set(name, l); }
  return l;
}

// where a button's label actually sits, relative to the button
function labelBox(b) {
  const t = [...b.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
  const br = b.getBoundingClientRect();
  if (!t) return { x: 6, y: br.height / 2 - 6, w: br.width - 12, h: 12 };
  const r = document.createRange(); r.selectNodeContents(t);
  const tr = r.getBoundingClientRect();
  return { x: tr.left - br.left, y: tr.top - br.top, w: tr.width, h: tr.height };
}
// what mark a button wears in its current state: a loop drawn round it, an underline, or nothing
function markOf(b) {
  const on = b.classList.contains("on");
  if (b.classList.contains("tool")) return on ? "loop" : "faint";
  if (b.classList.contains("style-picker") || b.classList.contains("color-picker") || b.classList.contains("feel")) return on ? "loop" : "";
  if (b.closest(".tabs")) return on ? "under" : "";
  if (b.id === "saveBtn" || b.id === "songPlay") return "loop";
  return "faint";
}
function drawMarks(animate = false) {
  document.querySelectorAll("button.mark").forEach((b, i) => {
    if (!b.offsetWidth) return; // hidden for now; drawn when it shows
    let m = marks.get(b);
    if (!m) {
      const host = svgEl("svg", { class: "mark-ink", "aria-hidden": "true" });
      b.appendChild(host);
      m = { host, line: null, key: "" };
      marks.set(b, m);
    }
    const kind = markOf(b), box = labelBox(b), key = `${kind}:${Math.round(box.x)}:${Math.round(box.y)}:${Math.round(box.w)}`;
    if (m.key === key) return;
    const kindChanged = m.key.split(":")[0] !== kind;
    m.key = key;
    if (!m.line || kindChanged) {
      m.line?.dispose();
      m.line = kind ? new PenLine(m.host, { width: kind === "faint" ? 0.8 : 1.1, className: kind === "faint" ? "faint" : "", taper: 5, wobble: kind === "loop" ? 1 : 0.7 }) : null;
    }
    if (!m.line) return;
    const seed = 40 + i * 13 + (kind === "loop" ? 5 : 0);
    if (kind === "loop") m.line.set([loopPts(box.x + box.w / 2, box.y + box.h / 2 + 0.5, box.w / 2 + 12, box.h / 2 + 8, seed)]);
    else m.line.set(overLine(box.x - 2, box.y + box.h + 2.5, box.x + box.w + 3, box.y + box.h + 1.5, seed, kind === "under" ? 0.5 : 0.25));
    if (animate && kindChanged) m.line.drawOn(0, kind === "loop" ? 320 : 180);
  });
}

function syncLineFeel(feel = getLineFeel()) {
  const toggle = $("inkFeelToggle"), menu = $("inkFeelMenu");
  for (const name of ["still", "breathing", "sketchy"]) {
    const button = $("feel" + name[0].toUpperCase() + name.slice(1));
    const selected = feel === name;
    button.classList.toggle("on", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  toggle.textContent = `ink · ${feel}`;
  toggle.setAttribute("aria-label", `Ink movement: ${feel}. Change how the hand-drawn lines move.`);
  toggle.setAttribute("aria-expanded", String(!menu.hidden));
  drawMarks(true);
}

async function chooseLineFeel(feel) {
  lineFeelTouched = true;
  setLineFeel(feel);
  syncLineFeel(feel);
  $("inkFeelMenu").hidden = true;
  $("inkFeelToggle").setAttribute("aria-expanded", "false");
  try { await setLines(feel); } catch (err) { console.warn("could not save the ink movement preference", err); }
}
let lineFeelTouched = false;

$("inkFeelToggle").onclick = () => {
  const menu = $("inkFeelMenu"), open = menu.hidden;
  menu.hidden = !open;
  $("inkFeelToggle").setAttribute("aria-expanded", String(open));
  if (open) requestAnimationFrame(() => drawMarks(true));
};
$("feelStill").onclick = () => chooseLineFeel("still");
$("feelBreathing").onclick = () => chooseLineFeel("breathing");
$("feelSketchy").onclick = () => chooseLineFeel("sketchy");
document.addEventListener("pointerdown", (e) => {
  if (!$("inkFeelMenu").hidden && !$("inkFeelMenu").parentElement.contains(e.target)) {
    $("inkFeelMenu").hidden = true;
    $("inkFeelToggle").setAttribute("aria-expanded", "false");
  }
}, { signal: lifecycle.signal });
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || $("inkFeelMenu").hidden) return;
  $("inkFeelMenu").hidden = true;
  $("inkFeelToggle").setAttribute("aria-expanded", "false");
  $("inkFeelToggle").focus();
}, { signal: lifecycle.signal });

// ---------- the title is lettered by hand: each character sits a little off the line ----------
function letterInto(el, text, seed) {
  el.textContent = "";
  const r = rng(seed);
  for (const ch of text) {
    const s = document.createElement("span");
    s.className = "ch";
    s.textContent = ch;
    if (ch.trim()) {
      s.style.translate = `0 ${((r() - 0.5) * 3).toFixed(2)}px`;       // baseline ±1.5px
      s.style.rotate = `${((r() - 0.5) * 5).toFixed(1)}deg`;
    }
    s.style.marginRight = `${((r() - 0.35) * 2.2).toFixed(2)}px`;      // spacing jitter
    el.appendChild(s);
  }
}
function letterTitle() {
  const t = $("title");
  if (document.activeElement === t) return; // plain text while it is being edited
  letterInto(t, page?.title || "", hash(page?.title || "") ^ 0x51ed);
  drawTitleLine();
}
function drawTitleLine() {
  const t = $("title"), host = $("titleLine");
  let w = 104;
  if (t.textContent.trim()) { const r = document.createRange(); r.selectNodeContents(t); w = Math.min(r.getBoundingClientRect().width, t.offsetWidth); }
  const x = t.offsetLeft + t.offsetWidth - w, y = t.offsetTop + t.offsetHeight + 1;
  penIn(host, "title", { width: 1.05, taper: 7 }).set(overLine(x - 4, y + 0.5, x + w + 5, y - 1, hash(page?.title || "untitled") ^ 17, 0.6));
}

// ---------- the scan: a loosely cut print pasted into the page ----------
const tornSeed = (Math.random() * 1e9) | 0; // a slightly different cut every time the page opens
let photo = { x: 0, y: 0, w: 0, h: 0 };
function measurePhoto() {
  const r = $("haze").getBoundingClientRect();
  photo = { x: r.left, y: r.top, w: r.width, h: r.height };
}
// walk round the photo's rectangle, pushing the edge in and out at three scales,
// with a couple of small bites where it tore; then feather the whole thing
function tornMaskUrl(W, H, { x, y, w, h }, seed, blur = 7) {
  const r = rng(seed), size = Math.min(1, Math.max(0.45, Math.min(w, h) / 300)); // small prints tear finer
  const per = 2 * (w + h), step = 7 * size, n = Math.ceil(per / step);
  const slow = [r() * 6.283, r() * 6.283, 2 + r() * 3, 5 + r() * 4];
  const knots = Array.from({ length: Math.ceil(per / 26) + 2 }, () => r() * 2 - 1);
  const bites = Array.from({ length: 3 + Math.floor(r() * 3) }, () => ({ at: r() * per, width: 18 + r() * 34, depth: 4 + r() * 8 }));
  const corner = Array.from({ length: 4 }, () => 6 + r() * 16);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const s = i * step;
    let px, py, nx, ny, toCorner;
    if (s < w) { px = x + s; py = y; nx = 0; ny = -1; toCorner = Math.min(s, w - s); }
    else if (s < w + h) { px = x + w; py = y + s - w; nx = 1; ny = 0; toCorner = Math.min(s - w, w + h - s); }
    else if (s < 2 * w + h) { px = x + w - (s - w - h); py = y + h; nx = 0; ny = 1; toCorner = Math.min(s - w - h, 2 * w + h - s); }
    else { px = x; py = y + h - (s - 2 * w - h); nx = -1; ny = 0; toCorner = Math.min(s - 2 * w - h, per - s); }
    const k = s / 26, k0 = Math.floor(k), u = k - k0, e = (1 - Math.cos(u * Math.PI)) / 2;
    let off = size * (5 * Math.sin((s / per) * Math.PI * 2 * slow[2] + slow[0]) + 2.5 * Math.sin((s / per) * Math.PI * 2 * slow[3] + slow[1])
      + 2.2 * (knots[k0] + (knots[k0 + 1] - knots[k0]) * e) + (r() - 0.5) * 1.6);
    for (const b of bites) { const d = Math.abs(s - b.at); if (d < b.width * size / 2) off -= size * b.depth * Math.cos((d / (b.width * size)) * Math.PI); }
    const ci = Math.min(3, Math.floor(s / (per / 4)));
    if (toCorner < corner[ci]) off -= (corner[ci] - toCorner) * 0.55; // corners clipped, never square
    pts.push(`${f1(px + nx * off)},${f1(py + ny * off)}`);
  }
  const svgText = `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}'><filter id='f' x='-5%' y='-5%' width='110%' height='110%'><feGaussianBlur stdDeviation='${blur}'/></filter><polygon points='${pts.join(" ")}' fill='white' filter='url(#f)'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svgText)}")`;
}
function tornEdgeMask() {
  const W = window.innerWidth, H = window.innerHeight, url = tornMaskUrl(W, H, photo, tornSeed);
  for (const el of [canvas, $("ink")]) {
    el.style.webkitMaskImage = el.style.maskImage = url;
    el.style.webkitMaskSize = el.style.maskSize = "100% 100%";
  }
  const haze = $("haze");
  haze.style.webkitMaskImage = haze.style.maskImage = url;
  haze.style.webkitMaskSize = haze.style.maskSize = `${W}px ${H}px`;
  haze.style.webkitMaskPosition = haze.style.maskPosition = `${-photo.x}px ${-photo.y}px`;
}
function placeLightLeak() {
  const r = rng(tornSeed ^ 0xa11ce), leak = $("leak");
  // the leak element overhangs the page by 25% each side, so 30%/70% sit near the page's corners
  leak.style.setProperty("--leak-x", r() < 0.5 ? "30%" : "70%");
  leak.style.setProperty("--leak-y", r() < 0.6 ? "30%" : "70%");
  leak.style.setProperty("--leak-dx", ((r() - 0.5) * 18).toFixed(1) + "%");
  leak.style.setProperty("--leak-dy", ((r() - 0.5) * 14).toFixed(1) + "%");
}

function drawChrome() {
  measurePhoto();
  tornEdgeMask();
  drawTitleLine();
  drawMarks();
  penIn($("sealRing"), "seal", { width: 0.85, taper: 4, wobble: 0.8 }).set([loopPts(11, 12, 9.2, 10.2, hash(page?.number || 0) ^ 44, { turns: 1.2 })]);
  penIn($("stickRing"), "stick", { width: 0.9, className: "faint", taper: 8 }).set([loopPts(48, 48, 40, 40, 7)]);
  penIn($("knobRing"), "knob", { width: 1.05, taper: 4, step: 2, wobble: 0.6 }).set([loopPts(18, 18, 9, 9, 9, { turns: 1.25 })]);
  penIn($("padBox"), "pad", { width: 0.75, className: "faint", taper: 6, wobble: 0.6 }).set(rectStrokes(4, 4, 252, 142, 5, 4));
}
// on load the page is sketched in, one line after another: the title, then the words in the margins
function sketchIn() {
  if (reducedMotion()) return;
  canvas.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 900, easing: "ease-out" });
  const seq = [[lines.get("title"), 220, null]];
  document.querySelectorAll(".margin button.mark").forEach((b) => { if (b.offsetWidth) seq.push([marks.get(b)?.line, 150, b]); });
  if ($("stick").offsetWidth) seq.push([lines.get("stick"), 220, null]);
  let t = 260;
  for (const id of ["title", "pageDate", "seal"]) $(id).animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 60, fill: "backwards" });
  for (const [l, d, label] of seq) {
    label?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay: Math.max(0, t - 80), fill: "backwards" });
    l?.drawOn(t, d);
    t += d * 0.8;
  }
}

// ---------- a tiny built-in page so the journal never opens empty: a cafe table drawn in splats ----------
function sampleScene() {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const g = [];
  const put = (x, y, z, c, s) => g.push(x, y, z, ...c.map((v) => Math.min(1, Math.max(0, v + (rnd() - 0.5) * 0.05))), s);
  const disc = (n, cx, cy, cz, R, c, s) => { for (let i = 0; i < n; i++) { const a = rnd() * 6.2832, r = R * Math.sqrt(rnd()); put(cx + r * Math.cos(a), cy, cz + r * Math.sin(a), c, s); } };
  const tube = (n, cx, y0, y1, cz, R, c, s) => { for (let i = 0; i < n; i++) { const a = rnd() * 6.2832; put(cx + R * Math.cos(a), y0 + (y1 - y0) * rnd(), cz + R * Math.sin(a), c, s); } };
  const dome = (n, cx, cy, cz, R, h, c, s) => { for (let i = 0; i < n; i++) { const a = rnd() * 6.2832, u = rnd(), r = Math.sqrt(1 - u * u); put(cx + R * r * Math.cos(a), cy + h * u, cz + R * r * Math.sin(a), c, s); } };

  const wood = [0.84, 0.74, 0.6], white = [0.96, 0.95, 0.92], dark = [0.2, 0.19, 0.18];
  disc(9000, 0, 0, 0, 0.62, wood, 0.016);              // table top
  tube(2500, 0, -0.03, 0, 0, 0.62, wood, 0.012);       // its edge
  tube(1500, 0, -0.8, -0.03, 0, 0.035, dark, 0.014);   // leg
  disc(1500, 0, -0.8, 0, 0.3, dark, 0.016);            // foot
  disc(2200, -0.2, 0.012, 0.12, 0.17, white, 0.009);   // plate
  dome(2600, -0.2, 0.014, 0.12, 0.095, 0.085, [0.8, 0.52, 0.24], 0.011); // bun
  dome(500, -0.2, 0.07, 0.12, 0.05, 0.035, [0.93, 0.8, 0.5], 0.008);     // its glaze
  disc(1400, 0.24, 0.012, -0.08, 0.12, white, 0.009);  // saucer
  tube(2400, 0.24, 0.014, 0.13, -0.08, 0.07, white, 0.008); // cup
  disc(700, 0.24, 0.11, -0.08, 0.064, [0.3, 0.18, 0.1], 0.009); // coffee
  disc(900, 0.02, 0.011, -0.34, 0.07, [0.55, 0.62, 0.5], 0.008); // a little coaster

  const props = ["x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"];
  const n = g.length / 7;
  const head = new TextEncoder().encode(`ply\nformat binary_little_endian 1.0\nelement vertex ${n}\n` + props.map((p) => `property float ${p}\n`).join("") + "end_header\n");
  const data = new Float32Array(n * 17);
  for (let i = 0; i < n; i++) {
    const o = i * 17, s = i * 7, ls = Math.log(g[s + 6]);
    data[o] = g[s]; data[o + 1] = g[s + 1]; data[o + 2] = g[s + 2];
    for (let k = 0; k < 3; k++) data[o + 6 + k] = (g[s + 3 + k] - 0.5) / 0.28209479;
    data[o + 9] = 5; data[o + 10] = data[o + 11] = data[o + 12] = ls; data[o + 13] = 1;
  }
  const out = new Uint8Array(head.length + data.byteLength);
  out.set(head); out.set(new Uint8Array(data.buffer), head.length);
  return out;
}
const SAMPLE = () => ({ fileBytes: sampleScene(), key: "sample-table-2", label: "sample.ply", flipped: false, title: "a table by the window", start: [0.75, 0.95, 1.85], target: [0, 0.03, 0] });

// ---------- three + spark ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, window.matchMedia("(pointer: coarse)").matches ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
$("stage").appendChild(renderer.domElement);
const canvas = renderer.domElement;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 1000);
const spark = new SparkRenderer({ renderer });
scene.add(spark);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.6;
controls.zoomSpeed = 0.8;

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  drawChrome(); inkDirty = true;
}, { signal: lifecycle.signal });

// ---------- page state ----------
let splat = null;
let page = null;      // the open page's record (see store.ts); null while on the scrapbook
let tool = null;     // null | "note" | "draw"
let editing = null;  // { note } for existing, { point } for new
let inkDirty = true;

const setStatus = (msg) => { $("status").textContent = msg; $("status").style.opacity = msg ? 1 : 0; };
const today = () => { const d = new Date(); return `${d.getDate()}. ${["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"][d.getMonth()]} ${d.getFullYear()}`; };
const pageSong = $("pageSong");
let pageSongUrl = null;

async function hushSong() {
  pageSong.pause();
  try { pageSong.currentTime = 0; } catch { /* the source may still be loading */ }
}

async function bindSong(pg) {
  const pick = $("songPick"), play = $("songPlay"), ask = $("songAsk");
  const name = pg.song;
  await hushSong();
  pick.textContent = name ? `song: ${name}` : "song";
  play.hidden = !name;
  ask.hidden = true;
  pick.hidden = false;

  if (pageSongUrl) URL.revokeObjectURL(pageSongUrl);
  pageSongUrl = null;
  pageSong.removeAttribute("src");
  pageSong.load();
  if (!name) return;

  const bytes = await getSong(pg.id);
  if (pg !== page || pg.song !== name) return;
  if (!bytes) {
    pg.song = null;
    pick.textContent = "song";
    play.hidden = true;
    save(true);
    return;
  }

  const ext = name.split(".").pop()?.toLowerCase();
  const mime = ext === "mp3" ? "audio/mpeg" : ext === "wav" ? "audio/wav" : "audio/mp4";
  pageSongUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
  pageSong.src = pageSongUrl;
  pageSong.load();
}

$("songPick").onclick = () => {
  if (!page) return;
  if (page.song) {
    $("songPick").hidden = true;
    $("songAsk").hidden = false;
    $("songNo").focus();
  } else $("songInput").click();
};
$("songPlay").onclick = async () => {
  if (!page?.song) return;
  if (pageSong.paused) {
    try { await pageSong.play(); } catch (err) { console.warn("could not play the page song", err); }
  } else await hushSong();
};
$("songNo").onclick = () => { $("songAsk").hidden = true; $("songPick").hidden = false; };
$("songYes").onclick = async () => {
  if (!page) return;
  await hushSong();
  await deleteSong(page.id);
  page.song = null;
  save(true);
  await bindSong(page);
};
$("songInput").onchange = async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file || !page) return;
  const pg = page;
  await saveSong(pg.id, new Uint8Array(await file.arrayBuffer()));
  if (page !== pg) return;
  pg.song = file.name;
  save(true);
  await bindSong(pg);
};

// what goes into storage: plain data only (notes and doodles also carry DOM elements while on screen)
const recordOf = (pg) => ({
  ...pg,
    notes: pg.notes.map(({ id, p, text, strokes, style, scale, reach, color }) => ({ id, p, text, strokes, style, scale: scale ?? 1, reach: reach ?? 1, color: color === "white" ? "white" : "black" })),
  doodles: pg.doodles.map(({ pts, d, color }) => ({ pts, d, color: color === "white" ? "white" : "black" })),
  song: pg.song || null,
});
let saveTimer = 0;
// saves are gathered for a moment, since typing a title or drawing would otherwise write on every change
function save(now = false) {
  if (!page) return;
  const pg = page;
  clearTimeout(saveTimer);
  const write = () => savePage(recordOf(pg)).catch((err) => console.warn("could not save the page", err));
  if (now) write(); else saveTimer = window.setTimeout(write, 300);
}
const pad2 = (n) => String(n).padStart(2, "0");

// ---------- haze: far splats fade toward the colour of the paper, inside Spark's own shader ----------
let viewDist = 2;
function paperTone() {
  const hex = getComputedStyle(document.documentElement).getPropertyValue("--paper").trim() || "#f6f2ea";
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b);
}
function paperHaze(mesh, d) {
  try {
    const { dynoBlock, dynoFloat, dynoVec3, splitGsplat, combineGsplat, split, neg, mix, mul, smoothstep, Gsplat } = dyno;
    const near = dynoFloat(d * 0.7), far = dynoFloat(d * 3.2), most = dynoFloat(0.42), tone = dynoVec3(paperTone());
    mesh.enableWorldToView = true;
    mesh.worldModifier = dynoBlock({ gsplat: Gsplat }, { gsplat: Gsplat }, ({ gsplat }) => {
      const { center, rgb } = splitGsplat(gsplat).outputs;
      const { z } = split(mesh.context.worldToView.apply(center)).outputs;
      const amount = mul(smoothstep(near, far, neg(z)), most);
      return { gsplat: combineGsplat({ gsplat, rgb: mix(rgb, tone, amount) }) };
    });
    mesh.updateGenerator();
  } catch (err) {
    console.warn("haze unavailable", err); // the scan still shows, just without distance haze
  }
}

// ---------- loading a page ----------
let loadToken = 0;
async function loadPage(id, direction = 0) {
  if (disposed) return;
  const token = ++loadToken;
  setStatus("loading");
  showHome(false);
  const stored = await getPage(id);
  if (disposed || token !== loadToken) return;
  if (!stored) { setStatus("that page could not be found"); return; }
  save(true); // anything pending on the page being left
  await hushSong();
  if (splat) { scene.remove(splat); splat.dispose?.(); splat = null; }

  const { scanBytes, ...rec } = stored;
  page = rec;
  page.notes ||= [];
  const needsStyleUpgrade = page.notes.some((n) => n.style !== "pencil" && n.style !== "whisper");
  page.notes.forEach(normalizeNoteStyle);
  page.doodles ||= [];
  if (needsStyleUpgrade) save(true);
  lastPageId = page.id;
  $("pageDate").textContent = page.date;
  $("sealNum").textContent = pad2(page.number);
  page.song = page.song || null;
  letterTitle();
  await bindSong(page);
  $("notes").innerHTML = "";
  $("ink").innerHTML = "";
  if (direction && !reducedMotion()) {
    // turning a page: the seal is stamped again, the new print fades up from the turning side
    $("seal").animate([{ opacity: 0, scale: 1.25 }, { opacity: 1, scale: 1 }], { duration: 320, easing: "cubic-bezier(.3,.7,.3,1)" });
    canvas.animate([{ opacity: 0, translate: `${direction * 24}px 0` }, { opacity: 1, translate: "0 0" }], { duration: 520, easing: "ease-out" });
  }

  const nextSplat = new SplatMesh({ fileBytes: scanBytes, fileName: page.label || "scan.ply" });
  splat = nextSplat;
  applyFlip();
  scene.add(nextSplat);

  camera.position.fromArray(page.start || [0, 0, 3]);
  controls.target.fromArray(page.target || [0, 0, 0]);
  camera.lookAt(controls.target);
  // the distance you first see the place from: notes keep a consistent size there, and haze is measured from it
  viewDist = Math.max(0.2, camera.position.distanceTo(controls.target));
  syncLookFromCamera();
  vel.set(0, 0, 0); glide.set(0, 0, 0);

  try {
    await nextSplat.initialized;
    if (disposed || splat !== nextSplat) return;
    paperHaze(nextSplat, viewDist);
    setStatus("");
    page.notes.forEach((n) => makeNoteEl(n));
    inkDirty = true;
    if (!page.cover) wantCover(1500); // its first look becomes its cover
  } catch (err) {
    if (disposed || splat !== nextSplat) return;
    console.error(err);
    setStatus("that file did not open. try a .spz or .ply scan");
  }
}

function applyFlip() {
  // most phone captures come out upside-down in three.js (camera convention), so scans default to flipped
  if (splat && page) splat.rotation.set(page.flipped ? Math.PI : 0, 0, 0);
  inkDirty = true;
}

// "open" begins a new page from the chosen scan (notes from the old journal come along if it was the same file)
const openScan = () => $("fileInput").click();
$("openBtn").onclick = openScan;
$("homeOpenBtn").onclick = openScan;
$("fileInput").onchange = async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  setStatus("loading");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const old = takeLegacy("file:" + file.name + ":" + file.size);
  const rec = await createPage({
    scanBytes: bytes, label: file.name, title: old?.title || "", date: old?.date || today(),
    flipped: old?.flipped ?? true, notes: old?.notes || [], doodles: old?.doodles || [], song: null,
  });
  loadPage(rec.id);
};
$("flipBtn").onclick = () => { if (!page) return; page.flipped = !page.flipped; applyFlip(); save(); wantCover(900); };
$("title").addEventListener("input", () => { if (page) { page.title = $("title").textContent.trim(); save(); } }, { signal: lifecycle.signal });
$("title").addEventListener("focus", () => { $("title").textContent = page?.title || ""; }, { signal: lifecycle.signal });
$("title").addEventListener("blur", letterTitle, { signal: lifecycle.signal });
$("title").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); e.target.blur(); } }, { signal: lifecycle.signal });

// ---------- tools ----------
const isTouch = window.matchMedia("(pointer: coarse)").matches;
function setTool(t) {
  tool = tool === t ? null : t;
  $("noteBtn").classList.toggle("on", tool === "note");
  $("drawBtn").classList.toggle("on", tool === "draw");
  $("noteBtn").setAttribute("aria-pressed", String(tool === "note"));
  $("drawBtn").setAttribute("aria-pressed", String(tool === "draw"));
  $("hint").textContent = tool === "note" ? "tap a spot to leave a note" : (isTouch ? "one finger draws, two move" : "drag to draw on the scene");
  $("hint").classList.toggle("show", !!tool);
  $("undoBtn").classList.toggle("show", tool === "draw");
  $("drawColorBtn").classList.toggle("available", tool === "draw");
  drawMarks(true);
}
$("noteBtn").onclick = () => setTool("note");
$("drawBtn").onclick = () => setTool("draw");
let drawColor = "black";
function syncDrawColor() {
  $("drawColorBtn").textContent = `ink · ${drawColor}`;
  $("drawColorBtn").setAttribute("aria-label", `Drawing color: ${drawColor}. Activate to switch to ${drawColor === "black" ? "white" : "black"}.`);
  $("drawColorBtn").classList.toggle("white", drawColor === "white");
  drawMarks(true);
}
$("drawColorBtn").onclick = () => {
  drawColor = drawColor === "black" ? "white" : "black";
  syncDrawColor();
};
function flashHint(msg) {
  const h = $("hint"), old = h.textContent;
  h.textContent = msg; h.classList.add("show");
  setTimeout(() => { h.textContent = old; h.classList.toggle("show", !!tool); }, 1500);
}

const raycaster = new THREE.Raycaster();
const rayAt = (x, y) => { raycaster.setFromCamera(new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1), camera); return raycaster; };

// note tool: tap (not drag) to pin
let down = null;
canvas.addEventListener("pointerdown", (e) => { down = notePinch ? null : { x: e.clientX, y: e.clientY, t: performance.now() }; }, { signal: lifecycle.signal });
canvas.addEventListener("pointerup", (e) => {
  if (!down || tool !== "note" || !splat) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  const quick = performance.now() - down.t < 400;
  down = null;
  if (moved > 8 || !quick) return; // that was a look/drag, not a tap
  const hit = rayAt(e.clientX, e.clientY).intersectObject(splat, false)[0];
  if (!hit) { flashHint("nothing there. tap right on something"); return; }
  openEditor({ point: splat.worldToLocal(hit.point.clone()).toArray() }); // scan space, so flip keeps notes attached
}, { signal: lifecycle.signal });

// draw tool: a stroke lives on a flat sheet facing you, at the depth of whatever you started on
let drawing = null;
const tmp = new THREE.Vector3();
function beginStroke(e) {
  const ray = rayAt(e.clientX, e.clientY);
  const hit = ray.intersectObject(splat, false)[0];
  const anchor = hit ? hit.point.clone() : ray.ray.at(1.5, new THREE.Vector3());
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), anchor);
  const stroke = { pts: [], d: +anchor.distanceTo(camera.position).toFixed(3), color: drawColor };
  page.doodles.push(stroke);
  drawing = { id: e.pointerId, plane, stroke, x: -99, y: -99 };
  addStrokePoint(e);
}
function addStrokePoint(e) {
  if (Math.hypot(e.clientX - drawing.x, e.clientY - drawing.y) < 2.5) return;
  if (!rayAt(e.clientX, e.clientY).ray.intersectPlane(drawing.plane, tmp)) return;
  drawing.x = e.clientX; drawing.y = e.clientY;
  splat.worldToLocal(tmp);
  drawing.stroke.pts.push([+tmp.x.toFixed(4), +tmp.y.toFixed(4), +tmp.z.toFixed(4)]);
  inkDirty = true;
}
function endStroke(keep) {
  if (!drawing) return;
  if (!keep || !drawing.stroke.pts.length) removeDoodle(drawing.stroke);
  drawing = null; inkDirty = true; save();
}
function removeDoodle(s) { s.el?.remove(); page.doodles = page.doodles.filter((x) => x !== s); inkDirty = true; }
$("undoBtn").onclick = () => { const s = page.doodles[page.doodles.length - 1]; if (s) { removeDoodle(s); save(); } };

let lastInkKey = "";
const pv = new THREE.Vector3();
function renderInk() {
  if (!splat) return;
  const key = camera.matrixWorld.elements.join() + camera.zoom;
  if (!inkDirty && key === lastInkKey) return;
  lastInkKey = key; inkDirty = false;
  const W = window.innerWidth, H = window.innerHeight;
  page.doodles.forEach((s, si) => {
    if (!s.el) {
      Object.defineProperty(s, "el", { value: svgEl("path"), enumerable: false, writable: true });
      s.el.classList.toggle("white-ink", s.color === "white");
      $("ink").appendChild(s.el);
    }
    const out = []; let ok = s.pts.length > 0, dist = 1;
    for (let i = 0; i < s.pts.length && ok; i++) {
      pv.fromArray(s.pts[i]); splat.localToWorld(pv);
      if (i === 0) dist = Math.max(pv.distanceTo(camera.position), 0.01);
      pv.project(camera);
      if (pv.z > 1 || pv.z < -1) ok = false; else out.push([(pv.x + 1) / 2 * W, (1 - pv.y) / 2 * H]);
    }
    s.el.style.display = ok ? "" : "none";
    if (!ok) return;
    const w = Math.min(9, Math.max(0.5, 1.9 * s.d / dist)); // nearer ink looks thicker
    s.el.setAttribute("d", inkOutline(out, w, { seed: si * 31 + 7, step: 2, taper: 4 + w * 3, pressure: 0.28 }));
  });
}

// ---------- note editor ----------
let editMode = "write", noteStyle = "pencil", noteColor = "black", padStrokes = [], padCur = null;
function setNoteStyle(style) {
  noteStyle = style === "whisper" ? "whisper" : "pencil";
  for (const name of ["pencil", "whisper"]) {
    const button = $("style" + name[0].toUpperCase() + name.slice(1));
    const selected = noteStyle === name;
    button.classList.toggle("on", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  drawMarks(true);
}
function setNoteColor(color, preview = true) {
  noteColor = color === "white" ? "white" : "black";
  for (const name of ["Black", "White"]) {
    const button = $("noteInk" + name);
    const selected = noteColor === name.toLowerCase();
    button.classList.toggle("on", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  $("slip").classList.toggle("white-ink", noteColor === "white");
  $("pad").classList.toggle("white-ink", noteColor === "white");
  const note = editing?.note;
  if (preview && note) {
    note.liveColor = noteColor;
    drawNote(note);
  }
  drawMarks(true);
}
function setTab(mode) {
  editMode = mode;
  $("slip").classList.toggle("draw", mode === "draw");
  $("tabWrite").classList.toggle("on", mode === "write");
  $("tabDraw").classList.toggle("on", mode === "draw");
  $("tabWrite").setAttribute("aria-selected", String(mode === "write"));
  $("tabDraw").setAttribute("aria-selected", String(mode === "draw"));
  drawSlip();
  if (mode === "write") setTimeout(() => $("noteText").focus(), 50); else $("noteText").blur();
}
function drawSlip() {
  const s = $("slip");
  penIn($("slipBox"), "slip", { width: 1.1, taper: 10 }).set(rectStrokes(3, 3, s.offsetWidth - 6, s.offsetHeight - 6, 12, 8));
  drawMarks(true);
}
const padInkOf = (pts, i) => inkOutline(pts, 1.7, { seed: i * 17 + 3, step: 1.6, taper: 7, pressure: 0.32 });
function redrawPad() {
  $("padInk").innerHTML = "";
  padStrokes.forEach((st, i) => $("padInk").appendChild(svgEl("path", { d: padInkOf(st, i) })));
  $("padGhost").style.display = padStrokes.length || padCur ? "none" : "";
}
$("tabWrite").onclick = () => setTab("write");
$("tabDraw").onclick = () => setTab("draw");
$("stylePencil").onclick = () => setNoteStyle("pencil");
$("styleWhisper").onclick = () => setNoteStyle("whisper");
$("noteInkBlack").onclick = () => setNoteColor("black");
$("noteInkWhite").onclick = () => setNoteColor("white");

const pad = $("pad");
const padPt = (e) => { const r = pad.getBoundingClientRect(); return [+((e.clientX - r.left) / r.width * 260).toFixed(1), +((e.clientY - r.top) / r.height * 150).toFixed(1)]; };
pad.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  try { pad.setPointerCapture(e.pointerId); } catch (err) { /* fine without capture */ }
  padCur = { id: e.pointerId, pts: [padPt(e)], el: svgEl("path") };
  $("padGhost").style.display = "none";
  $("padInk").appendChild(padCur.el);
  padCur.el.setAttribute("d", padInkOf(padCur.pts, padStrokes.length));
}, { signal: lifecycle.signal });
pad.addEventListener("pointermove", (e) => {
  if (!padCur || e.pointerId !== padCur.id) return;
  padCur.pts.push(padPt(e));
  padCur.el.setAttribute("d", padInkOf(padCur.pts, padStrokes.length));
}, { signal: lifecycle.signal });
const padEnd = (e) => { if (padCur && e.pointerId === padCur.id) { padStrokes.push(padCur.pts); padCur = null; } };
pad.addEventListener("pointerup", padEnd, { signal: lifecycle.signal });
pad.addEventListener("pointercancel", padEnd, { signal: lifecycle.signal });
$("padUndo").onclick = () => { padStrokes.pop(); redrawPad(); };

function openEditor(target) {
  editing = target;
  const n = target.note;
  setNoteStyle(n?.style || "pencil");
  setNoteColor(n?.color || "black", false);
  $("noteText").value = n?.text || "";
  padStrokes = n?.strokes ? n.strokes.map((s) => s.slice()) : [];
  padCur = null;
  $("tearBtn").style.visibility = n ? "visible" : "hidden";
  editScale = n?.scale ?? 1;
  stepEditScale(1);
  editReach = clampReach(n?.reach ?? 1);
  syncConnectorControl();
  $("editor").classList.add("open");
  redrawPad();
  setTab(n?.strokes?.length ? "draw" : editMode);
  drawChrome();
  lines.get("slip")?.drawOn(0, 460);
}
function closeEditor() {
  if (!$("editor").classList.contains("open")) return;
  if (editing?.note) editing.note.liveScale = null; // a size tried in the editor but not saved goes back
  if (editing?.note) {
    editing.note.liveReach = null; // an unsaved connector adjustment returns to its stored length
    if (editing.note.liveColor) { editing.note.liveColor = null; drawNote(editing.note); }
  }
  const returnFocus = editing?.note?.el?.isConnected ? editing.note.el.querySelector(".card") : $("noteBtn");
  $("editor").classList.remove("open"); $("noteText").blur(); editing = null;
  requestAnimationFrame(() => returnFocus?.focus());
}

document.querySelectorAll(".chip").forEach((c) => c.onclick = () => {
  const t = $("noteText"); t.value = (t.value ? t.value.trimEnd() + " " : "") + c.textContent; t.focus();
});
$("cancelBtn").onclick = closeEditor;
$("editor").addEventListener("pointerdown", (e) => { if (e.target.id === "editor") closeEditor(); }, { signal: lifecycle.signal });

$("saveBtn").onclick = () => {
  const text = $("noteText").value.trim();
  const content = editMode === "draw" ? { strokes: padStrokes, text: "" } : { text, strokes: null };
  if (editMode === "draw" ? !padStrokes.length : !text) { closeEditor(); return; }
  if (editing.note) {
    const styleChanged = editing.note.style !== noteStyle;
    Object.assign(editing.note, content, { style: noteStyle, scale: editScale, reach: editReach, color: noteColor });
    editing.note.liveColor = null;
    drawNote(editing.note, styleChanged);
  } else {
    const note = { id: Date.now().toString(36), p: editing.point, style: noteStyle, scale: editScale, reach: editReach, color: noteColor, ...content };
    page.notes.push(note);
    makeNoteEl(note, true);
    wantCover(1400); // once it has been sketched in
  }
  save(); closeEditor();
};
$("tearBtn").onclick = () => {
  const n = editing.note;
  n.el.remove();
  page.notes = page.notes.filter((x) => x.id !== n.id);
  save(); closeEditor();
};

// ---------- floating notes: memories anchored to the scan and projected each frame ----------
//
// Each note has an anchor A on the scan. Its card sits just above or beside A,
// moving a few millimetres on a slow path in world space. Its short trail stays
// attached as the camera moves. Size follows perspective and distant notes soften.
let soapId = 0;
function makeNoteEl(note, fresh = false) {
  const el = document.createElement("div");
  normalizeNoteStyle(note);
  el.className = "note";
  el.innerHTML = '<svg class="trail"></svg><div class="dot"></div><div class="bob"><div class="card"><svg class="bub"></svg><span class="c"></span></div></div>';
  const seed = hash(note.id), r = rng(seed);
  el.dataset.seed = String(seed >>> 0);
  const card = el.querySelector(".card");
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.onclick = () => { if (performance.now() > suppressClick) openEditor({ note }); };
  // pinching a note resizes it (instead of gliding); scrolling over it does the same on a desktop
  card.addEventListener("pointerdown", (e) => { if (e.pointerType === "touch" && notePointerDown(note, e)) { try { card.setPointerCapture(e.pointerId); } catch (err) { /* fine without capture */ } } });
  card.addEventListener("wheel", (e) => noteWheel(note, e), { passive: false });
  card.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openEditor({ note }); }
  };
  $("notes").appendChild(el);
  Object.defineProperty(note, "el", { value: el, enumerable: false, writable: true }); // keep el out of saved JSON
  // its own slow path through the air: periods, phases and a sideways lean for the trail
  Object.defineProperty(note, "air", {
    enumerable: false, writable: true,
    value: { tx: 13 + r() * 8, ty: 15 + r() * 7, tz: 17 + r() * 6, px: r() * 6.283, py: r() * 6.283, pz: r() * 6.283, lean: r() * 6.283 },
  });
  drawNote(note, fresh);
}
function drawNote(note, sketch = false) {
  const el = note.el, c = el.querySelector(".c"), seed = hash(note.id);
  c.innerHTML = "";
  if (note.strokes?.length) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const s of note.strokes) for (const [x, y] of s) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const m = 4, w = Math.max(x1 - x0, 10) + 2 * m, h = Math.max(y1 - y0, 10) + 2 * m, k = 0.62;
    const s = svgEl("svg", { viewBox: `${x0 - m} ${y0 - m} ${w} ${h}`, width: f1(w * k), height: f1(h * k) });
    // drawn as ink: each stroke lands, swells and thins like a real nib (widths are in pad units, shown at k)
    note.strokes.forEach((st, i) => s.appendChild(svgEl("path", { d: inkOutline(st, 2.5, { seed: seed + i * 17, step: 1.6, taper: 9, pressure: 0.34, blob: 3 }) })));
    c.appendChild(s);
  } else c.textContent = note.text;

  const card = el.querySelector(".card");
  const whisper = note.style === "whisper";
  const inkColor = note.liveColor || note.color || "black";
  card.setAttribute("aria-label", `Edit ${whisper ? "whisper" : "pencil"} note: ${note.strokes?.length ? "handwritten note" : note.text}`);
  el.classList.toggle("pencil", !whisper);
  el.classList.toggle("whisper", whisper);
  el.classList.toggle("white-ink", inkColor === "white");

  // the pen lines belonging to this note are rebuilt from scratch
  (el._pens || []).forEach((p) => p.dispose());
  const pens = [];
  Object.defineProperty(el, "_pens", { value: pens, configurable: true, writable: true });
  const trail = el.querySelector(".trail");
  trail.innerHTML = "";
  el._trailLine = null; el._outline = null; el._dots = []; el._trailKey = "";
  if (whisper) {
    el._trailLine = new PenLine(trail, { width: 1.1, taper: 6, step: 2, wobble: 0.7 });
    pens.push(el._trailLine);
  } else {
    // A short string of little pencil marks keeps the note attached to its spot.
    [[0.3, 1.6], [0.57, 2.3], [0.84, 3.1]].forEach(([at, rr], i) => {
      const g = svgEl("g", { class: "thought-dot" });
      g.appendChild(svgEl("circle", { class: "dot-fill", r: rr }));
      trail.appendChild(g);
      const l = new PenLine(g, { width: 0.85, taper: 1.5, step: 1, pressure: 0.2, wobble: 0.5, hook: false, breathe: 0.2 })
        .set([loopPts(0, 0, rr, rr, seed + 31 * i, { turns: 1.2, flat: 0.08 })]);
      pens.push(l);
      el._dots.push({ g, at, l });
    });
  }

  const bub = el.querySelector(".bub");
  const w = card.offsetWidth, h = card.offsetHeight;
  el.dataset.unsized = w ? "" : "1"; // laid out while hidden: draw again once it is on screen
  el.dataset.w = String(w);
  bub.setAttribute("width", w); bub.setAttribute("height", h);
  bub.innerHTML = "";
  let outline = null, body = null;
  if (!whisper && w) {
    // a loose oval round the words with room to spare, so the text never touches the edge
    const cx = w / 2, cy = h / 2, rx = w / 2 + 11, ry = h / 2 + 9;
    const loop = loopPts(cx, cy, rx, ry, seed + 9, { square: 2.35, flat: 0.06 + (seed % 7) / 100 });
    // a barely visible pencil wash sits under the loose ink outline
    const id = `soap-${++soapId}`;
    const grad = svgEl("radialGradient", { id, cx: "36%", cy: "30%", r: "78%" });
    grad.append(svgEl("stop", { offset: "0", class: "soap-light" }), svgEl("stop", { offset: "0.62", class: "soap-mid" }), svgEl("stop", { offset: "1", class: "soap-edge" }));
    const defs = svgEl("defs"); defs.appendChild(grad);
    body = svgEl("g", { class: "bub-body" });
    body.appendChild(svgEl("path", { class: "bub-fill", d: openCurve(loop) + "Z", fill: `url(#${id})` }));
    const glint = [];
    for (let a = 198; a <= 246; a += 6) glint.push([cx + Math.cos(a * Math.PI / 180) * rx * 0.8, cy + Math.sin(a * Math.PI / 180) * ry * 0.7]);
    body.appendChild(svgEl("path", { class: "soap-glint", d: openCurve(glint) }));
    bub.append(defs, body);
    outline = new PenLine(bub, { width: 1.15, taper: 9, step: 2.5 }).set([loop]);
    el._outline = outline;
    pens.push(outline);
  }

  if (!sketch || reducedMotion()) return;
  // a fresh note is sketched in: anchor, the trail, the outline, then the words
  const dot = el.querySelector(".dot");
  dot.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, delay: 20, fill: "backwards" });
  let textAt;
  if (whisper) {
    placeNote(note);
    el._trailLine.drawOn(110, 380);
    textAt = 470;
  } else {
    el._dots.forEach((d, i) => d.l.drawOn(120 + i * 110, 140));
    el._dots.forEach((d, i) => d.g.querySelector(".dot-fill").animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, delay: 120 + i * 110, fill: "backwards" }));
    outline?.drawOn(460, 460);
    body?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, delay: 480, fill: "backwards" });
    textAt = 880;
  }
  c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, delay: textAt, easing: "ease-out", fill: "backwards" });
}

const v = new THREE.Vector3(), worldA = new THREE.Vector3(), worldB = new THREE.Vector3(), worldP = new THREE.Vector3(), lean = new THREE.Vector3();
let airTime = 0;
const toScreen = (p) => { worldP.copy(p).project(camera); return [(worldP.x + 1) / 2 * window.innerWidth, (1 - worldP.y) / 2 * window.innerHeight, worldP.z]; };
// perspective size, relative to the first view; shorter screens scale the notes down slightly
const lifeSize = (dist) => Math.min(1.4, Math.max(0.55, (viewDist / Math.max(dist, 1e-3)) * Math.min(1.05, Math.sqrt(window.innerHeight / 760))));
function placeNote(n) {
  const el = n.el, air = n.air;
  worldA.fromArray(n.p); splat.localToWorld(worldA);
  const [ax, ay, az] = toScreen(worldA);
  const inside = ax > photo.x + 4 && ax < photo.x + photo.w - 4 && ay > photo.y + 4 && ay < photo.y + photo.h - 4;
  const visible = az > -1 && az < 1 && inside;
  el.style.display = visible ? "" : "none";
  if (!visible) return;
  if (el.dataset.unsized) drawNote(n);

  // Keep both note styles close to the tap point, with only a small, slow float.
  const whisper = n.style === "whisper";
  const wantReach = clampReach(n.liveReach ?? n.reach ?? 1);
  air.reach = air.reach == null ? wantReach : air.reach + (wantReach - air.reach) * scaleEase;
  const reach = air.reach;
  const rise = viewDist * 0.018 * reach, sway = reducedMotion() ? 0 : viewDist * 0.003 * reach, t = airTime;
  worldB.copy(worldA);
  worldB.y += (whisper ? 0.5 : 1) * rise + sway * 0.8 * Math.sin((t / air.ty) * 6.283 + air.py);
  worldB.x += sway * Math.sin((t / air.tx) * 6.283 + air.px);
  worldB.z += sway * 0.6 * Math.sin((t / air.tz) * 6.283 + air.pz);
  // the note's own size (0.5–2, eased toward while it changes) on top of its perspective size
  const want = n.liveScale ?? n.scale ?? 1;
  air.k = air.k == null ? want : air.k + (want - air.k) * scaleEase;
  const dist = worldB.distanceTo(camera.position), s = lifeSize(dist) * air.k;
  let [bx, by] = toScreen(worldB);
  bx -= ax; by -= ay;

  // Keep the card on the print while preserving its position near the anchor.
  const w = (Number(el.dataset.w) || 0) * s, h = el.querySelector(".card").offsetHeight * s;
  const whisperGap = 22 * reach;
  if (whisper) el.style.setProperty("--whisper-gap", `${f1(whisperGap)}px`);
  const left = ax + bx + (whisper ? whisperGap * s : -8 * s - w / 2), right = left + w;
  const top = ay + by + (whisper ? -h / 2 : -h - 10 * s), bottom = top + h;
  const safeLeft = photo.x + 8, safeRight = photo.x + photo.w - 8;
  const safeTop = photo.y + 8, safeBottom = photo.y + photo.h - 8;
  if (right > safeRight) bx -= right - safeRight;
  else if (left < safeLeft) bx += safeLeft - left;
  if (top < safeTop) by += safeTop - top;
  else if (bottom > safeBottom) by -= bottom - safeBottom;

  el.style.transform = `translate(${f1(ax)}px, ${f1(ay)}px)`;
  el.style.zIndex = String(10000 - Math.round(dist * 100)); // nearer notes on top
  el.querySelector(".bob").style.transform = `translate(${f1(bx)}px, ${f1(by)}px) scale(${s.toFixed(3)})`;
  el.querySelector(".dot").style.scale = Math.max(0.7, s).toFixed(2);

  // depth of field: far notes soften and pale, near ones are crisp; very near ones brighten, as if they noticed you
  const far = Math.min(1, Math.max(0, (dist - viewDist * 1.1) / (viewDist * 1.4)));
  const near = Math.min(1, Math.max(0, (0.6 - dist) / 0.35));
  const look = `${(far * 1.5).toFixed(1)}:${(1 - far * 0.32).toFixed(2)}:${near.toFixed(2)}`;
  if (el.dataset.look !== look) {
    el.dataset.look = look;
    el.style.filter = far > 0.04 ? `blur(${(far * 1.5).toFixed(1)}px)` : near > 0 ? `brightness(${(1 + near * 0.05).toFixed(3)}) contrast(${(1 + near * 0.06).toFixed(3)})` : "";
    el.style.opacity = (1 - far * 0.32).toFixed(2);
    el.style.setProperty("--near", near.toFixed(2));
  }

  if (whisper) {
    // A short pencilled line reaches from the tap to the whisper's left edge.
    const ex = bx + whisperGap * s, ey = by, len = Math.hypot(ex, ey) || 1, side = Math.cos(air.lean) < 0 ? -1 : 1;
    const key = `${Math.round(ex)}:${Math.round(ey)}`;
    if (el._trailKey !== key) {
      el._trailKey = key;
      const nx = -ey / len, ny = ex / len;
      const pts = [0, 0.3, 0.6, 1].map((u) => [ex * u + nx * Math.sin(u * Math.PI) * len * 0.12 * side, ey * u + ny * Math.sin(u * Math.PI) * len * 0.12 * side]);
      el._trailLine?.set([pts]);
    }
  } else {
    // Pencil marks stay attached to the note as it moves.
    lean.set(Math.cos(air.lean), 0, Math.sin(air.lean)).multiplyScalar(rise * 0.12);
    for (const d of el._dots || []) {
      worldP.copy(worldA).lerp(worldB, d.at).addScaledVector(lean, Math.sin(d.at * Math.PI));
      const ds = lifeSize(worldP.distanceTo(camera.position));
      const [dx, dy] = toScreen(worldP);
      d.g.setAttribute("transform", `translate(${f1(dx - ax)} ${f1(dy - ay)}) scale(${ds.toFixed(2)})`);
    }
  }
}
let scaleEase = 1;
function placeNotes(dt) {
  if (!splat) return;
  scaleEase = 1 - Math.exp(-dt * 14);
  if (!reducedMotion()) airTime += dt;
  splat.updateMatrixWorld();
  for (const n of page.notes) if (n.el) placeNote(n);
}

// ---------- float mode: drift through the scan ----------
let floatMode = true;
const keys = new Set();
const look = { yaw: 0, pitch: 0 };
const vel = new THREE.Vector3();    // (right, up, forward) in units/sec
const glide = new THREE.Vector3();  // one-off pushes from wheel / pinch, eased out over a few frames
const joy = { x: 0, y: 0 };
const pointers = new Map();
let pinchPrev = null;
const euler = new THREE.Euler(0, 0, 0, "YXZ");

function syncLookFromCamera() {
  euler.setFromQuaternion(camera.quaternion, "YXZ");
  look.yaw = euler.y; look.pitch = euler.x;
}
function setFloat(on) {
  floatMode = on;
  $("floatBtn").classList.toggle("on", on);
  $("floatBtn").setAttribute("aria-pressed", String(on));
  $("stick").classList.toggle("show", on && isTouch);
  $("help").textContent = on
    ? (isTouch ? "drag to look · stick to float · pinch to glide" : "drag to look · wasd to float · q e down up · scroll to glide")
    : (isTouch ? "drag to spin · pinch to zoom" : "drag to spin · scroll to zoom");
  controls.enabled = !on && tool !== "draw";
  drawMarks(true);
  if (on) { syncLookFromCamera(); vel.set(0, 0, 0); glide.set(0, 0, 0); }
  else {
    // spin around whatever is about 1.5 units in front of you
    controls.target.copy(camera.position).add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(1.5));
    controls.update();
  }
}
$("floatBtn").onclick = () => setFloat(!floatMode);
$("drawBtn").addEventListener("click", () => { controls.enabled = !floatMode && tool !== "draw"; }, { signal: lifecycle.signal });
$("noteBtn").addEventListener("click", () => { controls.enabled = !floatMode && tool !== "draw"; }, { signal: lifecycle.signal });

function pinchState() {
  const [a, b] = [...pointers.values()];
  return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
}
canvas.addEventListener("pointerdown", (e) => {
  if (notePinch && notePinch.ids.size === 1 && e.pointerType === "touch") { notePointerDown(notePinch.note, e); return; }
  if (tool !== "draw" && pointers.size === 0 && onPaper(e.clientX, e.clientY)) { swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() }; return; }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* fine without capture */ }
  pinchPrev = pointers.size === 2 ? pinchState() : null;
  if (pointers.size > 1) { down = null; endStroke(false); } // two fingers is never a tap or a stroke
  else if (tool === "draw" && splat) beginStroke(e);
}, { signal: lifecycle.signal });
canvas.addEventListener("pointermove", (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (drawing) { if (e.pointerId === drawing.id) addStrokePoint(e); return; }
  if (!floatMode) return;
  if (pointers.size === 1 && tool !== "draw") {   // grab the world and turn it
    look.yaw += dx * 0.004;
    look.pitch = Math.max(-1.45, Math.min(1.45, look.pitch + dy * 0.004));
  } else if (pointers.size === 2 && pinchPrev) {
    const now = pinchState();
    glide.z += (now.d - pinchPrev.d) * 0.012;   // spread fingers = drift forward
    glide.x -= (now.cx - pinchPrev.cx) * 0.006; // two-finger drag = slide sideways / up-down
    glide.y += (now.cy - pinchPrev.cy) * 0.006;
    pinchPrev = now;
  }
}, { signal: lifecycle.signal });
const endPointer = (e) => {
  if (swipe && e.pointerId === swipe.id) {
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y, quick = performance.now() - swipe.t < 700;
    swipe = null;
    if (e.type === "pointerup" && quick && Math.abs(dx) > 60 && Math.abs(dy) < Math.abs(dx) * 0.6) turnPage(dx < 0 ? 1 : -1);
    return;
  }
  if (drawing && e.pointerId === drawing.id) endStroke(e.type === "pointerup");
  pointers.delete(e.pointerId); pinchPrev = null;
};
canvas.addEventListener("pointerup", endPointer, { signal: lifecycle.signal });
canvas.addEventListener("pointercancel", endPointer, { signal: lifecycle.signal });
canvas.addEventListener("wheel", (e) => {
  if (!floatMode) return;
  e.preventDefault();
  glide.z -= Math.max(-200, Math.min(200, e.deltaY)) * 0.004;
}, { passive: false, signal: lifecycle.signal });

const typing = () => $("editor").classList.contains("open") || document.activeElement?.isContentEditable;
window.addEventListener("keydown", (e) => {
  if ($("editor").classList.contains("open") && e.key === "Escape") { closeEditor(); return; }
  if (typing() || e.metaKey || e.ctrlKey) return;
  const k = e.key.toLowerCase();
  if (!homeOpen && (k === "arrowleft" || k === "arrowright")) { e.preventDefault(); if (!e.repeat) turnPage(k === "arrowright" ? 1 : -1); return; }
  keys.add(k);
  if (floatMode && (k === " " || k.startsWith("arrow"))) e.preventDefault();
}, { signal: lifecycle.signal });
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()), { signal: lifecycle.signal });
window.addEventListener("blur", () => keys.clear(), { signal: lifecycle.signal });

const stick = $("stick"), knob = $("knob");
let stickId = null;
function stickMove(e) {
  const r = stick.getBoundingClientRect(), max = 30;
  let x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
  const len = Math.hypot(x, y);
  if (len > max) { x *= max / len; y *= max / len; }
  knob.style.transform = `translate(${x}px, ${y}px)`;
  joy.x = x / max; joy.y = y / max;
}
stick.addEventListener("pointerdown", (e) => { stickId = e.pointerId; try { stick.setPointerCapture(e.pointerId); } catch (err) { /* fine without capture */ } stickMove(e); }, { signal: lifecycle.signal });
stick.addEventListener("pointermove", (e) => { if (e.pointerId === stickId) stickMove(e); }, { signal: lifecycle.signal });
const stickEnd = (e) => { if (e.pointerId !== stickId) return; stickId = null; joy.x = joy.y = 0; knob.style.transform = ""; };
stick.addEventListener("pointerup", stickEnd, { signal: lifecycle.signal });
stick.addEventListener("pointercancel", stickEnd, { signal: lifecycle.signal });

const want = new THREE.Vector3();
function updateFloat(dt) {
  euler.set(look.pitch, look.yaw, 0);
  camera.quaternion.setFromEuler(euler);

  const has = (...ks) => ks.some((k) => keys.has(k)) ? 1 : 0;
  const speed = keys.has("shift") ? 4.5 : 1.6;
  want.set(
    has("d") - has("a") + joy.x,
    has("e", " ") - has("q"),
    has("w", "arrowup") - has("s", "arrowdown") - joy.y
  ).multiplyScalar(speed);
  vel.lerp(want, 1 - Math.exp(-dt * 5));   // ease in and out so it feels like floating, not snapping

  const k = 1 - Math.exp(-dt * 9);
  const mx = vel.x * dt + glide.x * k, my = vel.y * dt + glide.y * k, mz = vel.z * dt + glide.z * k;
  glide.multiplyScalar(1 - k);
  camera.translateX(mx); camera.translateY(my); camera.translateZ(-mz);
}

// ---------- the scrapbook: every page as a torn print, its seal, title and date ----------
let homeOpen = false, lastPageId = null, coverUrls = [];
function showHome(on) {
  homeOpen = on;
  $("home").classList.toggle("open", on);
  document.body.classList.toggle("at-home", on);
  if (on) { save(true); closeEditor(); setTool(null); }
}
async function openHome() {
  showHome(true);
  await renderCovers();
  drawMarks();
}
async function renderCovers() {
  const pages = await listPages();
  coverUrls.forEach((u) => URL.revokeObjectURL(u));
  coverUrls = [];
  const list = $("covers");
  list.innerHTML = "";
  $("homeEmpty").style.display = pages.length ? "none" : "";
  pages.forEach((pg, i) => {
    const li = document.createElement("li");
    li.className = "cover";
    li.innerHTML = '<button class="cover-open" type="button"><span class="cover-print"><img alt="" /></span><span class="seal"></span></button><span class="cover-title"></span><span class="cover-date"></span><span class="cover-delete"><button class="del" type="button">delete page</button><span class="ask" hidden>delete page <b></b>? <button class="yes" type="button">yes</button><button class="no" type="button">no</button></span></span>';
    const num = pad2(pg.number), open = li.querySelector(".cover-open");
    li.querySelector(".seal").textContent = num;
    li.querySelector(".cover-title").textContent = pg.title || "untitled place";
    li.querySelector(".cover-date").textContent = pg.date;
    li.querySelector(".ask b").textContent = num;
    open.setAttribute("aria-label", `Open page ${num}: ${pg.title || "untitled place"}`);
    open.onclick = () => loadPage(pg.id);
    const img = li.querySelector("img"), print = li.querySelector(".cover-print");
    if (pg.cover) {
      const url = URL.createObjectURL(pg.cover);
      coverUrls.push(url);
      img.src = url;
    } else {
      print.classList.add("unseen");
      const sketch = svgEl("svg", { class: "unseen-sketch", viewBox: "0 0 180 120", "aria-hidden": "true" });
      sketch.innerHTML = `
        <path d="M56 13 Q56 10 59 11 L121 15 Q124 15 123 18 L120 54 Q120 57 117 56 L58 53 Q55 53 56 50 Z" />
        <path d="M88 13 L87 54 M57 31 L122 34" class="light" />
        <path d="M48 60 Q76 57 128 63 M50 63 Q82 61 130 65" />
        <path d="M62 65 L64 94 Q86 98 114 95 L117 66" />
        <path d="M58 97 Q88 101 120 98 M65 103 Q90 106 114 103" class="light" />
        <path d="M136 62 Q132 57 135 52 Q138 48 140 43 M140 55 Q146 51 148 46 M135 54 Q129 49 128 45" class="light" />
        <path d="M132 63 Q140 65 147 62 L145 70 Q139 72 133 69 Z" class="accent" />
        <path d="M39 26 l4 -2 M34 33 l3 1 M148 24 l4 2" class="light" />`;
      print.appendChild(sketch);
    }
    // each print gets its own torn edge, the same every time for that page
    const tear = () => {
      const w = print.offsetWidth, h = print.offsetHeight;
      if (!w) return;
      const url = tornMaskUrl(w, h, { x: 6, y: 6, w: w - 12, h: h - 12 }, hash(pg.id), 3.5);
      print.style.webkitMaskImage = print.style.maskImage = url;
      print.style.webkitMaskSize = print.style.maskSize = "100% 100%";
    };
    img.onload = tear;
    // deleting asks first, in the margin
    const del = li.querySelector(".del"), ask = li.querySelector(".ask");
    del.onclick = () => { del.hidden = true; ask.hidden = false; ask.querySelector(".no").focus(); };
    ask.querySelector(".no").onclick = () => { ask.hidden = true; del.hidden = false; del.focus(); };
    ask.querySelector(".yes").onclick = async () => {
      await deletePage(pg.id);
      if (lastPageId === pg.id) { lastPageId = null; page = null; if (splat) { scene.remove(splat); splat.dispose?.(); splat = null; } }
      renderCovers();
    };
    list.appendChild(li);
    requestAnimationFrame(tear);
    if (!reducedMotion()) li.animate([{ opacity: 0, translate: "0 6px" }, { opacity: 1, translate: "0 0" }], { duration: 380, delay: 60 * i, easing: "ease-out", fill: "backwards" });
  });
}
$("homeBtn").onclick = openHome;

// ---------- turning pages: swipe across the paper margin, or the left and right arrow keys ----------
async function turnPage(dir) {
  if (!page || homeOpen) return;
  const pages = await listPages(), i = pages.findIndex((p) => p.id === page.id), next = pages[i + dir];
  if (next) loadPage(next.id, dir);
  else flashHint(dir > 0 ? "this is the last page" : "this is the first page");
}
const onPaper = (x, y) => x < photo.x || x > photo.x + photo.w || y < photo.y || y > photo.y + photo.h;
let swipe = null;

// ---------- covers: a small JPEG of the print, taken in the page ----------
let coverAt = 0;
function wantCover(delay) { coverAt = performance.now() + delay; }
function captureCover() {
  if (!page || !splat || !photo.w) return;
  const pg = page, k = canvas.width / window.innerWidth;
  const tw = 360, th = Math.round(tw * photo.h / photo.w);
  const c = document.createElement("canvas");
  c.width = tw; c.height = th;
  const ctx = c.getContext("2d");
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--paper").trim() || "#f6f2ea";
  ctx.fillRect(0, 0, tw, th);
  ctx.filter = getComputedStyle(canvas).filter; // the same faded print as on the page
  ctx.drawImage(canvas, photo.x * k, photo.y * k, photo.w * k, photo.h * k, 0, 0, tw, th);
  c.toBlob((blob) => { if (blob && pg === page) { pg.cover = blob; save(true); } }, "image/jpeg", 0.8);
}

// ---------- resizing a note: pinch it, scroll over it, or "smaller"/"larger" in the editor ----------
const SCALE_MIN = 0.5, SCALE_MAX = 2;
const clampScale = (k) => Math.min(SCALE_MAX, Math.max(SCALE_MIN, k));
const REACH_MIN = 0.3, REACH_MAX = 2.5;
const clampReach = (k) => Math.min(REACH_MAX, Math.max(REACH_MIN, Number(k) || 1));
// past the limits it gives a little, like stretching paper, and springs back when you let go
const rubber = (k) => (k > SCALE_MAX ? SCALE_MAX + (k - SCALE_MAX) * 0.3 : k < SCALE_MIN ? SCALE_MIN - (SCALE_MIN - k) * 0.3 : k);
function showResizing(note) {
  const el = note.el, now = performance.now();
  if (now - (el._resizeShown || 0) < 700) return; // once per gesture, not on every step
  el._resizeShown = now;
  (el._outline || el._trailLine)?.drawOn(0, 380);
}
function setNoteScale(note, k, { live = false } = {}) {
  note.liveScale = live ? rubber(k) : null;
  if (!live) note.scale = clampScale(k);
  showResizing(note);
}
let notePinch = null; // { note, ids: Map<id,{x,y}>, d0, k0 }
let suppressClick = 0;
function pinchDistance(ids) { const [a, b] = [...ids.values()]; return Math.hypot(a.x - b.x, a.y - b.y); }
function notePointerDown(note, e) {
  if (notePinch && notePinch.note !== note) return false;
  notePinch ||= { note, ids: new Map(), d0: 0, k0: 1 };
  notePinch.ids.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (notePinch.ids.size === 2) { notePinch.d0 = pinchDistance(notePinch.ids) || 1; notePinch.k0 = note.scale ?? 1; showResizing(note); }
  return true;
}
window.addEventListener("pointermove", (e) => {
  const p = notePinch?.ids.get(e.pointerId);
  if (!p) return;
  p.x = e.clientX; p.y = e.clientY;
  if (notePinch.ids.size === 2) setNoteScale(notePinch.note, notePinch.k0 * pinchDistance(notePinch.ids) / notePinch.d0, { live: true });
}, { signal: lifecycle.signal });
const notePointerUp = (e) => {
  if (!notePinch?.ids.has(e.pointerId)) return;
  if (notePinch.ids.size === 2) { // the pinch ends: settle inside the limits and keep it
    const n = notePinch.note;
    setNoteScale(n, n.liveScale ?? n.scale ?? 1);
    save(); suppressClick = performance.now() + 400;
  }
  notePinch.ids.delete(e.pointerId);
  if (!notePinch.ids.size) notePinch = null;
};
window.addEventListener("pointerup", notePointerUp, { signal: lifecycle.signal });
window.addEventListener("pointercancel", notePointerUp, { signal: lifecycle.signal });
const wheelSettle = new WeakMap();
function noteWheel(note, e) {
  e.preventDefault();
  const k = (note.liveScale ?? note.scale ?? 1) * Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.004);
  setNoteScale(note, k, { live: true });
  clearTimeout(wheelSettle.get(note));
  wheelSettle.set(note, setTimeout(() => { setNoteScale(note, note.liveScale ?? note.scale); save(); }, 220));
}
// the editor's two words step the size by 15%; it is kept when you save, undone if you cancel
let editScale = 1;
let editReach = 1;
function syncConnectorControl() {
  const input = $("connectorReach");
  input.value = String(editReach);
  $("connectorValue").textContent = `${Math.round(editReach * 100)}%`;
}
$("connectorReach").addEventListener("input", () => {
  editReach = clampReach($("connectorReach").value);
  syncConnectorControl();
  const note = editing?.note;
  if (note) note.liveReach = editReach;
});
function stepEditScale(f) {
  editScale = clampScale(editScale * f);
  const n = editing?.note;
  if (n) { n.liveScale = editScale; showResizing(n); }
  $("smallerBtn").disabled = editScale <= SCALE_MIN + 1e-3;
  $("largerBtn").disabled = editScale >= SCALE_MAX - 1e-3;
}
$("smallerBtn").onclick = () => stepEditScale(1 / 1.15);
$("largerBtn").onclick = () => stepEditScale(1.15);

// ---------- start ----------
setFloat(true);
placeLightLeak();
drawChrome();
sketchIn();
keepSketching(lifecycle.signal);
getLines().then((feel) => {
  if (disposed || lineFeelTouched) return;
  setLineFeel(feel);
  syncLineFeel(feel);
}).catch((err) => console.warn("could not load the ink movement preference", err));
$("title").addEventListener("input", drawTitleLine, { signal: lifecycle.signal });
// renaming happens in plain text: the hand-lettered spans come back when you are done
$("title").addEventListener("focus", () => {
  const t = $("title"), sel = window.getSelection(), r = document.createRange();
  r.selectNodeContents(t); r.collapse(false); sel?.removeAllRanges(); sel?.addRange(r);
}, { signal: lifecycle.signal });
document.fonts?.ready.then(() => { if (disposed) return; drawChrome(); page?.notes.forEach((n) => n.el && drawNote(n)); }); // lettering changes sizes once the pen font arrives

const clock = new THREE.Clock();
let breath = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (homeOpen || !page) return; // the scene rests while the scrapbook is open
  if (floatMode) updateFloat(dt); else controls.update();
  // the whole scan breathes: about 1% in and out over 8 s (still under reduced motion)
  breath += dt;
  const zoom = reducedMotion() ? 1 : 1 + 0.005 * Math.sin((breath / 8) * Math.PI * 2);
  if (camera.zoom !== zoom) { camera.zoom = zoom; camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld();
  renderer.render(scene, camera);
  if (coverAt && performance.now() >= coverAt && splat && !$("status").textContent) { coverAt = 0; captureCover(); }
  placeNotes(dt);
  renderInk();
});

// the first visit (an empty journal) begins with the sample table as page 01
showHome(true); // the journal opens on the scrapbook, while its pages are read
setStatus("");
(async () => {
  let pages = await listPages();
  if (disposed) return; // (in development React mounts twice; only the living instance may create the sample)
  if (!pages.length) {
    const sample = SAMPLE(), old = takeLegacy(sample.key);
    await createPage({
      scanBytes: sample.fileBytes, label: sample.label, title: old?.title || sample.title, date: old?.date || today(),
      flipped: old?.flipped ?? sample.flipped, notes: old?.notes || [], doodles: old?.doodles || [], start: sample.start, target: sample.target,
    });
    pages = await listPages();
  }
  if (disposed) return;
  openHome();
})();

return () => {
  disposed = true;
  lifecycle.abort();
  void hushSong();
  pageSong.removeAttribute("src");
  pageSong.load();
  if (pageSongUrl) { URL.revokeObjectURL(pageSongUrl); pageSongUrl = null; }
  renderer.setAnimationLoop(null);
  if (splat) { scene.remove(splat); splat.dispose?.(); splat = null; }
  renderer.dispose();
  canvas.remove();
};
}
