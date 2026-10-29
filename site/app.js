/**
 * app.js — the page. The arithmetic lives in `stats.js`; this file only reads data, calls it,
 * and draws what came back.
 *
 * 🔴 NO NUMBER IS EVER WRITTEN INTO THIS FILE. Every figure on the page is produced by a call to
 * `stats.js` from the loaded data, so the page cannot disagree with its own tests. Where a
 * percentage or a count appears it is computed here. The only literals are layout and labels.
 */
import * as M from "./stats.js";

/* ── the datasets, and where each one comes from ──────────────────────────────────────── */

const BUILT_IN = {
  anscombe: {
    label: "Anscombe's quartet",
    file: "data/anscombe.json",
    shape: (d) => {
      const columns = [];
      for (let i = 0; i < 4; i++) {
        columns.push({ name: `x${i + 1}`, kind: "num", values: d.series[i].x });
        columns.push({ name: `y${i + 1}`, kind: "num", values: d.series[i].y });
      }
      return { label: "Anscombe's quartet", columns, orderedInTime: false };
    },
    note: "Four sets of eleven points, built in 1973 to show that four datasets can share every summary statistic and look nothing alike.",
    source: "F. J. Anscombe, “Graphs in Statistical Analysis”, The American Statistician 27(1), 1973",
  },
  iris: {
    label: "Fisher's iris",
    file: "data/iris.json",
    shape: (d) => {
      const columns = d.columns.map((name, j) => ({ name, kind: "num", values: d.rows.map((r) => r[j]) }));
      columns.push({ name: "species", kind: "cat", values: d.rows.map((r) => r[d.columns.length]) });
      return { label: "Fisher's iris", columns, orderedInTime: false };
    },
    note: "150 flowers, four measurements in millimetres, three species. The set every classifier is tried on first, which is also why it is a weak test of one.",
    source: "R. A. Fisher, Annals of Eugenics 7(2), 1936; measured by Edgar Anderson",
  },
  faithful: {
    label: "Old Faithful",
    file: "data/faithful.json",
    shape: (d) => ({
      label: "Old Faithful",
      columns: d.columns.map((name, j) => ({ name, kind: "num", values: d.rows.map((r) => r[j]) })),
      orderedInTime: true,
    }),
    note: "272 eruptions of the Old Faithful geyser, each with the length of the eruption and the wait until the next one. The rows are in the order they were recorded, which is what makes the independence check possible.",
    source: "A. Azzalini & A. W. Bowman, Applied Statistics 39, 1990",
  },
  penguins: {
    label: "Palmer penguins",
    file: "data/penguins.json",
    shape: (d) => {
      const names = ["bill_length_mm", "bill_depth_mm", "flipper_length_mm", "body_mass_g"];
      const columns = names.map((name, j) => ({ name, kind: "num", values: d.rows.map((r) => r[j]) }));
      columns.push({ name: "species", kind: "cat", values: d.rows.map((r) => r[4]) });
      columns.push({ name: "island", kind: "cat", values: d.rows.map((r) => r[5]) });
      columns.push({ name: "sex", kind: "cat", values: d.rows.map((r) => r[6]) });
      return { label: "Palmer penguins", columns, orderedInTime: false };
    },
    note: "344 birds from three islands, with the measurements that were never taken left missing — which is what a real file looks like, and why the page counts holes instead of quietly dropping them.",
    source: "K. B. Gorman, T. D. Williams & W. R. Fraser, PLOS ONE 9(3): e90081, 2014",
  },
};

const state = {
  key: "anscombe",
  data: null,
  summaryCol: 0,
  modelX: 0,
  modelY: 1,
  classTarget: "",
  k: 5,
};

/* ── formatting ────────────────────────────────────────────────────────────────────────── */

const fmt = (v, dp = 4) => {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (!Number.isFinite(v)) return v > 0 ? "∞" : "−∞";
  const a = Math.abs(v);
  if (a !== 0 && a < 0.001) return v.toExponential(2);
  if (a >= 10000) return v.toLocaleString("en-CA", { maximumFractionDigits: 0 });
  return v.toLocaleString("en-CA", { minimumFractionDigits: dp, maximumFractionDigits: dp });
};

const fmtP = (p) => {
  if (!Number.isFinite(p)) return "—";
  if (p < 0.0001) return "< 0.0001";
  return p.toFixed(4);
};

const el = (tag, props = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined) node.append(kid);
  return node;
};

function table(headers, rows, opts = {}) {
  const thead = el("thead", {}, el("tr", {}, headers.map((h) => el("th", { class: h.cls || "", text: h.label || h, scope: "col" }))));
  const tbody = el("tbody");
  for (const row of rows) {
    const tr = el("tr", { class: row.class || "" });
    if (row.head) tr.append(el("th", { scope: "row", text: row.head }));
    for (const cell of row.cells) {
      const td = el("td", cell.colspan ? { class: cell.cls || "", colspan: cell.colspan } : { class: cell.cls || "" });
      if (cell.html) td.innerHTML = cell.html;
      else td.textContent = cell.text ?? "";
      tr.append(td);
    }
    tbody.append(tr);
  }
  const wrap = el("table", {}, opts.caption ? el("caption", { text: opts.caption }) : null, thead, tbody);
  return wrap;
}

function swap(container, ...nodes) {
  container.replaceChildren(...nodes.flat().filter(Boolean));
}

/* ── SVG helpers ──────────────────────────────────────────────────────────────────────── */

const NS = "http://www.w3.org/2000/svg";
function s(tag, attrs = {}, ...kids) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) node.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid) node.append(kid);
  return node;
}

const scale = (d0, d1, r0, r1) => (v) => (d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0));

/** Ticks that land on round numbers rather than on the data's own bounds. */
function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  const span = max - min;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => span / v <= count + 1) || 10 * mag;
  const start = Math.ceil(min / step) * step;
  const out = [];
  for (let v = start; v <= max + step * 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

const tickLabel = (v) => {
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a >= 1000) return v.toLocaleString("en-CA", { maximumFractionDigits: 0 });
  if (a >= 1) return String(Number(v.toFixed(2)));
  return String(Number(v.toPrecision(2)));
};

const W = 520;
const H = 300;
const PAD = { t: 12, r: 14, b: 34, l: 46 };

