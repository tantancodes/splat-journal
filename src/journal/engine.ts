// Splat Journal engine: three.js + Spark splat rendering, floating notes,
// handwriting, drawing on the scene and float/spin camera controls.
// Ported from the single-page prototype; attaches to the elements App.tsx renders.
// @ts-nocheck
// Type checking is off for this file: it is the prototype's engine ported as-is.
// Public surface is typed (mountJournal); the internals are plain JS. Typing them
// properly is a good next step once the design settles.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

type Vec3 = [number, number, number];
interface Note { id: string; p: Vec3; text: string; strokes: number[][][] | null; el?: HTMLElement }
interface Doodle { pts: Vec3[]; d: number; el?: SVGPathElement }
interface Page { key: string; title: string; flipped: boolean; notes: Note[]; doodles: Doodle[]; date?: string }
interface Source { fileBytes: Uint8Array; key: string; label: string; flipped?: boolean; title?: string; start?: Vec3; target?: Vec3 }

export function mountJournal(): () => void {
const $ = (id: string) => document.getElementById(id) as any;
const lifecycle = new AbortController();
let disposed = false;

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

// ---------- pen: every line in the interface is generated to look drawn by hand ----------
const rng = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const hash = (str) => { let h = 2166136261; for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h; };
const f1 = (n) => n.toFixed(1);

function openCurve(p) { // smooth curve through points (Catmull-Rom)
  let d = `M${f1(p[0][0])} ${f1(p[0][1])}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(i - 1, 0)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(i + 2, p.length - 1)];
    d += `C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])} ${f1(p2[1])}`;
  }
  return d;
}
// a loop the way a pen draws one: a little more than one turn, never quite meeting itself
function penLoop(cx, cy, rx, ry, seed, { square = 2.4, wobble = 1.2, turns = 1.1 } = {}) {
  const r = rng(seed), n = 18, a0 = -Math.PI * (0.55 + r() * 0.3), steps = Math.ceil(n * turns), pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), drift = 1 + (i / steps - 0.5) * 0.06;
    pts.push([cx + Math.sign(c) * Math.pow(Math.abs(c), 2 / square) * rx * drift + (r() - 0.5) * wobble * 2,
              cy + Math.sign(s) * Math.pow(Math.abs(s), 2 / square) * ry * drift + (r() - 0.5) * wobble * 2]);
  }
  return openCurve(pts);
}
// a box drawn as four separate strokes that overshoot the corners
function penRect(x, y, w, h, seed, over = 6, wob = 1.6) {
  const r = rng(seed), j = () => (r() - 0.5) * wob, o = () => over * (0.3 + r());
  const line = (x1, y1, x2, y2) => { const pts = []; for (let i = 0; i <= 3; i++) { const t = i / 3; pts.push([x1 + (x2 - x1) * t + j(), y1 + (y2 - y1) * t + j()]); } return openCurve(pts); };
  return line(x - o(), y, x + w + o(), y) + line(x + w, y - o(), x + w, y + h + o()) + line(x + w + o(), y + h, x - o(), y + h) + line(x, y + h + o(), x, y - o());
}
// a freehand stroke, lightly smoothed
function inkPath(p) {
  if (p.length === 1) return `M${f1(p[0][0])} ${f1(p[0][1])}l0.1 0`;
  let d = `M${f1(p[0][0])} ${f1(p[0][1])}`;
  for (let i = 1; i < p.length - 1; i++) d += `Q${f1(p[i][0])} ${f1(p[i][1])} ${f1((p[i][0] + p[i + 1][0]) / 2)} ${f1((p[i][1] + p[i + 1][1]) / 2)}`;
  const l = p[p.length - 1];
  return d + `L${f1(l[0])} ${f1(l[1])}`;
}

function drawChrome() {
  const cs = getComputedStyle($("mat")), mt = parseFloat(cs.borderTopWidth), mb = parseFloat(cs.borderBottomWidth), mx = parseFloat(cs.borderLeftWidth);
  $("framePath").setAttribute("d", penRect(mx, mt, window.innerWidth - 2 * mx, window.innerHeight - mt - mb, 3, 7, 2));
  $("framePath").setAttribute("pathLength", "1");
  document.querySelectorAll("nav button, #saveBtn").forEach((b, i) => {
    let s = b.querySelector("svg.sketch-outline");
    if (!s) { s = svgEl("svg", { class: "sketch-outline", "aria-hidden": "true" }); s.appendChild(svgEl("path", { class: "pen", pathLength: "1" })); b.appendChild(s); }
    const w = b.offsetWidth, h = b.offsetHeight;
    if (w) {
      s.setAttribute("viewBox", `0 0 ${w} ${h}`);
      s.setAttribute("preserveAspectRatio", "none");
      const isTool = b.closest("nav");
      s.firstChild.setAttribute("d", isTool
        ? penLoop(w / 2, 17, Math.min(15, w / 2 - 3), 12, 20 + i, { square: 2.2, wobble: 0.9 })
        : penLoop(w / 2, h / 2 + 1, w / 2 - 3, Math.min(h / 2 - 5, 15), 20 + i, { square: 2.2, wobble: 1 }));
    }
  });
  $("stickRing").setAttribute("d", penLoop(48, 48, 44, 44, 7, { square: 2, wobble: 1.4 }));
  $("knobRing").setAttribute("d", penLoop(18, 18, 14, 14, 9, { square: 2, wobble: 0.8 }));
  $("padBox").setAttribute("d", penRect(4, 4, 252, 142, 5, 0, 1.2));
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
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
let page = { key: "", title: "", flipped: true, notes: [], doodles: [] };
let tool = null;     // null | "note" | "draw"
let editing = null;  // { note } for existing, { point } for new
let inkDirty = true;

const setStatus = (msg) => { $("status").textContent = msg; $("status").style.opacity = msg ? 1 : 0; };
const today = () => { const d = new Date(); return `${d.getDate()}. ${["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"][d.getMonth()]} ${d.getFullYear()}`; };

function store(key, value) { try { localStorage.setItem("sj:" + key, JSON.stringify(value)); } catch (e) { /* storage can be unavailable; the page still works for this visit */ } }
function restore(key) { try { return JSON.parse(localStorage.getItem("sj:" + key)); } catch (e) { return null; } }
const save = () => store(page.key, page);

// ---------- loading a scan (= a page) ----------
async function loadPage(source) {
  if (disposed) return;
  setStatus("loading");
  if (splat) { scene.remove(splat); splat.dispose?.(); splat = null; }

  page = restore(source.key) || { key: source.key, title: source.title || "", flipped: source.flipped ?? true, notes: [], doodles: [] };
  page.date ||= today();
  page.doodles ||= [];
  $("pageDate").textContent = page.date;
  $("title").textContent = page.title;
  $("notes").innerHTML = "";
  $("ink").innerHTML = "";

  const nextSplat = new SplatMesh({ fileBytes: source.fileBytes, fileName: source.label });
  splat = nextSplat;
  applyFlip();
  scene.add(nextSplat);

  camera.position.fromArray(source.start || [0, 0, 3]);
  controls.target.fromArray(source.target || [0, 0, 0]);
  camera.lookAt(controls.target);
  syncLookFromCamera();
  vel.set(0, 0, 0); glide.set(0, 0, 0);

  try {
    await nextSplat.initialized;
    if (disposed || splat !== nextSplat) return;
    setStatus("");
    page.notes.forEach((n) => makeNoteEl(n));
    inkDirty = true;
  } catch (err) {
    if (disposed || splat !== nextSplat) return;
    console.error(err);
    setStatus("that file did not open. try a .spz or .ply scan");
  }
}

function applyFlip() {
  // most phone captures come out upside-down in three.js (camera convention), so scans default to flipped
  if (splat) splat.rotation.set(page.flipped ? Math.PI : 0, 0, 0);
  inkDirty = true;
}

$("openBtn").onclick = () => $("fileInput").click();
$("fileInput").onchange = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  loadPage({ fileBytes: bytes, key: "file:" + file.name + ":" + file.size, label: file.name });
  e.target.value = "";
};
$("flipBtn").onclick = () => { page.flipped = !page.flipped; applyFlip(); save(); };
$("title").addEventListener("input", () => { page.title = $("title").textContent.trim(); save(); }, { signal: lifecycle.signal });
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
}
$("noteBtn").onclick = () => setTool("note");
$("drawBtn").onclick = () => setTool("draw");
function flashHint(msg) {
  const h = $("hint"), old = h.textContent;
  h.textContent = msg; h.classList.add("show");
  setTimeout(() => { h.textContent = old; h.classList.toggle("show", !!tool); }, 1500);
}

const raycaster = new THREE.Raycaster();
const rayAt = (x, y) => { raycaster.setFromCamera(new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1), camera); return raycaster; };

// note tool: tap (not drag) to pin
let down = null;
canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; }, { signal: lifecycle.signal });
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
  const stroke = { pts: [], d: +anchor.distanceTo(camera.position).toFixed(3) };
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
  const key = camera.matrixWorld.elements.join();
  if (!inkDirty && key === lastInkKey) return;
  lastInkKey = key; inkDirty = false;
  const W = window.innerWidth, H = window.innerHeight;
  for (const s of page.doodles) {
    if (!s.el) { Object.defineProperty(s, "el", { value: svgEl("path"), enumerable: false, writable: true }); $("ink").appendChild(s.el); }
    const out = []; let ok = s.pts.length > 0, dist = 1;
    for (let i = 0; i < s.pts.length && ok; i++) {
      pv.fromArray(s.pts[i]); splat.localToWorld(pv);
      if (i === 0) dist = Math.max(pv.distanceTo(camera.position), 0.01);
      pv.project(camera);
      if (pv.z > 1 || pv.z < -1) ok = false; else out.push([(pv.x + 1) / 2 * W, (1 - pv.y) / 2 * H]);
    }
    s.el.style.display = ok ? "" : "none";
    if (!ok) continue;
    s.el.setAttribute("d", inkPath(out));
    s.el.setAttribute("stroke-width", Math.min(9, Math.max(0.5, 1.7 * s.d / dist)).toFixed(2)); // nearer ink looks thicker
  }
}

// ---------- note editor ----------
let editMode = "write", padStrokes = [], padCur = null;
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
  $("slipPath").setAttribute("d", penRect(1, 1, s.offsetWidth - 2, s.offsetHeight - 2, 12, 8, 1.8));
  $("slipPath").setAttribute("pathLength", "1");
  drawChrome();
}
function redrawPad() {
  $("padInk").innerHTML = "";
  padStrokes.forEach((st) => $("padInk").appendChild(svgEl("path", { d: inkPath(st) })));
  $("padGhost").style.display = padStrokes.length || padCur ? "none" : "";
}
$("tabWrite").onclick = () => setTab("write");
$("tabDraw").onclick = () => setTab("draw");

const pad = $("pad");
const padPt = (e) => { const r = pad.getBoundingClientRect(); return [+((e.clientX - r.left) / r.width * 260).toFixed(1), +((e.clientY - r.top) / r.height * 150).toFixed(1)]; };
pad.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  try { pad.setPointerCapture(e.pointerId); } catch (err) { /* fine without capture */ }
  padCur = { id: e.pointerId, pts: [padPt(e)], el: svgEl("path") };
  $("padGhost").style.display = "none";
  $("padInk").appendChild(padCur.el);
  padCur.el.setAttribute("d", inkPath(padCur.pts));
}, { signal: lifecycle.signal });
pad.addEventListener("pointermove", (e) => {
  if (!padCur || e.pointerId !== padCur.id) return;
  padCur.pts.push(padPt(e));
  padCur.el.setAttribute("d", inkPath(padCur.pts));
}, { signal: lifecycle.signal });
const padEnd = (e) => { if (padCur && e.pointerId === padCur.id) { padStrokes.push(padCur.pts); padCur = null; } };
pad.addEventListener("pointerup", padEnd, { signal: lifecycle.signal });
pad.addEventListener("pointercancel", padEnd, { signal: lifecycle.signal });
$("padUndo").onclick = () => { padStrokes.pop(); redrawPad(); };

function openEditor(target) {
  editing = target;
  const n = target.note;
  $("noteText").value = n?.text || "";
  padStrokes = n?.strokes ? n.strokes.map((s) => s.slice()) : [];
  padCur = null;
  $("tearBtn").style.visibility = n ? "visible" : "hidden";
  $("editor").classList.add("open");
  redrawPad();
  setTab(n?.strokes?.length ? "draw" : editMode);
}
function closeEditor() {
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
    Object.assign(editing.note, content);
    drawNote(editing.note);
  } else {
    const note = { id: Date.now().toString(36), p: editing.point, ...content };
    page.notes.push(note);
    makeNoteEl(note, true);
  }
  save(); closeEditor();
};
$("tearBtn").onclick = () => {
  const n = editing.note;
  n.el.remove();
  page.notes = page.notes.filter((x) => x.id !== n.id);
  save(); closeEditor();
};

// ---------- notes: floating bubbles, projected from 3D every frame ----------
function makeNoteEl(note, fresh = false) {
  const el = document.createElement("div");
  el.className = "note" + (fresh ? " fresh" : "");
  el.innerHTML = '<svg class="trail"></svg><div class="dot"></div><div class="bob"><div class="card"><svg class="bub"></svg><span class="c"></span></div></div>';
  const seed = hash(note.id);
  const trail = el.querySelector(".trail");
  trail.setAttribute("viewBox", "0 0 30 52");
  trail.setAttribute("preserveAspectRatio", "none");
  const drift = rng(seed + 31);
  const endX = 13 + drift() * 5;
  const trailPoints = [[6, 51], [5 + drift() * 5, 42], [9 + drift() * 6, 33], [11 + drift() * 5, 23], [endX - 2 + drift() * 4, 13], [endX, 2]];
  trail.appendChild(svgEl("path", { class: "trail-line", pathLength: "1", d: openCurve(trailPoints) }));
  el.querySelector(".bob").style.setProperty("--d", (-(seed >>> 0) % 5500) + "ms");
  const card = el.querySelector(".card");
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.onclick = () => openEditor({ note });
  card.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openEditor({ note }); }
  };
  $("notes").appendChild(el);
  Object.defineProperty(note, "el", { value: el, enumerable: false, writable: true }); // keep el out of saved JSON
  drawNote(note);
  if (fresh) setTimeout(() => el.classList.remove("fresh"), 1100);
}
function drawNote(note) {
  const el = note.el, c = el.querySelector(".c");
  c.innerHTML = "";
  if (note.strokes?.length) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const s of note.strokes) for (const [x, y] of s) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const m = 4, w = Math.max(x1 - x0, 10) + 2 * m, h = Math.max(y1 - y0, 10) + 2 * m, k = 0.62;
    const s = svgEl("svg", { viewBox: `${x0 - m} ${y0 - m} ${w} ${h}`, width: f1(w * k), height: f1(h * k) });
    note.strokes.forEach((st) => s.appendChild(svgEl("path", { d: inkPath(st) })));
    c.appendChild(s);
  } else c.textContent = note.text;

  const card = el.querySelector(".card");
  card.setAttribute("aria-label", note.strokes?.length ? "Edit handwritten note" : `Edit note: ${note.text}`);
  const w = card.offsetWidth, h = card.offsetHeight, bub = el.querySelector(".bub");
  bub.setAttribute("width", w); bub.setAttribute("height", h);
  bub.innerHTML = "";
  bub.appendChild(svgEl("path", { class: "pen filled", pathLength: "1", d: penLoop(w / 2, h / 2, w / 2 + 2, h / 2 + 2, hash(note.id) + 9, { square: 3, wobble: 1.3, turns: 1.08 }) }));
}

const v = new THREE.Vector3();
function placeNotes() {
  if (!splat) return;
  splat.updateMatrixWorld();
  for (const n of page.notes) {
    if (!n.el) continue;
    v.fromArray(n.p);
    splat.localToWorld(v);
    const dist = v.distanceTo(camera.position);
    v.project(camera);
    const visible = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15;
    n.el.style.display = visible ? "" : "none";
    if (!visible) continue;
    n.el.style.transform = `translate(${(v.x + 1) / 2 * window.innerWidth}px, ${(1 - v.y) / 2 * window.innerHeight}px)`;
    n.el.style.zIndex = String(10000 - Math.round(dist * 100)); // nearer notes on top
  }
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
    has("d", "arrowright") - has("a", "arrowleft") + joy.x,
    has("e", " ") - has("q"),
    has("w", "arrowup") - has("s", "arrowdown") - joy.y
  ).multiplyScalar(speed);
  vel.lerp(want, 1 - Math.exp(-dt * 5));   // ease in and out so it feels like floating, not snapping

  const k = 1 - Math.exp(-dt * 9);
  const mx = vel.x * dt + glide.x * k, my = vel.y * dt + glide.y * k, mz = vel.z * dt + glide.z * k;
  glide.multiplyScalar(1 - k);
  camera.translateX(mx); camera.translateY(my); camera.translateZ(-mz);
}

// ---------- start ----------
drawChrome();
setFloat(true);
document.fonts?.ready.then(() => { if (disposed) return; drawChrome(); page.notes.forEach((n) => n.el && drawNote(n)); }); // lettering changes sizes once the pen font arrives

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (floatMode) updateFloat(dt); else controls.update();
  camera.updateMatrixWorld();
  renderer.render(scene, camera);
  placeNotes();
  renderInk();
});

loadPage(SAMPLE());

return () => {
  disposed = true;
  lifecycle.abort();
  renderer.setAnimationLoop(null);
  if (splat) { scene.remove(splat); splat.dispose?.(); splat = null; }
  renderer.dispose();
  canvas.remove();
};
}
