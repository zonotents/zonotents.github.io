// main.js: page setup (math, theme) and the four demos.
import * as Z from "./zono.js";
import { View, css, scheduler, fmt } from "./plot.js";

const { V, M } = Z;
const DEG = Math.PI / 180;

// ---------- math typesetting ----------
function renderMath() {
  if (!window.katex) return;
  document.querySelectorAll(".m").forEach((el) => katex.render(el.textContent, el, { throwOnError: false }));
  document.querySelectorAll(".md").forEach((el) => katex.render(el.textContent, el, { throwOnError: false, displayMode: true }));
}

// ---------- theme ----------
const redrawers = [];
const SUN = `<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="4.6" fill="#f5b83d" stroke="#d98f12" stroke-width="1.2"/>
  <g stroke="#e9a21f" stroke-width="2" stroke-linecap="round">${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
    const r = (a * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    return `<line x1="${(12 + 7.4 * c).toFixed(2)}" y1="${(12 + 7.4 * s).toFixed(2)}" x2="${(12 + 9.8 * c).toFixed(2)}" y2="${(12 + 9.8 * s).toFixed(2)}"/>`;
  }).join("")}</g></svg>`;
const MOON = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z" fill="#c9cdf5" stroke="#8f96e0" stroke-width="1.2" stroke-linejoin="round"/>
  <circle cx="17.6" cy="5.4" r="1" fill="#c9cdf5"/><circle cx="20.4" cy="9" r="0.7" fill="#c9cdf5"/></svg>`;
function setupTheme() {
  const btn = document.getElementById("theme-btn");
  const icon = btn.querySelector(".theme-icon"), text = btn.querySelector(".theme-text");
  const order = ["auto", "light", "dark"];
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  let mode = "auto";
  try { mode = localStorage.getItem("theme") || "auto"; } catch (e) { /* storage blocked */ }
  const apply = () => {
    if (mode === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", mode);
    const shown = mode === "auto" ? (media.matches ? "dark" : "light") : mode;
    icon.innerHTML = shown === "dark" ? MOON : SUN;
    text.textContent = mode === "auto" ? `Theme: auto (${shown})` : `Theme: ${mode}`;
    const next = order[(order.indexOf(mode) + 1) % order.length];
    btn.title = `Switch to ${next === "auto" ? "the system theme" : next}`;
    redrawers.forEach((f) => f("theme"));
  };
  btn.addEventListener("click", () => {
    mode = order[(order.indexOf(mode) + 1) % order.length];
    try { localStorage.setItem("theme", mode); } catch (e) { /* storage blocked */ }
    apply();
  });
  media.addEventListener("change", apply);
  apply();
}

// ---------- small UI helpers ----------
function ui(root, onInput) {
  const get = {};
  root.querySelectorAll("[data-in]").forEach((el) => {
    const k = el.dataset.in;
    get[k] = () => (el.type === "checkbox" ? el.checked : parseFloat(el.value));
    el.addEventListener("input", () => onInput(k));
  });
  root.querySelectorAll("[data-seg]").forEach((seg) => {
    const k = seg.dataset.seg;
    get[k] = () => seg.querySelector("[aria-pressed=true]")?.dataset.v;
    seg.querySelectorAll("button").forEach((b) => {
      if (!b.hasAttribute("aria-pressed")) b.setAttribute("aria-pressed", "false");
      b.type = "button";
      b.addEventListener("click", () => {
        seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        onInput(k);
      });
    });
  });
  const set = (k, v) => { const el = root.querySelector(`[data-in="${k}"]`); if (el) el.value = v; };
  const out = (k, text) => { const el = root.querySelector(`[data-out="${k}"]`); if (el) el.textContent = text; };
  const stats = (rows) => {
    const dl = root.querySelector("[data-stats]");
    dl.innerHTML = rows.map((r) => (r === "-" ? '<div class="sep"></div>' : `<dt>${r[0]}</dt><dd>${r[1]}</dd>`)).join("");
  };
  return { get, set, out, stats };
}

function tooltip(root) {
  const tip = root.querySelector(".tip");
  return (text, px) => {
    if (!text) { tip.classList.remove("on"); return; }
    tip.textContent = text;
    tip.style.left = px[0] + "px"; tip.style.top = px[1] + "px";
    tip.classList.add("on");
  };
}

// A density layer for View.surface. The oblique mesh is centered at the mode when it is inside the support (so the
// peak is a mesh vertex), else at the support's center. off shifts the drawing.
const meshQ = (zt) => (zt.eta < 1 && Z.insideH(zt.H, zt.mode, -1e-3) ? zt.mode : zt.z.c);
function layerOf(zt, { off = [0, 0], color = css("--blue"), vmax = Z.peak(zt), ...rest } = {}) {
  const shifted = off[0] !== 0 || off[1] !== 0;
  return {
    f: shifted ? (x, y) => Z.density(zt, x - off[0], y - off[1]) : (x, y) => Z.density(zt, x, y),
    H: shifted ? null : zt.H, P: zt.P.map((p) => V.add(p, off)), q: V.add(meshQ(zt), off), color, vmax, ...rest,
  };
}
// Draw layers with their supports. floor() draws what lies in the support's plane (samples, obstacles): under the
// translucent solids in the oblique view, over the shading in the top view.
function drawLayers(view, layers, floor = () => {}) {
  if (view.oblique) {
    for (const L of layers) view.polygon(L.P, { fill: css("--chip"), stroke: css("--ink"), width: 1.1 });
    floor();
    view.surface(layers);
  } else {
    view.surface(layers);
    for (const L of layers) view.polygon(L.P, { width: 1.6 });
    floor();
  }
}

const covFrom = (s1, s2, th) => {
  const R = M.rot(th * DEG);
  return M.mul(M.mul(R, [[s1 * s1, 0], [0, s2 * s2]]), M.T(R));
};
const vecStr = (v) => `(${fmt(v[0], 2)}, ${fmt(v[1], 2)})`;

// =====================================================================================================
// Demo 1: explore a Gaussian zonotent
// =====================================================================================================
function demoExplore() {
  const root = document.getElementById("demo-explore");
  const view = new View(root.querySelector("canvas"), { x0: -4, x1: 4, y0: -3, y1: 3 });
  const tip = tooltip(root);
  const PRESETS = {
    2: [[1.7, 0.3], [-0.5, 1.2]],
    3: [[1.5, 0.1], [0.5, 1.0], [-0.7, 0.6]],
    4: [[1.2, 0.0], [0.5, 0.8], [-0.5, 0.6], [0.3, -0.4]],
    5: [[1.0, 0.1], [0.5, 0.7], [-0.4, 0.6], [0.4, -0.35], [0.0, 0.45]],
  };
  const st = { c: [0, 0], G: PRESETS[3].map((g) => [...g]), mu: [0.7, 0.35], zt: null, samples: [] };

  const rebuildHandles = () => {
    view.handles = [];
    view.addHandle({ get: () => st.c, set: (p) => { st.c = p; }, label: "c" });
    st.G.forEach((g, i) => view.addHandle({
      get: () => V.add(st.c, st.G[i]), set: (p) => { st.G[i] = V.sub(p, st.c); }, r: 7,
    }));
    view.addHandle({ get: () => st.mu, set: (p) => { st.mu = p; }, color: css("--blue"), label: "μ" });
  };
  rebuildHandles();

  const U = ui(root, (k) => {
    if (k === "ngen") { st.G = PRESETS[U.get.ngen()].map((g) => [...g]); rebuildHandles(); }
    if (k === "proj") view.setMode(U.get.proj());
    draw("input");
  });
  view.setMode(U.get.proj());  // start in the view pressed in the page (oblique, as in Fig. 1 of the paper)

  const compute = () => {
    const S = covFrom(U.get.s1(), U.get.s2(), U.get.th()), z = Z.zonotope(st.c, st.G);
    st.mu = Z.clampMean(z, st.mu, S, 5);  // keeps the Gaussian's mass on Z computable (see Z.clampMean)
    st.zt = Z.zonotent(z, st.mu, S, U.get.eta());
    st.samples = Z.sample(st.zt, 700, Z.mulberry32(7));
    st.mom = Z.moments(st.zt);
  };

  const draw = scheduler((reason) => {
    if (!["hover", "theme", "resize", "refine"].includes(reason)) compute();
    if (!st.zt) compute();
    const zt = st.zt, blue = css("--blue");
    U.out("s1", fmt(U.get.s1(), 2)); U.out("s2", fmt(U.get.s2(), 2));
    U.out("th", `${U.get.th()}°`); U.out("eta", fmt(U.get.eta(), 2));
    view.clear(); view.grid(1);
    drawLayers(view, [layerOf(zt)], () => { if (U.get.samples()) view.points(st.samples, css("--ink"), 1.1, 0.45); });
    if (U.get.ellipse()) view.ellipse(zt.mu, zt.S, 2, { stroke: blue, width: 1.3, dash: [2, 3] });
    if (U.get.moments()) {
      view.ellipse(st.mom.mean, st.mom.cov, 2, { stroke: css("--ink"), width: 1.4, dash: [6, 4] });
      view.marker(st.mom.mean, { shape: "cross", r: 4, label: "mean", labelDx: 8, labelDy: 10 });
    }
    if (!Z.insideH(zt.H, zt.mu) && zt.eta < 1) view.marker(zt.mode, { color: blue, r: 4, label: "mode", labelDy: 12 });
    view.drawHandles();
    U.stats([
      ["Generators", zt.z.G.length],
      ["vol(Z)", fmt(zt.area, 3)],
      ["Gaussian mass ν(Z)", fmt(zt.nu, 4)],
      ["Peak density", fmt(Z.peak(zt), 3)],
      "-",
      ["Parameter μ", vecStr(zt.mu)],
      ["Own mean", vecStr(st.mom.mean)],
    ]);
  });
  view.onChange = draw;
  view.onHover = (w, px) => {
    if (!w || !st.zt) return tip(null);
    const d = Z.density(st.zt, w[0], w[1]);
    tip(d > 0 ? `f(x) = ${fmt(d, 3)}` : "outside Z: f(x) = 0", px);
  };
  redrawers.push(draw);
  draw("input");
}

// =====================================================================================================
// Demo 2: moment-matched Minkowski sum vs. the exact convolution
// =====================================================================================================
function demoMinkowski() {
  const root = document.getElementById("demo-minkowski");
  const view = new View(root.querySelector("canvas"), { x0: -5.4, x1: 4.2, y0: -3.0, y1: 3.0 });
  const tip = tooltip(root);
  // Real coordinates: both inputs and the sum are centered near 0; the drawing offsets them.
  const OFF_X = [-3.6, 1.15], OFF_Y = [-3.6, -1.6], OFF_S = [1.5, 0];
  const GY = [[0.5, 0.0], [0.0, 0.5], [0.3, -0.3]];
  const gram = (G) => G.reduce((S, g) => M.add(S, M.outer(g, g)), [[0, 0], [0, 0]]);
  const PRE = {
    gg: { eta1: 0, eta2: 0, sy: 1 / 9 },
    ug: { eta1: 1, eta2: 0, sy: 1 / 9 },
    un: { eta1: 1, eta2: 0, sy: 1 / 81 },
    uu: { eta1: 1, eta2: 1, sy: 1 / 9 },
  };
  const st = {
    G1: [[1.0, 0.25], [-0.35, 0.7]], mu1: [0.25, 0.1], S1: [[0.25, 0.08], [0.08, 0.15]],
    G2: GY.map((g) => [...g]), mu2: [0, 0], sy: 1 / 9,
  };

  view.addHandle({ get: () => V.add(OFF_X, st.mu1), set: (p) => { st.mu1 = V.sub(p, OFF_X); }, color: css("--blue"), label: "μ₁",
    hidden: () => U.get.eta1() >= 1 });
  st.G1.forEach((_, i) => view.addHandle({ get: () => V.add(OFF_X, st.G1[i]), set: (p) => { st.G1[i] = V.sub(p, OFF_X); } }));
  st.G2.forEach((_, i) => view.addHandle({ get: () => V.add(OFF_Y, st.G2[i]), set: (p) => { st.G2[i] = V.sub(p, OFF_Y); } }));

  const U = ui(root, (k) => {
    if (k === "preset") {
      const p = PRE[U.get.preset()];
      U.set("eta1", p.eta1); U.set("eta2", p.eta2); st.sy = p.sy;
    }
    if (k === "proj") { view.setMode(U.get.proj()); draw("theme"); return; }  // no need to recompute
    draw("input");
  });
  U.set("eta1", 0); U.set("eta2", 0);

  // The exact density of X + Y on a grid: conv(s) = integral over Q = Z1 ∩ (s - Z2) of f1(p) f2(s - p) dp, in
  // closed form. Each f is w + alpha N, so the integrand has four terms: a constant (the area of Q), N1(p),
  // N2(s - p), and N1(p) N2(s - p) = N(s; mu1 + mu2, S1 + S2) N(p; m*, S*), each a Gaussian mass on the polygon Q.
  function convolution(zt1, zt2, sum, N) {
    const bb = Z.bbox(sum.P), hx = (bb.x1 - bb.x0) / N, hy = (bb.y1 - bb.y0) / N;
    const vals = new Float64Array(N * N);
    const negP2 = zt2.P.map((p) => [-p[0], -p[1]]);  // -Z2 (a point reflection keeps the counterclockwise order)
    const m = zt1.mass * zt2.mass;
    const c11 = m * zt1.w * zt2.w, c12 = m * zt1.w * zt2.alpha, c21 = m * zt1.alpha * zt2.w, c22 = m * zt1.alpha * zt2.alpha;
    const S1i = M.inv(zt1.S), S2i = M.inv(zt2.S), Sstar = M.sym(M.inv(M.add(S1i, S2i)));
    const S1imu1 = M.vec(S1i, zt1.mu), Nsum = Z.makeGauss(V.add(zt1.mu, zt2.mu), M.add(zt1.S, zt2.S));
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const s = [bb.x0 + (i + 0.5) * hx, bb.y0 + (j + 0.5) * hy];
        if (!Z.insideH(sum.H, s)) continue;
        const Q = Z.clipPolygon(zt1.P, negP2.map((p) => V.add(p, s)));
        if (Q.length < 3) continue;
        const s_mu2 = V.sub(s, zt2.mu);
        let v = c11 > 0 ? c11 * Math.abs(Z.polygonArea(Q)) : 0;
        if (c12 > 0) v += c12 * Z.gaussMassPolygon(Q, s_mu2, zt2.S);
        if (c21 > 0) v += c21 * Z.gaussMassPolygon(Q, zt1.mu, zt1.S);
        if (c22 > 0) {
          const k = Nsum(s[0], s[1]);
          if (k > 0) v += c22 * k * Z.gaussMassPolygon(Q, M.vec(Sstar, V.add(S1imu1, M.vec(S2i, s_mu2))), Sstar);
        }
        vals[j * N + i] = v;
      }
    }
    const at = (x, y) => {
      if (!Z.insideH(sum.H, [x, y], 1e-9)) return 0;  // the grid's edge cells would otherwise repeat past the support
      const u = (x - bb.x0) / hx - 0.5, w = (y - bb.y0) / hy - 0.5;
      const i = Math.max(0, Math.min(N - 2, Math.floor(u))), j = Math.max(0, Math.min(N - 2, Math.floor(w)));
      const a = Math.min(Math.max(u - i, 0), 1), b = Math.min(Math.max(w - j, 0), 1);
      return (1 - a) * (1 - b) * vals[j * N + i] + a * (1 - b) * vals[j * N + i + 1]
        + (1 - a) * b * vals[(j + 1) * N + i] + a * b * vals[(j + 1) * N + i + 1];
    };
    let l1 = 0, mass = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = bb.x0 + (i + 0.5) * hx, y = bb.y0 + (j + 0.5) * hy;
      mass += vals[j * N + i] * hx * hy;
      l1 += Math.abs(Z.density(sum, x, y) - vals[j * N + i]) * hx * hy;
    }
    return { at, l1, mass, peak: Math.max(...vals) };
  }

  let cache = {};
  const compute = (fine) => {
    const zt1 = Z.zonotent(Z.zonotope([0, 0], st.G1), st.mu1, st.S1, U.get.eta1());
    const zt2 = Z.zonotent(Z.zonotope([0, 0], st.G2), st.mu2, M.scale(gram(st.G2), st.sy), U.get.eta2());
    const t0 = performance.now();
    const r = Z.minkowskiMomentSum(zt1, zt2);
    const ms = performance.now() - t0;
    const conv = convolution(zt1, zt2, r.zt, fine ? 90 : 44);
    cache = { zt1, zt2, r, ms, conv, fine };
  };

  // A coarse convolution grid while things move, and a fine one once they have been still for a moment.
  let fineTimer = null;
  const draw = scheduler((reason) => {
    if (!cache.r || reason === "input" || reason === "drag" || reason === "drop") {
      compute(reason === "fine");
      clearTimeout(fineTimer);
      fineTimer = setTimeout(() => draw("fine"), 180);
    } else if (reason === "fine") compute(true);
    const { zt1, zt2, r, conv } = cache, sum = r.zt, blue = css("--blue");
    U.out("eta1", fmt(U.get.eta1(), 2)); U.out("eta2", fmt(U.get.eta2(), 2));
    const mode = U.get.view(), ink = css("--ink");
    view.clear();
    const IN = 0.55;  // in the oblique view the inputs stand lower, so the one in front hides less of the other
    const layers = [layerOf(zt1, { off: OFF_X, scale: IN }), layerOf(zt2, { off: OFF_Y, scale: IN })];
    const vmax = Math.max(Z.peak(sum), conv.peak);
    const sumBase = { P: sum.P.map((p) => V.add(p, OFF_S)), q: V.add(meshQ(sum), OFF_S), H: null };
    if (mode === "matched") layers.push(layerOf(sum, { off: OFF_S, vmax }));
    else if (mode === "exact") layers.push({ ...sumBase, f: (x, y) => conv.at(x - OFF_S[0], y - OFF_S[1]), color: blue, vmax });
    else {
      const d = (x, y) => Z.density(sum, x - OFF_S[0], y - OFF_S[1]) - conv.at(x - OFF_S[0], y - OFF_S[1]);
      layers.push({ ...sumBase, f: d, signed: true, color: css("--red"), negColor: css("--purple"), vmax: 0.35 * vmax });
    }
    drawLayers(view, layers);
    const title = { matched: "X + Y, moment-matched", exact: "X + Y, exact", diff: "matched − exact" }[mode];
    if (view.oblique) {
      view.label("X", OFF_X, { h: view.H * IN * 1.12, align: "center", size: 14, color: ink });
      view.label("Y", V.add(OFF_Y, [0, -0.9]), { dy: 14, align: "center", size: 14, color: ink });
      view.label(title, OFF_S, { h: view.H * 1.12, align: "center", size: 14, color: ink });
    } else {
      view.label("X", V.add(OFF_X, [0, 1.55]), { align: "center", size: 14, color: ink });
      view.label("Y", V.add(OFF_Y, [0, -1.05]), { align: "center", size: 14, color: ink });
      view.label(title, V.add(OFF_S, [0, 2.6]), { align: "center", size: 14, color: ink });
    }
    view.label("⊕", [-3.6, -0.55], { align: "center", size: 18 });
    view.label("→", [-1.25, 0], { align: "center", size: 22 });
    view.drawHandles();
    U.stats([
      ["Generators of the sum", sum.z.G.length],
      ["Matching iterations", `${r.iterations}${r.converged ? "" : " (not converged)"}`],
      ["Time to match", `${fmt(cache.ms, 1)} ms`],
      ["L¹ distance to exact", `${cache.fine ? "" : "≈ "}${fmt(conv.l1, 3)}`],
      "-",
      ["Mean of X + Y", vecStr(r.mean)],
      ["Parameter μ of the sum", vecStr(sum.mu)],
    ]);
  });
  view.onChange = draw;
  view.onHover = (w, px) => {
    if (!w || !cache.r) return tip(null);
    const s = V.sub(w, OFF_S);
    if (!Z.insideH(cache.r.zt.H, s)) return tip(null);
    tip(`matched ${fmt(Z.density(cache.r.zt, s[0], s[1]), 3)} · exact ${fmt(cache.conv.at(s[0], s[1]), 3)}`, px);
  };
  redrawers.push(draw);
  draw("input");
}

// =====================================================================================================
// Shared: the E1 system, propagated by moment-matched sums
// =====================================================================================================
const A_E1 = M.scale(M.rot(20 * DEG), 0.85);
const G0 = [[0.3, 0.0], [0.1, 0.2]];
const GW = [[0.12, 0.0], [0.0, 0.12], [0.06, -0.06]];
const gramW = GW.reduce((S, g) => M.add(S, M.outer(g, g)), [[0, 0], [0, 0]]);

function noiseZt(kind) {
  return kind === "uniform"
    ? Z.zonotent(Z.zonotope([0, 0], GW), [0, 0], [[1, 0], [0, 1]], 1)
    : Z.zonotent(Z.zonotope([0, 0], GW), [0, 0], M.scale(gramW, 1 / 9), 0);
}

const chains = {};
function chain(kind, b, T) {
  const key = `${kind}|${b}|${T}`;
  if (chains[key]) return chains[key];
  const W = noiseZt(kind);
  const x0 = Z.zonotent(Z.zonotope([0, 0], G0), [0, 0], [[1, 0], [0, 1]], 1);
  const out = [x0];
  for (let t = 1; t <= T; t++) out.push(Z.minkowskiMomentSum(Z.affineZt(out[t - 1], A_E1, b), W).zt);
  return (chains[key] = out);
}

// =====================================================================================================
// Demo 3: probabilistic order reduction
// =====================================================================================================
function demoReduction() {
  const root = document.getElementById("demo-reduction");
  const view = new View(root.querySelector("canvas"), { x0: -2, x1: 2, y0: -1.5, y1: 1.5 });
  const tip = tooltip(root);
  const U = ui(root, (k) => { if (k === "proj") view.setMode(U.get.proj()); draw("input"); });
  let cur = null;

  const compute = () => {
    const zt = chain(U.get.noise(), [0, 0], 10)[U.get.t()];
    const zeta = 10 ** U.get.zeta();
    const res = { zt, zeta, outer: Z.outerReduction(zt), free: Z.freeReduction(zt, zeta) };
    try { res.inner = Z.innerReduction(zt, zeta); } catch (e) { res.inner = null; }
    // fit the view to everything that is drawn
    const all = [...zt.P, ...res.outer.P, ...res.free.P];
    const bb = Z.bbox(all), pad = 0.12 * Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0);
    view.extent = { x0: bb.x0 - pad, x1: bb.x1 + pad, y0: bb.y0 - pad, y1: bb.y1 + pad };
    view.resize();
    cur = res;
  };

  // Label each outline at a different corner so the labels never stack: outer top right, inner bottom left,
  // free bottom right.
  const labelAt = (P, text, dir) => {
    const score = { tr: (p) => p[0] + p[1], bl: (p) => -p[0] - p[1], br: (p) => p[0] - p[1] }[dir];
    let best = P[0];
    for (const p of P) if (score(p) > score(best)) best = p;
    const off = { tr: [6, -9, "left"], bl: [-6, 10, "right"], br: [6, 10, "left"] }[dir];
    view.label(text, best, { dx: off[0], dy: off[1], align: off[2], size: 12, color: css("--ink") });
  };

  const draw = scheduler((reason) => {
    if (!cur || reason === "input") compute();
    if (reason === "resize") view.resize();
    const { zt, zeta, outer, inner, free } = cur;
    U.out("t", U.get.t()); U.out("zeta", zeta < 0.01 ? zeta.toExponential(2) : zeta.toPrecision(3));
    view.clear();
    drawLayers(view, [layerOf(zt)]);
    if (U.get.outer()) { view.polygon(outer.P, { stroke: css("--muted"), width: 1.8 }); labelAt(outer.P, "outer", "tr"); }
    if (U.get.free()) { view.polygon(free.P, { stroke: css("--ink"), width: 2.4, dash: [1.5, 4] }); labelAt(free.P, "free", "br"); }
    if (U.get.inner() && inner) { view.polygon(inner.P, { stroke: css("--ink"), width: 1.8, dash: [7, 4] }); labelAt(inner.P, "inner", "bl"); }
    view.marker(zt.mode, { r: 3, color: css("--ink") });

    const mark = (r) => (r ? "" : ' <span class="badge warn">missed</span>');
    const rows = [
      ["Original", zt.z.G.length, 1, "1"],
      ["Outer", 2, outer.area / zt.area, "1"],
      inner ? ["Inner", 2, inner.area / zt.area, fmt(inner.kept, 4) + mark(inner.reached)] : ["Inner", 2, NaN, "—" + mark(false)],
      ["Free", 2, free.area / zt.area, `≥ ${fmt(free.kept, 4)}` + mark(free.reached)],
    ];
    root.querySelector("[data-table]").innerHTML =
      "<thead><tr><th></th><th class=num>Gens</th><th class=num>Area</th><th class=num>Kept</th></tr></thead><tbody>" +
      rows.map((r) => `<tr><td>${r[0]}</td><td class=num>${r[1]}</td><td class=num>${fmt(r[2], 2)}×</td><td class=num>${r[3]}</td></tr>`).join("") +
      `</tbody><caption style="caption-side:bottom;text-align:left;padding-top:.4rem;color:var(--muted)">Budget: keep ≥ ${fmt(1 - zeta, 4)}. Area is relative to vol(<i>Z</i>).</caption>`;
  });
  view.onChange = draw;
  view.onHover = (w, px) => {
    if (!w || !cur) return tip(null);
    const d = Z.density(cur.zt, w[0], w[1]);
    tip(d > 0 ? `f(x) = ${fmt(d, 3)}` : "outside Z", px);
  };
  redrawers.push(draw);
  draw("input");
}

// =====================================================================================================
// Demo 4: probability of collision (the collision part of E1)
// =====================================================================================================
function demoCollision() {
  const root = document.getElementById("demo-collision");
  const T = 8, B = [0.6, 0.3], NMC = 20000;
  const st = { oc: [1.6, 1.3] };
  const GO = [[0.35, 0.0], [0.1, 0.3]];

  // view extent: every step's support under both noise models, and room to move the obstacle
  let bb = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const k of ["uniform", "tgauss"]) for (const zt of chain(k, B, T)) {
    const b2 = Z.bbox(zt.P);
    bb = { x0: Math.min(bb.x0, b2.x0), x1: Math.max(bb.x1, b2.x1), y0: Math.min(bb.y0, b2.y0), y1: Math.max(bb.y1, b2.y1) };
  }
  const view = new View(root.querySelector("canvas"), { x0: bb.x0 - 0.5, x1: bb.x1 + 0.5, y0: bb.y0 - 0.4, y1: bb.y1 + 0.4 });
  const tip = tooltip(root);
  view.addHandle({ get: () => st.oc, set: (p) => { st.oc = p; }, color: css("--red"), label: "O" });
  const U = ui(root, (k) => { if (k === "proj") { view.setMode(U.get.proj()); draw("theme"); return; } draw("input"); });

  // Monte Carlo of the true system and the plain Gaussian's exact moments, per noise model
  const sims = {};
  function sim(kind) {
    if (sims[kind]) return sims[kind];
    const rng = Z.mulberry32(2026), W = noiseZt(kind), x0 = chain(kind, B, T)[0];
    const xs = [], cur = [];
    for (let i = 0; i < NMC; i++) cur.push(Z.V.add([0, 0], G0.reduce((s, g) => V.add(s, V.scale(g, 2 * rng() - 1)), [0, 0])));
    xs.push(cur.map((p) => [...p]));
    for (let t = 1; t <= T; t++) {
      const w = Z.sample(W, NMC, rng);
      for (let i = 0; i < NMC; i++) cur[i] = V.add(V.add(M.vec(A_E1, cur[i]), B), w[i]);
      xs.push(cur.map((p) => [...p]));
    }
    const mw = Z.moments(W), m0 = Z.moments(x0);
    const gauss = [{ mean: m0.mean, cov: m0.cov }];
    for (let t = 1; t <= T; t++) {
      const g = gauss[t - 1];
      gauss.push({ mean: V.add(M.vec(A_E1, g.mean), B), cov: M.sym(M.add(M.mul(M.mul(A_E1, g.cov), M.T(A_E1)), mw.cov)) });
    }
    return (sims[kind] = { xs, gauss });
  }

  const wilson = (k, n, z = 2.576) => {
    const p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
    return [Math.max(0, c - h), Math.min(1, c + h)];
  };

  let res = null;
  const compute = () => {
    const kind = U.get.noise(), zts = chain(kind, B, T), S = sim(kind);
    const O = Z.zonotope(st.oc, GO), OP = Z.vertices(O), OH = Z.halfspaces(OP);
    const rows = zts.map((zt, t) => {
      const Q = Z.clipPolygon(zt.P, OP);
      const pz = Q.length >= 3 ? Z.massOnPolygon(zt, Q) : 0;
      const pg = Z.gaussMassPolygon(OP, S.gauss[t].mean, S.gauss[t].cov);
      let k = 0;
      for (const p of S.xs[t]) if (Z.insideH(OH, p)) k++;
      return { t, Q, pz, pg, pmc: k / NMC, ci: wilson(k, NMC), touches: Q.length >= 3 };
    });
    res = { kind, zts, S, OP, OH, rows };
  };

  const chart = root.querySelector("[data-chart]");
  let hoverT = null;
  function drawChart() {
    const W = chart.clientWidth || 260, H = 150, L = 38, R = 8, Tp = 18, Bt = 22;
    const ymax = Math.max(0.02, ...res.rows.map((r) => Math.max(r.pz, r.pg, r.ci[1]))) * 1.1;
    const x = (t) => L + (t / T) * (W - L - R), y = (p) => Tp + (1 - p / ymax) * (H - Tp - Bt);
    const ink = css("--ink"), muted = css("--muted"), grid = css("--rule"), blue = css("--blue");
    let s = "";
    for (const f of [0, 0.5, 1]) {
      s += `<line x1="${L}" x2="${W - R}" y1="${y(f * ymax)}" y2="${y(f * ymax)}" stroke="${grid}"/>`;
      s += `<text x="${L - 5}" y="${y(f * ymax) + 3}" text-anchor="end" font-size="10" fill="${muted}">${fmt(f * ymax, 2)}</text>`;
    }
    for (let t = 0; t <= T; t++) s += `<text x="${x(t)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="${muted}">${t}</text>`;
    const sel = U.get.t();
    s += `<line x1="${x(sel)}" x2="${x(sel)}" y1="${Tp - 4}" y2="${H - Bt}" stroke="${muted}" stroke-dasharray="2 3"/>`;
    const path = (key) => res.rows.map((r, i) => `${i ? "L" : "M"}${x(r.t)},${y(r[key])}`).join("");
    s += `<path d="${path("pg")}" fill="none" stroke="${muted}" stroke-width="2" stroke-dasharray="5 4"/>`;
    s += `<path d="${path("pz")}" fill="none" stroke="${blue}" stroke-width="2" stroke-linejoin="round"/>`;
    for (const r of res.rows) {
      s += `<line x1="${x(r.t)}" x2="${x(r.t)}" y1="${y(r.ci[0])}" y2="${y(r.ci[1])}" stroke="${ink}" stroke-width="1.5"/>`;
      s += `<circle cx="${x(r.t)}" cy="${y(r.pmc)}" r="3" fill="${ink}"/>`;
    }
    const hr = hoverT == null ? res.rows[sel] : res.rows[hoverT];
    s += `<text x="${L}" y="11" font-size="10.5" fill="${ink}">t = ${hr.t} · zono ${fmt(hr.pz, 3)} · Gauss ${fmt(hr.pg, 3)} · MC ${fmt(hr.pmc, 3)}</text>`;
    chart.setAttribute("viewBox", `0 0 ${W} ${H}`);
    chart.innerHTML = s;
    chart.onpointermove = (e) => {
      const r = chart.getBoundingClientRect(), t = Math.round(((e.clientX - r.left) - L) / (W - L - R) * T);
      const nt = Math.max(0, Math.min(T, t));
      if (nt !== hoverT) { hoverT = nt; drawChart(); }
    };
    chart.onpointerleave = () => { hoverT = null; drawChart(); };
    chart.onclick = () => { if (hoverT != null) { U.set("t", hoverT); draw("t"); } };
    chart.style.cursor = "pointer";
  }

  const draw = scheduler((reason) => {
    if (!res || reason === "input" || reason === "drag" || reason === "drop") compute();
    const t = U.get.t(), zt = res.zts[t], row = res.rows[t];
    U.out("t", t);
    view.clear(); view.grid(1);
    // In the oblique view the part of the solid over the obstacle is purple, the overlap color.
    const purple = css("--purple"), OH = res.OH;
    const colorAt = view.oblique ? (x, y) => (Z.insideH(OH, [x, y]) ? purple : null) : null;
    drawLayers(view, [layerOf(zt, { colorAt })], () => {
      for (const z of res.zts) if (z !== zt) view.polygon(z.P, { stroke: css("--muted"), width: 0.8 });
      view.polygon(res.OP, { stroke: css("--red"), width: 1.8, fill: "rgba(248,27,2,0.10)" });
      if (row.touches) view.polygon(row.Q, { stroke: purple, width: 1.5, fill: view.oblique ? null : "rgba(180,105,192,0.55)" });
      view.points(res.S.xs[t].slice(0, 1500), css("--ink"), 0.9, 0.35);
    });
    view.label(`Z${String(t).split("").map((d) => "₀₁₂₃₄₅₆₇₈₉"[d]).join("")}`, [zt.z.c[0], Z.bbox(zt.P).y0], { dy: 12, align: "center", size: 13, color: css("--ink") });
    view.drawHandles();
    const zonoAcc = row.pz >= row.ci[0] && row.pz <= row.ci[1];
    U.stats([
      ["Robust check (support only)", row.touches ? "may collide" : "cannot collide"],
      "-",
      ["Zonotent estimate", fmt(row.pz, 4)],
      ["Plain Gaussian", fmt(row.pg, 4)],
      ["Monte Carlo", fmt(row.pmc, 4)],
      ["99% interval", `[${fmt(row.ci[0], 4)}, ${fmt(row.ci[1], 4)}]`],
      ["Zonotent in interval", zonoAcc ? "yes" : "no"],
    ]);
    drawChart();
  });
  view.onChange = draw;
  view.onHover = (w, px) => {
    if (!w || !res) return tip(null);
    const d = Z.density(res.zts[U.get.t()], w[0], w[1]);
    tip(d > 0 ? `f(x) = ${fmt(d, 3)}` : "outside the support", px);
  };
  redrawers.push(draw);
  draw("input");
}

// ---------- boot ----------
function boot() {
  renderMath();
  setupTheme();
  const demos = [demoExplore, demoMinkowski, demoReduction, demoCollision];
  for (const d of demos) {
    try { d(); } catch (e) { console.error(d.name, e); }
  }
  // ?view=oblique opens every demo in the oblique view (for links that show it directly)
  if (new URLSearchParams(location.search).get("view") === "oblique") {
    document.querySelectorAll('[data-seg="proj"] [data-v="oblique"]').forEach((b) => b.click());
  }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
