// plot.js: a small canvas plotting layer for the demos (world <-> pixel transform, density rasters, polygons,
// point clouds, draggable handles, and a hover readout). Colors come from CSS custom properties so that light and
// dark mode each use their own surface.

import { insideH } from "./zono.js";

export function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function hexToRgb(h) {
  h = h.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// The oblique view of the paper's Figs. 1 and 2 (experiments/paper_style.py, Oblique): rotate the support's plane
// by ANGLE, squash it vertically by SQUASH, and lift each point straight up by its density.
const OBLIQUE_ANGLE = -12 * Math.PI / 180, SQUASH = 0.38;
const OCOS = Math.cos(OBLIQUE_ANGLE), OSIN = Math.sin(OBLIQUE_ANGLE);

export class View {
  // extent: {x0, x1, y0, y1} in world units; the canvas keeps equal scales on both axes.
  // mode "flat" draws from above; "oblique" draws the oblique view, with peaks `lift` world units tall
  // (default 0.3 times the extent's width).
  constructor(canvas, extent) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.extent = extent;
    this.mode = "flat";
    this.lift = null;
    this.handles = [];
    this.drag = null;
    this.onChange = () => {};
    this.onHover = null;
    this.resize();
    new ResizeObserver(() => { this.resize(); this.onChange("resize"); }).observe(canvas);
    this._bindPointer();
  }

  get oblique() { return this.mode === "oblique"; }
  get H() { return this.lift ?? 0.26 * (this.extent.x1 - this.extent.x0); }

  setMode(mode) { this.mode = mode; this.resize(); }

  // Plane coordinates (before the pixel transform) of the world point p at height h.
  _proj(p, h = 0) {
    if (!this.oblique) return p;
    return [OCOS * p[0] - OSIN * p[1], SQUASH * (OSIN * p[0] + OCOS * p[1]) + h];
  }
  // How far back a world point is in the oblique view (larger is farther).
  depth(p) { return OSIN * p[0] + OCOS * p[1]; }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssW = Math.max(r.width, 10); this.cssH = Math.max(r.height, 10);
    this.canvas.width = Math.round(this.cssW * dpr); this.canvas.height = Math.round(this.cssH * dpr);
    this.dpr = dpr;
    let e = this.extent;
    if (this.oblique) {  // the box around the projected floor, with room above for the peaks
      const C = [[e.x0, e.y0], [e.x1, e.y0], [e.x0, e.y1], [e.x1, e.y1]].map((p) => this._proj(p));
      const xs = C.map((q) => q[0]), ys = C.map((q) => q[1]);
      e = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) + this.H };
    }
    const sx = this.cssW / (e.x1 - e.x0), sy = this.cssH / (e.y1 - e.y0);
    this.s = Math.min(sx, sy);
    this.ox = (this.cssW - this.s * (e.x1 - e.x0)) / 2 - this.s * e.x0;
    this.oy = (this.cssH - this.s * (e.y1 - e.y0)) / 2 + this.s * e.y1;
  }

  px(p, h = 0) { const q = this._proj(p, h); return [this.ox + this.s * q[0], this.oy - this.s * q[1]]; }

  // The world point on the floor (height 0) under the pixel (x, y).
  world(x, y) {
    const a = (x - this.ox) / this.s, b = (this.oy - y) / this.s;
    if (!this.oblique) return [a, b];
    const q1 = b / SQUASH;
    return [OCOS * a + OSIN * q1, -OSIN * a + OCOS * q1];
  }

  // Draw density layers: a raster from above in flat mode, shaded solids in oblique mode.
  // Each layer: {f, H (halfspaces or null), P (support polygon), q (mesh center), color, vmax, signed, colorAt}.
  surface(layers) {
    if (!this.oblique) {
      const flat = [];
      for (const L of layers) {
        if (L.signed) {  // positive part in L.color, negative part in L.negColor
          flat.push({ ...L, f: (x, y) => Math.max(L.f(x, y), 0) });
          flat.push({ ...L, f: (x, y) => Math.max(-L.f(x, y), 0), color: L.negColor });
        } else flat.push(L);
      }
      this.density(flat);
      return;
    }
    const order = layers.map((L, i) => [i, this.depth(L.q)]).sort((a, b) => b[1] - a[1]);
    for (const [i] of order) this.solid(layers[i]);
  }

  // One zonotent as a solid in the oblique view, as draw_density in paper_style.py: a radial mesh from q, faces
  // shaded by height, walls along the boundary, the top edge in color, and vertical edges at the vertices (dashed
  // where hidden). Faces fade to transparent near zero so floor marks show through.
  solid({ f, P, q, color, vmax, signed = false, negColor, colorAt = null, scale = 1 }) {
    // While things move, a mesh about 3x coarser; a full-resolution redraw follows once they have been still for a
    // moment (see _refineSoon).
    const fast = this._isMoving();
    const nBoundary = fast ? 72 : 128, nRings = fast ? 24 : 40;
    const c = this.ctx, Hw = this.H * scale, nE = P.length;
    const per = Math.max(2, Math.ceil(nBoundary / nE));
    const Ux = [], Uy = [];
    for (let k = 0; k < nE; k++) {
      const a = P[k], b = P[(k + 1) % nE];
      for (let s = 0; s < per; s++) { Ux.push(a[0] + (b[0] - a[0]) * s / per); Uy.push(a[1] + (b[1] - a[1]) * s / per); }
    }
    const M = Ux.length, R = nRings, nN = (R + 1) * M;
    // Nodes q + r_i (U_j - q), with radii clustered near q where peaks are. Each node is evaluated and projected
    // once: world (wx, wy), height level F, depth D, and pixel position (X, Y) on the solid.
    const wx = new Float64Array(nN), wy = new Float64Array(nN), F = new Float64Array(nN);
    const X = new Float64Array(nN), Y = new Float64Array(nN), D = new Float64Array(nN);
    const s = this.s, ox = this.ox, oy = this.oy;
    for (let i = 0; i <= R; i++) {
      const r = Math.pow(i / R, 1.25) * (1 - 1e-9);
      for (let j = 0; j < M; j++) {
        const n = i * M + j, x = q[0] + r * (Ux[j] - q[0]), y = q[1] + r * (Uy[j] - q[1]);
        wx[n] = x; wy[n] = y;
        const v = f(x, y) / vmax;
        const h = signed ? Math.max(-1.5, Math.min(1.5, v)) : Math.min(v, 1.5);
        F[n] = h;
        D[n] = OSIN * x + OCOS * y;
        X[n] = ox + s * (OCOS * x - OSIN * y);
        Y[n] = oy - s * (SQUASH * D[n] + Hw * h);
      }
    }
    // Colors from lookup tables (LEVELS steps per color) instead of a new rgba string per face.
    const LEVELS = 48, bg = hexToRgb(css("--plot-bg"));
    const tables = new Map();
    const table = (hex, strength) => {
      const key = hex + strength;
      if (tables.has(key)) return tables.get(key);
      const rgb = hexToRgb(hex), out = [];
      for (let l = 0; l <= LEVELS; l++) {
        const t = l / LEVELS, m = bg.map((v, k) => Math.round(v + (0.3 + 0.7 * t) * (strength * (rgb[k] - v))));
        out.push(`rgba(${m[0]},${m[1]},${m[2]},${Math.min(0.94, 0.16 + 1.1 * t).toFixed(3)})`);
      }
      tables.set(key, out);
      return out;
    };
    const lvl = (x) => Math.round(Math.min(Math.max(x, 0), 1) * LEVELS);
    const posT = table(color, 0.85), negT = table(negColor || color, 0.85), wallT = table(color, 0.55);
    // Faces: R * M quads on top, then M walls. Each is 4 corners given as (pixel x, pixel y) in fx/fy.
    const nF = R * M + M;
    const fx = new Float64Array(nF * 4), fy = new Float64Array(nF * 4), depth = new Float64Array(nF);
    const fill = new Array(nF);
    let m = 0;
    for (let i = 0; i < R; i++) {
      for (let j = 0; j < M; j++, m++) {
        const k = (j + 1) % M, a = i * M + j, b = i * M + k, cc = (i + 1) * M + k, d = (i + 1) * M + j;
        fx[4 * m] = X[a]; fx[4 * m + 1] = X[b]; fx[4 * m + 2] = X[cc]; fx[4 * m + 3] = X[d];
        fy[4 * m] = Y[a]; fy[4 * m + 1] = Y[b]; fy[4 * m + 2] = Y[cc]; fy[4 * m + 3] = Y[d];
        depth[m] = (D[a] + D[cc]) / 2;
        const lev = (F[a] + F[b] + F[cc] + F[d]) / 4;
        const special = colorAt && colorAt((wx[a] + wx[cc]) / 2, (wy[a] + wy[cc]) / 2);
        fill[m] = special ? table(special, 0.85)[lvl(Math.abs(lev) * 0.9 + 0.25)] : (lev >= 0 ? posT : negT)[lvl(Math.abs(lev))];
      }
    }
    const top = R * M;  // the boundary ring
    for (let j = 0; j < M; j++, m++) {  // walls: from the floor up to the boundary values
      const k = (j + 1) % M, a = top + j, b = top + k;
      const ga = this.px([Ux[j], Uy[j]]), gb = this.px([Ux[k], Uy[k]]);
      fx[4 * m] = ga[0]; fx[4 * m + 1] = gb[0]; fx[4 * m + 2] = X[b]; fx[4 * m + 3] = X[a];
      fy[4 * m] = ga[1]; fy[4 * m + 1] = gb[1]; fy[4 * m + 2] = Y[b]; fy[4 * m + 3] = Y[a];
      depth[m] = (D[a] + D[b]) / 2 + 1e-9;
      const special = colorAt && colorAt((Ux[j] + Ux[k]) / 2, (Uy[j] + Uy[k]) / 2);
      fill[m] = (special ? table(special, 0.55) : wallT)[lvl(0.25 + 0.6 * Math.abs(F[a] + F[b]) / 2)];
    }
    const order = new Uint32Array(nF);
    for (let n = 0; n < nF; n++) order[n] = n;
    order.sort((u, v) => depth[v] - depth[u]);  // back to front
    // Fill each face grown by half a pixel about its center, which hides the hairline seams between neighbors
    // without a second (stroke) pass. Consecutive faces of one color share a path and a fill call.
    const GROW = 0.5;
    let curFill = null;
    c.beginPath();
    for (let o = 0; o < nF; o++) {
      const n = order[o], b4 = 4 * n;
      if (fill[n] !== curFill) {
        if (curFill !== null) { c.fillStyle = curFill; c.fill(); c.beginPath(); }
        curFill = fill[n];
      }
      const cx = (fx[b4] + fx[b4 + 1] + fx[b4 + 2] + fx[b4 + 3]) / 4, cy = (fy[b4] + fy[b4 + 1] + fy[b4 + 2] + fy[b4 + 3]) / 4;
      for (let t = 0; t < 4; t++) {
        const dx = fx[b4 + t] - cx, dy = fy[b4 + t] - cy, len = Math.hypot(dx, dy) || 1;
        const px = fx[b4 + t] + (GROW * dx) / len, py = fy[b4 + t] + (GROW * dy) / len;
        t ? c.lineTo(px, py) : c.moveTo(px, py);
      }
      c.closePath();
    }
    if (curFill !== null) { c.fillStyle = curFill; c.fill(); }
    // the top edge of the wall, in the layer's color
    c.beginPath();
    for (let j = 0; j < M; j++) j ? c.lineTo(X[top + j], Y[top + j]) : c.moveTo(X[top + j], Y[top + j]);
    c.closePath(); c.strokeStyle = color; c.lineWidth = 1.3; c.lineJoin = "round"; c.stroke();
    const Fb = F.subarray(top);
    if (fast) this._refineSoon();
    // vertical edges at the vertices: solid where a boundary edge at the vertex faces the viewer, else dashed
    for (let v = 0; v < nE; v++) {
      const a = P[v], b = P[(v + 1) % nE], z = P[(v - 1 + nE) % nE];
      const faces1 = (b[1] - a[1]) * OSIN + (a[0] - b[0]) * OCOS < 0, faces0 = (a[1] - z[1]) * OSIN + (z[0] - a[0]) * OCOS < 0;
      const h = Fb[v * per];
      if (Math.abs(h) < 1e-3) continue;
      const [X0, Y0] = this.px(a), [X1, Y1] = this.px(a, Hw * h);
      c.beginPath(); c.moveTo(X0, Y0); c.lineTo(X1, Y1);
      c.setLineDash(faces1 || faces0 ? [] : [3, 3]);
      c.strokeStyle = faces1 || faces0 ? css("--ink") : css("--muted"); c.lineWidth = 0.9; c.stroke();
      c.setLineDash([]);
    }
  }

  // Frames less than MOVING_MS apart mean something is being dragged or slid, so solids use the coarse mesh;
  // _refineSoon then asks for one full-resolution redraw (reason "refine") once the frames stop.
  _isMoving() { return this._frameGap < 140; }
  _refineSoon() {
    clearTimeout(this._refineTimer);
    this._refineTimer = setTimeout(() => this.onChange("refine"), 170);
  }

  clear() {
    const now = performance.now();
    this._frameGap = this._lastFrame === undefined ? Infinity : now - this._lastFrame;
    this._lastFrame = now;
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = css("--plot-bg");
    c.fillRect(0, 0, this.cssW, this.cssH);
  }

  grid(step = 1) {
    const c = this.ctx;
    c.strokeStyle = css("--grid"); c.lineWidth = 1;
    c.beginPath();
    if (this.oblique) {  // the floor's grid lines, projected, within the extent
      const e = this.extent;
      for (let x = Math.ceil(e.x0 / step) * step; x <= e.x1; x += step) {
        const [X0, Y0] = this.px([x, e.y0]), [X1, Y1] = this.px([x, e.y1]); c.moveTo(X0, Y0); c.lineTo(X1, Y1);
      }
      for (let y = Math.ceil(e.y0 / step) * step; y <= e.y1; y += step) {
        const [X0, Y0] = this.px([e.x0, y]), [X1, Y1] = this.px([e.x1, y]); c.moveTo(X0, Y0); c.lineTo(X1, Y1);
      }
      c.stroke();
      return;
    }
    const e = this.visibleWorld();
    for (let x = Math.ceil(e.x0 / step) * step; x <= e.x1; x += step) {
      const [X] = this.px([x, 0]); c.moveTo(Math.round(X) + 0.5, 0); c.lineTo(Math.round(X) + 0.5, this.cssH);
    }
    for (let y = Math.ceil(e.y0 / step) * step; y <= e.y1; y += step) {
      const [, Y] = this.px([0, y]); c.moveTo(0, Math.round(Y) + 0.5); c.lineTo(this.cssW, Math.round(Y) + 0.5);
    }
    c.stroke();
  }

  visibleWorld() {
    const [x0, y1] = this.world(0, 0), [x1, y0] = this.world(this.cssW, this.cssH);
    return { x0, x1, y0, y1 };
  }

  // Shade a density from the surface color (zero) up to color (at vmax), on a raster of about `res` CSS px.
  // layers: [{f: (x, y) => value, H: halfspaces or null, color: "#hex", vmax}] blended additively in color space.
  density(layers, res = 2) {
    const W = Math.ceil(this.cssW / res), Hh = Math.ceil(this.cssH / res);
    const img = this.ctx.createImageData(W, Hh);
    const bg = hexToRgb(css("--plot-bg"));
    const cols = layers.map((l) => hexToRgb(l.color));
    for (let j = 0; j < Hh; j++) {
      for (let i = 0; i < W; i++) {
        const [x, y] = this.world((i + 0.5) * res, (j + 0.5) * res);
        let r = bg[0], g = bg[1], b = bg[2];
        for (let k = 0; k < layers.length; k++) {
          const L = layers[k];
          if (L.H && !insideH(L.H, [x, y])) continue;
          const v = Math.min(L.f(x, y) / L.vmax, 1);
          if (!(v > 0)) continue;
          const a = 0.12 + 0.88 * v;  // the support itself gets a faint tint so it reads as a set
          r += (cols[k][0] - bg[0]) * a; g += (cols[k][1] - bg[1]) * a; b += (cols[k][2] - bg[2]) * a;
        }
        const o = 4 * (j * W + i);
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
      }
    }
    const tmp = document.createElement("canvas");
    tmp.width = W; tmp.height = Hh;
    tmp.getContext("2d").putImageData(img, 0, 0);
    const c = this.ctx;
    c.save(); c.imageSmoothingEnabled = true;
    c.drawImage(tmp, 0, 0, this.cssW, this.cssH);
    c.restore();
  }

  polygon(P, { stroke = css("--ink"), width = 1.5, dash = [], fill = null } = {}) {
    if (!P || P.length < 2) return;
    const c = this.ctx;
    c.beginPath();
    P.forEach((p, i) => { const [X, Y] = this.px(p); i ? c.lineTo(X, Y) : c.moveTo(X, Y); });
    c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    c.setLineDash(dash); c.strokeStyle = stroke; c.lineWidth = width; c.lineJoin = "round"; c.stroke(); c.setLineDash([]);
  }

  points(pts, color, r = 1.3, alpha = 0.55) {
    const c = this.ctx;
    c.fillStyle = color; c.globalAlpha = alpha;
    for (const p of pts) { const [X, Y] = this.px(p); c.fillRect(X - r, Y - r, 2 * r, 2 * r); }
    c.globalAlpha = 1;
  }

  marker(p, { color = css("--ink"), r = 4.5, shape = "dot", label = null, labelDx = 8, labelDy = -8 } = {}) {
    const c = this.ctx, [X, Y] = this.px(p);
    c.lineWidth = 2; c.strokeStyle = css("--plot-bg"); c.fillStyle = color;
    c.beginPath();
    if (shape === "cross") {
      c.strokeStyle = color; c.lineWidth = 2;
      c.moveTo(X - r, Y - r); c.lineTo(X + r, Y + r); c.moveTo(X - r, Y + r); c.lineTo(X + r, Y - r); c.stroke();
    } else if (shape === "ring") {
      c.arc(X, Y, r, 0, 2 * Math.PI); c.strokeStyle = color; c.stroke();
    } else {
      c.arc(X, Y, r, 0, 2 * Math.PI); c.fill(); c.stroke();
    }
    if (label) this.label(label, p, { dx: labelDx, dy: labelDy });
  }

  label(text, p, { dx = 0, dy = 0, align = "left", color = css("--ink-2"), size = 12, halo = true, h = 0 } = {}) {
    const c = this.ctx, [X, Y] = this.px(p, h);
    c.font = `${size}px ${css("--font-ui")}`;
    c.textAlign = align; c.textBaseline = "middle";
    if (halo) { c.lineWidth = 3; c.strokeStyle = css("--plot-bg"); c.strokeText(text, X + dx, Y + dy); }
    c.fillStyle = color; c.fillText(text, X + dx, Y + dy);
  }

  arrow(a, b, { color = css("--ink"), width = 1.5 } = {}) {
    const c = this.ctx, [X0, Y0] = this.px(a), [X1, Y1] = this.px(b);
    const ang = Math.atan2(Y1 - Y0, X1 - X0), h = 7;
    c.strokeStyle = color; c.fillStyle = color; c.lineWidth = width;
    c.beginPath(); c.moveTo(X0, Y0); c.lineTo(X1, Y1); c.stroke();
    c.beginPath(); c.moveTo(X1, Y1);
    c.lineTo(X1 - h * Math.cos(ang - 0.4), Y1 - h * Math.sin(ang - 0.4));
    c.lineTo(X1 - h * Math.cos(ang + 0.4), Y1 - h * Math.sin(ang + 0.4));
    c.closePath(); c.fill();
  }

  ellipse(mu, S, k, opts = {}) {  // the k-sigma ellipse of N(mu, S)
    const a = S[0][0], b = S[0][1], d = S[1][1];
    const t = (a + d) / 2, q = Math.sqrt(Math.max(t * t - (a * d - b * b), 0));
    const l1 = t + q, l2 = Math.max(t - q, 0), th = Math.abs(b) > 1e-12 ? Math.atan2(l1 - a, b) : (a >= d ? 0 : Math.PI / 2);
    const P = [];
    for (let i = 0; i < 64; i++) {
      const u = (2 * Math.PI * i) / 64, x = k * Math.sqrt(l1) * Math.cos(u), y = k * Math.sqrt(l2) * Math.sin(u);
      P.push([mu[0] + x * Math.cos(th) - y * Math.sin(th), mu[1] + x * Math.sin(th) + y * Math.cos(th)]);
    }
    this.polygon(P, opts);
  }

  // A draggable handle: get() returns its world point, set(p) moves it. Drawn by drawHandles().
  addHandle(h) { this.handles.push({ r: 9, ...h }); return h; }

  drawHandles() {
    const c = this.ctx;
    for (const h of this.handles) {
      if (h.hidden && h.hidden()) continue;
      const [X, Y] = this.px(h.get());
      c.beginPath(); c.arc(X, Y, h === this.drag || h === this.hover ? 7 : 5.5, 0, 2 * Math.PI);
      c.fillStyle = css("--plot-bg"); c.fill();
      c.lineWidth = 2; c.strokeStyle = h.color || css("--ink"); c.stroke();
      if (h.label) this.label(h.label, h.get(), { dx: 10, dy: -10, size: 11 });
    }
  }

  _hit(x, y) {
    let best = null, bd = Infinity;
    for (const h of this.handles) {
      if (h.hidden && h.hidden()) continue;
      const [X, Y] = this.px(h.get()), d = Math.hypot(X - x, Y - y);
      if (d < 16 && d < bd) { bd = d; best = h; }
    }
    return best;
  }

  _bindPointer() {
    const cv = this.canvas;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener("pointerdown", (e) => {
      const [x, y] = pos(e), h = this._hit(x, y);
      if (h) { this.drag = h; cv.setPointerCapture(e.pointerId); e.preventDefault(); this.onChange("drag"); }
    });
    cv.addEventListener("pointermove", (e) => {
      const [x, y] = pos(e);
      if (this.drag) {
        const w = this.world(x, y);
        const e2 = this.extent;
        this.drag.set([Math.min(Math.max(w[0], e2.x0), e2.x1), Math.min(Math.max(w[1], e2.y0), e2.y1)]);
        this.onChange("drag");
      } else {
        const h = this._hit(x, y);
        cv.style.cursor = h ? "grab" : "default";
        if (h !== this.hover) { this.hover = h; this.onChange("hover"); }
        if (this.onHover) this.onHover(this.world(x, y), [x, y]);
      }
    });
    const end = () => { if (this.drag) { this.drag = null; this.onChange("drop"); } };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    cv.addEventListener("pointerleave", () => { if (this.onHover) this.onHover(null); });
    cv.style.touchAction = "none";
  }
}

// Coalesce redraws to one per frame. When several requests land in one frame, the one that needs the most work
// wins, so a light redraw (hover, theme, resize, refine) never hides a change that needs a recompute.
const PRIORITY = { drop: 5, input: 4, drag: 3, fine: 2 };
export function scheduler(fn) {
  let queued = false, reason = null;
  return (r) => {
    if (reason === null || (PRIORITY[r] || 1) >= (PRIORITY[reason] || 1)) reason = r;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; const rr = reason; reason = null; fn(rr); });
  };
}

export function fmt(x, d = 3) {
  if (!isFinite(x)) return "—";
  if (Math.abs(x) >= 1e4 || (Math.abs(x) < 1e-3 && x !== 0)) return x.toExponential(2);
  return x.toFixed(d);
}
