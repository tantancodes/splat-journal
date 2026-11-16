// pen: every line in the interface is generated to look drawn by hand.
//
// A line is described by its centre ("where the nib travelled") as one or more
// strokes of points. Before it is inked, the centre is roughened the way a hand
// roughens it: a slow drift over the whole stroke, a tremor every few tens of
// pixels, and a fine jitter on top. Each stroke starts with a small hesitation
// blob and lifts off in a short hooked tail. It is then rendered as a filled
// outline whose width swells and thins (pen pressure). PenLine keeps such a line
// alive: it can be drawn on, and now and then it is quietly drawn again.

export type Pt = [number, number];
export type Strokes = Pt[][];

const NS = "http://www.w3.org/2000/svg";
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
};

export const rng = (a: number) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
export const hash = (str: unknown) => {
  let h = 2166136261;
  for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h;
};
export const f1 = (n: number) => n.toFixed(1);
export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** smooth curve through points (uniform Catmull-Rom as cubic Béziers) */
export function openCurve(p: Pt[]): string {
  if (!p.length) return "";
  let d = `M${f1(p[0][0])} ${f1(p[0][1])}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(i - 1, 0)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(i + 2, p.length - 1)];
    d += `C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])} ${f1(p2[1])}`;
  }
  return d;
}
const curveOf = (strokes: Strokes) => strokes.map(openCurve).join("");

/** the same Catmull-Rom curve, sampled every `step` px */
function spline(p: Pt[], step: number): Pt[] {
  const out: Pt[] = p.length ? [p[0]] : [];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(i - 1, 0)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(i + 2, p.length - 1)];
    const n = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const c = (a: number, b: number, e: number, f: number) =>
        0.5 * (2 * b + (-a + e) * t + (2 * a - 5 * b + 4 * e - f) * t2 + (-a + 3 * b - 3 * e + f) * t3);
      out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
}
function lengths(p: Pt[]) {
  const at = [0];
  for (let i = 1; i < p.length; i++) at.push(at[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  return at;
}
function normalAt(p: Pt[], i: number): Pt {
  const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
}

/** 1-d value noise along a stroke: knots `gapMin`–`gapMax` px apart, eased between */
function knotNoise(r: () => number, length: number, gapMin: number, gapMax: number, smooth = true) {
  const at = [0], val = [r() * 2 - 1];
  while (at[at.length - 1] < length) { at.push(at[at.length - 1] + gapMin + r() * (gapMax - gapMin)); val.push(r() * 2 - 1); }
  let k = 0;
  return (s: number) => {
    while (k > 0 && at[k] > s) k--;
    while (k < at.length - 2 && at[k + 1] < s) k++;
    const u = clamp((s - at[k]) / (at[k + 1] - at[k] || 1), 0, 1), e = smooth ? (1 - Math.cos(u * Math.PI)) / 2 : u;
    return val[k] + (val[k + 1] - val[k]) * e;
  };
}

// ---------- how a hand roughens a line ----------

/**
 * Three scales of unsteadiness added together, across the stroke:
 * a slow drift over the whole length (±3 px), a tremor every 20–40 px (±1 px),
 * and a fine jitter (±0.3 px). Small marks get proportionally less.
 * `slow` fixes the drift and tremor (the line's character), `fast` the jitter.
 */
export function roughen(p: Pt[], slow: number, fast: number, k = 1): Pt[] {
  if (p.length < 2 || !k) return p;
  const at = lengths(p), L = at[at.length - 1];
  const r = rng(slow), rf = rng(fast);
  const aDrift = k * Math.min(3, L * 0.012), aTremor = k * Math.min(1, L * 0.008), aFine = k * Math.min(0.3, L * 0.005);
  const w1 = 0.5 + r() * 0.9, w2 = 1.6 + r() * 1.4, ph1 = r() * 6.283, ph2 = r() * 6.283;
  const tremor = knotNoise(r, L, 20, 40), fine = knotNoise(rf, L, 2.5, 5, false);
  return p.map((q, i) => {
    const s = at[i], u = s / (L || 1), n = normalAt(p, i);
    const off = aDrift * (0.75 * Math.sin(Math.PI * w1 * u + ph1) + 0.25 * Math.sin(Math.PI * w2 * u + ph2))
      + aTremor * tremor(s) + aFine * fine(s);
    return [q[0] + n[0] * off, q[1] + n[1] * off] as Pt;
  });
}

/** where the nib lifts it flicks: a short tail curving off the line */
export function hookTail(p: Pt[], seed: number, k = 1): Pt[] {
  if (p.length < 3 || !k) return p;
  const at = lengths(p), L = at[at.length - 1];
  if (L < 6) return p;
  const r = rng(seed), len = k * clamp(L * 0.035, 1.6, 6), side = r() < 0.5 ? -1 : 1, turn = side * (0.9 + r() * 0.9);
  const e = p[p.length - 1];
  let j = p.length - 2;
  while (j > 0 && L - at[j] < 3) j--;
  let a = Math.atan2(e[1] - p[j][1], e[0] - p[j][0]);
  const out = p.slice(), steps = 5;
  let x = e[0], y = e[1];
  for (let i = 1; i <= steps; i++) {
    a += turn * (Math.pow(i / steps, 1.4) - Math.pow((i - 1) / steps, 1.4));
    x += Math.cos(a) * len / steps; y += Math.sin(a) * len / steps;
    out.push([x, y]);
  }
  return out;
}

// ---------- centre lines ----------

export interface LoopOpts { square?: number; turns?: number; flat?: number; wobble?: number }
/**
 * a loop the way a pen draws one: it goes round 15–30% further than it needs to,
 * comes back on a different radius, and one side of it is flatter than the other
 */
export function loopPts(cx: number, cy: number, rx: number, ry: number, seed: number, { square = 2.25, turns, flat, wobble = 0 }: LoopOpts = {}): Pt[] {
  const r = rng(seed), per = 32;
  const t = turns ?? 1.15 + r() * 0.15;
  const a0 = -Math.PI * (0.5 + r() * 0.4), dir = r() < 0.85 ? 1 : -1, steps = Math.ceil(per * t);
  // the second pass comes back 8–15% off the first radius, but never more than ~7 px on a big loop
  const spiral = (r() < 0.5 ? -1 : 1) * Math.min(0.08 + r() * 0.07, 7 / Math.max(rx, ry, 1));
  const flatAt = r() * 6.283, flatBy = flat ?? 0.1 + r() * 0.1, tilt = (r() - 0.5) * 0.08;
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + dir * (i / per) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const grow = 1 + (i / steps - 0.5) * spiral;
    const press = 1 - flatBy * Math.pow(Math.max(0, Math.cos(a - flatAt)), 2);
    const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / square) * rx * grow * press;
    const y = Math.sign(s) * Math.pow(Math.abs(s), 2 / square) * ry * grow * press;
    pts.push([cx + x - y * tilt + (r() - 0.5) * wobble, cy + y + x * tilt + (r() - 0.5) * wobble]);
  }
  return pts;
}

/** a single pen stroke between two points: bowed, never ruler-straight */
export function linePts(x1: number, y1: number, x2: number, y2: number, seed: number, wob = 0.6): Pt[] {
  const r = rng(seed), len = Math.hypot(x2 - x1, y2 - y1), n = Math.max(3, Math.round(len / 40));
  const nx = -(y2 - y1) / (len || 1), ny = (x2 - x1) / (len || 1);
  const bow = (r() < 0.5 ? -1 : 1) * (0.4 + r() * 0.6) * Math.min(5, len * 0.018), lean = 0.35 + r() * 0.3;
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, b = Math.sin(Math.pow(t, lean * 2) * Math.PI) * bow, j = (i === 0 || i === n ? 0.3 : 1) * (r() - 0.5) * wob;
    pts.push([x1 + (x2 - x1) * t + nx * (b + j), y1 + (y2 - y1) * t + ny * (b + j)]);
  }
  return pts;
}

/** a line the pen sometimes goes over twice: a second, shorter pass a hair beside the first */
export function overLine(x1: number, y1: number, x2: number, y2: number, seed: number, twice = 0.6): Strokes {
  const r = rng(seed ^ 0x9e37), first = linePts(x1, y1, x2, y2, seed);
  if (r() > twice) return [first];
  const len = Math.hypot(x2 - x1, y2 - y1), nx = -(y2 - y1) / (len || 1), ny = (x2 - x1) / (len || 1);
  const t0 = 0.04 + r() * 0.25, t1 = 0.72 + r() * 0.33, off = (r() < 0.5 ? -1 : 1) * (0.6 + r() * 0.9);
  const at = (t: number): Pt => [x1 + (x2 - x1) * t + nx * off, y1 + (y2 - y1) * t + ny * off];
  const [a, b] = [at(t0), at(t1)];
  return [first, linePts(a[0], a[1], b[0], b[1], seed + 77)];
}

/** a box drawn as four separate strokes that overshoot the corners */
export function rectStrokes(x: number, y: number, w: number, h: number, seed: number, over = 6, wob = 0.8): Strokes {
  const r = rng(seed), o = () => over * (0.3 + r()), s = () => (r() - 0.5) * over * 0.35;
  return [
    linePts(x - o(), y + s(), x + w + o(), y + s(), seed + 1, wob),
    linePts(x + w + s(), y - o(), x + w + s(), y + h + o(), seed + 2, wob),
    linePts(x + w + o(), y + h + s(), x - o(), y + h + s(), seed + 3, wob),
    linePts(x + s(), y + h + o(), x + s(), y - o(), seed + 4, wob),
  ];
}

/** shift every point along a smooth, low wave: the same line, drawn again by the same hand */
export function breathe(strokes: Strokes, seed: number, amp: number): Strokes {
  if (!amp) return strokes;
  const r = rng(seed);
  return strokes.map((s) => {
    const ax = r() * 6.283, ay = r() * 6.283, fx = 0.012 + r() * 0.03, fy = 0.012 + r() * 0.03;
    let len = 0;
    return s.map((p, i) => {
      if (i) len += Math.hypot(p[0] - s[i - 1][0], p[1] - s[i - 1][1]);
      return [p[0] + amp * Math.sin(len * fx + ax), p[1] + amp * Math.sin(len * fy + ay)] as Pt;
    });
  });
}

// ---------- ink: a centre line becomes a filled, pressure-varied outline ----------

export interface InkOpts { taper?: number; pressure?: number; step?: number; seed?: number; blob?: number }
/**
 * The outline of a nib travelling along `raw`. It lands with a small hesitation
 * blob (a little wider for the first few px), swells and thins with pressure,
 * and thins out as it lifts.
 */
export function inkOutline(raw: Pt[], width: number, { taper = 9, pressure = 0.3, step = 2.5, seed = 1, blob = 3.5 }: InkOpts = {}): string {
  const p: Pt[] = [];
  for (const q of raw.length > 1 ? spline(raw, step) : raw) {
    const l = p[p.length - 1];
    if (!l || Math.abs(l[0] - q[0]) + Math.abs(l[1] - q[1]) > 0.05) p.push(q);
  }
  if (!p.length) return "";
  if (p.length === 1) { // a dot: the nib touched and lifted
    const r = width * 0.62, [x, y] = p[0];
    return `M${f1(x - r)} ${f1(y)}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0Z`;
  }
  const at = lengths(p), L = at[at.length - 1], T = Math.max(0.5, Math.min(taper, L / 3)), B = Math.min(blob, L * 0.15);
  const r = rng(seed), ph1 = r() * 6.283, ph2 = r() * 6.283, l1 = 16 + r() * 18, l2 = 5 + r() * 5, land = 1.35 + r() * 0.25;
  const ease = (u: number) => (u >= 1 ? 1 : 0.38 + 0.62 * Math.sin(Math.max(0, u) * Math.PI / 2));
  const left: Pt[] = [], right: Pt[] = [], half: number[] = [];
  for (let i = 0; i < p.length; i++) {
    const s = at[i];
    const hesitate = B > 0 && s < B ? 1 + (land - 1) * Math.cos((s / B) * Math.PI / 2) : 1;
    const w = width * hesitate * ease((L - s) / T) * (1 + pressure * (0.65 * Math.sin(s / l1 + ph1) + 0.35 * Math.sin(s / l2 + ph2)));
    const [nx, ny] = normalAt(p, i), hw = Math.max(0.12, w / 2);
    half.push(hw);
    left.push([p[i][0] + nx * hw, p[i][1] + ny * hw]);
    right.push([p[i][0] - nx * hw, p[i][1] - ny * hw]);
  }
  const pt = (q: Pt) => `${f1(q[0])} ${f1(q[1])}`;
  const he = f1(half[half.length - 1]), hs = f1(half[0]);
  let d = `M${pt(left[0])}`;
  for (let i = 1; i < left.length; i++) d += `L${pt(left[i])}`;
  d += `A${he} ${he} 0 0 0 ${pt(right[right.length - 1])}`;
  for (let i = right.length - 2; i >= 0; i--) d += `L${pt(right[i])}`;
  return d + `A${hs} ${hs} 0 0 0 ${pt(left[0])}Z`;
}
export const inkOutlines = (strokes: Strokes, width: number, opts: InkOpts = {}) =>
  strokes.map((s, i) => inkOutline(s, width, { ...opts, seed: (opts.seed ?? 1) + i * 7919 })).join("");

// ---------- living lines ----------

export interface PenOpts extends InkOpts {
  width: number;
  className?: string;
  /** how unsteady the hand is: scales drift, tremor and jitter (default 1) */
  wobble?: number;
  /** finish each stroke with a hooked tail (default true) */
  hook?: boolean;
  /** how far a redraw may wander, in px, on top of the new jitter (default 0.45) */
  breathe?: number;
}
const live = new Set<PenLine>();
let maskId = 0;

export class PenLine {
  readonly g: SVGGElement;
  busy = false;
  private bodies: [SVGPathElement, SVGPathElement];
  private front = 0;
  private prepared: Strokes = [];
  private readonly hand = (Math.random() * 1e9) | 0; // this line's character: drift, tremor, hook
  private jitter = (Math.random() * 1e9) | 0;         // this drawing of it: fine jitter, pressure
  private nextJitter = 0;
  private reveal: SVGPathElement | null = null;
  private mask: SVGMaskElement | null = null;
  private fade: Animation[] = [];

  constructor(parent: Element, readonly opts: PenOpts) {
    this.g = svg("g", { class: "penline" + (opts.className ? " " + opts.className : "") });
    this.bodies = [svg("path", { class: "ink-body" }), svg("path", { class: "ink-body", opacity: 0 })];
    this.g.append(...this.bodies);
    parent.appendChild(this.g);
    live.add(this);
  }

  private shape(jitter: number) {
    const k = this.opts.wobble ?? 1;
    const rough = this.prepared.map((p, i) => roughen(p, this.hand + i * 101, jitter + i * 7, k));
    // a redraw changes only the jitter and this breath, so no point moves more than ~2 px
    return breathe(rough, jitter, this.opts.breathe ?? 0.45);
  }
  private outline(jitter: number) {
    const { width, taper, pressure, blob } = this.opts;
    return inkOutlines(this.shape(jitter), width, { taper, pressure, blob, step: this.opts.step ?? 2.5, seed: jitter });
  }

  /** give the line a new centre and paint it at once, without animation */
  set(strokes: Strokes) {
    const hook = this.opts.hook ?? true, k = this.opts.wobble ?? 1;
    this.prepared = strokes.filter((s) => s.length).map((s, i) => {
      const dense = s.length > 1 ? spline(s, 3) : s;
      return hook ? hookTail(dense, this.hand + i * 13, Math.min(1, k + 0.3)) : dense;
    });
    this.paint();
    return this;
  }
  private paint() {
    this.bodies[this.front].setAttribute("d", this.outline(this.jitter));
    if (this.busy) this.bodies[1 - this.front].setAttribute("d", this.outline(this.nextJitter));
    this.reveal?.setAttribute("d", curveOf(this.shape(this.jitter)));
  }

  /** ink the line on from its first point to its last; resolves once it is fully drawn */
  drawOn(delay = 0, duration = 420): Promise<void> {
    if (reducedMotion() || !this.prepared.length || !this.g.ownerSVGElement) return Promise.resolve();
    this.unmask();
    const id = `pen-reveal-${++maskId}`, host = this.g.ownerSVGElement;
    this.mask = svg("mask", { id, maskUnits: "userSpaceOnUse", x: -1e4, y: -1e4, width: 2e4, height: 2e4 });
    this.reveal = svg("path", {
      d: curveOf(this.shape(this.jitter)), fill: "none", stroke: "#fff", "stroke-width": this.opts.width * 3.5 + 3,
      "stroke-linecap": "round", "stroke-linejoin": "round", pathLength: 1, "stroke-dasharray": "1 2", "stroke-dashoffset": 1,
    });
    this.mask.appendChild(this.reveal);
    host.insertBefore(this.mask, host.firstChild);
    this.g.setAttribute("mask", `url(#${id})`);
    const reveal = this.reveal;
    const a = reveal.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration, delay, easing: "cubic-bezier(.35,.1,.3,1)", fill: "both" });
    return a.finished.then(() => { if (this.reveal === reveal) this.unmask(); }, () => {});
  }
  private unmask() {
    this.g.removeAttribute("mask");
    this.mask?.remove();
    this.mask = this.reveal = null;
  }

  /** crossfade to the same line drawn again with a slightly different hand */
  redraw(duration = 400) {
    if (this.busy || this.reveal || !this.prepared.length) return false;
    this.busy = true;
    this.nextJitter = (Math.random() * 1e9) | 0;
    const out = this.bodies[this.front], inn = this.bodies[1 - this.front];
    inn.setAttribute("d", this.outline(this.nextJitter));
    const opt: KeyframeAnimationOptions = { duration, easing: "ease-in-out", fill: "forwards" };
    this.fade = [out.animate([{ opacity: 1 }, { opacity: 0 }], opt), inn.animate([{ opacity: 0 }, { opacity: 1 }], opt)];
    this.fade[1].finished.then(() => {
      out.setAttribute("opacity", "0"); inn.setAttribute("opacity", "1");
      this.fade.forEach((f) => f.cancel()); this.fade = [];
      out.setAttribute("d", "");
      this.front = 1 - this.front; this.jitter = this.nextJitter; this.busy = false;
    }, () => { this.busy = false; });
    return true;
  }

  visible() {
    if (!this.g.isConnected) return false;
    const r = this.g.getBoundingClientRect();
    return r.width + r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
  }
  dispose() {
    live.delete(this);
    this.fade.forEach((f) => f.cancel());
    this.unmask();
    this.g.remove();
  }
}

/** every few seconds one visible line is drawn again, so the page never looks frozen */
export function keepSketching(signal: AbortSignal) {
  if (reducedMotion()) return;
  let timer = 0;
  const tick = () => {
    for (const l of live) if (!l.g.isConnected) l.dispose();
    if (!document.hidden && ![...live].some((l) => l.busy)) {
      const pool = [...live].filter((l) => l.visible());
      if (pool.length) pool[(Math.random() * pool.length) | 0].redraw();
    }
    timer = window.setTimeout(tick, 2400 + Math.random() * 2400);
  };
  timer = window.setTimeout(tick, 2800);
  signal.addEventListener("abort", () => { clearTimeout(timer); [...live].forEach((l) => l.dispose()); });
}
