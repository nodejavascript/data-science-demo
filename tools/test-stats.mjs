/**
 * test-stats.mjs — proves the arithmetic, against numbers computed somewhere else.
 *
 * 🔴 THE EXPECTED VALUES ARE NOT THIS FILE'S OWN OUTPUT. They were computed from the same data
 * files with Python's `statistics` and `scipy.stats` (and, for the Anscombe quartet, against the
 * published four-decimal summary every textbook prints). A test that compares the code to itself
 * passes when the code is wrong, which is the failure this file exists to avoid.
 *
 * Run: node tools/test-stats.mjs      (exit 0 = every assertion held)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "..", "site", "data");
const M = await import(join(HERE, "..", "site", "measured.js"));

let passed = 0;
const failures = [];

function ok(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

function near(name, actual, expected, tol = 1e-6) {
  const shown = `got ${actual}, expected ${expected}`;
  ok(name, Number.isFinite(actual) && Math.abs(actual - expected) <= tol, shown);
}

const json = (f) => JSON.parse(readFileSync(join(DATA, f), "utf8"));

console.log("\nmeasured.js — the arithmetic\n");

/* 1 · the basics, by hand: the numbers 1 to 10 */
{
  const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  near("mean of 1…10 is 5.5", M.mean(v), 5.5);
  near("sample variance of 1…10 is 9.166667", M.variance(v), 9.166666666666666);
  near("sample sd of 1…10 is 3.027650", M.sd(v), 3.0276503540974917);
  near("median of 1…10 is 5.5", M.quantile(v, 0.5), 5.5);
  near("type-7 q1 of 1…10 is 3.25", M.quantile(v, 0.25), 3.25);
  near("type-7 q3 of 1…10 is 7.75", M.quantile(v, 0.75), 7.75);
  near("skewness of a symmetric set is 0", M.skewness(v), 0);
  near("excess kurtosis of 1…5 is −1.2", M.kurtosis([1, 2, 3, 4, 5]), -1.2);
}

/* 2 · missing data is counted, never silently dropped */
{
  const s = M.summarise([1, 2, null, 4, undefined, NaN, ""]);
  ok("missing values are counted and reported", s.n === 3 && s.missing === 4, `n=${s.n} missing=${s.missing}`);
  near("the mean is over the complete values only", s.mean, 7 / 3);
}

/* 3 · correlation, including ranks with ties */
{
  const x = [1, 2, 3, 4, 5];
  near("a perfect positive correlation is 1", M.pearson(x, x.map((v) => 2 * v + 1)), 1);
  near("a perfect negative correlation is −1", M.pearson(x, x.map((v) => 10 - v)), -1);
  near("Spearman with ties is rank-averaged, not first-come", M.spearman([1, 2, 2, 3], [1, 2, 3, 4]), 0.9486832980505138);
}

/* 4 · the t distribution, against scipy */
{
  near("P(|t| ≥ 2.0, df 10) = 0.07338803", M.tTwoSidedP(2.0, 10), 0.07338803477074039, 1e-12);
  near("P(|t| ≥ 2.086, df 20) = 0.04999635", M.tTwoSidedP(2.086, 20), 0.04999635445744025, 1e-12);
  near("P(|t| ≥ 3.0, df 25) = 0.00603818", M.tTwoSidedP(3.0, 25), 0.0060381795651434905, 1e-12);
  near("P(|t| ≥ 0.5, df 5) = 0.63829887", M.tTwoSidedP(0.5, 5), 0.638298871640929, 1e-12);
  near("I_x(a,b) at x=0.5, a=b is 0.5", M.incompleteBeta(3, 3, 0.5), 0.5, 1e-12);
}

/* 5 · OLS recovers a line it was given, and refuses one it cannot fit */
{
  const x = [1, 3, 5, 7, 9];
  const model = M.ols(x, x.map((v) => 3 + 2 * v));
  near("a noiseless line gives back its slope", model.slope, 2, 1e-9);
  near("a noiseless line gives back its intercept", model.intercept, 3, 1e-9);
  near("a noiseless line has R² = 1", model.r2, 1, 1e-12);
  near("a noiseless line has no residual error", model.residualSe, 0, 1e-12);
  const flat = M.ols([2, 2, 2, 2], [1, 2, 3, 4]);
  ok("a constant predictor is refused, not faked", Boolean(flat.error), JSON.stringify(flat).slice(0, 60));
}

