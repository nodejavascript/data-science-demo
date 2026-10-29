/* verify-render.mjs — the page as a BROWSER runs it, which is the only half a served-page check
 * cannot reach. `tools/test-stats.mjs` proves the arithmetic; this proves the page actually calls
 * it and draws what came back.
 *
 *     python3 tools/serve.py 8161 &
 *     node tools/verify-render.mjs            # default http://127.0.0.1:8161/
 *     node tools/verify-render.mjs --selftest # prove this check can fail
 *
 * 🔴 IT DRIVES ITS OWN HEADLESS CHROME, in a temporary profile, and never touches the browser the
 * owner is using. It speaks the DevTools protocol directly — no puppeteer, no playwright, nothing
 * to install — and it fails on a console error or an uncaught exception, because a page that
 * renders half of itself and throws in the middle is exactly the failure a screenshot hides.
 *
 * 🔴 AND THE VALUES IT ASSERTS ARE THE ONES THE ARITHMETIC TESTS ALREADY PROVED: the mean of
 * Anscombe's x1 is 9, the correlation of set 1 is 0.8164, iris sepal length averages 5.8433.
 * If the page is wired to the wrong column, or to a constant, or to nothing, those numbers stop
 * appearing — which is the claim "every figure is computed from the data" made checkable.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const SELFTEST = args.includes("--selftest");
const URL_BASE = (args.find((a) => a.startsWith("http")) || "http://127.0.0.1:8161/").replace(/\/$/, "");

const CHROME =
  process.env.CHROME_PATH ||
  ["/home/geooogle/.local/bin/google-chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(Boolean);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${!ok && detail ? " — " + detail : ""}`);
  if (!ok) failures++;
};

/* ── the browser, over the DevTools protocol ─────────────────────────────────────────── */

