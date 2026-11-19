// zono.js: planar zonotopes and Gaussian zonotents for the browser demos.
// A JavaScript port of the 2D cases of the zonotents Python package (src/zonotents): the same definitions and
// algorithms, with quadrature on a triangulation of the zonotope instead of its parallelotope tiling.
// Vectors are [x, y]; matrices are [[a, b], [c, d]] (rows); a zonotope is {c: [x, y], G: [[gx, gy], ...]}.

export const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
  scale: (a, s) => [a[0] * s, a[1] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1],
  cross: (a, b) => a[0] * b[1] - a[1] * b[0],
  norm: (a) => Math.hypot(a[0], a[1]),
};

export const M = {
  mul: (A, B) => [
    [A[0][0] * B[0][0] + A[0][1] * B[1][0], A[0][0] * B[0][1] + A[0][1] * B[1][1]],
    [A[1][0] * B[0][0] + A[1][1] * B[1][0], A[1][0] * B[0][1] + A[1][1] * B[1][1]],
  ],
  vec: (A, x) => [A[0][0] * x[0] + A[0][1] * x[1], A[1][0] * x[0] + A[1][1] * x[1]],
  T: (A) => [[A[0][0], A[1][0]], [A[0][1], A[1][1]]],
  add: (A, B) => [[A[0][0] + B[0][0], A[0][1] + B[0][1]], [A[1][0] + B[1][0], A[1][1] + B[1][1]]],
  scale: (A, s) => [[A[0][0] * s, A[0][1] * s], [A[1][0] * s, A[1][1] * s]],
  det: (A) => A[0][0] * A[1][1] - A[0][1] * A[1][0],
  inv: (A) => {
    const d = A[0][0] * A[1][1] - A[0][1] * A[1][0];
    return [[A[1][1] / d, -A[0][1] / d], [-A[1][0] / d, A[0][0] / d]];
  },
  sym: (A) => [[A[0][0], (A[0][1] + A[1][0]) / 2], [(A[0][1] + A[1][0]) / 2, A[1][1]]],
  outer: (a, b) => [[a[0] * b[0], a[0] * b[1]], [a[1] * b[0], a[1] * b[1]]],
  minEig: (A) => {
    const t = (A[0][0] + A[1][1]) / 2, d = A[0][0] * A[1][1] - A[0][1] * A[1][0];
    return t - Math.sqrt(Math.max(t * t - d, 0));
  },
  chol: (S) => {
    const a = Math.sqrt(S[0][0]), b = S[1][0] / a, c = Math.sqrt(Math.max(S[1][1] - b * b, 1e-300));
    return [[a, 0], [b, c]];
  },
  sqrtSym: (S) => {  // symmetric square root of a 2x2 SPD matrix
    const s = Math.sqrt(M.det(S)), t = Math.sqrt(S[0][0] + S[1][1] + 2 * s);
    return [[(S[0][0] + s) / t, S[0][1] / t], [S[1][0] / t, (S[1][1] + s) / t]];
  },
  rot: (th) => [[Math.cos(th), -Math.sin(th)], [Math.sin(th), Math.cos(th)]],
};

// ---------- Zonotopes ----------

export function zonotope(c, G) {
  return { c: [...c], G: G.map((g) => [...g]) };
}

export function minkowski(z1, z2) {
  return zonotope(V.add(z1.c, z2.c), [...z1.G, ...z2.G]);
}

export function affine(z, A, b = [0, 0]) {
  return zonotope(V.add(M.vec(A, z.c), b), z.G.map((g) => M.vec(A, g)));
}

// Vertices in counterclockwise order: flip each generator into the upper half-plane, sort by angle, walk.
export function vertices(z) {
  const gs = z.G.filter((g) => V.norm(g) > 1e-12).map((g) => (g[1] < 0 || (g[1] === 0 && g[0] < 0) ? V.scale(g, -1) : g));
  if (gs.length === 0) return [z.c];
  gs.sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
  let p = gs.reduce((acc, g) => V.add(acc, g), [0, 0]);
  p = V.add(z.c, p);  // the vertex that is extreme in the direction just right of every generator
  const out = [p];
  for (const g of gs) { p = V.sub(p, V.scale(g, 2)); out.push(p); }
  for (const g of gs.slice(0, -1)) { p = V.add(p, V.scale(g, 2)); out.push(p); }
  return out;  // 2m vertices
}

