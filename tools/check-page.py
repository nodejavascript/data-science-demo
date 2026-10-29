#!/usr/bin/env python3
"""Check the site's own page against the family's on-page rules, locally, with the site running.

    python3 tools/serve.py 8161 &
    python3 tools/check-page.py [url]

This is the local half of the family's test set: it reads the page as it is SERVED rather than as
it is written, so a head that loses the 180-pixel icon, a canonical that drifts off the host, a
second <h1> or a script pulled from someone else's server all fail here rather than after a
deploy. Its app-specific half fetches the data files and asserts the row counts, because a page
whose datasets 404 renders an empty shell and every other check still passes.

The live half (`~/.seo_audit.py` and `~/.nodejs_compliance.py --site`) needs a deployed host and
runs on deploy day.

Exit 0 = every check passed. Exit 1 = at least one did not, and it says which.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8161/"
HOST = "data-science-demo.nodejavascript.com"

# hosts a LINK may point at; a SUBRESOURCE (script/style/img) from any of these is a fault
OK_LINK_HOSTS = ("nodejavascript.com", "github.com", "opensource.org", "schema.org")

# theme colours the family already uses — this site's must not be one of them (part 5)
TAKEN_THEMES = {
    "#940f04", "#0c1626", "#08050d", "#0a0f1f", "#1d4ed8", "#34d399", "#f472b6", "#a3e635",
    "#23523c", "#6d28d9", "#0b0714", "#03090b", "#38bdf8", "#a855f7", "#2a0b12", "#0a0e13",
    "#ff5c9e", "#f97316", "#f5a524", "#ca8a04",
}

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print("  %s  %s%s" % ("ok  " if ok else "FAIL", name, (" — " + detail) if detail and not ok else ""))
    if not ok:
        failures.append(name)


# 🔴 A BROWSER USER-AGENT, BECAUSE CLOUDFLARE ANSWERS BARE PYTHON WITH 403. Measured on the first
# live run of this check, 29 October 2026: the same URL that answers 200 to curl and to Chrome
# answered `HTTP 403 Forbidden` to urllib's default agent, and the check reported the site as
# broken. A check that cannot read the live host cannot check it.
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36"


def get(url: str) -> tuple[int, str]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,*/*"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.status, r.read().decode("utf-8", "replace")


def main() -> int:
    status, html = get(URL)
    check("the page answers 200", status == 200, "HTTP %s" % status)

    title = (re.search(r"<title>(.*?)</title>", html, re.S) or [None, ""])[1].strip()
    check("the title IS the full domain name", title == HOST, "title is %r" % title)

    desc = (re.search(r'<meta\s+name="description"\s+content="(.*?)"', html, re.S) or [None, ""])[1]
    check("one meta description, 120-160 characters", 120 <= len(desc) <= 160, "%d chars" % len(desc))

    canon = (re.search(r'<link rel="canonical" href="(.*?)"', html) or [None, ""])[1]
    check("a self-referencing canonical", canon == "https://%s/" % HOST, canon)

    h1s = re.findall(r"<h1[^>]*>(.*?)</h1>", html, re.S)
    check("exactly one <h1>", len(h1s) == 1, "%d found" % len(h1s))
    if h1s:
        # 🔴 THE H1 IS THE BELIEF, NOT THE CAPABILITY — the golden rule, checked rather than trusted.
        # A capability reads as "features / values / benefits" (the standard's own test), so the
        # words that give a capability away must not be in it.
        belief = re.sub(r"<[^>]+>", "", h1s[0]).strip()
        capability_words = ("tool", "app", "online", "free", "calculator", "dashboard", "explore")
        check(
            "the <h1> states a belief, not a capability",
            not any(w in belief.lower() for w in capability_words),
            belief,
        )
        check("the <h1> is not empty", len(belief) > 12, belief)

    # 🔴 A TAG LEFT UNCLOSED SWALLOWS THE REST OF THE PAGE, and every check above still passes.
    # Data science demo on a sibling site on 29 October 2026. Comments may name a tag; a comment is not markup.
    # 🔴 THE TAGS ARE COUNTED AFTER NORMALISING WHITESPACE INSIDE A TAG, because `</svg\n>` is
    # valid HTML — a formatter may break a tag across lines — and a raw substring count read it as
    # an unclosed element. Data science demo here on 29 October 2026: the footer's star icon is written that
    # way, and the count said 3 opened, 2 closed, which was the CHECK's fault and not the page's.
    stripped = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    stripped = re.sub(r"<\s*/\s*([a-zA-Z0-9]+)", r"</\1", stripped)
    stripped = re.sub(r"<\s+([a-zA-Z0-9]+)", r"<\1", stripped)
    stripped = re.sub(r"(</?[a-zA-Z0-9]+)\s+>", r"\1>", stripped)
    for tag in ("section", "table", "div", "figure", "ul", "ol", "details", "svg", "script"):
        opened, closed = stripped.count("<%s" % tag), stripped.count("</%s>" % tag)
        check("every <%s> is closed" % tag, opened == closed, "%d opened, %d closed" % (opened, closed))

    order = re.findall(r'<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"', html)
    check(
        "the 180-pixel PNG is the FIRST icon declared (SVG is not a format Google reads)",
        bool(order) and "favicon-180.png" in order[0],
        "first is %s" % (order[0] if order else "none"),
    )
    for size in ("favicon-180.png", "favicon.svg", "favicon-32.png", "favicon.ico", "apple-touch-icon.png"):
        check("the icon set declares %s" % size, any(size in h for h in order))

    check("no analytics tag in the page (the gate creates it)", "googletagmanager" not in html)
    check("the gate itself is loaded", "consent.js" in html)
    check("no privacy.html anywhere", "privacy.html" not in html)
    check("no www hostname", not re.search(r"://www\.", html))
    check("a theme colour is declared", 'name="theme-color"' in html)

    theme = (re.search(r'name="theme-color" content="([^"]+)"', html) or [None, ""])[1]
    check("the theme colour is this site's own", theme.lower() not in TAKEN_THEMES, theme)

    # structured data: it must parse, and its @type must be one the consuming validator documents
    blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
    check("the page carries structured data", bool(blocks))
    for block in blocks:
        try:
            data = json.loads(block)
        except Exception as exc:  # noqa: BLE001
            check("the JSON-LD parses", False, str(exc))
            continue
        nodes = data.get("@graph", [data])
        kinds = [n.get("@type") for n in nodes]
        check("the JSON-LD parses (%s)" % ", ".join(str(k) for k in kinds), True)
        check(
            "every @type is one Google's Software App validator accepts",
            all(k in ("SoftwareApplication", "FAQPage", "Question", "Answer", "Offer") for k in kinds),
            ", ".join(str(k) for k in kinds),
        )
        app = next((n for n in nodes if n.get("@type") == "SoftwareApplication"), None)
        check(
            "the software app carries the properties the rich result needs",
            bool(app)
            and all(app.get(k) for k in ("name", "applicationCategory", "operatingSystem", "offers"))
            and app.get("offers", {}).get("price") == "0",
            json.dumps(app)[:120] if app else "no SoftwareApplication node",
        )

    # a subresource is something the page LOADS: a script, an image, or a stylesheet/icon/manifest.
    # A RELATION LINK IS NOT A SUBRESOURCE — the canonical and og:url fetch nothing.
    subs = re.findall(r'<(?:script|img|iframe)[^>]*\ssrc="(https?://[^"]+)"', html) + re.findall(
        r'<link[^>]*rel="(?:stylesheet|preload|icon|apple-touch-icon|manifest)"[^>]*href="(https?://[^"]+)"', html
    )
    check("no subresource comes from a third party", not subs, ", ".join(subs))

    for need in ("site-footer", "Cookie settings", "© 2026 %s" % HOST, 'id="privacy"', "gh-star"):
        check("the page carries %s" % need, need in html)

    base = URL.rstrip("/")

    # ── the fault reporter (part 18) ─────────────────────────────────────────────────────────
    check("the fault reporter is loaded, deferred", 'src="/rollbar.js" defer' in html)
    check("no Rollbar credential is in the page", "data-token" not in html)
    check("the page never talks to Rollbar directly", "api.rollbar.com" not in html)
    try:
        st, js = get(base + "/rollbar.js")
        check("/rollbar.js answers 200", st == 200)
        check("…and it posts to this site's own origin", "/api/fault" in js)
        check("…and the query string is dropped before it leaves", "location.search" not in js)
        check("…and it honours Do Not Track", "doNotTrack" in js)
        check("…and it stops after five reports on one page", "MAX_PER_PAGE" in js)
    except urllib.error.HTTPError as exc:
        check("/rollbar.js answers 200", False, "HTTP %s" % exc.code)

    # ── this app's own half ────────────────────────────────────────────────────────────────────
    check("the app is loaded as a module", 'type="module" src="./app.js"' in html)
    check(
        "the arithmetic is imported by the app, not loaded by the page",
        "./stats.js\"" not in html and "stats.js" not in re.findall(r'<script[^>]*src="([^"]+)"', html),
    )

    # a page whose datasets 404 is an empty shell that every rule above still passes
    for path, rows in (
        ("/data/anscombe.json", 11),
        ("/data/iris.json", 150),
        ("/data/faithful.json", 272),
        ("/data/penguins.json", 344),
    ):
        try:
            st, body = get(base + path)
            data = json.loads(body)
            n = len(data["rows"]) if "rows" in data else len(data["series"][0]["x"])
            check("%s answers 200 with %d rows" % (path, rows), st == 200 and n == rows, "got %s rows" % n)
        except urllib.error.HTTPError as exc:
            check("%s answers 200" % path, False, "HTTP %s" % exc.code)
        except Exception as exc:  # noqa: BLE001
            check("%s parses as JSON" % path, False, str(exc))

    for path, needle in (("/robots.txt", "Sitemap:"), ("/sitemap.xml", HOST)):
        try:
            st, body = get(base + path)
            check("%s answers 200 and carries %r" % (path, needle), st == 200 and needle in body)
        except urllib.error.HTTPError as exc:
            check("%s answers 200" % path, False, "HTTP %s" % exc.code)

    # the manifest must be JSON a browser can install, not merely present
    try:
        st, body = get(base + "/manifest.webmanifest")
        mani = json.loads(body)
        check(
            "the manifest parses and carries a name, a start_url and the 180-pixel icon",
            st == 200
            and bool(mani.get("name"))
            and mani.get("start_url") == "/"
            and any(i.get("sizes") == "180x180" for i in mani.get("icons", [])),
            body[:120],
        )
    except urllib.error.HTTPError as exc:
        check("/manifest.webmanifest answers 200", False, "HTTP %s" % exc.code)
    except Exception as exc:  # noqa: BLE001
        check("/manifest.webmanifest parses as JSON", False, str(exc))

    print()
    if failures:
        print("  %d check(s) FAILED: %s" % (len(failures), "; ".join(failures)))
        return 1
    print("  CHECK OK — every on-page rule holds on the served page")
    return 0


if __name__ == "__main__":
    sys.exit(main())