function frame(w, h, pad, xTicks, yTicks, xLabel, yLabel, xd, yd) {
  const xs = scale(xd[0], xd[1], pad.l, w - pad.r);
  const ys = scale(yd[0], yd[1], h - pad.b, pad.t);
  const g = s("g");
  for (const t of yTicks) {
    g.append(s("line", { class: "grid-line", x1: pad.l, x2: w - pad.r, y1: ys(t), y2: ys(t) }));
    g.append(s("text", { x: pad.l - 6, y: ys(t) + 3, "text-anchor": "end" }, document.createTextNode(tickLabel(t))));
  }
  for (const t of xTicks) {
    g.append(s("text", { x: xs(t), y: h - pad.b + 14, "text-anchor": "middle" }, document.createTextNode(tickLabel(t))));
  }
  g.append(s("line", { class: "axis", x1: pad.l, x2: w - pad.r, y1: h - pad.b, y2: h - pad.b }));
  g.append(s("line", { class: "axis", x1: pad.l, x2: pad.l, y1: pad.t, y2: h - pad.b }));
  if (xLabel) g.append(s("text", { class: "label", x: (pad.l + w - pad.r) / 2, y: h - 4, "text-anchor": "middle" }, document.createTextNode(xLabel)));
  if (yLabel)
    g.append(
      s(
        "text",
        { class: "label", x: 12, y: pad.t + 4, "text-anchor": "middle", transform: `rotate(-90 12 ${pad.t + 4})` },
        document.createTextNode(yLabel),
      ),
    );
  return { g, xs, ys };
}

function bounds(values, padFrac = 0.05) {
  const { kept } = M.clean(values);
  if (!kept.length) return [0, 1];
  let lo = Math.min(...kept);
  let hi = Math.max(...kept);
  if (lo === hi) {
    const bump = Math.abs(lo) * 0.1 || 1;
    return [lo - bump, hi + bump];
  }
  const pad = (hi - lo) * padFrac;
  return [lo - pad, hi + pad];
}

function scatterChart(points, opts = {}) {
  const w = opts.w || W;
  const h = opts.h || H;
  const pad = opts.pad || PAD;
  /* a shared domain, when the caller wants several figures drawn on one scale */
  const xd = opts.domain ? opts.domain.x : bounds(points.map((p) => p.x));
  let yd = opts.domain ? opts.domain.y : bounds(points.map((p) => p.y));
  if (opts.hlines && opts.hlines.length) {
    /* 🔴 A HORIZONTAL BAND IS PART OF THE PICTURE. The ±2σ bands on the residual plot sit outside
     * the residuals' own range by definition, so an axis scaled only to the points drew them off
     * the frame and across the axis labels. Data science demo here on 29 October 2026. */
    const ys2 = opts.hlines.map((h) => h.y);
    yd = [Math.min(yd[0], ...ys2), Math.max(yd[1], ...ys2)];
  }
  const { g, xs, ys } = frame(w, h, pad, niceTicks(xd[0], xd[1], opts.xTicks || 5), niceTicks(yd[0], yd[1], opts.yTicks || 5), opts.xLabel, opts.yLabel, xd, yd);
  if (opts.hlines) {
    for (const hl of opts.hlines) g.append(s("line", { class: hl.cls || "line dashed", x1: pad.l, x2: w - pad.r, y1: ys(hl.y), y2: ys(hl.y) }));
  }
  for (const p of points) {
    g.append(
      s("circle", { class: "pt", cx: xs(p.x), cy: ys(p.y), r: opts.r || 3.1 }, s("title", {}, document.createTextNode(p.title || `${p.x}, ${p.y}`))),
    );
  }
  if (opts.line) {
    /* 🔴 THE LINE IS CLIPPED TO THIS AXIS. The quartet shares one range across four plots so the
     * pictures can be compared, but each plot's own axis is scaled to its own points — drawing the
     * line across the SHARED range made it run out of the frame and over the next figure. Data science demo
     * on this page on 29 October 2026. */
    const l0 = opts.line.intercept + opts.line.slope * xd[0];
    const l1 = opts.line.intercept + opts.line.slope * xd[1];
    g.append(s("line", { class: "line", x1: xs(xd[0]), y1: ys(l0), x2: xs(xd[1]), y2: ys(l1) }));
  }
  return s("svg", { viewBox: `0 0 ${w} ${h}`, role: "presentation" }, g);
}

/* ── 1 · data ─────────────────────────────────────────────────────────────────────────── */

function columnByName(name) {
  return state.data.columns.find((c) => c.name === name);
}

function renderDataset() {
  const d = state.data;
  const spec = BUILT_IN[state.key];
  const rows = d.columns[0].values.length;
  const numeric = d.columns.filter((c) => c.kind === "num");
  const holes = numeric.reduce((acc, c) => acc + M.clean(c.values).missing, 0);

  swap(
    document.getElementById("dataset-meta"),
    el("div", { html: `<b>${d.label}</b> — ${rows.toLocaleString("en-CA")} rows, ${d.columns.length} columns (${numeric.length} numeric).` }),
    el(
      "div",
      { class: "src" },
      spec ? `${spec.note} Source: ${spec.source}.` : `Your file. Nothing in it has left your browser.`,
    ),
    holes
      ? el("div", { class: "src warn", text: `${holes} missing numeric ${holes === 1 ? "value" : "values"} across ${numeric.filter((c) => M.clean(c.values).missing).length} columns. Every statistic below states which rows it used.` })
      : null,
  );

  const head = d.columns.map((c) => c.name);
  const preview = [];
  for (let i = 0; i < Math.min(8, rows); i++) {
    preview.push({
      cells: d.columns.map((c) => {
        const v = c.values[i];
        return c.kind === "num"
          ? { text: v === null ? "(missing)" : fmt(v, 3), cls: v === null ? "num bad" : "num" }
          : { text: v === null ? "(missing)" : v };
      }),
    });
  }
  if (rows > 8) {
    preview.push({
      class: "total",
      head: "",
      cells: [{ text: `… and ${(rows - 8).toLocaleString("en-CA")} more rows, all of them used by the statistics below.`, cls: "why", colspan: String(head.length + 1) }],
    });
  }
  swap(
    document.getElementById("dataset-table"),
    table(head, preview, { caption: "The data, as loaded — the first eight rows" }),
  );

  fillColumnSelect();
  fillModelSelects();
  fillClassSelect();
  renderSummary();
  renderQuartet();
  renderModel();
  renderClassify();
}