export function polygonArea(P) {
  let s = 0;
  for (let i = 0; i < P.length; i++) s += V.cross(P[i], P[(i + 1) % P.length]);
  return s / 2;
}

export function area(z) { return Math.abs(polygonArea(vertices(z))); }

// Halfspaces {x : a.x <= b} of a counterclockwise convex polygon.
export function halfspaces(P) {
  const H = [];
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length], e = V.sub(q, p);
    const n = [e[1], -e[0]], len = V.norm(n);
    if (len < 1e-14) continue;
    const a = V.scale(n, 1 / len);
    H.push({ a, b: V.dot(a, p) });
  }
  return H;
}

export function insideH(H, x, tol = 0) {
  for (const h of H) if (V.dot(h.a, x) > h.b + tol) return false;
  return true;
}

export function bbox(P) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of P) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  return { x0, x1, y0, y1 };
}

// Sutherland-Hodgman clip of convex polygon P by convex polygon Q (both counterclockwise).
export function clipPolygon(P, Q) {
  let out = P;
  for (const h of halfspaces(Q)) {
    const inp = out; out = [];
    if (inp.length === 0) break;
    for (let i = 0; i < inp.length; i++) {
      const a = inp[i], b = inp[(i + 1) % inp.length];
      const da = V.dot(h.a, a) - h.b, db = V.dot(h.a, b) - h.b;
      if (da <= 0) out.push(a);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) out.push(V.add(a, V.scale(V.sub(b, a), da / (da - db))));
    }
  }
  return out;
}

// ---------- Quadrature on a convex polygon ----------

function gaussLegendre(n) {
  const x = [], w = [];
  for (let i = 1; i <= n; i++) {
    let t = Math.cos(Math.PI * (i - 0.25) / (n + 0.5)), dp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1, p1 = t;
      for (let k = 2; k <= n; k++) { const p2 = ((2 * k - 1) * t * p1 - (k - 1) * p0) / k; p0 = p1; p1 = p2; }
      dp = n * (t * p1 - p0) / (t * t - 1);
      const dt = p1 / dp; t -= dt;
      if (Math.abs(dt) < 1e-15) break;
    }
    x.push((1 - t) / 2); w.push(1 / ((1 - t * t) * dp * dp));  // mapped to [0, 1]
  }
  return { x, w };
}
const GL_CACHE = {};
function gl(n) { return GL_CACHE[n] || (GL_CACHE[n] = gaussLegendre(n)); }

// Points and weights for integrating over a convex polygon: a fan of triangles from its centroid, each by a
// Duffy-collapsed Gauss-Legendre product rule (exact for polynomials of high degree on each triangle).
export function polygonQuadrature(P, order = 20) {
  const GL = gl(order), pts = [], wts = [];
  if (P.length < 3) return { pts, wts };
  let c = [0, 0];
  for (const p of P) c = V.add(c, p);
  c = V.scale(c, 1 / P.length);
  for (let i = 0; i < P.length; i++) {
    const B = P[i], C = P[(i + 1) % P.length];
    const e1 = V.sub(B, c), e2 = V.sub(C, B), J = Math.abs(V.cross(e1, e2));
    for (let a = 0; a < GL.x.length; a++) {
      const u = GL.x[a];
      for (let b = 0; b < GL.x.length; b++) {
        const v = GL.x[b];
        pts.push(V.add(c, V.add(V.scale(e1, u), V.scale(e2, u * v))));
        wts.push(GL.w[a] * GL.w[b] * u * J);
      }
    }
  }
  return { pts, wts };
}

// ---------- Gaussians ----------

export function gaussPdf(x, mu, S) {
  const d = M.det(S), Si = M.inv(S), r = V.sub(x, mu);
  return Math.exp(-0.5 * V.dot(r, M.vec(Si, r))) / (2 * Math.PI * Math.sqrt(d));
}

export function makeGauss(mu, S) {  // a fast pdf closure
  const d = M.det(S), Si = M.inv(S), k = 1 / (2 * Math.PI * Math.sqrt(d));
  const a = Si[0][0], b = Si[0][1], c = Si[1][1], m0 = mu[0], m1 = mu[1];
  return (x, y) => { const u = x - m0, v = y - m1; return k * Math.exp(-0.5 * (a * u * u + 2 * b * u * v + c * v * v)); };
}

