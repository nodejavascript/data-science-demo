/**
 * stats.js — the arithmetic this page shows you.
 *
 * WHY THIS FILE IS SEPARATE FROM THE PAGE. Every number the site prints comes from a function
 * in here, and this file is imported by the tests as well as by the browser. That is the whole
 * claim of the site: a figure you cannot re-compute is an opinion. If a statistic were written
 * into the markup somewhere, the test could not reach it and the claim would be false.
 *
 * NO DEPENDENCIES, NO DEPENDENCY ON THE DOM. Plain arithmetic, so `node tools/test-stats.mjs`
 * runs exactly the code the page runs.
 *
 * WHERE A CHOICE EXISTS, THE CHOICE IS NAMED — because a statistic without its convention is
 * ambiguous: sample standard deviation uses the n−1 denominator; quantiles use the linear
 * interpolation of Hyndman & Fan type 7 (what R, NumPy's default and Excel's QUARTILE.INC do);
 * skewness is the adjusted sample moment G1; kurtosis is excess kurtosis (normal = 0).
 */

/* ── small numeric helpers ─────────────────────────────────────────────────────────────── */

/** Neumaier summation: a plain running sum loses digits when 300 nearly-equal numbers are added. */
export function sum(values) {
  let s = 0;
  let c = 0;
  for (const v of values) {
    const t = s + v;
    c += Math.abs(s) >= Math.abs(v) ? s - t + v : v - t + s;
    s = t;
  }
  return s + c;
}

export function mean(values) {
  return values.length ? sum(values) / values.length : NaN;
}

/** Sample variance, n−1 denominator — and the denominator is the reason it is a sample estimate. */
export function variance(values) {
  const n = values.length;
  if (n < 2) return NaN;
  const m = mean(values);
  let acc = 0;
  for (const v of values) acc += (v - m) * (v - m);
  return acc / (n - 1);
}

export function sd(values) {
  return Math.sqrt(variance(values));
}

/** Third and fourth central moments, needed by skewness and kurtosis. */
function centralMoments(values) {
  const n = values.length;
  const m = mean(values);
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (const v of values) {
    const d = v - m;
    const d2 = d * d;
    m2 += d2;
    m3 += d2 * d;
    m4 += d2 * d2;
  }
  return { n, m, m2: m2 / n, m3: m3 / n, m4: m4 / n };
}

/** Adjusted sample skewness (G1) — the same thing R's e1071 calls type 2 and SciPy's `bias=False`. */
export function skewness(values) {
  const { n, m2, m3 } = centralMoments(values);
  if (n < 3 || m2 === 0) return NaN;
  const g1 = m3 / Math.pow(m2, 1.5);
  return (Math.sqrt(n * (n - 1)) / (n - 2)) * g1;
}

/** Excess kurtosis (G2) — 0 for a normal distribution, not 3. */
export function kurtosis(values) {
  const { n, m2, m4 } = centralMoments(values);
  if (n < 4 || m2 === 0) return NaN;
  const g2 = m4 / (m2 * m2) - 3;
  return ((n - 1) / ((n - 2) * (n - 3))) * ((n + 1) * g2 + 6);
}

/**
 * Quantile, Hyndman & Fan type 7: h = (n−1)p + 1, then linear interpolation between neighbours.
 * Chosen because it is the default in R's `quantile`, NumPy's `percentile` and Excel, so a reader
 * who checks this number anywhere else will get the same one.
 */
export function quantile(sorted, p) {
  const n = sorted.length;
  if (!n) return NaN;
  if (n === 1) return sorted[0];
  const h = (n - 1) * p + 1;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, n);
  const frac = h - lo;
  return sorted[lo - 1] + frac * (sorted[hi - 1] - sorted[lo - 1]);
}

/** Sorted copy — the callers all want the same sort, and sorting the input in place would surprise them. */
export function sortedCopy(values) {
  return values.slice().sort((a, b) => a - b);
}

/** Drops nulls, NaN and infinities — and reports how many it dropped, so missingness is never silent. */
export function clean(values) {
  const kept = [];
  let missing = 0;
  for (const v of values) {
    if (v === null || v === undefined || v === "" || !Number.isFinite(v)) missing++;
    else kept.push(v);
  }
  return { kept, missing };
}

/* ── the summary panel ─────────────────────────────────────────────────────────────────── */