function fillColumnSelect() {
  const sel = document.getElementById("summary-col");
  const numeric = state.data.columns.map((c, i) => ({ c, i })).filter((o) => o.c.kind === "num");
  const keep = sel.value;
  swap(sel, numeric.map((o) => el("option", { value: String(o.i), text: `${o.c.name} (${M.clean(o.c.values).kept.length} values)` })));
  if (keep && numeric.some((o) => String(o.i) === keep)) sel.value = keep;
  else if (numeric.length) sel.value = String(numeric[0].i);
  state.summaryCol = Number(sel.value);
}

function fillModelSelects() {
  const numeric = state.data.columns.map((c, i) => ({ c, i })).filter((o) => o.c.kind === "num");
  for (const [id, key, fallback] of [
    ["model-x", "modelX", 0],
    ["model-y", "modelY", 1],
  ]) {
    const sel = document.getElementById(id);
    const keep = sel.value;
    swap(sel, numeric.map((o) => el("option", { value: String(o.i), text: o.c.name })));
    if (keep && numeric.some((o) => String(o.i) === keep)) sel.value = keep;
    else sel.value = String(numeric[Math.min(fallback, numeric.length - 1)].i);
    state[key] = Number(sel.value);
  }
}

function fillClassSelect() {
  const cats = state.data.columns.map((c, i) => ({ c, i })).filter((o) => o.c.kind === "cat");
  const sel = document.getElementById("class-target");
  const keep = sel.value;
  swap(
    sel,
    cats.length
      ? cats.map((o) => {
          const levels = [...new Set(o.c.values.filter((v) => v !== null))];
          return el("option", { value: String(o.i), text: `${o.c.name} — ${levels.length} classes` });
        })
      : [el("option", { value: "", text: "this dataset has no class column" })],
  );
  if (keep && cats.some((o) => String(o.i) === keep)) sel.value = keep;
  state.classTarget = sel.value;
}

/* ── 2 · summary ──────────────────────────────────────────────────────────────────────── */

function renderSummary() {
  const col = state.data.columns[state.summaryCol];
  if (!col || col.kind !== "num") return;
  const { kept, missing } = M.clean(col.values);
  const st = M.summarise(col.values);
  const n = st.n;

  const rows = [
    { head: "n", cells: [{ text: st.n.toLocaleString("en-CA"), cls: "num" }, { text: "values present", cls: "why" }] },
    ...(missing
      ? [{ head: "missing", cells: [{ text: String(missing), cls: "num warn" }, { text: "cells left empty or unreadable, excluded from every figure here", cls: "why" }] }]
      : []),
    { head: "mean", cells: [{ text: fmt(st.mean), cls: "num" }, { text: "Σx ÷ n — moved by a single extreme value", cls: "why" }] },
    { head: "median", cells: [{ text: fmt(st.median), cls: "num" }, { text: "the 50th percentile, type 7 — resists extremes", cls: "why" }] },
    { head: "sd", cells: [{ text: fmt(st.sd), cls: "num" }, { text: "sample standard deviation, n − 1 denominator", cls: "why" }] },
    { head: "variance", cells: [{ text: fmt(st.variance), cls: "num" }, { text: "the square of the sd, in squared units", cls: "why" }] },
    { head: "q1 · q3", cells: [{ text: ` ${fmt(st.q1)} · ${fmt(st.q3)}`, cls: "num" }, { text: "type 7, the R and NumPy default", cls: "why" }] },
    { head: "iqr", cells: [{ text: fmt(st.iqr), cls: "num" }, { text: "q3 − q1, the middle half of the data", cls: "why" }] },
    { head: "min · max", cells: [{ text: `${fmt(st.min)} · ${fmt(st.max)}`, cls: "num" }, { text: "observed extremes, nothing inferred", cls: "why" }] },
    { head: "skewness", cells: [{ text: fmt(st.skewness), cls: "num" }, { text: "adjusted sample moment G1 — 0 is symmetric", cls: "why" }] },
    { head: "kurtosis", cells: [{ text: fmt(st.kurtosis), cls: "num" }, { text: "excess kurtosis — a normal distribution is 0, not 3", cls: "why" }] },
    { head: "se of mean", cells: [{ text: fmt(st.stderrMean), cls: "num" }, { text: "sd ÷ √n — how far the mean itself would wander", cls: "why" }] },
  ];
  swap(document.getElementById("summary-table"), table([{ label: "statistic" }, { label: "value" }, { label: "how it is computed" }], rows, { caption: col.name }));

  const sumX = M.sum(kept);
  const ss = kept.reduce((a, v) => a + (v - st.mean) ** 2, 0);
  swap(
    document.getElementById("summary-arith"),
    el("div", { html:
      `<b>mean</b>  = Σx ÷ n            = ${fmt(sumX)} ÷ ${n} = ${fmt(st.mean)}<br />` +
      `<b>sd</b>    = √( Σ(x − x̄)² ÷ (n − 1) ) = √( ${fmt(ss)} ÷ ${n - 1} ) = ${fmt(st.sd)}<br />` +
      `<b>se</b>    = sd ÷ √n           = ${fmt(st.sd)} ÷ √${n} = ${fmt(st.stderrMean)}<br />` +
      `<b>iqr</b>   = q3 − q1           = ${fmt(st.q3)} − ${fmt(st.q1)} = ${fmt(st.iqr)}` }),
  );

  /* the histogram */
  const h = M.histogram(kept);
  const hw = W;
  const hh = 210;
  const pad = { t: 10, r: 12, b: 32, l: 40 };
  const maxCount = Math.max(...h.bins.map((b) => b.count), 1);
  const bw = (hw - pad.l - pad.r) / h.bins.length;
  const yScale = scale(0, maxCount, hh - pad.b, pad.t);
  const g = s("g");
  for (const t of niceTicks(0, maxCount, 4)) {
    g.append(s("line", { class: "grid-line", x1: pad.l, x2: hw - pad.r, y1: yScale(t), y2: yScale(t) }));
    g.append(s("text", { x: pad.l - 6, y: yScale(t) + 3, "text-anchor": "end" }, document.createTextNode(String(Math.round(t)))));
  }
  h.bins.forEach((b, i) => {
    const x = pad.l + i * bw;
    const y = yScale(b.count);
    g.append(
      s(
        "rect",
        { class: "bar", x: x + 0.6, y, width: Math.max(1, bw - 1.2), height: Math.max(0, hh - pad.b - y) },
        s("title", {}, document.createTextNode(`${fmt(b.lo, 2)} – ${fmt(b.hi, 2)}: ${b.count} ${b.count === 1 ? "value" : "values"}`)),
      ),
    );
  });
  for (const t of niceTicks(Math.min(...kept), Math.max(...kept), 5)) {
    const x = pad.l + ((t - h.bins[0].lo) / (h.bins[h.bins.length - 1].hi - h.bins[0].lo)) * (hw - pad.l - pad.r);
    if (x >= pad.l - 1 && x <= hw - pad.r + 1)
      g.append(s("text", { x, y: hh - pad.b + 14, "text-anchor": "middle" }, document.createTextNode(tickLabel(t))));
  }
  g.append(s("line", { class: "axis", x1: pad.l, x2: hw - pad.r, y1: hh - pad.b, y2: hh - pad.b }));
  g.append(s("line", { class: "axis", x1: pad.l, x2: pad.l, y1: pad.t, y2: hh - pad.b }));
  g.append(s("text", { class: "label", x: pad.l - 6, y: pad.t - 1, "text-anchor": "end" }, document.createTextNode("count")));
  swap(document.getElementById("hist"), s("svg", { viewBox: `0 0 ${hw} ${hh}` }, g));
  document.getElementById("hist-caption").innerHTML =
    `${h.binCount} bins, ${h.rule === "Freedman–Diaconis" ? "width chosen by the Freedman–Diaconis rule — 2 × IQR × n<sup>−1/3</sup>" : "width chosen by " + h.rule}, so the bin size adapts to the spread rather than being picked by hand. Hover a bar for its range.`;

  /* the box plot */
  renderBox(kept, h.rule === "no data" ? "" : col.name);
}