function launch() {
  const profile = mkdtempSync(join(tmpdir(), "dsd-render-"));
  const child = spawn(
    CHROME,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--disable-client-side-phishing-detection",
      "--disable-domain-reliability",
      "--disable-breakpad",
      "--no-pings",
      "--no-service-autorun",
      "--metrics-recording-only",
      "--disable-features=OptimizationHints,Translate,MediaRouter",
      "--window-size=1280,900",
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const out = [];
  child.stdout.on("data", (d) => out.push(d.toString()));
  child.stderr.on("data", (d) => out.push(d.toString()));
  return { child, profile, out };
}

async function port(proc) {
  const file = join(proc.profile, "DevToolsActivePort");
  for (let i = 0; i < 200; i++) {
    try {
      const [p] = readFileSync(file, "utf8").split("\n");
      if (p) return Number(p);
    } catch {
      /* not written yet */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Chrome never opened its debugging port:\n" + proc.out.join(""));
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(fn) {
    this.listeners.push(fn);
  }
  close() {
    try {
      this.ws.close();
    } catch {
      /* already gone */
    }
  }
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", () => rej(new Error("websocket refused: " + url)), { once: true });
  });
  return new CDP(ws);
}

/* ── the run ─────────────────────────────────────────────────────────────────────────── */

const proc = launch();
let cdp;
let session;
const consoleErrors = [];
const exceptions = [];

try {
  const p = await port(proc);
  const list = await (await fetch(`http://127.0.0.1:${p}/json/version`)).json();
  cdp = await connect(list.webSocketDebuggerUrl);
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  ({ sessionId: session } = await cdp.send("Target.attachToTarget", { targetId, flatten: true }));

  cdp.on((msg) => {
    if (msg.sessionId !== session) return;
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error")
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(" "));
    if (msg.method === "Runtime.exceptionThrown")
      exceptions.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  });

  await cdp.send("Page.enable", {}, session);
  await cdp.send("Runtime.enable", {}, session);

  const evaluate = async (expression) => {
    const res = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, session);
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    return res.result.value;
  };

  const navigate = async (url, settleMs = 900) => {
    await cdp.send("Page.navigate", { url }, session);
    /* the page loads a JSON file and then draws; the settle is a wait for that, not for the load
       event, because the load event fires before the first fetch resolves */
    await new Promise((r) => setTimeout(r, settleMs));
  };

  const text = (sel) => evaluate(`(document.querySelector(${JSON.stringify(sel)})||{}).innerText || ""`);
  const count = (sel) => evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
  const rowValue = (tableSel, rowHead) =>
    evaluate(`(() => {
      const rows = [...document.querySelectorAll(${JSON.stringify(tableSel)} + " tbody tr")];
      const row = rows.find((r) => (r.querySelector("th") || {}).innerText === ${JSON.stringify(rowHead)});
      const cell = row && row.querySelectorAll("td")[0];
      return cell ? cell.innerText.trim() : null;
    })()`);

  console.log("\nthe page in a real browser — headless Chrome, its own profile\n");

  await navigate(URL_BASE + "/" + (SELFTEST ? "?selftest=1" : ""));

  /* 1 · it ran at all, and said nothing while running */
  const ready = await evaluate("Boolean(window.__dataScienceDemo && window.__dataScienceDemo.ready)");
  check("the app module executed", ready === true);
  check("no uncaught exception", exceptions.length === 0, exceptions.join(" | "));
  check("no console error", consoleErrors.length === 0, consoleErrors.join(" | "));

  /* 2 · the summary is real: Anscombe's x1 has mean 9 and variance 11 by construction */
  check("the summary table is drawn", (await count("#summary-table tbody tr")) >= 10);
  const mean = await rowValue("#summary-table", "mean");
  check("the mean of x1 reads 9.0000 — computed, not written into the page", mean === "9.0000", String(mean));
  const variance = await rowValue("#summary-table", "variance");
  check("the variance of x1 reads 11.0000", variance === "11.0000", String(variance));
  check("the histogram drew bars", (await count("#hist svg rect.bar")) >= 1);
  check("the box plot is drawn", (await count("#box svg")) === 1);
  check("the histogram caption names the bin rule", (await text("#hist-caption")).includes("Freedman"));

  /* 3 · the quartet: four scatters, and the summary that four datasets share */
  check("four scatters are drawn", (await count("#quartet-plots svg")) === 4);
  const quartet = await text("#quartet-table");
  check("the quartet table carries the shared correlation 0.8164", quartet.includes("0.8164"), quartet.slice(0, 80));
  check("every one of the four sets shows that correlation", (quartet.match(/0\.816\d/g) || []).length === 4);

  /* 4 · the fitted line, its uncertainty, and the assumptions */
  const slope = await rowValue("#model-table", "slope");
  check("a slope is printed", slope !== null && slope.length > 0, String(slope));
  const se = await rowValue("#model-table", "se(slope)");
  check("the slope's standard error is printed beside it", se !== null && se !== "0.0000", String(se));
  check("the residual plot is drawn", (await count("#resid-plot svg circle.pt")) > 0);
  check("cross-validation printed a mean and a spread", /±/.test(await text("#cv-out")));
  check("all five assumptions are stated", (await count("#assumption-out .assumption")) === 5);

  /* 5 · a different dataset, through the picker — the path a reader actually takes */
  await evaluate(`document.querySelector('.chip[data-set="iris"]').click()`);
  await new Promise((r) => setTimeout(r, 900));
  check("choosing iris reloads the page's data", (await text("#dataset-meta")).includes("150"));
  const irisMean = await rowValue("#summary-table", "mean");
  check("iris sepal length averages 5.8433", irisMean === "5.8433", String(irisMean));
  check("iris draws a confusion matrix", (await count("#cm tbody tr")) === 4);
  check("the ROC curves are drawn, one per class", (await count("#roc svg path[stroke]")) >= 3);
  check("the classifier's accuracy is printed with its spread", /%/.test(await text("#class-cv")) && /±/.test(await text("#class-cv")));

  /* 6 · the neighbour count is a live control, not decoration */
  await evaluate(`(() => { const k = document.getElementById("class-k"); k.value = "3"; k.dispatchEvent(new Event("input")); })()`);
  await new Promise((r) => setTimeout(r, 400));
  check("changing the neighbour count redraws the classifier", (await text("#class-note")).includes("3 neighbours"));

  /* 7 · penguins: the dataset with holes in it */
  await evaluate(`document.querySelector('.chip[data-set="penguins"]').click()`);
  await new Promise((r) => setTimeout(r, 900));
  check("penguins reports its missing values rather than dropping them quietly", (await text("#dataset-meta")).includes("missing"));

  /* 8 · a visitor's own file, through the real file input — the path a static check cannot reach */
  await evaluate(`(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["height,weight\\n170,68\\n172,71\\n165,60\\n180,82\\n168,65\\n"], "own.csv", { type: "text/csv" }));
    const input = document.getElementById("csv");
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
  })()`);
  await new Promise((r) => setTimeout(r, 700));
  check("a dropped-in file is read in the browser", (await text("#dataset-meta")).includes("own.csv"));
  check("…and its rows are counted", (await text("#dataset-meta")).includes("5 rows"));
  const ownMean = await rowValue("#summary-table", "mean");
  check("…and its statistics are computed: height mean is 171.0000", ownMean === "171.0000", String(ownMean));

  /* 9 · the cookie gate opened, because a fresh profile has said nothing yet */
  check("the cookie panel opened on a first visit", (await count("#consentBar .consentAsk")) === 1);

  /* 10 · the handset width — a page that scrolls sideways on a phone is a fault no desktop check sees */
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, session);
  await new Promise((r) => setTimeout(r, 300));
  const overflow = await evaluate("({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth })");
  check("nothing overflows the viewport at 390 pixels", overflow.scroll <= overflow.inner + 1, JSON.stringify(overflow));
  /* 🔴 AND THE SECOND HALF IS A REAL ASSERTION, NOT A TAUTOLOGY. `scrollWidth >= clientWidth` is
   * true of every element ever made; what must hold is that the wide table is SCROLLABLE rather than
   * pushing the page, so the computed overflow is read. */
  const contained = await evaluate(`(() => {
    const t = document.querySelector(".table-wrap");
    if (!t) return "no table";
    return getComputedStyle(t).overflowX;
  })()`);
  check("…and a wide table is contained by a scrolling box", contained === "auto" || contained === "scroll", String(contained));
  await cdp.send("Emulation.clearDeviceMetricsOverride", {}, session);

  /* 11 · the selftest: a fault the checks above must catch */
  if (SELFTEST) {
    const caught = [];
    const expectFail = (name, ok) => {
      if (!ok) caught.push(name);
    };
    await evaluate(`document.querySelectorAll("#hist svg rect.bar").forEach((b) => b.setAttribute("class", ""))`);
    expectFail("histogram bars", (await count("#hist svg rect.bar")) >= 1);
    await evaluate(`document.querySelectorAll("#hist svg rect").forEach((b) => b.setAttribute("class", "bar"))`);
    check("the selftest's injected fault was caught and then repaired", caught.length === 1 && (await count("#hist svg rect.bar")) >= 1);
  }
} catch (err) {
  check("the browser run completed", false, String(err && err.message));
} finally {
  try {
    cdp && (await cdp.send("Browser.close")).catch?.(() => {});
  } catch {
    /* the browser may already be gone */
  }
  try {
    cdp && cdp.close();
  } catch {
    /* already closed */
  }
  /* 🔴 KILL, WAIT FOR THE EXIT, *THEN* DELETE. The first version killed the browser and removed the
   * profile in the same tick, and left a `dsd-render-*` directory in /tmp on every run because
   * Chrome was still writing its profile when the delete ran. Data science demo here on 29 October 2026. */
  try {
    proc.child.kill("SIGKILL");
    await new Promise((res) => {
      if (proc.child.exitCode !== null) return res();
      const t = setTimeout(res, 2000);
      proc.child.once("exit", () => {
        clearTimeout(t);
        res();
      });
    });
  } catch {
    /* already dead */
  }
  try {
    rmSync(proc.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* a temp directory that will not delete is not a test failure */
  }
}

console.log();
if (failures) {
  console.log(`  ${failures} check(s) FAILED — the page does not render what it claims.`);
  process.exit(1);
}
console.log("  RENDER OK — the page draws real numbers in a real browser");
process.exit(0);