/* 6 · ANSCOMBE'S QUARTET — four datasets whose summary statistics agree and whose pictures do not */
{
  const ans = json("anscombe.json");
  const models = ans.series.map((s) => M.ols(s.x, s.y));
  const sums = ans.series.map((s) => M.summarise(s.x));
  const ys = ans.series.map((s) => M.summarise(s.y));

  ok("all four x columns have mean 9", sums.every((s) => Math.abs(s.mean - 9) < 1e-12));
  ok("all four x columns have variance 11", sums.every((s) => Math.abs(s.variance - 11) < 1e-12));
  ok(
    "every y column has mean 7.5 to two places",
    ys.every((s) => Math.abs(s.mean - 7.5) < 0.00091),
    ys.map((s) => s.mean.toFixed(6)).join(" "),
  );
  near("set 1 mean y is 7.500909", ys[0].mean, 7.500909090909093);
  near("set 3 mean y is 7.500000", ys[2].mean, 7.5);
  ok(
    "every slope is 0.50 to two places",
    models.every((m) => Math.abs(m.slope - 0.5) < 0.0006),
    models.map((m) => m.slope.toFixed(6)).join(" "),
  );
  near("set 1 slope is 0.500091", models[0].slope, 0.5000909090909091, 1e-12);
  near("set 3 slope is 0.499727", models[2].slope, 0.49972727272727274, 1e-12);
  ok(
    "every correlation is 0.816 to three places",
    ans.series.every((s) => Math.abs(M.pearson(s.x, s.y) - 0.816) < 0.001),
    ans.series.map((s) => M.pearson(s.x, s.y).toFixed(6)).join(" "),
  );
  near("set 1 correlation is 0.816421", M.pearson(ans.series[0].x, ans.series[0].y), 0.81642051634484, 1e-12);
  near("set 4 correlation is 0.816521", M.pearson(ans.series[3].x, ans.series[3].y), 0.8165214368885029, 1e-12);

  /* …and the four residual sets look nothing alike. That difference is the point of the quartet:
     the summary agrees while the data does not. */
  const residualSd = models.map((m) => M.sd(m.residuals));
  ok(
    "all four residual standard deviations agree to 0.002",
    Math.max(...residualSd) - Math.min(...residualSd) < 0.002,
    residualSd.map((v) => v.toFixed(4)).join(" "),
  );
  const worst = models.map((m) => Math.max(...m.residuals.map(Math.abs)));
  near("set 3 carries a point 3.241 off the line", worst[2], 3.2410909090909093, 1e-9);
  ok(
    "no other set has a residual over 2",
    worst[0] < 2 && worst[1] < 2 && worst[3] < 2,
    worst.map((v) => v.toFixed(3)).join(" "),
  );
}

/* 7 · Fisher's iris, against Python */
{
  const iris = json("iris.json");
  const col = (i) => iris.rows.map((r) => r[i]);
  const sLen = M.summarise(col(0));
  near("iris sepal length mean is 5.843333", sLen.mean, 5.843333333333334);
  near("iris sepal length sd is 0.828066", sLen.sd, 0.828066127977863);
  near("iris sepal width mean is 3.057333", M.summarise(col(1)).mean, 3.0573333333333337);
  near("iris petal length mean is 3.758000", M.summarise(col(2)).mean, 3.758);
  near("iris petal length sd is 1.765298", M.summarise(col(2)).sd, 1.7652982332594664);
  near("iris petal width sd is 0.762238", M.summarise(col(3)).sd, 0.7622376689603466);
  const { x, y } = M.pairs(col(0), col(2));
  near("iris corr(sepal length, petal length) is 0.8717538", M.pearson(x, y), 0.8717537758865833, 1e-10);
  ok("iris is 150 rows across three species", iris.rows.length === 150 && new Set(iris.rows.map((r) => r[4])).size === 3);
}

