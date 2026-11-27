import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { injectModules } from "../src/module-html.js";

const INDEX = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

const demo = {
  id: "demo",
  menu: { group: "lens", order: 10, icon: '<circle cx="12" cy="12" r="8"/>' },
  page: { title: "Demo" },
  markup: '<section class="page-view hidden" id="view-demo"></section>',
  css: true,
};

test("index.html ha i quattro marcatori, quello della testa dopo il foglio di stile del core", () => {
  for (const m of ["head", "nav-dati", "nav-lens", "pages"]) assert.equal(INDEX.split(`<!--lens:modules-${m}-->`).length, 2, m);
  assert.ok(INDEX.indexOf("<!--lens:modules-head-->") > INDEX.indexOf('<link rel="stylesheet" href="style.css">'));
  assert.ok(INDEX.indexOf("<!--lens:modules-nav-lens-->") < INDEX.indexOf('href="#impostazioni"'));
  assert.ok(INDEX.indexOf("<!--lens:modules-pages-->") < INDEX.indexOf('id="view-impostazioni"'));
});

test("injectModules senza moduli: i marcatori spariscono e non si aggiunge nulla", () => {
  const out = injectModules(INDEX, []);
  assert.doesNotMatch(out, /lens:modules/);
  assert.doesNotMatch(out, /lens-modules|\/modules\//);
  // only the marker lines go away
  assert.equal(out.split("\n").length, INDEX.split("\n").length - 4);
});

test("injectModules: voce prima di Impostazioni, pagina prima della sua sezione, stile dopo quello del core", () => {
  const out = injectModules(INDEX, [demo]);
  assert.doesNotMatch(out, /lens:modules/);
  assert.match(out, /<meta name="lens-modules" content="demo">/);
  const nav = out.indexOf('data-page="demo"');
  assert.ok(nav > out.indexOf('href="#novita"') && nav < out.indexOf('href="#impostazioni"'));
  assert.ok(out.includes('<a href="#demo" data-page="demo" data-label="Demo" data-i18n-data-label><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg><span class="nav-text" data-i18n>Demo</span></a>'));
  const page = out.indexOf('id="view-demo"');
  assert.ok(page > 0 && page < out.indexOf('id="view-impostazioni"'));
  const link = out.indexOf('<link rel="stylesheet" href="/modules/demo/style.css">');
  assert.ok(link > out.indexOf('<link rel="stylesheet" href="style.css">'));
  assert.ok(link < out.indexOf("</head>"));
});

test("injectModules: gruppo Dati in fondo al gruppo, ordine per menu.order, nessun link senza css", () => {
  const a = { ...demo, id: "aaa", menu: { group: "dati", order: 20, icon: "" }, page: { title: "A" }, markup: "", css: false };
  const b = { ...demo, id: "bbb", menu: { group: "dati", order: 5, icon: "" }, page: { title: "B" }, markup: "", css: false };
  const out = injectModules(INDEX, [a, b]);
  assert.match(out, /<meta name="lens-modules" content="aaa,bbb">/);
  assert.doesNotMatch(out, /\/modules\//);
  const ia = out.indexOf('data-page="aaa"');
  const ib = out.indexOf('data-page="bbb"');
  assert.ok(out.indexOf('data-page="sessioni"') < ib && ib < ia && ia < out.indexOf('id="nav-g-lens"'));
});

test("injectModules: il titolo esce escapato, il markup non interpreta $", () => {
  const out = injectModules(INDEX, [{ ...demo, page: { title: 'A<b>&"' }, markup: "<p>$& $' $1</p>" }]);
  assert.ok(out.includes('data-label="A&lt;b&gt;&amp;&quot;"'));
  assert.ok(out.includes('data-i18n>A&lt;b&gt;&amp;&quot;</span>'));
  assert.doesNotMatch(out, /A<b>/);
  assert.ok(out.includes("<p>$& $' $1</p>"));
});

const spec = { type: "demo-uno", label: "Uno", description: "Il primo", size: [6, 4], min: [3, 3], home: "both", data: ["/api/demo/uno"] };

function widgetsJson(out) {
  const m = /<script type="application\/json" id="lens-module-widgets">(.*)<\/script>/.exec(out);
  assert.ok(m, "il tag dei widget c'è");
  return m[1];
}

test("widget dei moduli: JSON nell'head, escape di <", () => {
  const evil = { id: "demo", name: "</script><b>&", state: "on", file: "/modules/demo/widgets.js", types: [{ ...spec, label: "</script><img src=x onerror=alert(1)>", description: "a & b > c" }] };
  const out = injectModules(INDEX, [demo], null, [evil]);
  const json = widgetsJson(out);
  // nothing in the JSON can close the tag or open another
  assert.doesNotMatch(json, /[<>&]/);
  assert.equal(out.split("</script>").length, INDEX.split("</script>").length + 1, "un solo </script> in più: il nostro");
  assert.deepEqual(JSON.parse(json), [evil], "decodificato è lo stesso elenco");
  const at = out.indexOf('id="lens-module-widgets"');
  assert.ok(at > out.indexOf('<link rel="stylesheet" href="style.css">') && at < out.indexOf("</head>"), "nell'head, dopo il foglio di stile del core");
  assert.doesNotMatch(out, /lens:modules/);
});

test("widget dei moduli: anche con il modulo spento e senza pagine l'elenco c'è, con file null", () => {
  const off = { id: "demo", name: "Demo", state: "off", file: null, types: [spec] };
  const out = injectModules(INDEX, [], null, [off]);
  assert.deepEqual(JSON.parse(widgetsJson(out)), [off]);
  assert.doesNotMatch(out, /lens-modules/);
});

test("nessun modulo con widget: HTML invariato", () => {
  for (const pages of [[], [demo]]) {
    const base = injectModules(INDEX, pages);
    assert.equal(injectModules(INDEX, pages, null, []), base);
    assert.equal(injectModules(INDEX, pages, null, undefined), base);
    assert.doesNotMatch(base, /lens-module-widgets/);
  }
});

test("injectModules: il selettore generico ha id e etichetta della sorgente solo a modulo acceso", () => {
  assert.match(INDEX, /id="source-select"[^>]*\shidden/);
  assert.doesNotMatch(injectModules(INDEX, [demo]), /data-source-id/);
  assert.doesNotMatch(injectModules(INDEX, []), /data-source-id/);
  const out = injectModules(INDEX, [demo], { id: "demo", label: 'D"emo' });
  assert.match(out, /id="source-select" data-source-id="demo" data-source-label="D&quot;emo"/);
});
