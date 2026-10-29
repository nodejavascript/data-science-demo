/* live-check.mjs — the DEPLOYED host, read from outside, the way a stranger's browser sees it.
 *
 *     node tools/live-check.mjs                        # the live host
 *     node tools/live-check.mjs http://127.0.0.1:8161   # or a local server
 *
 * This is the half the other checks cannot reach. `test-stats.mjs` proves the arithmetic,
 * `check-page.py` proves the page the server sends is the one the rules describe, and
 * `verify-render.mjs` proves a browser runs it. **None of them can tell you that the deploy
 * happened** — a stale document root, an edge that cached the old shell, a Caddy block that never
 * reloaded and a sitemap still naming the old host all look perfect from the repository.
 *
 * Exit 0 = the live host matches the files. Exit 1 = it does not, and it names what differs.
 */
const BASE = (process.argv[2] || "https://data-science-demo.nodejavascript.com").replace(/\/$/, "");
const HOST = new URL(BASE).host;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${!ok && detail ? " — " + detail : ""}`);
  if (!ok) failures++;
};

async function get(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*", ...(opts.headers || {}) },
    redirect: opts.redirect || "follow",
  });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

console.log(`\nlive check — ${BASE}\n`);

/* 1 · the shell, and the three headers that make a deploy visible */
{
  const r = await get("/");
  check("the home page answers 200", r.status === 200, `HTTP ${r.status}`);
  const title = (r.body.match(/<title>(.*?)<\/title>/s) || [])[1] || "";
  check("the title is the full host", title.trim() === HOST, JSON.stringify(title.trim()));
  check("the page sends no-store, so a deploy is visible at once", /no-store/i.test(r.headers.get("cache-control") || ""), r.headers.get("cache-control"));
  check("exactly one h1", (r.body.match(/<h1[^>]*>/g) || []).length === 1);
  check("a self-referencing canonical", r.body.includes(`rel="canonical" href="https://${HOST}/"`));
  check("no analytics tag in the document (the gate creates it)", !r.body.includes("googletagmanager"));
  check("a measurement id is set", /data-ga-id="G-[A-Z0-9]+"/.test(r.body), (r.body.match(/data-ga-id="[^"]*"/) || [])[0]);
  check("the consent gate is loaded", r.body.includes("./consent.js"));
  check("the fault reporter is loaded", r.body.includes('src="/rollbar.js"'));
}

/* 2 · the files the page names, at the type a browser needs */
{
  for (const [path, type] of [
    ["/stats.js", "javascript"],
    ["/app.js", "javascript"],
    ["/consent.js", "javascript"],
    ["/rollbar.js", "javascript"],
    ["/styles.css", "css"],
    ["/favicon.svg", "svg"],
    ["/favicon-180.png", "png"],
    ["/manifest.webmanifest", "manifest"],
  ]) {
    const r = await get(path);
    check(`${path} answers 200 as ${type}`, r.status === 200 && (r.headers.get("content-type") || "").includes(type), `${r.status} ${r.headers.get("content-type")}`);
  }
}

/* 3 · the data — a page whose datasets 404 is an empty shell that looks fine */
{
  for (const [file, rows] of [["anscombe", 11], ["iris", 150], ["faithful", 272], ["penguins", 344]]) {
    const r = await get(`/data/${file}.json`);
    let n = -1;
    try {
      const d = JSON.parse(r.body);
      n = d.rows ? d.rows.length : d.series[0].x.length;
    } catch {
      /* reported below */
    }
    check(`data/${file}.json answers with ${rows} rows`, r.status === 200 && n === rows, `got ${n}`);
  }
}

/* 4 · the two files a crawler reads, and the repair for a link somebody already has */
{
  const sitemap = await get("/sitemap.xml");
  check("sitemap.xml answers and names this host", sitemap.status === 200 && sitemap.body.includes(`https://${HOST}/`), `HTTP ${sitemap.status}`);
  check("sitemap.xml carries exactly one <loc>", (sitemap.body.match(/<loc>/g) || []).length === 1);
  const robots = await get("/robots.txt");
  check("robots.txt answers and points at the sitemap", robots.status === 200 && robots.body.includes(`https://${HOST}/sitemap.xml`), `HTTP ${robots.status}`);
  const privacy = await get("/privacy", { redirect: "manual" });
  check("/privacy redirects to the section on the page", [301, 302, 307, 308].includes(privacy.status), `HTTP ${privacy.status}`);
}

/* 5 · the identity, so a redeploy cannot quietly bring back a colour the register has taken */
{
  const r = await get("/");
  const theme = (r.body.match(/name="theme-color" content="([^"]+)"/) || [])[1];
  check("the theme colour is this site's own fuchsia", theme === "#d946ef", String(theme));
}

console.log();
if (failures) {
  console.log(`  ${failures} check(s) FAILED — the live host does not match the repository.`);
  process.exit(1);
}
console.log("  LIVE OK — the deployed host matches the files");