function renderBox(values, name) {
  const f = M.fiveNumber(values);
  const w = W;
  const h = 120;
  const pad = { l: 30, r: 30 };
  const [lo, hi] = bounds(values, 0.06);
  const xs = scale(lo, hi, pad.l, w - pad.r);
  const mid = 52;
  const g = s("g");
  for (const t of niceTicks(lo, hi, 5)) {
    g.append(s("line", { class: "grid-line", x1: xs(t), x2: xs(t), y1: 22, y2: 84 }));
    g.append(s("text", { x: xs(t), y: 100, "text-anchor": "middle" }, document.createTextNode(tickLabel(t))));
  }
  g.append(s("line", { class: "whisker", x1: xs(f.whiskerLo), x2: xs(f.q1), y1: mid, y2: mid }));
  g.append(s("line", { class: "whisker", x1: xs(f.q3), x2: xs(f.whiskerHi), y1: mid, y2: mid }));
  for (const x of [f.whiskerLo, f.whiskerHi]) g.append(s("line", { class: "whisker", x1: xs(x), x2: xs(x), y1: mid - 12, y2: mid + 12 }));
  g.append(s("rect", { class: "box", x: xs(f.q1), y: mid - 18, width: Math.max(1, xs(f.q3) - xs(f.q1)), height: 36, rx: 2 }));
  g.append(s("line", { class: "median", x1: xs(f.median), x2: xs(f.median), y1: mid - 18, y2: mid + 18 }));
  for (const o of f.outliers) g.append(s("circle", { class: "outlier", cx: xs(o), cy: mid, r: 3.2 }, s("title", {}, document.createTextNode(`outlier: ${fmt(o)}`))));
  swap(document.getElementById("box"), s("svg", { viewBox: `0 0 ${w} ${h}` }, g));
  document.getElementById("box-caption").innerHTML =
    `${name ? `<b>${name}</b> — ` : ""}median ${fmt(f.median)}, box from q1 ${fmt(f.q1)} to q3 ${fmt(f.q3)}; whiskers reach the furthest value inside 1.5 × IQR, and ` +
    `${f.outliers.length} ${f.outliers.length === 1 ? "value sits" : "values sit"} outside that fence (drawn as rings). A value outside the fence is flagged, not deleted.`;
}

/* ── 3 · Anscombe's quartet ───────────────────────────────────────────────────────────── */