/* 8 · Old Faithful, against Python — and the regression's own uncertainty */
{
  const f = json("faithful.json");
  const e = f.rows.map((r) => r[0]);
  const w = f.rows.map((r) => r[1]);
  near("faithful is 272 eruptions", e.length, 272);
  near("mean eruption length is 3.487783 min", M.mean(e), 3.487783088235294, 1e-12);
  near("mean waiting time is 70.897059 min", M.mean(w), 70.8970588235294, 1e-12);
  near("sd of eruption length is 1.141371", M.sd(e), 1.141371251105208, 1e-12);
  near("corr(eruptions, waiting) is 0.9008112", M.pearson(e, w), 0.9008111683218128, 1e-10);

  const model = M.ols(e, w);
  near("waiting = 33.47 + 10.73 × eruptions (slope)", model.slope, 10.729641395133523, 1e-9);
  near("…(intercept)", model.intercept, 33.47439702275336, 1e-9);
  near("…R² is 0.8114608", model.r2, 0.8114607609733095, 1e-9);
  ok("the slope's standard error is small but not zero", model.seSlope > 0.1 && model.seSlope < 0.6, String(model.seSlope));
  ok("the slope is far from zero on this data", model.pSlope < 1e-30, String(model.pSlope));
  ok("residual standard error equals the printed value", Math.abs(model.residualSe - Math.sqrt(model.sse / model.df)) < 1e-12);
}

/* 9 · Palmer penguins — the dataset with holes in it */
{
  const p = json("penguins.json");
  const bill = p.rows.map((r) => r[0]);
  const sex = p.rows.map((r) => r[6]);
  near("penguins is 344 rows", p.rows.length, 344);
  ok("bill length has 2 missing values", M.clean(bill).missing === 2, String(M.clean(bill).missing));
  ok("sex has 11 missing values", M.clean(sex.map((v) => (v ? 1 : null))).missing === 11);
  ok("a complete-case analysis uses 342 rows", M.clean(bill).kept.length === 342);
}

/* 10 · the histogram draws every point exactly once */
{
  const iris = json("iris.json");
  const h = M.histogram(iris.rows.map((r) => r[0]));
  const total = h.bins.reduce((a, b) => a + b.count, 0);
  ok("histogram counts sum to n", total === 150, `${total}`);
  ok("the bin rule is Freedman–Diaconis on this column", h.rule === "Freedman–Diaconis", h.rule);
  ok("the bins are contiguous", h.bins.every((b, i) => i === 0 || Math.abs(b.lo - h.bins[i - 1].hi) < 1e-9));
  const flat = M.histogram([5, 5, 5, 5, 5, 5]);
  ok("a constant column still draws one bar", flat.bins.length === 1 && flat.bins[0].count === 6);
}

/* 11 · classification metrics: chance, perfection, and the reverse */
{
  ok("perfectly separable scores give AUC 1", Math.abs(M.rocAuc([0.9, 0.8, 0.2, 0.1], [true, true, false, false]).auc - 1) < 1e-12);
  ok("reversed scores give AUC 0", Math.abs(M.rocAuc([0.1, 0.2, 0.8, 0.9], [true, true, false, false]).auc) < 1e-12);
  ok("an uninformative score gives AUC 0.5", Math.abs(M.rocAuc([0.5, 0.5, 0.5, 0.5], [true, true, false, false]).auc - 0.5) < 1e-12);
  const cm = M.confusionMatrix(["a", "a", "b", "b"], ["a", "b", "b", "b"], ["a", "b"]);
  ok("the confusion matrix counts both kinds of error", cm.matrix[0][0] === 1 && cm.matrix[0][1] === 1 && cm.matrix[1][1] === 2);
  ok("accuracy is correct over total", Math.abs(cm.accuracy - 0.75) < 1e-12);
  const a = cm.perClass.find((c) => c.label === "a");
  ok("per-class recall for a is 1/2", Math.abs(a.recall - 0.5) < 1e-12);
  ok("per-class precision for a is 1", Math.abs(a.precision - 1) < 1e-12);
}

/* 12 · the splitter is seeded, covers every row, and does not depend on luck we cannot repeat */
{
  const folds = M.kFold(20, 5, M.rng(7));
  const seen = folds.flat().sort((a, b) => a - b);
  ok("the folds cover every row exactly once", JSON.stringify(seen) === JSON.stringify([...Array(20).keys()]));
  ok("the folds are the same on a second run with the same seed", JSON.stringify(M.kFold(20, 5, M.rng(7))) === JSON.stringify(folds));
  ok("a different seed gives a different split", JSON.stringify(M.kFold(20, 5, M.rng(8))) !== JSON.stringify(folds));
}

