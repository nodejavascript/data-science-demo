/* Test the REAL consent.js — not a copy of it — in a stub DOM, for the paths a served-page check
 * cannot reach without a click: a visitor who answered YES, one who answered NO, and the owner's
 * own ?ga=off switch. It also proves the empty-id case, which is the state of this build.
 *
 *     node tools/test-consent.mjs
 *
 * The refusal half — no request to Google before a yes — is proved twice: here (no tag is created)
 * and in the served-page check (the tag is not in the document at all).
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(here, "..", "site", "consent.js"), "utf8");

let failures = 0;
const check = (name, ok) => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}`);
  if (!ok) failures++;
};

const KEY = "data-science-demo.consent";
const ID = "G-TESTID123";

function run(choice, query, id = ID) {
  const created = [];
  const store = new Map(choice ? [[KEY, choice]] : []);

  const el = (tag) => {
    const node = {
      tagName: tag,
      attrs: {},
      children: [],
      style: { setProperty() {} },
      setAttribute(k, v) {
        node.attrs[k] = String(v);
      },
      getAttribute(k) {
        return k in node.attrs ? node.attrs[k] : null;
      },
      hasAttribute(k) {
        return k in node.attrs;
      },
      appendChild(c) {
        node.children.push(c);
        created.push(c);
      },
      remove() {},
      querySelector() {
        return null;
      },
      closest() {
        return null;
      },
      addEventListener() {},
      set innerHTML(v) {
        node._html = v;
      },
      get innerHTML() {
        return node._html || "";
      },
    };
    return node;
  };

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    CustomEvent: class CustomEvent {
      constructor(type, opts) {
        this.type = type;
        this.detail = opts && opts.detail;
      }
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    },
    document: {
      currentScript: { getAttribute: (k) => (k === "data-ga-id" ? id : null) },
      readyState: "complete",
      createElement: el,
      head: { appendChild: (c) => created.push(c) },
      body: { appendChild: (c) => created.push(c) },
      documentElement: { style: { setProperty() {} } },
      querySelector: () => null,
      addEventListener() {},
      dispatchEvent() {},
    },
    window: {
      addEventListener() {},
      dispatchEvent() {},
      location: { search: query || "" },
      dataLayer: undefined,
      // 🔴 THE TWO ARGUMENTS PASSED TO A PUSHED `arguments` OBJECT. In a browser `gtag` pushes the
      // real `arguments`; the stub keeps it working so "config was called with the id" is testable.
    },
  };
  sandbox.window.window = sandbox.window;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "consent.js" });

  const tags = created.filter((c) => c && typeof c.src === "string" && c.src.includes("googletagmanager.com"));
  return { sandbox, tags, store };
}

console.log("consent.js — the real file, in a stub DOM\n");

/* 1 · a visitor who has not answered: nothing is loaded */
{
  const { tags, sandbox } = run(null);
  check("no choice stored  →  no analytics tag is created", tags.length === 0);
  check("no choice stored  →  no gtag function is defined", sandbox.window.gtag === undefined);
}

/* 2 · a yes loads this site's own property, from the script's own data attribute */
{
  const { tags, sandbox } = run("granted");
  check("granted            →  exactly one analytics tag", tags.length === 1, );
  check("granted            →  the tag is the id the page declares", tags.length === 1 && tags[0].src.endsWith(ID));
  check("granted            →  the tag is async", tags.length === 1 && tags[0].async === true);
  check("granted            →  gtag is defined", typeof sandbox.window.gtag === "function");
  const calls = (sandbox.window.dataLayer || []).map((a) => Array.from(a));
  check("granted            →  config was called with the id", calls.some((c) => c[0] === "config" && c[1] === ID));
}

/* 3 · a no loads nothing and sets the belt-and-braces disable flag */
{
  const { tags, sandbox, store } = run("denied");
  check("denied             →  no analytics tag is created", tags.length === 0);
  check("denied             →  ga-disable-<id> is set", sandbox.window[`ga-disable-${ID}`] === true);
  check("denied             →  the choice is remembered", store.get(KEY) === "denied");
}

/* 4 · the owner's own switch, which is deliberately not in the panel */
{
  const off = run(null, "?ga=off");
  check("?ga=off            →  nothing is loaded even with no stored choice", off.tags.length === 0);
  check("?ga=off            →  the opt-out flag is stored", off.store.get("ga_opt_out") === "1");
  const on = run("denied", "?ga=on");
  check("?ga=on             →  loads the tag and overrides a stored no", on.tags.length === 1);
}

/* 5 · THE STATE OF THIS BUILD — no id configured is a no-op, not a fake measurement */
{
  const { tags, sandbox } = run("granted", "", "");
  check("an empty id        →  no tag is created even after a yes", tags.length === 0);
  check("an empty id        →  no gtag function is defined", sandbox.window.gtag === undefined);
}

/* 6 · a placeholder id never loads either (the family's own guard) */
{
  const { tags } = run("granted", "", "G-XXXXXXXXXX");
  check("a placeholder id   →  no tag is created", tags.length === 0);
}

console.log(`\n${failures === 0 ? "CONSENT OK — the gate holds on every path" : `${failures} check(s) FAILED`}`);
process.exit(failures ? 1 : 0);