function renderQuartet() {
  const host = document.getElementById("quartet-plots");
  const tableHost = document.getElementById("quartet-table");
  if (!host || !tableHost) return;

  if (state.key !== "anscombe") {
    swap(host);
    swap(
      tableHost,
      el("p", { class: "note", html: `The quartet is its own dataset — choose <b>Anscombe's quartet</b> above to see it drawn. The point of the section is that it is the same four sets every time.` }),
    );
    return;
  }

  const sets = [1, 2, 3, 4].map((i) => {
    const xc = columnByName(`x${i}`);
    const yc = columnByName(`y${i}`);
    const { x, y } = M.pairs(xc.values, yc.values);
    const model = M.ols(x, y);
    return { i, x, y, model, r: M.pearson(x, y), sx: M.summarise(x), sy: M.summarise(y) };
  });

  /* 🔴 ONE RANGE FOR ALL FOUR, so the pictures can be compared. Each plot then draws within it —
   * the axes are shared even though the scales are computed per figure. */
  const xAll = sets.flatMap((st) => st.x);
  const yAll = sets.flatMap((st) => st.y);
  const shared = { x: bounds(xAll, 0.06), y: bounds(yAll, 0.06) };

  swap(
    host,
    sets.map((st) =>
      el(
        "figure",
        { class: "chart" },
        scatterChart(
          st.x.map((xv, j) => ({ x: xv, y: st.y[j], title: `set ${st.i}: (${xv}, ${st.y[j]})` })),
          {
            w: 250,
            h: 210,
            pad: { t: 12, r: 12, b: 28, l: 38 },
            xTicks: 3,
            yTicks: 3,
            r: 2.6,
            line: { slope: st.model.slope, intercept: st.model.intercept },
            xLabel: "x",
            yLabel: st.i === 1 ? "y" : "",
            domain: shared,
          },
        ),
        el("figcaption", { text: `set ${st.i}` }),
      ),
    ),
  );

  const rows = [
    { head: "mean x", cells: sets.map((st) => ({ text: fmt(st.sx.mean, 3), cls: "num" })) },
    { head: "mean y", cells: sets.map((st) => ({ text: fmt(st.sy.mean, 3), cls: "num" })) },
    { head: "variance x", cells: sets.map((st) => ({ text: fmt(st.sx.variance, 3), cls: "num" })) },
    { head: "variance y", cells: sets.map((st) => ({ text: fmt(st.sy.variance, 3), cls: "num" })) },
    { head: "correlation", cells: sets.map((st) => ({ text: fmt(st.r, 4), cls: "num" })) },
    { head: "slope", cells: sets.map((st) => ({ text: fmt(st.model.slope, 4), cls: "num" })) },
    { head: "intercept", cells: sets.map((st) => ({ text: fmt(st.model.intercept, 4), cls: "num" })) },
    { head: "R²", cells: sets.map((st) => ({ text: fmt(st.model.r2, 4), cls: "num" })) },
    { head: "residual sd", cells: sets.map((st) => ({ text: fmt(M.sd(st.model.residuals), 4), cls: "num" })) },
    { head: "largest residual", cells: sets.map((st) => ({ text: fmt(Math.max(...st.model.residuals.map(Math.abs)), 3), cls: "num" })) },
  ];
  swap(
    tableHost,
    table([{ label: "statistic" }, ...sets.map((st) => ({ label: `set ${st.i}` }))], rows, {
      caption: "Computed here, from the eleven points of each set",
    }),
  );
}

/* ── 4 · the fitted line ──────────────────────────────────────────────────────────────── */

function renderModel() {
  const xc = state.data.columns[state.modelX];
  const yc = state.data.columns[state.modelY];
  if (!xc || !yc || xc.kind !== "num" || yc.kind !== "num") return;
  const { x, y, dropped } = M.pairs(xc.values, yc.values);
  const model = M.ols(x, y);
  document.getElementById("model-n").textContent = `${x.length} complete pairs${dropped ? `, ${dropped} row${dropped === 1 ? "" : "s"} dropped for a missing value` : ""}`;

  if (model.error) {
    swap(document.getElementById("model-table"), el("p", { class: "note bad", text: model.error }));
    swap(document.getElementById("resid-plot"));
    swap(document.getElementById("cv-out"));
    swap(document.getElementById("assumption-out"));
    return;
  }

  const rows = [
    { head: "n", cells: [{ text: String(model.n), cls: "num" }, { text: "complete pairs used", cls: "why" }] },
    { head: "intercept", cells: [{ text: fmt(model.intercept), cls: "num" }, { text: `where the line meets ${xc.name} = 0`, cls: "why" }] },
    { head: "se(intercept)", cells: [{ text: fmt(model.seIntercept), cls: "num" }, { text: "how far the intercept would move on another sample", cls: "why" }] },
    { head: "slope", cells: [{ text: fmt(model.slope), cls: "num" }, { text: `change in ${yc.name} per one unit of ${xc.name}`, cls: "why" }] },
    { head: "se(slope)", cells: [{ text: fmt(model.seSlope), cls: "num" }, { text: "the slope's own uncertainty — read this before quoting the slope", cls: "why" }] },
    { head: "t", cells: [{ text: fmt(model.tSlope, 3), cls: "num" }, { text: "slope ÷ se(slope)", cls: "why" }] },
    { head: "p (slope)", cells: [{ text: fmtP(model.pSlope), cls: "num" }, { text: `two-sided t on ${model.df} degrees of freedom`, cls: "why" }] },
    { head: "R²", cells: [{ text: fmt(model.r2, 4), cls: "num" }, { text: "share of the variance in the outcome the line explains", cls: "why" }] },
    { head: "adjusted R²", cells: [{ text: fmt(model.adjR2, 4), cls: "num" }, { text: "R² after paying for the one parameter", cls: "why" }] },
    { head: "residual se", cells: [{ text: fmt(model.residualSe), cls: "num" }, { text: "√( SSE ÷ (n − 2) ) — typical distance from the line", cls: "why" }] },
  ];
  swap(
    document.getElementById("model-table"),
    table([{ label: "estimate" }, { label: "value" }, { label: "what it is" }], rows, {
      caption: `${yc.name} = ${fmt(model.intercept, 3)} + ${fmt(model.slope, 3)} × ${xc.name}`,
    }),
  );

  /* residual plot — the picture that says whether the line was the right shape at all */
  const residPts = x.map((xv, i) => ({ x: xv, y: model.residuals[i], title: `${xc.name} ${fmt(xv, 2)} → residual ${fmt(model.residuals[i], 3)}` }));
  swap(
    document.getElementById("resid-plot"),
    scatterChart(residPts, {
      xLabel: xc.name,
      yLabel: "residual",
      hlines: [
        { y: 0, cls: "line dashed" },
        { y: 2 * model.residualSe, cls: "line dashed" },
        { y: -2 * model.residualSe, cls: "line dashed" },
      ],
      r: 2.9,
    }),
  );
  const outside = model.residuals.filter((r) => Math.abs(r) > 2 * model.residualSe).length;
  document.getElementById("resid-caption").innerHTML =
    `Residual = what the line did not explain. The dashed bands are ±2 × the residual standard error; ${outside} of ${model.n} points fall outside them. ` +
    `A shape in this cloud means the straight line is the wrong model, however good the R² looks.`;

  renderCV(x, y, yc.name);
  renderAssumptions(x, y, model, xc.name);
}

