// Mounts every animation via harness.html, renders contact sheets and prints a pass/fail table.
// Usage: node verify.cjs [--no-sheets] [key ...]
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const KEYS = ["landmine", "facepull", "rdl", "deadlift", "hipthrust", "bulgarian", "rollout", "deadbug", "straightarm", "externalrot"];
const TOL = 0.5; // px, lengths and fixed contacts
const TOUCH = 0.75; // px, allowed contact for floor, bench and bar
const args = process.argv.slice(2);
const noSheets = args.includes("--no-sheets");
const only = args.filter(a => !a.startsWith("--"));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1420, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto("file://" + path.join(__dirname, "harness.html"));
  const keys = only.length ? only : KEYS;
  const rows = [];
  for (const k of keys) {
    const r = await page.evaluate(k => runChecks(k, 240), k);
    rows.push(r);
    if (!noSheets) {
      fs.mkdirSync(path.join(__dirname, "sheets"), { recursive: true });
      for (const theme of ["light", "dark"]) {
        await page.evaluate(([k, th]) => sheet(k, th), [k, theme]);
        await page.locator("#sheet").screenshot({ path: path.join(__dirname, "sheets", `${k}-${theme}.png`) });
      }
      await page.evaluate(() => document.body.classList.remove("sheet"));
    }
  }
  const pf = ok => (ok ? "PASS" : "FAIL");
  const fmt = (x, d = 2) => (x == null ? "n/a" : (Math.abs(x) < 1e-9 ? 0 : x).toFixed(d));
  console.log("\nkey          period  lengths(max px)        contacts(max px)       floor(pen px)          bench/plate(pen px)    bar(pen px)            reach   drift%     loop");
  let allOk = true;
  for (const r of rows) {
    const c = [
      [r.len <= TOL, `${fmt(r.len, 3)} ${pf(r.len <= TOL)}`],
      [r.fixed <= TOL, `${fmt(r.fixed, 3)} ${pf(r.fixed <= TOL)}`],
      [r.floor <= TOUCH, r.floor < -1e8 ? "n/a" : `${fmt(r.floor)} ${pf(r.floor <= TOUCH)}`],
      [r.bench <= TOUCH, r.bench < -1e8 ? "n/a" : `${fmt(r.bench)} ${pf(r.bench <= TOUCH)}`],
      [r.bar <= TOUCH, r.bar < -1e8 ? "n/a" : `${fmt(r.bar)} ${pf(r.bar <= TOUCH)}`],
      [r.reach <= TOL, `${fmt(r.reach, 3)}`],
      [r.drift == null || r.drift < 3, r.drift == null ? "n/a" : `${fmt(r.drift)} ${pf(r.drift < 3)}`],
      [r.seamless, pf(r.seamless)]
    ];
    if (c.some(x => !x[0])) allOk = false;
    console.log(r.key.padEnd(12), String(r.period).padEnd(7), c.map((x, i) => x[1].padEnd(i === 5 ? 8 : i === 6 ? 11 : 23)).join(""));
    const worst = [r.len > TOL && "len: " + r.lenWorst, r.fixed > TOL && "fixed: " + r.fixedWorst, r.floor > TOUCH && "floor: " + r.floorWorst, r.bench > TOUCH && "bench: " + r.benchWorst, r.bar > TOUCH && "bar: " + r.barWorst].filter(Boolean);
    if (worst.length) console.log("             worst ->", worst.join(" | "));
    const ex = Object.keys(r.extraMin).map(e => `${e} ${r.extraMin[e]}..${r.extraMax[e]}`);
    if (ex.length) console.log("             measures:", ex.join(", "));
  }
  console.log("\nconsole errors:", errors.length ? errors : "none");
  console.log(allOk && !errors.length ? "\nALL CHECKS PASS" : "\nSOME CHECKS FAIL");
  await browser.close();
  process.exitCode = allOk && !errors.length ? 0 : 1;
})();