/* 13 · cross-validation: honest about the spread */
{
  const f = json("faithful.json");
  const cv = M.cvRegression(f.rows.map((r) => r[0]), f.rows.map((r) => r[1]), { k: 5, repeats: 10, seed: 20261029 });
  ok("cross-validation produced 50 folds", cv.folds === 50, String(cv.folds));
  ok("the mean out-of-fold RMSE is between 5 and 8 minutes", cv.mean > 5 && cv.mean < 8, String(cv.mean));
  ok("the spread across folds is reported and non-zero", cv.sd > 0, String(cv.sd));
  ok("every fold scored, none skipped", cv.scores.every((s) => Number.isFinite(s) && s > 0));
  const again = M.cvRegression(f.rows.map((r) => r[0]), f.rows.map((r) => r[1]), { k: 5, repeats: 10, seed: 20261029 });
  ok("the same seed reproduces the same score exactly", again.mean === cv.mean);
}

/* 14 · k-nearest-neighbours on iris, and a score that is honest about its own errors */
{
  const iris = json("iris.json");
  const X = iris.rows.map((r) => r.slice(0, 4));
  const y = iris.rows.map((r) => r[4]);
  const cv = M.cvKnn(X, y, { k: 5, repeats: 5, neighbours: 5, seed: 20261029 });
  ok("k-NN cross-validation gave one accuracy per repeat", cv.scores.length === 5, String(cv.scores.length));
  ok("iris scores between 0.93 and 0.98 at 5 neighbours", cv.mean > 0.93 && cv.mean < 0.98, String(cv.mean));
  ok("…and the spread across repeats is reported", cv.sd > 0, String(cv.sd));
  const first = M.confusionMatrix(y, cv.firstRunPredictions, ["setosa", "versicolor", "virginica"]);
  ok(
    "nearly every error is between the two similar species",
    first.matrix[1][0] + first.matrix[1][2] + first.matrix[2][0] + first.matrix[2][1] >= first.total - first.correct - 1,
  );
  /* The one setosa this classifier gets wrong is row 41 — sepal 4.5 × 2.3 mm, an unusually narrow
     flower whose five nearest neighbours include three versicolor. That is a fact about the data,
     not a fault in the code, so the test asserts it rather than wishing it away. */
  const wrongSetosa = y.map((v, i) => i).filter((i) => y[i] === "setosa" && cv.firstRunPredictions[i] !== "setosa");
  ok(
    "the one setosa error is the 2.3 mm sepal row",
    wrongSetosa.length <= 1 && (wrongSetosa.length === 0 || X[wrongSetosa[0]][1] === 2.3),
    JSON.stringify(wrongSetosa.map((i) => X[i])),
  );
}

/* 15 · the CSV reader refuses to guess */
{
  const good = M.parseCsv('a,b\n1,2\n3,4\n');
  ok("a clean file gives two data rows", good.rows.length === 2 && good.header[1] === "b");
  const quoted = M.parseCsv('name,note\n"Smith, J","he said ""hi"""\n');
  ok("quoted commas and doubled quotes survive", quoted.rows[0][0] === "Smith, J" && quoted.rows[0][1] === 'he said "hi"');
  const crlf = M.parseCsv("a,b\r\n1,2\r\n");
  ok("CRLF files read the same", crlf.rows.length === 1 && crlf.rows[0][1] === "2");
  const bad = M.parseCsv("a,b\n1,2,3\n");
  ok("a ragged row is refused with its line number", Boolean(bad.error) && bad.error.includes("row 2"), bad.error);
  const bom = M.parseCsv('\uFEFFa,b\n1,2\n');
  ok("a byte-order mark does not corrupt the first header", bom.header[0] === "a", JSON.stringify(bom.header));
}

console.log(`\n${passed} assertions held, ${failures.length} failed`);
if (failures.length) {
  console.log("FAILED: " + failures.join(" · "));
  process.exit(1);
}