export function summarise(values) {
  const { kept, missing } = clean(values);
  const n = kept.length;
  if (!n) return { n: 0, missing, empty: true };
  const s = sortedCopy(kept);
  const q1 = quantile(s, 0.25);
  const q3 = quantile(s, 0.75);
  const m = mean(kept);
  return {
    n,
    missing,
    empty: false,
    mean: m,
    median: quantile(s, 0.5),
    sd: sd(kept),
    variance: variance(kept),
    min: s[0],
    max: s[n - 1],
    range: s[n - 1] - s[0],
    q1,
    q3,
    iqr: q3 - q1,
    skewness: skewness(kept),
    kurtosis: kurtosis(kept),
    stderrMean: Math.sqrt(variance(kept) / n),
  };
}

/* ── the bin rule for the histogram ────────────────────────────────────────────────────── */

/**
 * Freedman–Diaconis: bin width = 2·IQR·n^(−1/3). It adapts to spread and to sample size instead of
 * being an arbitrary number, and it is the rule the chart's caption names. When the IQR is 0
 * (a constant column, or one with more than half its values identical) it falls back to Sturges'
 * rule, and the caption says which rule produced the bins.
 */
export function binWidth(values) {
  const { kept } = clean(values);
  const n = kept.length;
  if (n < 2) return { width: NaN, rule: "no data" };
  const s = sortedCopy(kept);
  const iqr = quantile(s, 0.75) - quantile(s, 0.25);
  if (iqr > 0) return { width: (2 * iqr) / Math.cbrt(n), rule: "Freedman–Diaconis" };
  const range = s[n - 1] - s[0];
  const k = Math.max(1, Math.ceil(Math.log2(n) + 1));
  return { width: range > 0 ? range / k : NaN, rule: "Sturges (the interquartile range is zero)" };
}

export function histogram(values, opts = {}) {
  const { kept } = clean(values);
  const n = kept.length;
  if (!n) return { bins: [], rule: "no data", binCount: 0 };
  const s = sortedCopy(kept);
  const lo = s[0];
  const hi = s[n - 1];
  let width = opts.width;
  let rule = "chosen width";
  if (!Number.isFinite(width) || width <= 0) {
    const auto = binWidth(kept);
    width = auto.width;
    rule = auto.rule;
  }
  if (!Number.isFinite(width) || width <= 0) return { bins: [{ lo, hi, count: n }], rule, binCount: 1, width: 0 };
  const count = Math.max(1, Math.min(60, Math.ceil((hi - lo) / width)));
  const step = (hi - lo) / count || width;
  const bins = [];
  for (let i = 0; i < count; i++) bins.push({ lo: lo + i * step, hi: lo + (i + 1) * step, count: 0 });
  for (const v of kept) {
    let idx = Math.floor((v - lo) / step);
    if (idx >= count) idx = count - 1;
    if (idx < 0) idx = 0;
    bins[idx].count++;
  }
  return { bins, rule, binCount: bins.length, width: step, max: Math.max(...bins.map((b) => b.count)) };
}

/* ── correlation ──────────────────────────────────────────────────────────────────────── */

/** Pairs two columns and keeps only rows where BOTH are present — listwise deletion, stated. */
export function pairs(xs, ys) {
  const x = [];
  const y = [];
  let dropped = 0;
  for (let i = 0; i < xs.length; i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
      x.push(xs[i]);
      y.push(ys[i]);
    } else dropped++;
  }
  return { x, y, dropped };
}

export function pearson(x, y) {
  const n = x.length;
  if (n < 3) return NaN;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx;
    const b = y[i] - my;
    sxy += a * b;
    sxx += a * a;
    syy += b * b;
  }
  if (sxx === 0 || syy === 0) return NaN;
  return sxy / Math.sqrt(sxx * syy);
}

/** Ranks with ties averaged — without the averaging, a tied column would produce a fake correlation. */
export function ranks(values) {
  const idx = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(values.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = avg;
    i = j + 1;
  }
  return out;
}

export function spearman(x, y) {
  return pearson(ranks(x), ranks(y));
}

export function correlationMatrix(columns) {
  const k = columns.length;
  const out = [];
  for (let i = 0; i < k; i++) {
    out.push([]);
    for (let j = 0; j < k; j++) {
      const { x, y } = pairs(columns[i], columns[j]);
      out[i].push(pearson(x, y));
    }
  }
  return out;
}

/* ── the t distribution, from the incomplete beta function ─────────────────────────────── */

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