function renderCV(x, y, unit) {
  const cv = M.cvRegression(x, y, { k: 5, repeats: 20, seed: 20261029 });
  const host = document.getElementById("cv-out");
  if (cv.error) {
    swap(host, el("p", { class: "note bad", text: cv.error }));
    return;
  }
  const strip = dotStrip(cv.scores);
  swap(
    host,
    el(
      "div",
      { class: "cv" },
      el(
        "div",
        {},
        el("div", { class: "cv-big" }, el("span", { class: "value", text: fmt(cv.mean, 3) }), el("span", { class: "pm", text: `± ${fmt(cv.sd, 3)}` }), el("span", { class: "unit", text: ` in ${unit}` })),
        el("p", { class: "cv-note", html: `mean and standard deviation of <b>${cv.scores.length}</b> out-of-fold root-mean-square errors — each from its own ${cv.k}-fold split, so ${cv.repeats} repeats and ${cv.folds} fitted models in all. The worst repeat scored ${fmt(cv.max, 3)} and the best ${fmt(cv.min, 3)}; that range is the honest width of the claim.` }),
        el("p", { class: "cv-note", html: `Seeded at ${cv.seed}, so this split can be reproduced exactly — a score nobody can reproduce is an anecdote.` }),
      ),
      el("div", { class: "chart" }, strip),
    ),
  );
}

/** A dot per score, so the spread is seen rather than read off a ± number. */
function dotStrip(values) {
  const w = 460;
  const h = 130;
  const pad = { l: 14, r: 14, b: 24, t: 12 };
  const [lo, hi] = bounds(values, 0.18);
  const xs = scale(lo, hi, pad.l, w - pad.r);
  const g = s("g");
  g.append(s("line", { class: "axis", x1: pad.l, x2: w - pad.r, y1: h - pad.b, y2: h - pad.b }));
  for (const t of niceTicks(lo, hi, 4)) {
    g.append(s("text", { x: xs(t), y: h - 9, "text-anchor": "middle" }, document.createTextNode(tickLabel(t))));
  }
  const sorted = values.slice().sort((a, b) => a - b);
  sorted.forEach((v, i) => {
    /* three rows, so twenty dots are read as a cloud rather than as a smudge on one line */
    const row = [(h - pad.b) / 2 - 26, (h - pad.b) / 2, (h - pad.b) / 2 + 26][i % 3];
    g.append(s("circle", { class: "pt", cx: xs(v), cy: row, r: 3.2 }, s("title", {}, document.createTextNode(fmt(v, 4)))));
  });
  const m = M.mean(values);
  g.append(s("line", { class: "median", x1: xs(m), x2: xs(m), y1: pad.t, y2: h - pad.b }));
  g.append(s("text", { x: xs(m), y: pad.t + 8, "text-anchor": "middle", class: "label" }, document.createTextNode("mean")));
  return s("svg", { viewBox: `0 0 ${w} ${h}` }, g);
}

function renderAssumptions(x, y, model, xName) {
  const n = model.n;
  const resid = model.residuals;
  const cards = [];

  const add = (title, verdict, cls, body) =>
    cards.push(
      el("div", { class: `assumption ${cls}` }, el("h4", {}, document.createTextNode(title), el("span", { class: "verdict", text: verdict })), el("p", { html: body })),
    );

  /* 1 · linearity — is there a curve left in the residuals? */
  const rLin = M.spearman(x, resid);
  const rSq = M.spearman(x.map((v) => v * v), resid);
  const curve = Math.max(Math.abs(rLin), Math.abs(rSq));
  add(
    "The relationship is a straight line",
    curve > 0.2 ? "looks curved" : "no curve seen",
    curve > 0.2 ? "v-warn" : "v-ok",
    `Rank correlation of the residuals with ${xName} is ${fmt(rLin, 3)}, and with ${xName}² is ${fmt(rSq, 3)}. ` +
      `A residual cloud that bends means the line is the wrong shape — the coefficient above is then describing something that is not there.`,
  );

  /* 2 · independence — only checkable when the file records the order */
  if (state.data.orderedInTime) {
    const a = resid.slice(0, -1);
    const b = resid.slice(1);
    const acf = M.pearson(a, b);
    add(
      "The rows are independent of each other",
      Math.abs(acf) > 0.3 ? "correlated" : "no carry-over seen",
      Math.abs(acf) > 0.3 ? "v-warn" : "v-ok",
      `This file records the order the rows were taken, so the lag-1 autocorrelation of the residuals can be computed: ${fmt(acf, 3)}. ` +
        `Near zero means one row carries little information about the next; a strong value means the sample is smaller than n suggests, whatever n says.`,
    );
  } else {
    add(
      "The rows are independent of each other",
      "not checkable here",
      "v-na",
      `Nothing in this file records the order or the grouping of the rows, so carry-over cannot be measured — and no statistic computed from the values can recover it. ` +
        `This is the assumption that most often fails in real data and the one this page can least often test.`,
    );
  }

  /* 3 · equal spread — does the size of the residuals change with x? */
  const absResid = resid.map(Math.abs);
  const rHet = M.spearman(x, absResid);
  add(
    "The spread is the same along the line",
    Math.abs(rHet) > 0.35 ? "spread changes" : "looks even",
    Math.abs(rHet) > 0.35 ? "v-warn" : "v-ok",
    `Rank correlation of |residual| with ${xName} is ${fmt(rHet, 3)}. A funnel — small residuals at one end, large at the other — makes the printed standard errors too small on one side and too large on the other.`,
  );

  /* 4 · the shape of the residuals */
  const sk = M.skewness(resid);
  const ku = M.kurtosis(resid);
  const off = Math.abs(sk) > 1 || Math.abs(ku) > 2;
  add(
    "The residuals are roughly normal",
    off ? "skewed or heavy" : "roughly normal",
    off ? "v-warn" : "v-ok",
    `Skewness ${fmt(sk, 3)} and excess kurtosis ${fmt(ku, 3)}. This is a shape check, not a formal test — a Shapiro–Wilk or Anderson–Darling test is not implemented here, and the p-values above assume normality of the residuals rather than prove it.`,
  );

  /* 5 · leverage — is one row deciding the answer? */
  const mx = model.meanX;
  let sxx = 0;
  for (const v of x) sxx += (v - mx) ** 2;
  const h = x.map((v) => 1 / n + (v - mx) ** 2 / sxx);
  const hMax = Math.max(...h);
  const hFlag = hMax > 3 * (2 / n);
  add(
    "No single row decides the line",
    hFlag ? "one row pulls hard" : "no row dominates",
    hFlag ? "v-warn" : "v-ok",
    `The largest leverage (the share of the fit that row is able to move) is ${fmt(hMax, 3)} against an average of ${fmt(2 / n, 3)}. ` +
      `Anscombe's third set is the textbook case: one point at the far right decides almost the whole line.`,
  );

  swap(document.getElementById("assumption-out"), cards);
}

