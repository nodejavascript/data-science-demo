# data-science-demo.nodejavascript.com

**A number you cannot check is an opinion** — so this page checks its own numbers in front of you.
Pick one of four published datasets, or drop in your own file, and every statistic is computed in
your browser from that data: the arithmetic is printed with the numbers substituted, the convention
is named where more than one exists, and every estimate arrives with its uncertainty beside it.
Nothing is uploaded, because there is nowhere for it to go.

That belief forbids things, which is the test of whether it is a belief at all:

- **no figure on this page is typed in by hand.** Every number comes from `site/stats.js`, called
  with the loaded data. The page cannot disagree with its own tests, because it runs the same code.
- **no estimate is printed without its uncertainty.** A slope without a standard error, or a
  cross-validated score without its spread across repeats, is exactly the number this page refuses
  to print alone.
- **no missing value is quietly dropped.** The count of holes is printed, and so is which rows each
  statistic used.
- **no conclusion is drawn for you.** The assumption checks say what they measured and what they
  could not measure — and one of them always says "not checkable here".

## What it does

| Panel | What is computed |
|---|---|
| **1 · The data** | four published datasets, plus your own comma-separated file, read in the browser |
| **2 · One column** | n, mean, median, SD, variance, quartiles, IQR, min/max, skewness, kurtosis, standard error of the mean; a Freedman–Diaconis histogram and a box plot |
| **3 · Anscombe's quartet** | four scatters that share their mean, variance, correlation and fitted line to three decimals — recomputed here, not quoted |
| **4 · A fitted line** | ordinary least squares with standard errors, t statistics and p-values from the incomplete beta function, R², adjusted R², residual standard error, a residual plot, 20 repeats of 5-fold cross-validation, and five assumption checks including leverage |
| **5 · Classification** | k-nearest neighbours with repeated k-fold cross-validation, a confusion matrix, per-class recall, precision and one-vs-rest AUC, and the ROC curves |

## How to run it

```bash
python3 tools/serve.py 8161     # http://127.0.0.1:8161
```

or with the container in `docker-compose.yml`.

## How it is proved

Three checks, run in this order — the arithmetic, the cookie gate, the page, then the page in a
real browser:

The last two need the site being served (`python3 tools/serve.py 8161 &`).

```bash
npm test                   # 89 assertions, the cookie gate, and the served page
npm run test:e2e           # headless Chrome: does the page draw real numbers?
node tools/verify-render.mjs --selftest   # …and can that check actually fail?
npm run test:live          # the DEPLOYED host: files, headers, data, sitemap, identity
```

`npm run test:live` is the one that proves a deploy happened — a stale document root, an edge
holding an old shell or a sitemap naming the old host all look perfect from the repository.

**The expected values in `tools/test-stats.mjs` were computed somewhere else** — in Python, with
`statistics` and `scipy.stats`, and against the four-decimal summary of Anscombe's quartet that
every textbook prints. A test that compares the code to itself passes when the code is wrong.

**The render check runs its own headless Chrome in a temporary profile** and speaks the DevTools
protocol directly: no puppeteer, no playwright, nothing to install, and it never touches the browser
you are using. It fails on a console error or an uncaught exception, because a page that draws half
of itself and throws in the middle is what a screenshot hides.

## The datasets, and their papers

| dataset | source |
|---|---|
| Anscombe's quartet (1973) | F. J. Anscombe, “Graphs in Statistical Analysis”, *The American Statistician* 27(1), 17–21 |
| Fisher's iris (1936) | R. A. Fisher, *Annals of Eugenics* 7(2), 179–188; measured by Edgar Anderson |
| Old Faithful (1990) | A. Azzalini & A. W. Bowman, *Applied Statistics* 39, 357–365 |
| Palmer penguins (2014) | K. B. Gorman, T. D. Williams & W. R. Fraser, *PLOS ONE* 9(3): e90081 |

Each is shipped as JSON under `site/data/`, with the missing measurements left missing — the
penguins have 2 blank bill measurements and 11 blank sexes, and the page reports both rather than
quietly completing the cases.

## The conventions, named

Where a statistic has more than one defensible definition, the page says which one it used:

- **standard deviation** — the n − 1 denominator, because these are samples.
- **quantiles** — Hyndman & Fan type 7, which is what R's `quantile`, NumPy's default and Excel's
  `QUARTILE.INC` produce, so the same number appears if you check it elsewhere.
- **skewness** — the adjusted sample moment G1 (`bias=False` in SciPy).
- **kurtosis** — *excess* kurtosis, so a normal distribution is 0 and not 3.
- **correlation** — Pearson's, unless it says Spearman, which is Pearson's on averaged ranks.
- **cross-validation** — one score per repeat over all out-of-fold predictions, because the folds of
  one split are not independent and their spread is not the uncertainty of the estimate.

## What this is not

It is a workbench, not a statistics package. There is no multiple regression, no mixed model, no
random effect, no survival analysis, no formal normality test, and no time series. Where a check
cannot be made from the data at hand it says so instead of approximating — the independence
assumption is only testable on the one dataset here that records the order its rows were taken.

## Layout

```
site/                      the page and the arithmetic
  stats.js              the statistics — no DOM, no dependencies, imported by the tests
  app.js                   the page: reads data, calls stats.js, draws what came back
  data/                    the four datasets, as JSON
  consent.js               the cookie gate; creates the analytics tag only after a yes
tools/                     the checks, the dev server, the icon generator
```

## Licence

MIT.