export function lnGamma(z) {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1;
  let a = LANCZOS[0];
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the incomplete beta function (Lentz's method). */
function betacf(a, b, x) {
  const TINY = 1e-30;
  const EPS = 3e-16;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularised incomplete beta I_x(a,b). */
export function incompleteBeta(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (front * betacf(a, b, x)) / a;
  return 1 - (front * betacf(b, a, 1 - x)) / b;
}

/** Two-sided p-value for a t statistic on `df` degrees of freedom. */
export function tTwoSidedP(t, df) {
  if (!Number.isFinite(t) || !(df > 0)) return NaN;
  return incompleteBeta(df / 2, 0.5, df / (df + t * t));
}

/* ── ordinary least squares ───────────────────────────────────────────────────────────── */

/**
 * Simple linear regression, y = a + b·x, with the uncertainty of every estimate.
 *
 * The standard errors are the textbook ones: se(b) = s / sqrt(Sxx) and
 * se(a) = s · sqrt(1/n + x̄²/Sxx), with s² = SSE/(n−2). A slope printed without its standard
 * error is the most common way a regression is over-read, so the page prints them side by side.
 */
export function ols(x, y) {
  const n = x.length;
  if (n < 3) return { n, error: "at least three complete pairs are needed" };
  const mx = mean(x);
  const my = mean(y);
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx;
    const b = y[i] - my;
    sxx += a * a;
    sxy += a * b;
    syy += b * b;
  }
  if (sxx === 0) return { n, error: "the predictor is constant, so no line has a defined slope" };
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const fitted = x.map((v) => intercept + slope * v);
  const residuals = y.map((v, i) => v - fitted[i]);
  let sse = 0;
  for (const r of residuals) sse += r * r;
  const sst = syy;
  const df = n - 2;
  const r2 = sst === 0 ? NaN : 1 - sse / sst;
  const adjR2 = Number.isFinite(r2) ? 1 - (1 - r2) * ((n - 1) / df) : NaN;
  const s2 = sse / df;
  const seSlope = Math.sqrt(s2 / sxx);
  const seIntercept = Math.sqrt(s2 * (1 / n + (mx * mx) / sxx));
  const tSlope = slope / seSlope;
  const tIntercept = intercept / seIntercept;
  return {
    n,
    slope,
    intercept,
    seSlope,
    seIntercept,
    tSlope,
    tIntercept,
    pSlope: tTwoSidedP(tSlope, df),
    pIntercept: tTwoSidedP(tIntercept, df),
    r2,
    adjR2,
    df,
    sse,
    sst,
    rmse: Math.sqrt(sse / n),
    residualSe: Math.sqrt(s2),
    fitted,
    residuals,
    meanX: mx,
    meanY: my,
  };
}

/* ── the histogram's companion: a five-number summary for the box plot ────────────────── */

export function fiveNumber(values) {
  const { kept } = clean(values);
  if (!kept.length) return null;
  const s = sortedCopy(kept);
  const q1 = quantile(s, 0.25);
  const q3 = quantile(s, 0.75);
  const iqr = q3 - q1;
  const loFence = q1 - 1.5 * iqr;
  const hiFence = q3 + 1.5 * iqr;
  const inside = s.filter((v) => v >= loFence && v <= hiFence);
  return {
    min: s[0],
    q1,
    median: quantile(s, 0.5),
    q3,
    max: s[s.length - 1],
    whiskerLo: inside.length ? inside[0] : s[0],
    whiskerHi: inside.length ? inside[inside.length - 1] : s[s.length - 1],
    outliers: s.filter((v) => v < loFence || v > hiFence),
  };
}

/* ── resampling: a seeded generator, so a "random" split is reproducible ──────────────── */

/** mulberry32 — 32-bit seeded PRNG. A split that cannot be reproduced is not evidence. */
export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(n, random) {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

/** k folds, as index arrays. */
export function kFold(n, k, random) {
  const order = shuffle(n, random);
  const folds = Array.from({ length: k }, () => []);
  order.forEach((v, i) => folds[i % k].push(v));
  return folds;
}

/**
 * Repeated k-fold cross-validation of the regression line.
 *
 * WHY REPEATED: one 5-fold split of 272 rows gives one RMSE number, and that number moves from
 * split to split. Repeating it and reporting the spread is the difference between "the model
 * scores 6.1" and "the model scores 6.1 ± 0.2", and only the second is honest.
 *
 * 🔴 ONE SCORE PER REPEAT, NOT ONE PER FOLD. Every row is predicted exactly once inside a repeat,
 * so the repeat's score is computed over all n out-of-fold predictions. Averaging the five fold
 * scores instead would give the same number but a WRONG spread: the folds of one split are not
 * independent, so their spread is not the uncertainty of the estimate. Repeats are.
 */
export function cvRegression(x, y, opts = {}) {
  const k = opts.k || 5;
  const repeats = opts.repeats || 20;
  const seed = opts.seed || 20261029;
  const random = rng(seed);
  const n = x.length;
  if (n < k * 2) return { error: `need at least ${k * 2} rows for ${k}-fold cross-validation`, scores: [] };
  const scores = [];
  for (let r = 0; r < repeats; r++) {
    const preds = new Array(n);
    for (const test of kFold(n, k, random)) {
      const inTest = new Set(test);
      const trX = [];
      const trY = [];
      for (let i = 0; i < n; i++) {
        if (!inTest.has(i)) {
          trX.push(x[i]);
          trY.push(y[i]);
        }
      }
      const model = ols(trX, trY);
      if (model.error) continue;
      for (const i of test) preds[i] = model.intercept + model.slope * x[i];
    }
    if (preds.some((p) => p === undefined)) continue;
    let sse = 0;
    for (let i = 0; i < n; i++) sse += (y[i] - preds[i]) * (y[i] - preds[i]);
    scores.push(Math.sqrt(sse / n));
  }
  if (!scores.length) return { error: "no repeat could be fitted", scores: [] };
  return {
    k,
    repeats,
    folds: scores.length * k,
    scores,
    mean: mean(scores),
    sd: sd(scores),
    min: Math.min(...scores),
    max: Math.max(...scores),
    seed,
  };
}

/* ── classification: k nearest neighbours, and the metrics that judge it ──────────────── */

/** Standardises each column using TRAIN statistics only — leaking test means inflates the score. */
export function standardiser(rows) {
  const p = rows[0].length;
  const mu = [];
  const sigma = [];
  for (let j = 0; j < p; j++) {
    const col = rows.map((r) => r[j]);
    const m = mean(col);
    const s = sd(col) || 1;
    mu.push(m);
    sigma.push(s);
  }
  return (row) => row.map((v, j) => (v - mu[j]) / sigma[j]);
}

export function knnPredict(trainX, trainY, point, k) {
  const d = trainX.map((row, i) => {
    let acc = 0;
    for (let j = 0; j < row.length; j++) {
      const diff = row[j] - point[j];
      acc += diff * diff;
    }
    return { d: acc, label: trainY[i] };
  });
  d.sort((a, b) => a.d - b.d);
  const votes = new Map();
  for (let i = 0; i < Math.min(k, d.length); i++) {
    const w = 1 / (Math.sqrt(d[i].d) + 1e-9);
    votes.set(d[i].label, (votes.get(d[i].label) || 0) + w);
  }
  let best = null;
  let bestScore = -Infinity;
  for (const [label, score] of votes) {
    if (score > bestScore) {
      best = label;
      bestScore = score;
    }
  }
  return best;
}

/** Per-class score for the ROC curve: the share of the k nearest neighbours that carry the class. */
export function knnScore(trainX, trainY, point, k, label) {
  const d = trainX.map((row, i) => {
    let acc = 0;
    for (let j = 0; j < row.length; j++) {
      const diff = row[j] - point[j];
      acc += diff * diff;
    }
    return { d: acc, label: trainY[i] };
  });
  d.sort((a, b) => a.d - b.d);
  let total = 0;
  let hit = 0;
  for (let i = 0; i < Math.min(k, d.length); i++) {
    const w = 1 / (Math.sqrt(d[i].d) + 1e-9);
    total += w;
    if (d[i].label === label) hit += w;
  }
  return total ? hit / total : 0;
}

/**
 * Area under the ROC curve, computed from ranks (the Mann–Whitney U statistic) rather than by
 * integrating a drawn polyline — the two agree exactly and the rank form is one pass.
 * 0.5 is a coin toss. 1.0 is a perfect ordering.
 */
export function rocAuc(scores, isPositive) {
  const pos = [];
  const neg = [];
  for (let i = 0; i < scores.length; i++) (isPositive[i] ? pos : neg).push(scores[i]);
  if (!pos.length || !neg.length) return { auc: NaN, nPos: pos.length, nNeg: neg.length };
  const all = scores.slice();
  const r = ranks(all);
  let rankSumPos = 0;
  for (let i = 0; i < scores.length; i++) if (isPositive[i]) rankSumPos += r[i];
  const auc = (rankSumPos - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length);
  return { auc, nPos: pos.length, nNeg: neg.length };
}

/** The ROC polyline itself, for drawing. One point per distinct threshold. */
export function rocCurve(scores, isPositive) {
  const order = scores.map((s, i) => [s, isPositive[i]]).sort((a, b) => b[0] - a[0]);
  const totalPos = order.filter((o) => o[1]).length;
  const totalNeg = order.length - totalPos;
  const points = [{ fpr: 0, tpr: 0 }];
  let tp = 0;
  let fp = 0;
  for (let i = 0; i < order.length; i++) {
    if (order[i][1]) tp++;
    else fp++;
    const last = i === order.length - 1 || order[i + 1][0] !== order[i][0];
    if (last && totalPos && totalNeg) points.push({ fpr: fp / totalNeg, tpr: tp / totalPos });
  }
  return points;
}

export function confusionMatrix(yTrue, yPred, labels) {
  const index = new Map(labels.map((l, i) => [l, i]));
  const matrix = labels.map(() => labels.map(() => 0));
  let correct = 0;
  for (let i = 0; i < yTrue.length; i++) {
    const a = index.get(yTrue[i]);
    const b = index.get(yPred[i]);
    if (a === undefined || b === undefined) continue;
    matrix[a][b]++;
    if (a === b) correct++;
  }
  const perClass = labels.map((label, i) => {
    const tp = matrix[i][i];
    const rowTotal = matrix[i].reduce((a, b) => a + b, 0);
    const colTotal = matrix.reduce((acc, row) => acc + row[i], 0);
    return {
      label,
      support: rowTotal,
      predicted: colTotal,
      recall: rowTotal ? tp / rowTotal : NaN,
      precision: colTotal ? tp / colTotal : NaN,
    };
  });
  return { labels, matrix, correct, total: yTrue.length, accuracy: correct / yTrue.length, perClass };
}

/**
 * Repeated k-fold cross-validation of the classifier. Same discipline as the regression version:
 * one accuracy per repeat, computed over every row predicted exactly once out-of-fold, so the
 * spread across repeats is the uncertainty and the spread across the folds of one split is not.
 *
 * The folds themselves are NOT stratified — with three species of 50 each a fold is still close
 * to balanced, but on a rare-class problem this would need stratifying, and that is a limitation
 * of this implementation rather than of cross-validation.
 */
export function cvKnn(X, y, opts = {}) {
  const k = opts.k || 5;
  const repeats = opts.repeats || 10;
  const neighbours = opts.neighbours || 5;
  const random = rng(opts.seed || 20261029);
  const n = X.length;
  if (n < k * 2) return { error: `need at least ${k * 2} rows for ${k}-fold cross-validation`, scores: [] };
  const scores = [];
  let lastPredictions = null;
  for (let r = 0; r < repeats; r++) {
    const folds = kFold(n, k, random);
    const preds = new Array(n);
    for (const test of folds) {
      const inTest = new Set(test);
      const trainIdx = [];
      for (let i = 0; i < n; i++) if (!inTest.has(i)) trainIdx.push(i);
      const train = standardiser(trainIdx.map((i) => X[i]));
      const trainX = trainIdx.map((i) => train(X[i]));
      const trainY = trainIdx.map((i) => y[i]);
      for (const i of test) preds[i] = knnPredict(trainX, trainY, train(X[i]), neighbours);
    }
    let correct = 0;
    for (let i = 0; i < n; i++) if (preds[i] === y[i]) correct++;
    scores.push(correct / n);
    if (r === 0) lastPredictions = preds;
  }
  return {
    k,
    repeats,
    neighbours,
    scores,
    mean: mean(scores),
    sd: sd(scores),
    min: Math.min(...scores),
    max: Math.max(...scores),
    seed: opts.seed || 20261029,
    firstRunPredictions: lastPredictions,
  };
}

/* ── CSV, for the visitor's own file ──────────────────────────────────────────────────── */

/**
 * A small, strict CSV reader: quoted fields, doubled quotes, CRLF, and a header row. It refuses
 * ragged rows instead of guessing, because a file that silently shifts a column by one produces
 * statistics that look fine and are wrong.
 */
export function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let quoted = false;
  let i = 0;
  const src = text.replace(/^\uFEFF/, "");
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (!nonEmpty.length) return { header: [], rows: [], columns: [], error: "the file is empty" };
  const header = nonEmpty[0].map((h) => h.trim());
  const body = nonEmpty.slice(1);
  const width = header.length;
  const ragged = body.findIndex((r) => r.length !== width);
  if (ragged !== -1) {
    return { header, rows: [], columns: [], error: `row ${ragged + 2} has ${body[ragged].length} fields, the header has ${width}` };
  }
  return { header, rows: body, columns: header };
}
