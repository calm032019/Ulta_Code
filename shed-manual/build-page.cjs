// Builds shed-manual-new.html from shed-manual.html + anims.js.
// - ANIM_CSS replaces the old stick-figure rules in the page's own <style> block (static, so a hash-based CSP still covers it)
// - anims.js replaces the old rig and ANIMS; the mount code is untouched and keeps its el() helper
const fs = require("fs");
const path = require("path");

const dir = __dirname;
let page = fs.readFileSync(path.join(dir, "shed-manual.html"), "utf8");
const anims = fs.readFileSync(path.join(dir, "anims.js"), "utf8");
const ANIM_CSS = new Function(anims + "\nreturn ANIM_CSS;")();

const cut = (s, from, to, insert) => {
  const a = s.indexOf(from), b = s.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error("marker not found: " + from);
  return s.slice(0, a) + insert + s.slice(b);
};
page = cut(page, ".fig{stroke:var(--ink)", "\nfooter{", "/* exercise animations (ANIM_CSS from anims.js) */\n" + ANIM_CSS + "\n");
page = cut(page, "// ---------- animation rig ----------", "const reduce = window.matchMedia",
  "// ---------- animations (anims.js) ----------\n" + anims.trim() + "\n\n" +
  'const SVGNS = "http://www.w3.org/2000/svg";\n' +
  "function el(tag, attrs, parent){ const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }\n\n");
fs.writeFileSync(path.join(dir, "shed-manual-new.html"), page);
console.log("wrote shed-manual-new.html (" + page.length + " bytes)");
