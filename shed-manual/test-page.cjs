// Tests shed-manual-new.html in Chromium: console errors, all 10 animations running, pause/play,
// phone-width screenshots, and a run under a strict hash-based content-security policy.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const PAGE = path.join(__dirname, "shed-manual-new.html");
const KEYS = ["landmine", "facepull", "rdl", "deadlift", "hipthrust", "bulgarian", "rollout", "deadbug", "straightarm", "externalrot"];

async function run(file, label, opts = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: opts.dark ? "dark" : "light" });
  const page = await ctx.newPage();
  const errors = [], requests = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push(String(e)));
  page.on("request", r => { if (!r.url().startsWith("file:")) requests.push(r.url()); });
  await page.goto("file://" + file);
  // open every animated exercise
  const ids = await page.evaluate(() => [...document.querySelectorAll(".anim")].map(a => a.closest("details").id));
  const results = [];
  for (const id of ids) {
    await page.evaluate(id => { const d = document.getElementById(id); d.open = true; d.scrollIntoView(); }, id);
    const key = await page.evaluate(id => document.querySelector("#" + id + " .anim").dataset.anim, id);
    const snap = () => page.evaluate(id => document.querySelector("#" + id + " .anim svg").innerHTML, id);
    // sample across a little over one full rep; holds are part of the tempo, so count distinct frames
    const seen = new Set(); for (let i = 0; i < 10; i++) { seen.add(await snap()); await page.waitForTimeout(500); }
    // pause, then confirm it holds still
    await page.click("#" + id + " .anim button");
    const p1 = await snap(); await page.waitForTimeout(400); const p2 = await snap();
    const btn = await page.textContent("#" + id + " .anim button");
    await page.click("#" + id + " .anim button");
    const nodes = await page.evaluate(id => document.querySelectorAll("#" + id + " .anim svg *").length, id);
    results.push({ id, key, animates: seen.size >= 6, distinct: seen.size, pauses: p1 === p2 && btn === "Play", nodes });
  }
  if (opts.shots) {
    for (const id of ["deadlift", "cable-external-rotation"]) {
      await page.evaluate(id => document.getElementById(id).scrollIntoView(), id);
      await page.locator("#" + id).screenshot({ path: path.join(__dirname, "sheets", `page-${id}-${opts.dark ? "dark" : "light"}.png`) });
    }
  }
  await browser.close();
  return { label, errors, requests, results };
}

(async () => {
  const plain = await run(PAGE, "page", { shots: true });
  const dark = await run(PAGE, "page (dark)", { dark: true, shots: true });
  // strict CSP: only the page's own inline script and style blocks (by hash) plus Google Fonts.
  // The original page is run under the same policy for comparison.
  const withCsp = (src, out) => {
    const html = fs.readFileSync(src, "utf8");
    const sha = s => "'sha256-" + crypto.createHash("sha256").update(s, "utf8").digest("base64") + "'";
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1], style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
    const csp = `default-src 'none'; script-src ${sha(script)}; style-src ${sha(style)} https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'none'; connect-src 'none'`;
    fs.writeFileSync(out, html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${csp}">`));
    return out;
  };
  const strict = await run(withCsp(PAGE, path.join(__dirname, ".csp-new.html")), "new page under strict CSP");
  const orig = await run(withCsp(path.join(__dirname, "shed-manual.html"), path.join(__dirname, ".csp-orig.html")), "original page under the same CSP");
  fs.unlinkSync(path.join(__dirname, ".csp-new.html")); fs.unlinkSync(path.join(__dirname, ".csp-orig.html"));
  for (const r of [plain, dark, strict, orig]) {
    console.log(`\n== ${r.label} ==`);
    console.log("animation        exercise id                     animates  pauses  svg nodes  distinct frames /10");
    for (const x of r.results) console.log(x.key.padEnd(17), x.id.padEnd(31), (x.animates ? "yes" : "NO").padEnd(9), (x.pauses ? "yes" : "NO").padEnd(7), String(x.nodes).padEnd(10), x.distinct);
    const inlineAttr = r.errors.filter(e => /Applying inline style violates/.test(e)), other = r.errors.filter(e => !/Applying inline style violates/.test(e));
    console.log("console errors:", other.length ? other : "none");
    if (inlineAttr.length) console.log(`CSP: ${inlineAttr.length} blocked inline style="" attributes (the page's own header stripes and filter chips, not the animations)`);
    console.log("network requests (non-file):", r.requests.length ? [...new Set(r.requests.map(u => new URL(u).host))].join(", ") : "none");
  }
  const ok = [plain, dark, strict].every(r => r.results.length === 10 && r.results.every(x => x.animates && x.pauses));
  console.log(ok ? "\nALL 10 ANIMATE AND PAUSE IN EVERY RUN" : "\nPROBLEMS FOUND");
})();
