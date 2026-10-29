/* The cookie gate — data-science-demo.nodejavascript.com
 *
 * 🔴 THE ANALYTICS TAG IS NOT IN THE DOCUMENT. This file holds the measurement id (read from its
 * own `data-ga-id`) and creates the tag only after a yes, so a visitor who refuses makes NO
 * request to Google at all — which is the whole point of doing it this way rather than loading
 * the tag and setting a flag.
 *
 * There is one real choice on this site: analytical cookies. Everything the page needs to work
 * needs nothing stored — your own file never leaves the browser — so nothing else is offered.
 * The choice is remembered in localStorage, and the door in the footer goes through a DELEGATED
 * listener on the document, because a listener bound at load dies the moment the bar is
 * re-rendered.
 *
 * ⚠ AN EMPTY ID IS A NO-OP, NOT A FAKE MEASUREMENT. This site's property is created in the `mcp`
 * account at deployment and the id set in the page's `data-ga-id`; until then `loadTag()` returns
 * immediately and the panel says so, because a panel that asks a question with no effect is a
 * fake choice.
 */
(function () {
  var me = document.currentScript || document.querySelector("script[data-ga-id]");
  var GA_ID = (me && me.getAttribute("data-ga-id")) || "";
  var KEY = "data-science-demo.consent";
  var OUT = "ga_opt_out";
  var choice = null;

  try {
    /* 🔴 THE OWNER'S OWN SWITCH — ?ga=off / ?ga=on — deliberately NOT in the cookie panel: the
     * panel asks the visitor ONE real question. This is for whoever runs the site. */
    var q = String((window.location && window.location.search) || "");
    if (/[?&]ga=off\b/.test(q)) {
      localStorage.setItem(KEY, "denied");
      localStorage.setItem(OUT, "1");
    } else if (/[?&]ga=on\b/.test(q)) {
      localStorage.removeItem(OUT);
      localStorage.setItem(KEY, "granted");
    }
    choice = localStorage.getItem(OUT) === "1" ? "denied" : localStorage.getItem(KEY);
  } catch (e) {
    choice = null; /* private mode, or storage refused: behave as if nothing was chosen yet */
  }

  function configured() {
    return Boolean(GA_ID) && GA_ID.indexOf("X") === -1;
  }

  function loadTag() {
    if (!configured()) return;
    if (window.__dataScienceDemoTagLoaded) return;
    window.__dataScienceDemoTagLoaded = true;
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA_ID);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      window.dataLayer.push(arguments);
    };
    window.gtag("js", new Date());
    window.gtag("config", GA_ID);
  }

  function blockTag() {
    if (!GA_ID) return;
    window["ga-disable-" + GA_ID] = true; /* belt as well as braces, for any tag already out */
  }

  if (choice === "granted") loadTag();
  else blockTag();

  var bar = null;

  function reserve() {
    if (!bar) return;
    document.documentElement.style.setProperty("--consent-height", bar.offsetHeight + "px");
  }

  function panel(view) {
    bar.innerHTML = view;
    reserve();
  }

  function markChoice(next, open2) {
    try {
      localStorage.setItem(KEY, next);
    } catch (e) {
      /* nothing to do; the choice still applies to this page load */
    }
    if (next === "granted") loadTag();
    else blockTag();
    document.dispatchEvent(new CustomEvent("measured:consent", { detail: { choice: next } }));
    if (open2 === false) close();
  }

  function close() {
    if (bar) {
      bar.remove();
      bar = null;
      document.documentElement.style.setProperty("--consent-height", "0px");
    }
  }

  var ASK =
    '<div class="consentAsk">' +
    '<h2 class="consentTitle">May this page count the visit?</h2>' +
    '<p class="consentText">This page sets nothing until you answer. If you allow it, Google ' +
    "Analytics counts the visit — no profile of you is built here, nothing is sold, and your own " +
    'data file never leaves your browser at all. <a href="#privacy">What that means</a>.</p>' +
    (configured()
      ? ""
      : '<p class="consentText consentNote">No measurement id is set on this build, so nothing is sent either way.</p>') +
    '<div class="consentActions">' +
    '<button type="button" class="primary" data-answer="granted">Allow analytics</button>' +
    '<button type="button" data-answer="denied">Only what is needed</button>' +
    "</div></div>";

  function prefs(current) {
    var on = current === "granted";
    return (
      '<div class="consentPrefs" id="consentPrefs">' +
      '<div class="consentHead"><h2 class="consentTitle">Cookie settings</h2>' +
      '<button type="button" class="consentClose" aria-label="Close" data-close>&times;</button></div>' +
      '<ul class="consentList">' +
      '<li class="consentRow"><div><p class="consentRowName">Strictly necessary</p>' +
      '<p class="consentRowWhy">The page itself, the choice you make here, and — if the page breaks ' +
      'on your device — a report of the error, to this site\'s own origin, so a breakage can be found ' +
      'instead of staying invisible for ever. It sets no cookie and keeps nothing, so there is ' +
      'nothing to switch off.</p></div>' +
      '<span class="consentAlways">Always on</span></li>' +
      '<li class="consentRow"><div><p class="consentRowName">Analytics</p>' +
      '<p class="consentRowWhy">Google Analytics, to count visits.' +
      (configured() ? " Nothing loads from Google unless this is on." : " No measurement id is set on this build, so nothing is loaded either way.") +
      "</p></div>" +
      '<button type="button" class="consentSwitch" role="switch" aria-checked="' + on + '" ' +
      'aria-label="Analytics cookies" data-switch><span class="consentDot"></span></button></li>' +
      "</ul>" +
      '<div class="consentActions"><button type="button" class="primary" data-save>Save choice</button></div>' +
      "</div>"
    );
  }

  function open(which) {
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "consent";
      /* 🔴 THE IDS ARE PART OF THE HOUSE CONTRACT: the family's render check finds this bar as
       * `#consentBar` and decides whether the footer's door opens a panel by looking for
       * `#consentPrefs, #consentBar, [role="dialog"]`. */
      bar.id = "consentBar";
      bar.setAttribute("role", "dialog");
      bar.setAttribute("aria-label", "Cookie choice");
      document.body.appendChild(bar);
      window.addEventListener("resize", reserve);
    }
    panel(which === "ask" ? ASK : prefs(choice));
  }

  /* One listener on the document, for every control in the bar AND for the footer's door. */
  document.addEventListener("click", function (ev) {
    var el = ev.target.closest ? ev.target.closest("[data-answer],[data-switch],[data-save],[data-close],[data-consent-open]") : null;
    if (!el) return;

    if (el.hasAttribute("data-consent-open")) {
      ev.preventDefault();
      open("prefs");
      return;
    }
    if (el.hasAttribute("data-close")) {
      close();
      return;
    }
    if (el.hasAttribute("data-answer")) {
      markChoice(el.getAttribute("data-answer") === "granted" ? "granted" : "denied", false);
      return;
    }
    if (el.hasAttribute("data-switch")) {
      el.setAttribute("aria-checked", el.getAttribute("aria-checked") === "true" ? "false" : "true");
      return;
    }
    if (el.hasAttribute("data-save")) {
      var sw = bar && bar.querySelector("[data-switch]");
      markChoice(sw && sw.getAttribute("aria-checked") === "true" ? "granted" : "denied", false);
    }
  });

  if (choice !== "granted" && choice !== "denied") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        open("ask");
      });
    } else open("ask");
  }
})();