/* ── 5 · classification ──────────────────────────────────────────────────────────────── */

function renderClassify() {
  const host = document.getElementById("cm");
  const metricsHost = document.getElementById("class-metrics");
  const rocHost = document.getElementById("roc");
  const cvHost = document.getElementById("class-cv");
  const target = state.data.columns[Number(state.classTarget)];

  if (!target || target.kind !== "cat") {
    /* 🔴 AN EMPTY `table-wrap` STILL DRAWS ITS BORDER, which read as a stray rule under the message.
     * So the wrapper's class is dropped while it holds nothing but a sentence. */
    host.className = "";
    metricsHost.className = "";
    swap(host, el("p", { class: "note", text: "This dataset has no categorical column, so there is nothing to classify. Choose Fisher's iris or the Palmer penguins above — both have a species column with three classes." }));
    swap(metricsHost);
    swap(rocHost);
    swap(cvHost);
    document.getElementById("roc-caption").textContent = "";
    return;
  }
  host.className = "table-wrap";
  metricsHost.className = "table-wrap";

  const features = state.data.columns.map((c, i) => ({ c, i })).filter((o) => o.c.kind === "num");
  const rows = features[0].c.values
    .map((_, i) => i)
    .filter((i) => features.every((f) => Number.isFinite(f.c.values[i])) && target.values[i] !== null && target.values[i] !== undefined);
  const X = rows.map((i) => features.map((f) => f.c.values[i]));
  const y = rows.map((i) => target.values[i]);
  const labels = [...new Set(y)].sort();
  document.getElementById("class-note").textContent =
    `${rows.length} rows with all ${features.length} numeric columns present, classified by ${target.name} (${labels.length} classes), ${state.k} neighbours.`;

  const cv = M.cvKnn(X, y, { k: 5, repeats: 10, neighbours: state.k, seed: 20261029 });
  const cm = M.confusionMatrix(y, cv.firstRunPredictions, labels);

  /* the confusion matrix */
  const head = [{ label: target.name, cls: "corner" }, ...labels.map((l) => ({ label: `predicted ${l}` }))];
  const body = labels.map((label, i) => ({
    head: label,
    cells: cm.matrix[i].map((count, j) => ({ text: String(count), cls: `num ${i === j ? "diag" : count ? "off" : ""}` })),
  }));
  body.push({ class: "total", head: "actual total", cells: labels.map((_, j) => ({ text: String(cm.matrix.reduce((a, row) => a + row[j], 0)), cls: "num" })) });
  swap(host, table(head, body, { caption: `Out-of-fold predictions from the first repeat. Accuracy ${fmt(cm.accuracy * 100, 1)}%.` }));

  /* precision, recall, and the AUC for each class */
  const scoreByClass = new Map(labels.map((l) => [l, new Array(y.length)]));
  {
    const folds = M.kFold(y.length, 5, M.rng(20261029));
    for (const test of folds) {
      const inTest = new Set(test);
      const trainIdx = [];
      for (let i = 0; i < y.length; i++) if (!inTest.has(i)) trainIdx.push(i);
      const std = M.standardiser(trainIdx.map((i) => X[i]));
      const trainX = trainIdx.map((i) => std(X[i]));
      const trainY = trainIdx.map((i) => y[i]);
      for (const i of test) for (const l of labels) scoreByClass.get(l)[i] = M.knnScore(trainX, trainY, std(X[i]), state.k, l);
    }
  }

  const rows2 = cm.perClass.map((c) => {
    const isPos = y.map((v) => v === c.label);
    const { auc } = M.rocAuc(scoreByClass.get(c.label), isPos);
    return {
      head: c.label,
      cells: [
        { text: String(c.support), cls: "num" },
        { text: fmt(c.recall * 100, 1) + "%", cls: "num" },
        { text: fmt(c.precision * 100, 1) + "%", cls: "num" },
        { text: fmt(auc, 4), cls: "num" },
      ],
    };
  });
  swap(
    metricsHost,
    table([{ label: "class" }, { label: "rows" }, { label: "recall" }, { label: "precision" }, { label: "AUC (one vs rest)" }], rows2, {
      caption: "Recall is the share of a class that was found; precision is the share of the predictions for it that were right",
    }),
  );

  /* the ROC curves, one per class */
  const w = W;
  const h = 320;
  const pad = { t: 14, r: 14, b: 38, l: 44 };
  const xs = scale(0, 1, pad.l, w - pad.r);
  const ys = scale(0, 1, h - pad.b, pad.t);
  const g = s("g");
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    g.append(s("line", { class: "grid-line", x1: pad.l, x2: w - pad.r, y1: ys(t), y2: ys(t) }));
    g.append(s("line", { class: "grid-line", x1: xs(t), x2: xs(t), y1: pad.t, y2: h - pad.b }));
    g.append(s("text", { x: pad.l - 6, y: ys(t) + 3, "text-anchor": "end" }, document.createTextNode(tickLabel(t))));
    g.append(s("text", { x: xs(t), y: h - pad.b + 14, "text-anchor": "middle" }, document.createTextNode(tickLabel(t))));
  }
  g.append(s("line", { class: "axis", x1: pad.l, x2: w - pad.r, y1: h - pad.b, y2: h - pad.b }));
  g.append(s("line", { class: "axis", x1: pad.l, x2: pad.l, y1: pad.t, y2: h - pad.b }));
  g.append(s("line", { class: "line dashed", x1: xs(0), y1: ys(0), x2: xs(1), y2: ys(1) }));
  g.append(s("text", { class: "label", x: (pad.l + w - pad.r) / 2, y: h - 6, "text-anchor": "middle" }, document.createTextNode("false positive rate")));
  g.append(s("text", { class: "label", x: 12, y: pad.t + 30, "text-anchor": "middle", transform: `rotate(-90 12 ${pad.t + 30})` }, document.createTextNode("true positive rate")));

  const colours = ["#14b8a6", "#99f6e4", "#fbbf24", "#f87171", "#c084fc"];
  labels.forEach((label, li) => {
    const isPos = y.map((v) => v === label);
    const pts = M.rocCurve(scoreByClass.get(label), isPos);
    const d = pts.map((p, i) => `${i ? "L" : "M"}${xs(p.fpr).toFixed(2)},${ys(p.tpr).toFixed(2)}`).join(" ");
    g.append(s("path", { d, fill: "none", stroke: colours[li % colours.length], "stroke-width": 2 }));
    const auc = M.rocAuc(scoreByClass.get(label), isPos).auc;
    g.append(
      s(
        "text",
        { x: w - pad.r - 4, y: pad.t + 14 + li * 16, "text-anchor": "end", fill: colours[li % colours.length] },
        document.createTextNode(`${label} — AUC ${fmt(auc, 3)}`),
      ),
    );
  });
  swap(rocHost, s("svg", { viewBox: `0 0 ${w} ${h}` }, g));
  document.getElementById("roc-caption").innerHTML =
    `Each class against all the others, scored by the share of the ${state.k} nearest neighbours that carry it. The diagonal is a coin toss. ` +
    `The curve, unlike the accuracy above, does not change when one class is far more common than the other.`;

  const strip = dotStrip(cv.scores);
  swap(
    cvHost,
    el(
      "div",
      {},
      el("div", { class: "cv-big" }, el("span", { class: "value", text: fmt(cv.mean * 100, 1) + "%" }), el("span", { class: "pm", text: `± ${fmt(cv.sd * 100, 1)}` })),
      el("p", { class: "cv-note", html: `accuracy across ${cv.repeats} repeats of 5-fold cross-validation, each repeat scoring every row once out of fold.` }),
      el("div", { class: "chart" }, strip),
    ),
  );
}