export function erf(x) {  // Abramowitz-Stegun 7.1.26; |error| < 1.5e-7
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
export const Phi = (x) => 0.5 * (1 + erf(x / Math.SQRT2));

export function PhiInv(p) {  // Acklam's rational approximation, then one Newton step
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  let x;
  if (p < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p > 1 - 0.02425) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else {
    const q = p - 0.5, r = q * q;
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const e = Phi(x) - p;
  return x - e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
}

export function randn(rng = Math.random) {
  let u = 0; while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

// ---------- Gaussian zonotents ----------
// The density on Z is w + alpha N(x; mu, Sigma), with w = eta / vol(Z) and alpha = (1 - eta) / nu(Z), where eta is
// the wall share and nu(Z) is the Gaussian's mass in Z (def: gaussian zonotent). mass != 1 makes it relaxed.

export function zonotent(z, mu, S, eta = 0, mass = 1) {
  const zt = { z, mu: [...mu], S: M.sym(S), eta, mass };
  return refresh(zt);
}

export function refresh(zt) {
  zt.P = vertices(zt.z);
  zt.H = halfspaces(zt.P);
  zt.area = Math.abs(polygonArea(zt.P));
  zt.quad = polygonQuadrature(zt.P);
  zt.nu = gaussMassQ(zt.quad, zt.mu, zt.S);
  zt.w = zt.eta / zt.area;
  zt.alpha = zt.eta >= 1 ? 0 : (1 - zt.eta) / zt.nu;
  zt.pdf = makeGauss(zt.mu, zt.S);
  zt.mode = modeOf(zt);
  return zt;
}

export function density(zt, x, y) {  // includes the relaxed mass
  if (!insideH(zt.H, [x, y], 1e-12)) return 0;
  return zt.mass * (zt.w + zt.alpha * zt.pdf(x, y));
}

export function peak(zt) { return zt.mass * (zt.w + zt.alpha * zt.pdf(zt.mode[0], zt.mode[1])); }

export function gaussMassQ(quad, mu, S) {
  const f = makeGauss(mu, S);
  let s = 0;
  for (let i = 0; i < quad.pts.length; i++) s += quad.wts[i] * f(quad.pts[i][0], quad.pts[i][1]);
  return s;
}

export function gaussMassPolygon(P, mu, S) { return gaussMassQ(polygonQuadrature(P), mu, S); }

// Mean and covariance of the normalized density by quadrature (the wall and the Gaussian mixed by eta).
export function moments(zt) {
  return mixtureMoments(zt.quad, zt.area, zt.eta, zt.mu, zt.S);
}

function mixtureMoments(quad, A, eta, mu, S) {
  const f = makeGauss(mu, S);
  let g0 = 0, g1 = [0, 0], u1 = [0, 0];
  let g2 = [[0, 0], [0, 0]], u2 = [[0, 0], [0, 0]];
  for (let i = 0; i < quad.pts.length; i++) {
    const p = quad.pts[i], w = quad.wts[i], gw = w * f(p[0], p[1]);
    g0 += gw;
    g1[0] += gw * p[0]; g1[1] += gw * p[1];
    u1[0] += w * p[0]; u1[1] += w * p[1];
    g2[0][0] += gw * p[0] * p[0]; g2[0][1] += gw * p[0] * p[1]; g2[1][1] += gw * p[1] * p[1];
    u2[0][0] += w * p[0] * p[0]; u2[0][1] += w * p[0] * p[1]; u2[1][1] += w * p[1] * p[1];
  }
  const mG = V.scale(g1, 1 / g0), mU = V.scale(u1, 1 / A);
  const EG = [[g2[0][0] / g0, g2[0][1] / g0], [g2[0][1] / g0, g2[1][1] / g0]];
  const EU = [[u2[0][0] / A, u2[0][1] / A], [u2[0][1] / A, u2[1][1] / A]];
  const g = eta >= 1 ? 0 : 1 - eta;
  const m = V.add(V.scale(mU, 1 - g), V.scale(mG, g));
  const E = M.add(M.scale(EU, 1 - g), M.scale(EG, g));
  return { mean: m, cov: M.sym(M.add(E, M.scale(M.outer(m, m), -1))), nu: g0 };
}

// The point of Z nearest the mean in the Mahalanobis distance: the mean if it is in Z, else the nearest point of
// the boundary in whitened coordinates.
export function modeOf(zt) {
  if (zt.eta >= 1) return [...zt.z.c];
  if (insideH(zt.H, zt.mu)) return [...zt.mu];
  const L = M.chol(zt.S), Li = M.inv(L);
  const P = zt.P.map((p) => M.vec(Li, V.sub(p, zt.mu)));
  let best = null, bd = Infinity;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length], e = V.sub(b, a);
    const t = Math.min(1, Math.max(0, -V.dot(a, e) / V.dot(e, e)));
    const q = V.add(a, V.scale(e, t)), d = V.norm(q);
    if (d < bd) { bd = d; best = q; }
  }
  return V.add(zt.mu, M.vec(L, best));
}

export function affineZt(zt, A, b = [0, 0]) {  // exact (affine maps of Gaussian zonotents)
  return zonotent(affine(zt.z, A, b), V.add(M.vec(A, zt.mu), b), M.mul(M.mul(A, zt.S), M.T(A)), zt.eta, zt.mass);
}

// The Gaussian zonotent on z with no wall whose own mean and covariance are (mean, cov): the fixed-point
// iteration of moments.matched_gaussian (add the moment residual, halving the step to stay positive definite).
export function matchedGaussian(z, mean, cov, { tol = 1e-6, maxIter = 200 } = {}) {
  const P = vertices(z), quad = polygonQuadrature(P), A = Math.abs(polygonArea(P));
  const scale = Math.sqrt(cov[0][0] + cov[1][1]);
  let mu = [...mean], S = M.sym(cov), res = Infinity, it = 0, converged = false;
  for (it = 0; it <= maxIter; it++) {
    const m = mixtureMoments(quad, A, 0, mu, S);
    const dm = V.sub(mean, m.mean), dS = M.add(cov, M.scale(m.cov, -1));
    res = Math.max(Math.abs(dm[0]) / scale, Math.abs(dm[1]) / scale,
      Math.max(Math.abs(dS[0][0]), Math.abs(dS[0][1]), Math.abs(dS[1][1])) / (scale * scale));
    if (res < tol) { converged = true; break; }
    if (it === maxIter || S[0][0] + S[1][1] > 1e3 * (cov[0][0] + cov[1][1])) break;
    let step = 1, cand = null;
    const floor = Math.max(1e-3 * M.minEig(S), 1e-6 * scale * scale);
    while (step > 1e-4) {
      const trial = M.sym(M.add(S, M.scale(dS, step)));
      if (M.minEig(trial) > floor) { cand = trial; break; }
      step /= 2;
    }
    if (!cand) break;
    mu = V.add(mu, V.scale(dm, step)); S = cand;
  }
  return { zt: zonotent(z, mu, S, 0), converged, iterations: it, residual: res };
}

// The moment-matched sum (def: moment matched sum): the wall-free Gaussian zonotent on Z1 + Z2 with the exact
// mean m1 + m2 and covariance S1 + S2 of X + Y for independent X, Y.
export function minkowskiMomentSum(zt1, zt2, opts) {
  const a = moments(zt1), b = moments(zt2);
  const mean = V.add(a.mean, b.mean), cov = M.add(a.cov, b.cov);
  const out = matchedGaussian(minkowski(zt1.z, zt2.z), mean, cov, opts);
  out.zt.mass = zt1.mass * zt2.mass;
  return { ...out, mean, cov };
}

// ---------- Sampling ----------

export function sample(zt, n, rng = Math.random) {
  const out = [];
  const L = M.chol(zt.S), bb = bbox(zt.P);
  let nWall = 0;
  for (let i = 0; i < n; i++) if (rng() < zt.eta) nWall++;
  // wall: uniform by rejection from the bounding box
  while (out.length < nWall) {
    const p = [bb.x0 + (bb.x1 - bb.x0) * rng(), bb.y0 + (bb.y1 - bb.y0) * rng()];
    if (insideH(zt.H, p)) out.push(p);
  }
  // Gaussian: rejection from N(mu, Sigma) while it accepts often enough, else from the box with the peak as envelope
  const need = n - nWall;
  let got = 0, tries = 0;
  const fmax = zt.pdf(zt.mode[0], zt.mode[1]);
  while (got < need) {
    let p;
    if (zt.nu > 0.02) {
      p = V.add(zt.mu, M.vec(L, [randn(rng), randn(rng)]));
      if (!insideH(zt.H, p)) continue;
    } else {
      p = [bb.x0 + (bb.x1 - bb.x0) * rng(), bb.y0 + (bb.y1 - bb.y0) * rng()];
      if (!insideH(zt.H, p) || rng() * fmax > zt.pdf(p[0], p[1])) { if (++tries > 2e6) break; continue; }
    }
    out.push(p); got++;
  }
  return out;
}

export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Probabilistic order reduction ----------

// Mass of zt's density on a convex polygon Q inside its support (exact for the wall, quadrature for the Gaussian).
export function massOnPolygon(zt, Q) {
  if (Q.length < 3) return 0;
  const a = Math.abs(polygonArea(Q));
  const g = zt.alpha > 0 ? gaussMassPolygon(Q, zt.mu, zt.S) : 0;
  return zt.mass * (zt.w * a + zt.alpha * g);
}

function templateIndices(G, k = 2, maxCos = 0.995) {
  const order = G.map((g, i) => [V.norm(g), i]).filter((t) => t[0] > 0).sort((a, b) => b[0] - a[0]).map((t) => t[1]);
  const chosen = [];
  for (const i of order) {
    const gi = G[i], ni = V.norm(gi);
    if (chosen.every((j) => Math.abs(V.dot(gi, G[j]) / (ni * V.norm(G[j]))) <= maxCos)) chosen.push(i);
    if (chosen.length === k) break;
  }
  return chosen;
}

// lambda > 0 maximizing sum log lambda_j subject to Z(center, diag(lambda) T) inside z (barrier method, as in
// reduction.max_volume_scales).
function maxVolumeScales(H, center, T) {
  let Mm = H.map((h) => T.map((t) => Math.abs(V.dot(h.a, t))));
  let d = H.map((h) => h.b - V.dot(h.a, center));
  const keep = Mm.map((r) => r[0] + r[1] > 0);
  Mm = Mm.filter((_, i) => keep[i]); d = d.filter((_, i) => keep[i]);
  let lam = [0, 0].map(() => 0.5 * Math.min(...d.map((di, i) => di / (Mm[i][0] + Mm[i][1]))));
  let t = 1;
  const phi = (x) => -t * (Math.log(x[0]) + Math.log(x[1])) - d.reduce((s, di, i) => s + Math.log(di - Mm[i][0] * x[0] - Mm[i][1] * x[1]), 0);
  for (let outer = 0; outer < 60; outer++) {
    for (let it = 0; it < 200; it++) {
      const g = [-t / lam[0], -t / lam[1]];
      const Hs = [[t / lam[0] ** 2, 0], [0, t / lam[1] ** 2]];
      for (let i = 0; i < d.length; i++) {
        const s = d[i] - Mm[i][0] * lam[0] - Mm[i][1] * lam[1];
        g[0] += Mm[i][0] / s; g[1] += Mm[i][1] / s;
        const s2 = 1 / (s * s);
        Hs[0][0] += s2 * Mm[i][0] * Mm[i][0]; Hs[0][1] += s2 * Mm[i][0] * Mm[i][1]; Hs[1][1] += s2 * Mm[i][1] * Mm[i][1];
      }
      Hs[1][0] = Hs[0][1];
      const step = V.scale(M.vec(M.inv(Hs), g), -1);
      const dec = -V.dot(g, step);
      if (dec / 2 <= 1e-12 * t) break;
      let a = 1;
      const feasible = (x) => x[0] > 0 && x[1] > 0 && d.every((di, i) => di - Mm[i][0] * x[0] - Mm[i][1] * x[1] > 0);
      while (!feasible(V.add(lam, V.scale(step, a)))) a *= 0.5;
      const f0 = phi(lam);
      while (phi(V.add(lam, V.scale(step, a))) > f0 - 0.25 * a * dec && a > 1e-12) a *= 0.5;
      lam = V.add(lam, V.scale(step, a));
    }
    if (d.length / t < 1e-10) break;
    t *= 8;
  }
  return lam;
}

// Inner reduction (reduction.probabilistic_reduction): a parallelotope inside Z, centered at the mode, with the
// two largest generators as its template, shaped for maximum volume and shrunk to hold 1 - alpha of the mass.
export function innerReduction(zt, alpha) {
  const target = (1 - alpha) * zt.mass;
  let center = zt.mode;
  const margin = Math.min(...zt.H.map((h) => (h.b - V.dot(h.a, center)) / (h.b - V.dot(h.a, zt.z.c))));
  if (!(margin > 1e-6)) center = zt.z.c;
  const idx = templateIndices(zt.z.G, 2);
  const T = idx.map((i) => zt.z.G[i]);
  const lam = maxVolumeScales(zt.H, center, T);
  const reduced = (s) => zonotope(center, T.map((t, j) => V.scale(t, s * lam[j])));
  const massAt = (s) => massOnPolygon(zt, vertices(reduced(s)));
  const full = massAt(1);
  let s = 1, kept = full;
  if (full >= target) {
    let lo = 0, hi = 1;
    while (hi - lo > 1e-5) {
      const mid = (lo + hi) / 2, m = massAt(mid);
      if (m >= target) { hi = mid; kept = m; } else lo = mid;
    }
    s = hi;
  }
  const z = reduced(s);
  return { z, P: vertices(z), kept: kept / zt.mass, reached: kept >= target * (1 - 1e-9), certified: true,
    contains: false, inside: true, area: area(z), maxVolumeShare: full / zt.mass };
}

function frameWidths(G, F) {
  const Fi = M.inv(F);
  const w = [0, 0];
  for (const g of G) { const y = M.vec(Fi, g); w[0] += Math.abs(y[0]); w[1] += Math.abs(y[1]); }
  return w;
}

function momentFrame(zt) {  // the square root of Sigma whose interval hull of Z is smallest ("best" in the package)
  let best = null;
  for (const L of [M.chol(zt.S), M.sqrtSym(zt.S)]) {
    const w = frameWidths(zt.z.G, L), key = Math.log(w[0]) + Math.log(w[1]);
    if (!best || key < best.key) best = { L, w, key };
  }
  return best;
}

// Outer reduction (reduction_enclose.outer_reduction): the interval hull of Z in the moment frame, a
// parallelotope that contains Z; nothing is discarded.
export function outerReduction(zt) {
  const { L, w } = momentFrame(zt);
  const z = zonotope(zt.z.c, [V.scale([L[0][0], L[1][0]], w[0]), V.scale([L[0][1], L[1][1]], w[1])]);
  return { z, P: vertices(z), kept: 1, reached: true, certified: true, contains: true, inside: false, area: area(z) };
}

// Free reduction (reduction_enclose.free_reduction, "cube"): the confidence parallelotope Z(mu, r L) with
// (2 Phi(r) - 1)^2 = 1 - alpha', where alpha' = alpha if Z is symmetric about mu (Gaussian correlation inequality)
// and alpha nu(Z) otherwise (the halfspace certificate, with nu(Z) exact in 2D).
export function freeReduction(zt, alpha) {
  const { L } = momentFrame(zt);
  const Lc = M.chol(zt.S), off = M.vec(M.inv(Lc), V.sub(zt.z.c, zt.mu));
  const symmetric = Math.max(Math.abs(off[0]), Math.abs(off[1])) <= 1e-7;  // looser than the package's 1e-9: quadrature rounding
  const alphaUsed = symmetric ? alpha : alpha * zt.nu;
  const r = PhiInv((1 + Math.sqrt(1 - alphaUsed)) / 2);
  const nuCube = (2 * Phi(r) - 1) ** 2;
  const share = symmetric ? nuCube : 1 - (1 - nuCube) / zt.nu;
  const z = zonotope(zt.mu, [V.scale([L[0][0], L[1][0]], r), V.scale([L[0][1], L[1][1]], r)]);
  const P = vertices(z);
  const actual = gaussMassPolygon(clipPolygon(zt.P, P), zt.mu, zt.S) / zt.nu;  // nu(Z ∩ Z') / nu(Z)
  return { z, P, kept: share, actual, radius: r, symmetric, certificate: symmetric ? "symmetric" : "halfspace",
    reached: share >= (1 - alpha) * (1 - 1e-12), certified: true, contains: false, inside: false, area: area(z) };
}