/* ── wiring ──────────────────────────────────────────────────────────────────────────── */

async function load(key) {
  state.key = key;
  const spec = BUILT_IN[key];
  document.querySelectorAll("#dataset-picker .chip").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.set === key)));
  const res = await fetch(spec.file, { cache: "no-store" });
  if (!res.ok) {
    document.getElementById("dataset-meta").textContent = `could not load ${spec.file} (HTTP ${res.status})`;
    return;
  }
  const raw = await res.json();
  state.data = spec.shape(raw);
  renderDataset();
}

function loadCsv(text, name) {
  const parsed = M.parseCsv(text);
  if (parsed.error) {
    document.getElementById("csv-note").textContent = `${name}: ${parsed.error}`;
    document.getElementById("csv-note").className = "hint bad";
    return;
  }
  const columns = parsed.header.map((h, j) => {
    const values = parsed.rows.map((r) => r[j]);
    const blanks = values.filter((v) => v.trim() === "").length;
    const nums = values.map((v) => (v.trim() === "" ? null : Number(v.replace(/,/g, ""))));
    const numeric = nums.every((v) => v === null || Number.isFinite(v)) && blanks < values.length;
    return numeric ? { name: h, kind: "num", values: nums } : { name: h, kind: "cat", values: values.map((v) => (v.trim() === "" ? null : v)) };
  });
  if (!columns.some((c) => c.kind === "num")) {
    document.getElementById("csv-note").textContent = `${name}: no column of numbers was found, so no statistic can be computed.`;
    document.getElementById("csv-note").className = "hint bad";
    return;
  }
  state.key = "csv";
  state.data = { label: name, columns, orderedInTime: false };
  document.querySelectorAll("#dataset-picker .chip").forEach((b) => b.setAttribute("aria-pressed", "false"));
  document.getElementById("csv-note").className = "hint";
  document.getElementById("csv-note").textContent = `${name}: ${parsed.rows.length.toLocaleString("en-CA")} rows read, ${columns.length} columns.`;
  renderDataset();
}

document.getElementById("dataset-picker").addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (btn && btn.dataset.set) load(btn.dataset.set);
});

document.getElementById("csv").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const text = await file.text();
  loadCsv(text, file.name);
});

document.getElementById("summary-col").addEventListener("change", (e) => {
  state.summaryCol = Number(e.target.value);
  renderSummary();
});

document.getElementById("model-x").addEventListener("change", (e) => {
  state.modelX = Number(e.target.value);
  renderModel();
});
document.getElementById("model-y").addEventListener("change", (e) => {
  state.modelY = Number(e.target.value);
  renderModel();
});
document.getElementById("class-target").addEventListener("change", (e) => {
  state.classTarget = e.target.value;
  renderClassify();
});
document.getElementById("class-k").addEventListener("input", (e) => {
  state.k = Number(e.target.value);
  document.getElementById("class-k-out").textContent = String(state.k);
  renderClassify();
});

/* the section links in the hero, so #data and #how land on the panel rather than the top */
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener("click", (e) => {
    const target = document.querySelector(a.getAttribute("href"));
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  });
});

/**
 * The hero's own figure — Anscombe's first set, drawn once from the shipped file. It is fetched
 * separately from the picker so that loading your own file cannot leave the hero claiming to show
 * your data, or Anscombe's, depending on what happened first.
 */
async function renderHero() {
  const host = document.getElementById("hero-plot");
  if (!host) return;
  try {
    const d = await (await fetch("data/anscombe.json", { cache: "no-store" })).json();
    const x = d.series[0].x;
    const y = d.series[0].y;
    const model = M.ols(x, y);
    swap(
      host,
      scatterChart(
        x.map((xv, i) => ({ x: xv, y: y[i], title: `(${xv}, ${y[i]})` })),
        {
          w: 420,
          h: 280,
          pad: { t: 12, r: 14, b: 30, l: 40 },
          line: { slope: model.slope, intercept: model.intercept },
          xLabel: "x",
          yLabel: "y",
          r: 3.2,
        },
      ),
    );
  } catch {
    /* the hero is an illustration; if it will not load, the rest of the page still works */
  }
}

/* open on the quartet, because its four plots are the argument the page exists to make */
renderHero();
load("anscombe");

/* the fixtures the tests read: nothing is asserted against a screenshot, and the tests import
   `stats.js` directly — but these let a browser check confirm the page rendered numbers. */
window.__dataScienceDemo = { state, ready: true };
