/* The Shed Manual: exercise animations.
   Defines two globals: ANIMS (one entry per animated exercise) and ANIM_CSS (all sm- prefixed).
   Plain ES2017. No modules, libraries, network requests or external assets.
   Each entry: { view, cap, label, period, build(svg) -> draw(t) }, t = 0..1 over one rep, draw(0) === draw(1). */

var ANIM_CSS = [
  ".sm-skin{fill:var(--ink);stroke:var(--bg);stroke-width:1.2;stroke-linejoin:round}",
  ".sm-solid{fill:var(--ink)}",
  ".sm-far{opacity:.5}",
  ".sm-fl{fill:var(--muted)}",
  ".sm-ear{fill:none;stroke:var(--bg);stroke-width:1}",
  ".sm-eq{fill:var(--muted)}",
  ".sm-eq-line{fill:none;stroke:var(--muted);stroke-linecap:round;stroke-linejoin:round}",
  ".sm-pad{fill:var(--surface);stroke:var(--muted);stroke-width:1.5;stroke-linejoin:round}",
  ".sm-hub{fill:var(--surface);stroke:var(--muted);stroke-width:1.2}",
  ".sm-plate{fill:var(--red);fill-opacity:.1;stroke:var(--red);stroke-width:2.2}",
  ".sm-plate-far{fill:none;stroke:var(--red);stroke-width:2;opacity:.35}",
  ".sm-plate-edge{fill:var(--red)}",
  ".sm-floor{stroke:var(--line);stroke-width:2;stroke-linecap:round}",
  ".sm-trace{fill:none;stroke:var(--red);stroke-width:1.6;stroke-dasharray:1.5 4;stroke-linecap:round;opacity:.75}",
  ".sm-cable{fill:none;stroke:var(--muted);stroke-width:1.3}",
  ".sm-rope{fill:none;stroke:var(--muted);stroke-width:3;stroke-linecap:round}",
  ".sm-towel{fill:var(--surface);stroke:var(--muted);stroke-width:1.2}"
].join("\n");

var ANIMS = (function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg", D2R = Math.PI / 180;

  // ---------- dom + maths ----------
  function mk(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  var n2 = function (x) { return String(Math.round(x * 100) / 100); };
  var clamp = function (x, a, b) { return x < a ? a : x > b ? b : x; };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var smooth = function (x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  var sine = function (x) { return (1 - Math.cos(Math.PI * clamp(x, 0, 1))) / 2; };
  var fk = function (p, l, a) { return [p[0] + l * Math.cos(a * D2R), p[1] + l * Math.sin(a * D2R)]; };
  var angOf = function (a, b) { return Math.atan2(b[1] - a[1], b[0] - a[0]) / D2R; };
  var dist = function (a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); };
  var add = function (a, b) { return [a[0] + b[0], a[1] + b[1]]; };
  var sub = function (a, b) { return [a[0] - b[0], a[1] - b[1]]; };
  // local frame -> world: u along angle a, v along a + 90 (SVG, y down)
  function loc(o, a, u, v) {
    var c = Math.cos(a * D2R), s = Math.sin(a * D2R);
    return [o[0] + u * c - v * s, o[1] + u * s + v * c];
  }
  // two-bone IK: joint at l1 from A so the chain reaches B; pref picks the bend side
  function ik(A, B, l1, l2, pref) {
    var dx = B[0] - A[0], dy = B[1] - A[1], d = Math.hypot(dx, dy);
    var dc = clamp(d, Math.abs(l1 - l2) + 1e-6, l1 + l2 - 1e-6);
    var base = Math.atan2(dy, dx), off = Math.acos(clamp((l1 * l1 + dc * dc - l2 * l2) / (2 * l1 * dc), -1, 1));
    var m1 = [A[0] + l1 * Math.cos(base + off), A[1] + l1 * Math.sin(base + off)];
    var m2 = [A[0] + l1 * Math.cos(base - off), A[1] + l1 * Math.sin(base - off)];
    var mx = A[0] + dx / 2, my = A[1] + dy / 2;
    var p1 = (m1[0] - mx) * pref[0] + (m1[1] - my) * pref[1], p2 = (m2[0] - mx) * pref[0] + (m2[1] - my) * pref[1];
    return p1 >= p2 ? m1 : m2;
  }
  function bisect(f, lo, hi, it) {
    var flo = f(lo);
    for (var i = 0; i < (it || 48); i++) {
      var mid = (lo + hi) / 2, fm = f(mid);
      if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else hi = mid;
    }
    return (lo + hi) / 2;
  }
  // monotone cubic through [[x, y], ...] (Fritsch-Carlson): smooth, no overshoot
  function mono(keys) {
    var n = keys.length, xs = keys.map(function (k) { return k[0]; }), ys = keys.map(function (k) { return k[1]; }), d = [], m = [], i;
    for (i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
      var a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
      if (h > 9) { var t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    return function (x) {
      x = clamp(x, xs[0], xs[n - 1]);
      for (var j = 0; j < n - 2 && x > xs[j + 1]; j++);
      var hh = xs[j + 1] - xs[j], t = (x - xs[j]) / hh, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[j] + (t3 - 2 * t2 + t) * hh * m[j] + (-2 * t3 + 3 * t2) * ys[j + 1] + (t3 - t2) * hh * m[j + 1];
    };
  }
  function segDist(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    var t = l2 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1) : 0;
    return { d: Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy), t: t };
  }
  // gap between a circle and a body capsule [name,a,b,r0,r1,peak] (negative = overlap)
  function capGap(c, r, cap) {
    var q = segDist(c, cap[1], cap[2]);
    var rr = lerp(cap[3], cap[4], q.t) + 4 * q.t * (1 - q.t) * (cap[5] - (cap[3] + cap[4]) / 2);
    return q.d - rr - r;
  }
  // as capGap, but a circle behind the limb (its +y, posterior side) counts as overlap
  function frontGap(c, r, cap) {
    var a = cap[1], b = cap[2], v = (c[0] - a[0]) * (a[1] - b[1]) + (c[1] - a[1]) * (b[0] - a[0]);
    var g = capGap(c, r, cap), t = segDist(c, a, b).t;
    return v > 0 && t > 0 && t < 1 ? -Math.abs(g) - r : g;
  }

  // Tempo: keys [[ms, value], ...] starting from the final value, so the loop closes exactly.
  // Each move eases in and out (zero velocity at both ends), so holds and reversals are smooth.
  function tempo(keys) {
    var total = 0, list = [], prev = keys[keys.length - 1][1];
    keys.forEach(function (k) { list.push({ t0: total, d: k[0], a: prev, b: k[1], e: k[2] || sine }); total += k[0]; prev = k[1]; });
    var f = function (t) {
      var ms = clamp(t, 0, 1) * total;
      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        if (ms <= s.t0 + s.d) return s.a === s.b ? s.a : s.a + (s.b - s.a) * s.e((ms - s.t0) / s.d);
      }
      return prev;
    };
    f.period = total;
    return f;
  }

  // ---------- shapes (built once) ----------
  function catmull(pts, per) {
    // closed Catmull-Rom through pts: returns {d, samples}
    var n = pts.length, d = "M" + n2(pts[0][0]) + "," + n2(pts[0][1]), out = [];
    for (var i = 0; i < n; i++) {
      var p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      var c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      var c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += "C" + n2(c1[0]) + "," + n2(c1[1]) + " " + n2(c2[0]) + "," + n2(c2[1]) + " " + n2(p2[0]) + "," + n2(p2[1]);
      for (var j = 0; j < (per || 5); j++) {
        var t = j / (per || 5), u = 1 - t;
        out.push([u * u * u * p1[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p2[0],
                  u * u * u * p1[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p2[1]]);
      }
    }
    return { d: d + "Z", samples: out };
  }
  // tapered limb along +x from 0 to L; radii r0 (proximal) r1 (distal); neg/pos = peak half-widths on -y/+y
  function limb(L, r0, r1, neg, pos, k) {
    var cn = 2 * neg - (r0 + r1) / 2, cp = 2 * pos - (r0 + r1) / 2;
    return "M0," + n2(-r0) + "Q" + n2(L * k) + "," + n2(-cn) + " " + n2(L) + "," + n2(-r1) +
      "A" + n2(r1) + "," + n2(r1) + " 0 0 1 " + n2(L) + "," + n2(r1) +
      "Q" + n2(L * k) + "," + n2(cp) + " 0," + n2(r0) +
      "A" + n2(r0) + "," + n2(r0) + " 0 0 1 0," + n2(-r0) + "Z";
  }
  // capsule between two screen points (for the 3D/top-down rigs)
  function capPath(a, b, ra, rb) {
    var dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1e-6, ux = dx / d, uy = dy / d, nx = -uy, ny = ux;
    return "M" + n2(a[0] + nx * ra) + "," + n2(a[1] + ny * ra) + "L" + n2(b[0] + nx * rb) + "," + n2(b[1] + ny * rb) +
      "A" + n2(rb) + "," + n2(rb) + " 0 0 0 " + n2(b[0] - nx * rb) + "," + n2(b[1] - ny * rb) +
      "L" + n2(a[0] - nx * ra) + "," + n2(a[1] - ny * ra) +
      "A" + n2(ra) + "," + n2(ra) + " 0 0 0 " + n2(a[0] + nx * ra) + "," + n2(a[1] + ny * ra) + "Z";
  }
  function tf(node, p, a) {
    node.setAttribute("transform", "translate(" + n2(p[0]) + "," + n2(p[1]) + ") rotate(" + n2(a) + ")");
  }
  function line(parent, a, b, cls) { return mk("line", { x1: n2(a[0]), y1: n2(a[1]), x2: n2(b[0]), y2: n2(b[1]), "class": cls }, parent); }
  function setLine(node, a, b) { node.setAttribute("x1", n2(a[0])); node.setAttribute("y1", n2(a[1])); node.setAttribute("x2", n2(b[0])); node.setAttribute("y2", n2(b[1])); }
  function polyline(parent, pts, cls) { return mk("polyline", { points: pts.map(function (p) { return n2(p[0]) + "," + n2(p[1]); }).join(" "), "class": cls }, parent); }
  function traceOf(parent, fn, n) { var pts = []; for (var i = 0; i <= (n || 48); i++) pts.push(fn(i / (n || 48))); return polyline(parent, pts, "sm-trace"); }

  // ---------- side-view figure ----------
  // Proportions from standard anthropometric fractions of stature H.
  // Local frames: limbs run along +x from the proximal joint. For a right-facing figure,
  // +y is posterior on limbs and anterior on the torso and head.
  var TORSO = {
    std: [[-0.05, 0.036], [0.06, 0.058], [0.17, 0.062], [0.25, 0.068], [0.305, 0.045], [0.338, 0.0], [0.318, -0.05],
          [0.235, -0.065], [0.125, -0.05], [0.03, -0.074], [-0.04, -0.07], [-0.083, -0.03], [-0.072, 0.012]],
    flat: [[-0.05, 0.036], [0.06, 0.058], [0.17, 0.062], [0.25, 0.068], [0.305, 0.045], [0.338, 0.0], [0.318, -0.05],
           [0.235, -0.066], [0.125, -0.066], [0.03, -0.068], [-0.04, -0.066], [-0.083, -0.03], [-0.072, 0.012]]
  };
  var HEAD = [[0.068, -0.05], [0.11, -0.057], [0.148, -0.032], [0.162, 0.006], [0.147, 0.043], [0.12, 0.056], [0.1, 0.069],
              [0.084, 0.058], [0.07, 0.06], [0.04, 0.052], [0.03, 0.026], [0.045, -0.022]];
  var FOOT = [[-0.03, -0.012], [-0.047, 0.012], [-0.038, 0.039], [0.02, 0.039], [0.09, 0.039], [0.107, 0.032],
              [0.098, 0.019], [0.05, 0.006], [0.012, -0.016]];

  function figure(H, opt) {
    opt = opt || {};
    var s = function (x) { return x * H; };
    var L = { shank: s(0.246), thigh: s(0.245), ua: s(0.186), fa: s(0.146), grip: s(0.045), torso: s(0.30), fist: s(0.052) };
    var R = { // r0, r1, -y peak, +y peak, peak position
      thigh: [s(0.052), s(0.034), s(0.050), s(0.053), 0.4],
      shank: [s(0.031), s(0.0135), s(0.019), s(0.038), 0.28],
      ua: [s(0.031), s(0.021), s(0.027), s(0.029), 0.4],
      fa: [s(0.023), s(0.016), s(0.024), s(0.024), 0.28],
      fist: [s(0.019), s(0.022), s(0.022), s(0.022), 0.5]
    };
    var sc = function (pts) { return pts.map(function (p) { return [s(p[0]), s(p[1])]; }); };
    var torso = catmull(sc(TORSO[opt.torso || "std"]), 6), head = catmull(sc(HEAD), 6), foot = catmull(sc(FOOT), 6);
    var D = {};
    ["thigh", "shank", "ua", "fa"].forEach(function (k) { D[k] = limb(L[k], R[k][0], R[k][1], R[k][2], R[k][3], R[k][4]); });
    D.fist = limb(L.fist, R.fist[0], R.fist[1], R.fist[2], R.fist[3], R.fist[4]);
    var NECK = [s(0.31), s(-0.012)];
    var N = {}, api = { L: L, H: H, R: R, last: null };

    function p(g, d, cls) { return mk("path", { d: d, "class": cls }, g); }
    api.farArm = function (parent) { var g = mk("g", { "class": "sm-far" }, parent); N.fua = p(g, D.ua, "sm-fl"); N.ffa = p(g, D.fa, "sm-fl"); N.ffi = p(g, D.fist, "sm-fl"); return g; };
    api.farLeg = function (parent) { var g = mk("g", { "class": "sm-far" }, parent); N.fft = p(g, foot.d, "sm-fl"); N.fsh = p(g, D.shank, "sm-fl"); N.fth = p(g, D.thigh, "sm-fl"); return g; };
    api.body = function (parent) {
      N.torso = p(parent, torso.d, "sm-skin");
      N.head = mk("g", {}, parent);
      p(N.head, limb(s(0.075), s(0.03), s(0.026), s(0.027), s(0.027), 0.5), "sm-skin");
      p(N.head, head.d, "sm-skin");
      mk("ellipse", { cx: n2(s(0.088)), cy: n2(s(-0.016)), rx: n2(s(0.017)), ry: n2(s(0.011)), "class": "sm-ear" }, N.head);
    };
    api.nearLeg = function (parent) { var g = mk("g", {}, parent); N.nft = p(g, foot.d, "sm-skin"); N.nsh = p(g, D.shank, "sm-skin"); N.nth = p(g, D.thigh, "sm-skin"); return g; };
    api.nearArm = function (parent) { var g = mk("g", {}, parent); N.nua = p(g, D.ua, "sm-skin"); N.nfa = p(g, D.fa, "sm-skin"); N.nfi = p(g, D.fist, "sm-skin"); return g; };
    api.all = function (parent) { api.farArm(parent); api.farLeg(parent); api.body(parent); api.nearLeg(parent); api.nearArm(parent); };

    // helpers that build chains with exact segment lengths
    api.legIK = function (hip, ankle, pref, foot) { return { h: hip, k: ik(ankle, hip, L.shank, L.thigh, pref || [1, 0]), a: ankle, f: foot || 0 }; };
    api.legFK = function (hip, thighA, shankA, footA) { var k = fk(hip, L.thigh, thighA); return { h: hip, k: k, a: fk(k, L.shank, shankA), f: footA }; };
    api.armTo = function (sh, g, pref) {
      var e = ik(sh, g, L.ua, L.fa + L.grip, pref || [-1, 0]), a = angOf(e, g);
      return { s: sh, e: e, w: fk(e, L.fa, a), ha: a, target: g };
    };
    api.armFK = function (sh, uaA, faA, haA) { var e = fk(sh, L.ua, uaA), w = fk(e, L.fa, faA); return { s: sh, e: e, w: w, ha: haA == null ? faA : haA }; };
    api.gripOf = function (arm) { return fk(arm.w, L.grip, arm.ha); };
    api.shoulder = function (hip, ta) { return fk(hip, L.torso, ta); };
    api.neckBase = function (hip, ta) { return loc(hip, ta, NECK[0], NECK[1]); };

    // P: {hip, ta, neck, nl, fl, na, fa} (legs {h,k,a,f}, arms {s,e,w,ha})
    api.set = function (P) {
      api.last = P;
      tf(N.torso, P.hip, P.ta);
      tf(N.head, api.neckBase(P.hip, P.ta), P.ta + (P.neck || 0));
      var leg = function (q, th, sh, ft) { if (!q || !th) return; tf(th, q.h, angOf(q.h, q.k)); tf(sh, q.k, angOf(q.k, q.a)); tf(ft, q.a, q.f); };
      var arm = function (q, ua, fa, fi) { if (!q || !ua) return; tf(ua, q.s, angOf(q.s, q.e)); tf(fa, q.e, angOf(q.e, q.w)); tf(fi, q.w, q.ha); };
      leg(P.nl, N.nth, N.nsh, N.nft); leg(P.fl, N.fth, N.fsh, N.fft);
      arm(P.na, N.nua, N.nfa, N.nfi); arm(P.fa, N.fua, N.ffa, N.ffi);
    };

    // geometry for the test harness (not used while animating)
    api.probe = function () {
      var P = api.last, segs = [], caps = [], outlines = [];
      var cap = function (name, a, b, r) { caps.push([name, a, b, r[0], r[1], Math.max(r[2], r[3]), r[2], r[3]]); };
      var xf = function (smp, o, a) { return smp.map(function (q) { return loc(o, a, q[0], q[1]); }); };
      outlines.push(["torso", xf(torso.samples, P.hip, P.ta)]);
      outlines.push(["head", xf(head.samples, api.neckBase(P.hip, P.ta), P.ta + (P.neck || 0))]);
      [["near", P.nl], ["far", P.fl]].forEach(function (x) {
        var q = x[1]; if (!q) return;
        segs.push([x[0] + " thigh", q.h, q.k, L.thigh]); segs.push([x[0] + " shank", q.k, q.a, L.shank]);
        cap(x[0] + " thigh", q.h, q.k, R.thigh); cap(x[0] + " shank", q.k, q.a, R.shank);
        outlines.push([x[0] + " foot", xf(foot.samples, q.a, q.f)]);
      });
      [["near", P.na], ["far", P.fa]].forEach(function (x) {
        var q = x[1]; if (!q) return;
        segs.push([x[0] + " upper arm", q.s, q.e, L.ua]); segs.push([x[0] + " forearm", q.e, q.w, L.fa]);
        cap(x[0] + " upper arm", q.s, q.e, R.ua); cap(x[0] + " forearm", q.e, q.w, R.fa);
        cap(x[0] + " hand", q.w, fk(q.w, L.fist, q.ha), R.fist);
      });
      return { segs: segs, caps: caps, outlines: outlines };
    };
    api.footSamples = foot.samples; api.headSamples = head.samples; api.torsoSamples = torso.samples;
    return api;
  }
  // lowest (max y) point of a local outline placed at o with angle a
  function lowest(samples, o, a) { var m = -1e9; samples.forEach(function (q) { var w = loc(o, a, q[0], q[1]); if (w[1] > m) m = w[1]; }); return m; }
  function reachErr(arm, fig) { return arm.target ? dist(fig.gripOf(arm), arm.target) : 0; }
  function floorLine(svg, y, x0, x1) { return line(svg, [x0, y], [x1, y], "sm-floor"); }

  // bar seen end-on with plates (side view)
  function plateSet(parent, rPlate, rHub, farOff) {
    var far = mk("circle", { r: n2(rPlate), "class": "sm-plate-far" }, parent);
    return {
      far: far,
      front: function (p2) {
        var g = mk("g", {}, p2);
        mk("circle", { r: n2(rPlate), "class": "sm-plate" }, g);
        mk("circle", { r: n2(rHub), "class": "sm-hub" }, g);
        return g;
      },
      set: function (front, c) { far.setAttribute("cx", n2(c[0] + farOff[0])); far.setAttribute("cy", n2(c[1] + farOff[1])); front.setAttribute("transform", "translate(" + n2(c[0]) + "," + n2(c[1]) + ")"); }
    };
  }

  var TP = {
    landmine: tempo([[350, 0], [1000, 1], [350, 1], [2000, 0]]),
    facepull: tempo([[350, 0], [1000, 1], [700, 1], [2000, 0]]),
    rdl: tempo([[450, 0], [2000, 1], [350, 1], [1100, 0]]),
    deadlift: tempo([[450, 0], [1000, 1], [550, 1], [2000, 0]]),
    hipthrust: tempo([[300, 0], [1000, 1], [900, 1], [2000, 0]]),
    bulgarian: tempo([[300, 0], [2000, 1], [300, 1], [1000, 0]]),
    rollout: tempo([[400, 0], [2000, 1], [350, 1], [1200, 0]]),
    straightarm: tempo([[350, 0], [1000, 1], [500, 1], [2000, 0]]),
    externalrot: tempo([[400, 0], [1200, 1], [600, 1], [2000, 0]]),
    deadbug: tempo([[300, 0], [2000, 1], [400, 1], [1000, 0]])
  };

  var A = {};

  // =====================================================================
  // 1. Landmine press (side view, single arm, near arm pressing)
  // =====================================================================
  A.landmine = {
    period: TP.landmine.period,
    view: "0 0 360 240",
    cap: "Side view. Press up and forward along the bar’s arc, ribs down, then lower slowly.",
    label: "Side view of a single-arm landmine press in a staggered stance. The end of the bar starts at the front of the shoulder and is pressed up and forward along the arc it makes around its floor pivot, with a slight forward lean and the ribs kept down. The shoulder blade glides up and forward a touch at the top, then the bar is lowered slowly back to the shoulder.",
    build: function (svg) {
      var M = 112, H = 1.78 * M, FY = 232, fig = figure(H), L = fig.L;
      var BAR = 2.2 * M, GRIPR = BAR - 0.06 * M, PIV = [342, FY - 0.08 * M];
      var HX = 104, hip = [HX, FY - 0.5 * H];
      var NA = [HX - 0.15 * H, FY - 0.039 * H], FA = [HX + 0.14 * H, FY - 0.039 * H];
      var FAR = [0.012 * H, 0];
      var gir = function (ta, g) { return fk(loc(hip, ta, 0.285 * H, 0.026 * H), 0.03 * H, ta + g); };
      var e0 = 82, e1 = 76, g0 = -60, g1 = -10;
      var GH0 = gir(-e0, g0), G0 = [GH0[0] + 0.096 * H, GH0[1] + 0.045 * H];
      PIV[0] = G0[0] + Math.sqrt(GRIPR * GRIPR - Math.pow(PIV[1] - G0[1], 2));
      var grip = function (b) { return [PIV[0] - GRIPR * Math.cos(b * D2R), PIV[1] - GRIPR * Math.sin(b * D2R)]; };
      var b0 = Math.atan2(PIV[1] - G0[1], PIV[0] - G0[0]) / D2R;
      var Aeff = L.ua + L.fa + L.grip, GH1 = gir(-e1, g1);
      var b1 = bisect(function (b) { return dist(GH1, grip(b)) - 0.985 * Aeff; }, b0, 80);
      var pose = function (p) {
        var ta = -lerp(e0, e1, p), g = lerp(g0, g1, p), gh = gir(ta, g), G = grip(lerp(b0, b1, p));
        var fsh = add(fig.shoulder(hip, ta), FAR);
        return {
          hip: hip, ta: ta, neck: -4, gh: gh, G: G, b: lerp(b0, b1, p),
          nl: fig.legIK(hip, NA, [1, 0]), fl: fig.legIK(add(hip, FAR), add(FA, FAR), [1, 0]),
          na: fig.armTo(gh, G, [0.25, 1]), fa: fig.armFK(fsh, 88, 78)
        };
      };
      var tp = TP.landmine;

      floorLine(svg, FY, 8, 352);
      traceOf(svg, function (u) { return grip(lerp(b0 - 2, b1 + 2, u)); }, 40);
      fig.farLeg(svg); fig.farArm(svg); fig.body(svg); fig.nearLeg(svg);
      // landmine bracket
      mk("path", { d: "M" + n2(PIV[0] - 10) + "," + FY + "L" + n2(PIV[0] - 4) + "," + n2(PIV[1] - 5) + "L" + n2(PIV[0] + 6) + "," + n2(PIV[1] - 5) + "L" + n2(PIV[0] + 12) + "," + FY + "Z", "class": "sm-eq" }, svg);
      var bar = mk("g", {}, svg);
      var r = function (x0, x1, h, cls) { return mk("rect", { x: n2(x0), y: n2(-h / 2), width: n2(x1 - x0), height: n2(h), rx: n2(Math.min(h / 2, 2)), "class": cls }, bar); };
      r(0, BAR - 0.415 * M, 0.028 * M, "sm-eq");
      r(BAR - 0.415 * M, BAR, 0.05 * M, "sm-eq");
      r(BAR - 0.43 * M, BAR - 0.4 * M, 0.08 * M, "sm-eq");
      r(BAR - 0.395 * M, BAR - 0.35 * M, 0.45 * M, "sm-plate-edge");
      mk("circle", { cx: 0, cy: 0, r: n2(0.03 * M), "class": "sm-hub" }, bar);
      fig.nearArm(svg);
      var last = null;
      var draw = function (t) {
        var P = pose(tp(t)); last = P;
        fig.set(P); tf(bar, PIV, angOf(PIV, P.G) + 0);
      };
      svg.__sm = {
        W: 360,
        probe: function () {
          var pr = fig.probe(), P = last, ang = angOf(PIV, P.G);
          pr.segs.push(["bar (pivot to grip)", PIV, P.G, GRIPR], ["shoulder girdle", loc(hip, P.ta, 0.285 * H, 0.026 * H), P.gh, 0.03 * H]);
          pr.fixed = [["near foot", P.nl.a], ["far foot", P.fl.a], ["hip", P.hip], ["pivot", PIV]];
          pr.floorY = FY;
          pr.reach = [["hand on bar end", reachErr(P.na, fig)]];
          var pc = [BAR - 0.3725 * M, 0], ph = 0.225 * M, pw = 0.0225 * M;
          pr.polys = [["plate", [[pc[0] - pw, -ph], [pc[0] + pw, -ph], [pc[0] + pw, ph], [pc[0] - pw, ph]].map(function (q) { return loc(PIV, ang, q[0], q[1]); }), ["near hand"]]];
          pr.bars = [{ name: "bar shaft", seg: [PIV, fk(PIV, BAR, ang)], r: 0.025 * M, ignore: ["near hand", "near forearm"] }];
          return pr;
        }
      };
      return draw;
    }
  };

  // =====================================================================
  // 2. Face pull (rear three-quarter view, true 3D rig, orthographic)
  // =====================================================================
  A.facepull = {
    period: TP.facepull.period,
    view: "0 0 300 200",
    cap: "From behind. Elbows high and wide, hands finish by your ears, shoulders stay down.",
    label: "Cable rope face pull seen from behind and slightly above, at an angle. The rope runs from a pulley at head height. The arms start reaching towards the pulley, then the elbows travel out, back and stay at or above shoulder height while the shoulders stay down. At the finish the hands are beside the ears and the forearms have rotated up and back. The rope then returns slowly.",
    build: function (svg) {
      var Hm = 1.78, M = 114, O = [160, 247];
      var yaw = -10 * D2R, pit = 15 * D2R, cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
      // world: x = person's right, y = up, z = forward (towards the pulley), metres
      var proj = function (q) { return [O[0] + M * (q[0] * cy + q[2] * sy), O[1] - M * (-q[0] * sy * sp + q[1] * cp + q[2] * cy * sp)]; };
      var depth = function (q) { return -q[0] * sy * cp - q[1] * sp + q[2] * cy * cp; };
      var v3 = {
        add: function (a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; },
        sub: function (a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; },
        mul: function (a, k) { return [a[0] * k, a[1] * k, a[2] * k]; },
        dot: function (a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; },
        len: function (a) { return Math.hypot(a[0], a[1], a[2]); },
        unit: function (a) { var l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; }
      };
      var UA = 0.186 * Hm, FA = 0.146 * Hm, GR = 0.045 * Hm, ROPE = 0.42;
      var S = { r: [0.175, 0.818 * Hm, 0], l: [-0.175, 0.818 * Hm, 0] };
      var PUL = [0, 1.72, 1.3];
      var udir = function (h, e, side) { return [side * Math.cos(e) * Math.sin(h), Math.sin(e), Math.cos(e) * Math.cos(h)]; };
      var slerp = function (a, b, t) {
        var d = clamp(v3.dot(a, b), -1, 1), w = Math.acos(d);
        if (w < 1e-4) return a;
        var s1 = Math.sin((1 - t) * w) / Math.sin(w), s2 = Math.sin(t * w) / Math.sin(w);
        return v3.unit(v3.add(v3.mul(a, s1), v3.mul(b, s2)));
      };
      // start: arm reaching to the pulley; finish: elbow out, back and a little high, hand beside the ear
      var D0 = v3.unit(v3.sub([0.1, PUL[1], PUL[2]], S.r));
      var h0 = Math.atan2(D0[0], D0[2]), e0 = Math.asin(D0[1]);
      var h1 = 128 * D2R, e1 = 9 * D2R;
      var E1 = v3.add(S.r, v3.mul(udir(h1, e1, 1), UA));
      var F1 = v3.unit(v3.sub([0.13, 1.66, 0.02], E1));
      var side = function (P, sgn) {
        var h = lerp(h0, h1, P), e = lerp(e0, e1, P);
        var q = smooth((P - 0.15) / 0.85);
        var s = sgn > 0 ? S.r : S.l;
        var du = udir(h, e, sgn), E = v3.add(s, v3.mul(du, UA));
        var f = slerp(D0, F1, q); f = [sgn * f[0], f[1], f[2]];
        var W = v3.add(E, v3.mul(f, FA)), G = v3.add(W, v3.mul(f, GR));
        return { S: s, E: E, W: W, G: G };
      };
      var tp = TP.facepull;

      // static body (metres)
      var C = function (parent, a, b, ra, rb, cls) { return mk("path", { d: capPath(proj(a), proj(b), ra * M, rb * M), "class": cls }, parent); };
      // cable stack ahead
      // pulley on a short upright (the rest of the stack is out of shot, behind the figure)
      C(svg, [0, PUL[1], PUL[2] + 0.07], [0, 2.3, PUL[2] + 0.07], 0.04, 0.04, "sm-eq");
      var pul2 = proj(PUL);
      mk("circle", { cx: n2(pul2[0]), cy: n2(pul2[1]), r: n2(0.055 * M), "class": "sm-hub" }, svg);
      var cable = mk("line", { "class": "sm-cable" }, svg);
      traceOf(svg, function (u) { return proj(side(u, -1).G); }, 40);
      var far = mk("g", { "class": "sm-far" }, svg);
      var ropeL = mk("line", { "class": "sm-rope" }, far);
      var lua = mk("path", { "class": "sm-fl" }, far), lfa = mk("path", { "class": "sm-fl" }, far), lfi = mk("path", { "class": "sm-fl" }, far);
      // legs (static), feet hip-width
      var legs = mk("g", {}, svg);
      [-1, 1].forEach(function (sg) {
        var hipJ = [sg * 0.09, 0.53 * Hm, 0], kn = [sg * 0.1, 0.285 * Hm, 0.01], an = [sg * 0.11, 0.039 * Hm, 0];
        C(legs, kn, an, 0.05, 0.035, sg > 0 ? "sm-skin" : "sm-skin");
        C(legs, hipJ, kn, 0.075, 0.055, "sm-skin");
        C(legs, [sg * 0.11, 0.03, -0.04], [sg * 0.12, 0.025, 0.17], 0.035, 0.03, "sm-skin");
      });
      // torso from behind: back silhouette
      var back = [[0, 1.5], [0.07, 1.495], [0.16, 1.47], [0.215, 1.44], [0.235, 1.39], [0.2, 1.3], [0.17, 1.15], [0.15, 1.05],
                  [0.165, 0.97], [0.17, 0.88], [0.09, 0.82], [0, 0.84]];
      var outline = back.concat(back.slice(1, -1).reverse().map(function (q) { return [-q[0], q[1]]; }));
      var tor = catmull(outline.map(function (q) { return proj([q[0], q[1], -0.06 + 0.02 * (Math.abs(q[0]) > 0.2 ? 1 : 0)]); }), 4);
      mk("path", { d: tor.d, "class": "sm-skin" }, svg);
      // shoulder blades hint
      [-1, 1].forEach(function (sg) { mk("path", { d: "M" + proj([sg * 0.06, 1.42, -0.09]).map(n2).join(",") + "L" + proj([sg * 0.11, 1.28, -0.09]).map(n2).join(","), "class": "sm-ear" }, svg); });
      // neck and head
      C(svg, [0, 1.47, -0.01], [0, 1.58, 0.0], 0.055, 0.05, "sm-skin");
      [-1, 1].forEach(function (sg) { var e = proj([sg * 0.08, 1.645, 0.0]); mk("ellipse", { cx: n2(e[0]), cy: n2(e[1]), rx: n2(0.022 * M), ry: n2(0.035 * M), "class": "sm-skin" }, svg); });
      var hc = proj([0, 1.665, 0.0]);
      mk("ellipse", { cx: n2(hc[0]), cy: n2(hc[1]), rx: n2(0.08 * M), ry: n2(0.112 * M), "class": "sm-skin" }, svg);
      var ropeR = mk("line", { "class": "sm-rope" }, svg);
      var rua = mk("path", { "class": "sm-skin" }, svg), rfa = mk("path", { "class": "sm-skin" }, svg), rfi = mk("path", { "class": "sm-skin" }, svg);
      var knot = mk("circle", { r: n2(0.03 * M), "class": "sm-eq" }, svg);

      var last = null;
      var draw = function (t) {
        var p = tp(t), R = side(p, 1), Lf = side(p, -1);
        // rope junction on the cable line, ROPE metres from each hand
        var mid = v3.mul(v3.add(R.G, Lf.G), 0.5), u = v3.unit(v3.sub(mid, PUL)), w = v3.sub(PUL, R.G);
        var b = v3.dot(u, w), c = v3.dot(w, w) - ROPE * ROPE, s = -b - Math.sqrt(Math.max(0, b * b - c));
        var J = v3.add(PUL, v3.mul(u, s));
        last = { R: R, L: Lf, J: J, p: p };
        var pj = proj(J);
        setLine(cable, pul2, pj); setLine(ropeR, pj, proj(Lf.G)); setLine(ropeL, pj, proj(R.G));
        knot.setAttribute("cx", n2(pj[0])); knot.setAttribute("cy", n2(pj[1]));
        var arm = function (q, ua, fa, fi) {
          ua.setAttribute("d", capPath(proj(q.S), proj(q.E), 0.05 * M, 0.037 * M));
          fa.setAttribute("d", capPath(proj(q.E), proj(q.W), 0.04 * M, 0.028 * M));
          fi.setAttribute("d", capPath(proj(q.W), proj(v3.add(q.W, v3.mul(v3.unit(v3.sub(q.G, q.W)), 0.09))), 0.034 * M, 0.038 * M));
        };
        // near (ink) = the left arm, the shoulder this page cares about
        arm(Lf, rua, rfa, rfi); arm(R, lua, lfa, lfi);
      };
      svg.__sm = {
        W: 300, is3d: true,
        probe: function () {
          var q = last, segs = [];
          [["right", q.R], ["left", q.L]].forEach(function (x) {
            var px = function (a) { return a.map(function (c) { return c * M; }); };
            segs.push([x[0] + " upper arm", px(x[1].S), px(x[1].E), UA * M], [x[0] + " forearm", px(x[1].E), px(x[1].W), FA * M], [x[0] + " rope strand", px(q.J), px(x[1].G), ROPE * M]);
          });
          return {
            segs: segs, caps: [], outlines: [],
            fixed: [["right shoulder", q.R.S], ["left shoulder", q.L.S], ["pulley", PUL]].map(function (f) { return [f[0], f[1].map(function (c) { return c * M; })]; }),
            extra: {
              elbowRise: Math.min(q.R.E[1] - q.R.S[1], q.L.E[1] - q.L.S[1]),
              elbowWide: q.L.S[0] - q.L.E[0], p: q.p,
              handToEar: Math.hypot(q.L.G[0] + 0.08, q.L.G[1] - 1.645, q.L.G[2]),
              handAboveElbow: q.L.W[1] - q.L.E[1], elbowBehind: -q.L.E[2], handSpread: q.R.G[0] - q.L.G[0]
            }
          };
        }
      };
      return draw;
    }
  };

  // =====================================================================
  // 3. Romanian deadlift (side)
  // =====================================================================
  A.rdl = {
    period: TP.rdl.period,
    view: "0 0 300 200",
    cap: "Side view. Soft knees, hips back, bar slides down your thighs to just below the knee.",
    label: "Side view of a barbell Romanian deadlift. Starting tall with soft knees, the hips push straight back while the torso tips forward with a flat back. The knee angle stays fixed and the bar slides down the thighs in a vertical line over the middle of the foot, stopping just below the knee before the hips drive forward to stand tall again.",
    build: function (svg) {
      var M = 98, H = 1.78 * M, FY = 190, fig = figure(H), L = fig.L;
      var AX = 138, AY = FY - 0.039 * H, BX = AX + 0.038 * H, BR = 0.014 * M, PR = 0.225 * M;
      var FAR = [-0.014 * H, 0], KF = 22, Aeff = (L.ua + L.fa + L.grip) * 0.998;
      var legCaps = function (k, hp) { return [["t", hp, k, fig.R.thigh[0], fig.R.thigh[1], fig.R.thigh[3]], ["s", k, [AX, AY], fig.R.shank[0], fig.R.shank[1], fig.R.shank[2]]]; };
      var build1 = function (e, phi) {
        var k = fk([AX, AY], L.shank, phi), hp = fk(k, L.thigh, phi - KF), ta = -e, sh = fig.shoulder(hp, ta);
        var dx = BX - sh[0], B = [BX, sh[1] + Math.sqrt(Math.max(0, Aeff * Aeff - dx * dx))];
        return { k: k, hip: hp, ta: ta, sh: sh, B: B };
      };
      var gapOf = function (q) { return Math.min.apply(null, legCaps(q.k, q.hip).map(function (c) { return capGap(q.B, BR, c); })); };
      var solvePhi = function (e) { return bisect(function (ph) { return gapOf(build1(e, ph)); }, -125, -70); };
      var at = function (e) { return build1(e, solvePhi(e)); };
      var eTop = 86, eBot = bisect(function (e) { var q = at(e); return q.B[1] - (q.k[1] + 0.035 * H); }, 8, 70);
      var pose = function (p) {
        var q = at(lerp(eTop, eBot, p));
        var nl = { h: q.hip, k: q.k, a: [AX, AY], f: 0 };
        var fl = { h: add(q.hip, FAR), k: add(q.k, FAR), a: [AX + FAR[0], AY], f: 0 };
        return { hip: q.hip, ta: q.ta, neck: 6 * p, B: q.B, nl: nl, fl: fl, na: fig.armTo(q.sh, q.B, [-1, 0]), fa: fig.armTo(add(q.sh, FAR), add(q.B, FAR), [-1, 0]) };
      };
      var tp = TP.rdl;
      floorLine(svg, FY, 10, 290);
      var top = pose(0).B, bot = pose(1).B;
      line(svg, [BX, top[1] - 6], [BX, bot[1] + 6], "sm-trace");
      var pl = plateSet(svg, PR, 0.025 * M, [-0.05 * M, 0]);
      fig.farArm(svg); fig.farLeg(svg); fig.body(svg); fig.nearLeg(svg); fig.nearArm(svg);
      var front = pl.front(svg), last = null;
      var draw = function (t) { var P = pose(tp(t)); last = P; fig.set(P); pl.set(front, P.B); };
      svg.__sm = {
        W: 300,
        probe: function () {
          var pr = fig.probe(), P = last;
          pr.fixed = [["near foot", P.nl.a], ["far foot", P.fl.a]];
          pr.floorY = FY; pr.barX = P.B[0];
          pr.reach = [["near hand on bar", reachErr(P.na, fig)], ["far hand on bar", reachErr(P.fa, fig)]];
          pr.bars = [{ name: "bar", c: P.B, r: BR, ignore: ["near hand", "far hand", "near forearm", "far forearm", "far thigh", "far shank"] }];
          pr.extra = { kneeAngle: 180 - Math.abs(angOf(P.nl.k, P.nl.h) - angOf(P.nl.a, P.nl.k)), armFromVertical: angOf(P.na.s, P.B) - 90, barBelowKnee: (P.B[1] - P.nl.k[1]) / H };
          return pr;
        }
      };
      return draw;
    }
  };

  // =====================================================================
  // 4. Deadlift (side)
  // =====================================================================
  A.deadlift = {
    period: TP.deadlift.period,
    view: "0 0 300 200",
    cap: "Side view. Bar over mid-foot, hips and shoulders rise together, then the hips come through.",
    label: "Side view of a conventional barbell deadlift. The bar starts on the floor over the middle of the foot with the shins touching it and the back flat. Hips and shoulders rise together while the bar drags straight up the shins, and once it passes the knees the hips come through to a tall lockout with no lean back. The bar is lowered the same way, in the same vertical line.",
    build: function (svg) {
      var M = 98, H = 1.78 * M, FY = 192, fig = figure(H), L = fig.L;
      var AX = 126, AY = FY - 0.039 * H, BX = AX + 0.042 * H, BR = 0.014 * M, PR = 0.225 * M;
      var FAR = [-0.014 * H, 0], Aeff = (L.ua + L.fa + L.grip) * 0.998, yFloor = FY - PR, ANK = [AX, AY];
      var build1 = function (yb, e, al) {
        var B = [BX, yb], sh = [BX + Aeff * Math.sin(al * D2R), yb - Aeff * Math.cos(al * D2R)];
        var ta = -e, hp = fk(sh, -L.torso, ta), k = ik(ANK, hp, L.shank, L.thigh, [1, 0]);
        return { B: B, sh: sh, ta: ta, hip: hp, k: k, e: e, al: al };
      };
      var legGap = function (q) {
        return Math.min(frontGap(q.B, BR, ["s", q.k, ANK, fig.R.shank[0], fig.R.shank[1], fig.R.shank[2]]),
                        frontGap(q.B, BR, ["t", q.hip, q.k, fig.R.thigh[0], fig.R.thigh[1], fig.R.thigh[2]]));
      };
      // the bar is dragged up the legs: for a bar height and back angle, the arm angle is whatever keeps it in contact
      var contact = function (yb, e) {
        var f = function (al) { return legGap(build1(yb, e, al)); };
        if (f(-25) < 0) return build1(yb, e, -25);
        if (f(30) > 0) return build1(yb, e, 30);
        return build1(yb, e, bisect(f, -25, 30, 40));
      };
      var Dk = Math.sqrt(L.thigh * L.thigh + L.shank * L.shank - 2 * L.thigh * L.shank * Math.cos(177 * D2R));
      var reach = function (q) { return Dk - dist(ANK, q.hip); };
      // set-up: shoulder blades over the bar (shoulder joint a few degrees ahead), shins on the bar
      var a0 = 6;
      var e0 = bisect(function (e) { return legGap(build1(yFloor, e, a0)); }, 10, 75);
      // lockout: torso vertical, bar against the thighs, knees just short of dead straight
      var yTop = bisect(function (y) { return reach(contact(y, 90)); }, yFloor - 0.2 * H, yFloor - 0.5 * H);
      var aTop = contact(yTop, 90).al;
      var kneeAng = function (q) { return 180 - Math.abs(angOf(q.k, q.hip) - angOf(ANK, q.k)); };
      var shinFwd = function (q) { return angOf(ANK, q.k) + 90; };
      // key positions, each solved with the bar touching the legs ("drag it up your legs"):
      // set-up, mid-shin, bar at the knees with shins vertical, two on the thighs as the hips come through, lockout
      var yb1 = AY - L.shank - 0.03 * H;
      var e1 = bisect(function (e) { return contact(yb1, e).al - 4; }, e0, 70);
      // above the knees the knees keep extending while the hips come through: key by knee angle
      var thighKey = function (y, knee) { return contact(y, bisect(function (e) { return kneeAng(contact(y, e)) - knee; }, e1, 90)); };
      var Q = [build1(yFloor, e0, a0), contact(lerp(yFloor, yb1, 0.45), lerp(e0, e1, 0.4)), contact(lerp(yFloor, yb1, 0.8), lerp(e0, e1, 0.78)), contact(yb1, e1),
               thighKey(lerp(yb1, yTop, 0.35), 152), thighKey(lerp(yb1, yTop, 0.7), 166), contact(yTop, 90)];
      var keyS = Q.map(function (q) { return (q.B[1] - yFloor) / (yTop - yFloor); });
      var cv = [0, 1, 2].map(function (i) {
        return mono(Q.map(function (q, j) { return [keyS[j], [angOf(ANK, q.k), angOf(q.k, q.hip), q.e][i]]; }));
      });
      var drive = function (s) {
        var k = fk(ANK, L.shank, cv[0](s)), hp = fk(k, L.thigh, cv[1](s)), e = cv[2](s), sh = fig.shoulder(hp, -e);
        var dx = BX - sh[0], B = [BX, sh[1] + Math.sqrt(Math.max(0, Aeff * Aeff - dx * dx))];
        return { B: B, sh: sh, ta: -e, hip: hp, k: k, e: e, al: Math.asin(clamp(-dx / Aeff, -1, 1)) / D2R };
      };
      var pose = function (s) {
        var q = drive(s);
        var nl = { h: q.hip, k: q.k, a: ANK, f: 0 }, fl = { h: add(q.hip, FAR), k: add(q.k, FAR), a: [AX + FAR[0], AY], f: 0 };
        return { hip: q.hip, ta: q.ta, neck: 0, B: q.B, q: q, nl: nl, fl: fl, na: fig.armTo(q.sh, q.B, [-1, 0]), fa: fig.armTo(add(q.sh, FAR), add(q.B, FAR), [-1, 0]) };
      };
      var tp = TP.deadlift;
      floorLine(svg, FY, 10, 290);
      line(svg, [BX, yTop - 6], [BX, yFloor], "sm-trace");
      var pl = plateSet(svg, PR, 0.025 * M, [-0.05 * M, 0]);
      fig.farArm(svg); fig.farLeg(svg); fig.body(svg); fig.nearLeg(svg); fig.nearArm(svg);
      var front = pl.front(svg), last = null;
      var draw = function (t) { var P = pose(tp(t)); last = P; fig.set(P); pl.set(front, P.B); };
      svg.__sm = {
        W: 300,
        probe: function () {
          var pr = fig.probe(), P = last;
          pr.fixed = [["near foot", P.nl.a], ["far foot", P.fl.a]];
          pr.floorY = FY; pr.barX = P.B[0];
          pr.reach = [["near hand on bar", reachErr(P.na, fig)], ["far hand on bar", reachErr(P.fa, fig)]];
          pr.bars = [{ name: "bar", c: P.B, r: BR, ignore: ["near hand", "far hand", "near forearm", "far forearm", "far thigh", "far shank"] }];
          pr.circles = [{ name: "plate on floor", c: P.B, r: PR }];
          pr.extra = { torsoElev: P.q.e, armAngle: P.q.al, barHeight: (FY - P.B[1]) / M, legGap: legGap(P.q), e0: e0, e1: e1,
            kneeAngle: 180 - Math.abs(angOf(P.nl.k, P.nl.h) - angOf(P.nl.a, P.nl.k)), shinFwd: angOf(P.nl.a, P.nl.k) + 90, hipHeight: (FY - P.hip[1]) / M };
          return pr;
        }
      };
      return draw;
    }
  };

  // =====================================================================
  // 5. Barbell hip thrust (side)
  // =====================================================================
  A.hipthrust = {
    period: TP.hipthrust.period,
    view: "0 0 300 200",
    cap: "Side view. Upper back pivots on the bench edge. Drive up to a flat tabletop, chin tucked.",
    label: "Side view of a barbell hip thrust. The shoulder blades rest on the edge of a flat bench, feet flat, and the bar sits over the hip crease. The hips drive up, pivoting on the bench edge, until the shins are vertical and the thighs and torso form a flat tabletop. The chin stays tucked so the head follows the torso. The hips then lower slowly towards the floor.",
    build: function (svg) {
      var M = 150, H = 1.78 * M, FY = 190, fig = figure(H), L = fig.L;
      var BH = 0.43 * M, EX = 74, E = [EX, FY - BH];
      var uc = 0.235 * H, vc = -0.066 * H, PR = 0.225 * M, BR = 0.014 * M;
      var bu = 0.05 * H, bv = 0.057 * H + 0.034 * M;
      var FAR = [0.012 * H, 0];
      var geo = function (b) {
        var dT = [-Math.cos(b * D2R), -Math.sin(b * D2R)], an = [Math.sin(b * D2R), -Math.cos(b * D2R)];
        var hp = [E[0] - uc * dT[0] - vc * an[0], E[1] - uc * dT[1] - vc * an[1]];
        return { hip: hp, ta: 180 + b, bar: [hp[0] + bu * dT[0] + bv * an[0], hp[1] + bu * dT[1] + bv * an[1]] };
      };
      var AY = FY - 0.039 * H;
      var kneeTop = function (g) { var dy = AY - L.shank - g.hip[1]; return [g.hip[0] + Math.sqrt(L.thigh * L.thigh - dy * dy), AY - L.shank]; };
      // top: thigh continues the torso line (tabletop) with the shin vertical
      var bTop = bisect(function (b) { var g = geo(b); return angOf(g.hip, kneeTop(g)) - b; }, -8, 20);
      var AX = kneeTop(geo(bTop))[0];
      var low = function (b) { var g = geo(b); return lowest(fig.torsoSamples, g.hip, g.ta); };
      var bPlate = bisect(function (b) { return geo(b).bar[1] + PR - FY; }, bTop, 60);
      var bGlute = bisect(function (b) { return low(b) - (FY - 0.012 * M); }, bTop, 60);
      // the folding thigh must not push through the bar either
      var thighGap = function (b) { var g = geo(b), kk = ik([AX, AY], g.hip, L.shank, L.thigh, [0.2, -1]); return capGap(g.bar, BR, ["t", g.hip, kk, fig.R.thigh[0], fig.R.thigh[1], fig.R.thigh[2]]); };
      var bThigh = thighGap(60) >= 0 ? 60 : bisect(thighGap, bTop, 60);
      var bBot = Math.min(bPlate, bGlute, bThigh);
      var pose = function (p) {
        var g = geo(lerp(bBot, bTop, p)), sh = fig.shoulder(g.hip, g.ta);
        return {
          hip: g.hip, ta: g.ta, neck: 28, B: g.bar,
          nl: fig.legIK(g.hip, [AX, AY], [0.2, -1]), fl: fig.legIK(add(g.hip, FAR), [AX + FAR[0], AY], [0.2, -1]),
          na: fig.armTo(sh, g.bar, [0, 1]), fa: fig.armTo(add(sh, FAR), add(g.bar, FAR), [0, 1])
        };
      };
      var tp = TP.hipthrust;
      floorLine(svg, FY, 6, 294);
      traceOf(svg, function (u) { return geo(lerp(bBot, bTop, u)).bar; }, 30);
      // bench: pad + frame
      mk("path", { d: "M" + n2(EX - 0.05 * M) + "," + n2(E[1] + 0.07 * M) + "L" + n2(EX - 0.12 * M) + "," + FY + "M" + n2(EX - 0.05 * M) + "," + n2(E[1] + 0.07 * M) + "L" + n2(4) + "," + n2(E[1] + 0.07 * M), "class": "sm-eq-line", "stroke-width": "4" }, svg);
      mk("rect", { x: -10, y: n2(E[1]), width: n2(EX + 10), height: n2(0.07 * M), rx: 4, "class": "sm-pad" }, svg);
      var pl = plateSet(svg, PR, 0.025 * M, [0.045 * M, 0]);
      fig.farLeg(svg); fig.farArm(svg); fig.body(svg); fig.nearLeg(svg); fig.nearArm(svg);
      var front = pl.front(svg), last = null;
      var draw = function (t) { var P = pose(tp(t)); last = P; fig.set(P); pl.set(front, P.B); };
      svg.__sm = {
        W: 300,
        probe: function () {
          var pr = fig.probe(), P = last;
          pr.fixed = [["near foot", P.nl.a], ["far foot", P.fl.a], ["bench contact on back", loc(P.hip, P.ta, uc, vc)]];
          pr.floorY = FY;
          pr.reach = [["near hand on bar", reachErr(P.na, fig)], ["far hand on bar", reachErr(P.fa, fig)]];
          pr.rects = [{ name: "bench pad", x: -10, y: E[1], w: EX + 10, h: 0.07 * M, ignore: ["near upper arm", "far upper arm", "near forearm", "far forearm", "near hand", "far hand"] }];
          pr.bars = [{ name: "bar", c: P.B, r: BR, ignore: ["near hand", "far hand", "near forearm", "far forearm", "far thigh", "far shank"] }];
          pr.circles = [{ name: "plate on floor", c: P.B, r: PR }];
          pr.extra = {
            torsoElev: P.ta - 180, thighElev: -angOf(P.nl.h, P.nl.k) , shinFromVertical: angOf(P.nl.a, P.nl.k) + 90,
            gluteClear: FY - lowest(fig.torsoSamples, P.hip, P.ta), plateClear: FY - (P.B[1] + PR), bTop: bTop, bBot: bBot, bPlate: bPlate, bGlute: bGlute, bThigh: bThigh, hipAngle: 180 - (P.ta - 180) + angOf(P.nl.h, P.nl.k)
          };
          return pr;
        }
      };
      return draw;
    }
  };

  // =====================================================================
  // 6. DB Bulgarian split squat (side)
  // =====================================================================
  A.bulgarian = {
    period: TP.bulgarian.period,
    view: "0 0 300 200",
    cap: "Side view. Rear foot laces-down on the bench. Drop straight down until the back knee nearly touches.",
    label: "Side view of a dumbbell Bulgarian split squat. The rear foot rests laces-down on a flat bench and the dumbbells hang at the sides. The body drops straight down, with a slight forward lean and the front shin angling a little forward, until the back knee is just above the floor, then drives back up through the front foot.",
    build: function (svg) {
      var M = 98, H = 1.78 * M, FY = 190, fig = figure(H), L = fig.L;
      var BH = 0.43 * M, EX = 86, PADT = BH - 0.07 * M, padTop = FY - BH;
      var FAR = [-0.012 * H, 0], Aeff = (L.ua + L.fa + L.grip) * 0.998;
      // rear foot laces-down on the pad, toes pointing back
      var RF = 186;
      var lowRel = lowest(fig.footSamples, [0, 0], RF);
      var RA = [EX + 0.02 * H, padTop - lowRel];
      var HX = RA[0] + 0.2 * H, FA = [HX + 0.175 * H, FY - 0.039 * H];
      var eTop = 84, eBot = 77;
      var hipAt = function (y) { return [HX, y]; };
      var rearKnee = function (hp) { return ik(RA, hp, L.shank, L.thigh, [0.3, 1]); };
      var Dtop = Math.sqrt(L.thigh * L.thigh + L.shank * L.shank - 2 * L.thigh * L.shank * Math.cos(162 * D2R));
      var yTop = FA[1] - Math.sqrt(Dtop * Dtop - Math.pow(HX - FA[0], 2));
      var kneeLow = function (y) { var k = rearKnee(hipAt(y)); return k[1] + fig.R.thigh[1]; };
      var yBot = bisect(function (y) { return kneeLow(y) - (FY - 0.03 * M); }, yTop, FY - 0.1 * H);
      var pose = function (p) {
        var hp = hipAt(lerp(yTop, yBot, p)), ta = -lerp(eTop, eBot, p), sh = fig.shoulder(hp, ta);
        var g = [sh[0] + 0.012 * H, sh[1] + Aeff];
        return {
          hip: hp, ta: ta, neck: 4,
          nl: fig.legIK(hp, FA, [1, 0]), fl: { h: add(hp, FAR), k: add(rearKnee(hp), FAR), a: add(RA, FAR), f: RF },
          na: fig.armTo(sh, g, [-1, 0]), fa: fig.armTo(add(sh, FAR), add(g, FAR), [-1, 0])
        };
      };
      var tp = TP.bulgarian;
      floorLine(svg, FY, 6, 294);
      // bench
      mk("path", { d: "M" + n2(EX - 0.08 * M) + "," + n2(padTop + 0.07 * M) + "L" + n2(EX - 0.14 * M) + "," + FY + "M" + n2(EX - 0.08 * M) + "," + n2(padTop + 0.07 * M) + "L0," + n2(padTop + 0.07 * M), "class": "sm-eq-line", "stroke-width": "3.5" }, svg);
      mk("rect", { x: -10, y: n2(padTop), width: n2(EX + 10), height: n2(0.07 * M), rx: 3, "class": "sm-pad" }, svg);
      var p0 = fig.gripOf(pose(0).na), p1 = fig.gripOf(pose(1).na);
      line(svg, [p0[0], p0[1] - 4], [p1[0], p1[1] + 4], "sm-trace");
      var db = function (parent, cls) {
        var g = mk("g", {}, parent), hw = 0.06 * M, hh = 0.065 * M;
        mk("rect", { x: n2(-0.08 * M), y: n2(-0.012 * M), width: n2(0.16 * M), height: n2(0.024 * M), "class": cls }, g);
        mk("rect", { x: n2(-0.08 * M - hw), y: n2(-hh), width: n2(hw), height: n2(2 * hh), rx: 2, "class": cls }, g);
        mk("rect", { x: n2(0.08 * M), y: n2(-hh), width: n2(hw), height: n2(2 * hh), rx: 2, "class": cls }, g);
        return g;
      };
      var farG = fig.farArm(svg); var dbF = db(farG, "sm-fl");
      fig.farLeg(svg); fig.body(svg); fig.nearLeg(svg);
      var dbN = db(svg, "sm-eq");
      fig.nearArm(svg);
      var last = null;
      var draw = function (t) {
        var P = pose(tp(t)); last = P; fig.set(P);
        tf(dbN, fig.gripOf(P.na), 0); tf(dbF, fig.gripOf(P.fa), 0);
      };
      svg.__sm = {
        W: 300,
        probe: function () {
          var pr = fig.probe(), P = last;
          pr.fixed = [["front foot", P.nl.a], ["rear foot on bench", P.fl.a], ["hip x (drops straight down)", [P.hip[0], 0]]];
          pr.floorY = FY;
          pr.reach = [["near hand", reachErr(P.na, fig)], ["far hand", reachErr(P.fa, fig)]];
          var g = fig.gripOf(P.na);
          pr.rects = [{ name: "bench pad", x: -10, y: padTop, w: EX + 10, h: 0.07 * M, ignore: [] }];
          pr.lowPts = [["dumbbell", g[1] + 0.065 * M]];
          pr.extra = { rearKneeGap: (FY - (P.fl.k[1] + fig.R.thigh[1])) / M, frontShin: angOf(P.nl.a, P.nl.k) + 90, frontThigh: -angOf(P.nl.h, P.nl.k) };
          return pr;
        }
      };
      return draw;
    }
  };

  // =====================================================================
  // 7. Ab wheel rollout (side)
  // =====================================================================
  A.rollout = {
    period: TP.rollout.period,
    view: "0 0 300 200",
    cap: "Side view. Knees, hips and shoulders finish in one straight line. No sag, then pull back.",
    label: "Side view of a kneeling ab wheel rollout. Starting on the knees with the wheel under the shoulders, the wheel rolls forward while the hips extend, so that at full reach the knees, hips and shoulders form one straight line with no sag in the lower back and the arms reaching long. The abs then pull the wheel back to the start.",
    build: function (svg) {
      var M = 126, H = 1.78 * M, FY = 178, fig = figure(H), L = fig.L;
      var RW = 0.09 * M, AXY = FY - RW, Aeff = (L.ua + L.fa + L.grip) * 0.997;
      var K = [74, FY - fig.R.thigh[1]];
      var FAR = [-0.01 * H, 0];
      var RF = 183, ankY = FY - lowest(fig.footSamples, [0, 0], RF);
      var AN = [K[0] - Math.sqrt(L.shank * L.shank - Math.pow(ankY - K[1], 2)), ankY];
      var geo = function (psi, tau) {
        var hp = fk(K, L.thigh, -psi), ta = -tau, sh = fig.shoulder(hp, ta);
        var dy = AXY - sh[1], hx = sh[0] + Math.sqrt(Math.max(0, Aeff * Aeff - dy * dy));
        return { hip: hp, ta: ta, sh: sh, G: [hx, AXY] };
      };
      var psi0 = 78, psi1 = 20;
      var tau0 = bisect(function (tau) { var g = geo(psi0, tau); return angOf(g.sh, g.G) - 84; }, 10, 80);
      var pose = function (p) {
        var g = geo(lerp(psi0, psi1, p), lerp(tau0, psi1, Math.pow(p, 0.85)));
        return {
          hip: g.hip, ta: g.ta, neck: 6, G: g.G,
          nl: { h: g.hip, k: K, a: AN, f: RF }, fl: { h: add(g.hip, FAR), k: add(K, FAR), a: add(AN, FAR), f: RF },
          na: fig.armTo(g.sh, g.G, [-1, -0.2]), fa: fig.armTo(add(g.sh, FAR), add(g.G, FAR), [-1, -0.2])
        };
      };
      var x0 = pose(0).G[0], x1 = pose(1).G[0];
      var tp = TP.rollout;
      floorLine(svg, FY, 6, 294);
      line(svg, [x0 - 4, AXY], [x1 + 4, AXY], "sm-trace");
      fig.farLeg(svg); fig.farArm(svg); fig.body(svg); fig.nearLeg(svg);
      var wheel = mk("g", {}, svg);
      mk("circle", { r: n2(RW - 0.012 * M), "class": "sm-hub" }, wheel);
      mk("circle", { r: n2(RW - 0.006 * M), fill: "none", "class": "sm-eq-line", "stroke-width": n2(0.022 * M) }, wheel);
      var spokes = mk("g", {}, wheel);
      [0, 60, 120].forEach(function (a) { var p = fk([0, 0], RW - 0.02 * M, a); line(spokes, [-p[0], -p[1]], p, "sm-eq-line").setAttribute("stroke-width", "1.5"); });
      fig.nearArm(svg);
      var last = null;
      var draw = function (t) {
        var P = pose(tp(t)); last = P; fig.set(P);
        wheel.setAttribute("transform", "translate(" + n2(P.G[0]) + "," + n2(P.G[1]) + ")");
        spokes.setAttribute("transform", "rotate(" + n2((P.G[0] - x0) / RW / D2R) + ")");
      };
      svg.__sm = {
        W: 300,
        probe: function () {
          var pr = fig.probe(), P = last;
          pr.fixed = [["near knee", P.nl.k], ["far knee", P.fl.k], ["near foot", P.nl.a], ["far foot", P.fl.a]];
          pr.floorY = FY;
          pr.reach = [["near hand on wheel", reachErr(P.na, fig)], ["far hand on wheel", reachErr(P.fa, fig)]];
          pr.circles = [{ name: "wheel on floor", c: P.G, r: RW }];
          var sh = fig.shoulder(P.hip, P.ta);
          pr.extra = { hipAngle: 180 - Math.abs(angOf(P.hip, sh) - angOf(K, P.hip)), lineDev: segDist(P.hip, K, sh).d / H * 100, shoulderFlex: Math.abs(angOf(sh, P.G) - angOf(sh, P.hip)) };
          return pr;
        }
      };
      return draw;
    }
  };

  // =====================================================================
  // 8. Dead bug (side, lying on the back)
  // =====================================================================
  A.deadbug = {
    period: TP.deadbug.period * 2,
    view: "0 0 300 200",
    cap: "Side view. Lower back stays flat on the floor. Opposite arm and leg reach out, then swap.",
    label: "Side view of a dead bug, lying on the back with the arms pointing straight up and the hips and knees bent to 90 degrees. The lower back stays pressed flat into the floor while one arm reaches back overhead and the opposite leg straightens out, both hovering just above the floor. They return together and the other arm and leg repeat.",
    build: function (svg) {
      var M = 112, H = 1.78 * M, FY = 168, fig = figure(H, { torso: "flat" }), L = fig.L;
      var HIPY = FY - 0.0685 * H, hip = [172, HIPY], ta = 180, sh = fig.shoulder(hip, ta);
      var FAR = [-0.006 * H, -0.014 * H];
      var nb = fig.neckBase(hip, ta);
      var neck = bisect(function (n) { return lowest(fig.headSamples, nb, ta + n) - FY; }, -40, 30);
      var arm = function (s, u) { return fig.armFK(s, lerp(-90, -177, u), lerp(-92, -180, u)); };
      var leg = function (h, u) {
        var th = lerp(-90, -5, u), shk = lerp(0, -1.5, u);
        return fig.legFK(h, th, shk, shk - 90 + 8 * u);
      };
      var half = TP.deadbug;
      var pose = function (t) {
        var first = t < 0.5, u = half(first ? t * 2 : t * 2 - 1);
        var a = first ? u : 0, b = first ? 0 : u; // a: near leg + far arm, b: far leg + near arm
        return { hip: hip, ta: ta, neck: neck, nl: leg(hip, a), fl: leg(add(hip, FAR), b), na: arm(sh, b), fa: arm(add(sh, FAR), a) };
      };
      floorLine(svg, FY, 6, 294);
      traceOf(svg, function (u) { return fig.gripOf(arm(sh, u)); }, 30);
      traceOf(svg, function (u) { var q = leg(hip, u); return loc(q.a, q.f, -0.035 * H, 0.03 * H); }, 30);
      fig.farArm(svg); fig.farLeg(svg); fig.body(svg); fig.nearLeg(svg); fig.nearArm(svg);
      var last = null;
      var draw = function (t) { var P = pose(t); last = P; fig.set(P); };
      svg.__sm = {
        W: 300,
        probe: function () {
          var pr = fig.probe(), P = last;
          pr.fixed = [["pelvis", P.hip], ["shoulders", sh]];
          pr.floorY = FY;
          var backPts = fig.torsoSamples.filter(function (q) { return q[1] < -0.06 * H; }).map(function (q) { return loc(hip, ta, q[0], q[1]); });
          pr.extra = { backGap: Math.max.apply(null, backPts.map(function (q) { return FY - q[1]; })), heelClear: FY - lowest(fig.footSamples, P.nl.a, P.nl.f) };
          return pr;
        }
      };
      return draw;
    }
  };

  // =====================================================================
  // 9. Straight-arm pulldown (side)
  // =====================================================================
  A.straightarm = {
    period: TP.straightarm.period,
    view: "0 0 300 200",
    cap: "Side view. Elbows soft and fixed, shoulders down. Sweep the bar from eye level to your thighs.",
    label: "Side view of a straight-arm cable pulldown from a high pulley. Standing with a slight hip hinge and soft knees, the elbows stay softly bent at a fixed angle while the bar sweeps down in an arc from eye level to the front of the thighs, with the shoulders kept down. The bar then rises slowly back to eye level.",
    build: function (svg) {
      var M = 86, H = 1.78 * M, FY = 192, fig = figure(H), L = fig.L;
      var AX = 104, AY = FY - 0.039 * H, KF = 14, PHI = -84, BR = 0.014 * M;
      var FAR = [-0.014 * H, 0], ELB = 16;
      var kn = fk([AX, AY], L.shank, PHI), hip = fk(kn, L.thigh, PHI - KF), ta = -70, sh = fig.shoulder(hip, ta);
      var COL = 262, PUL = [COL - 0.06 * M, FY - 2.08 * M];
      var armAt = function (a) { return fig.armFK(sh, a, a - ELB); };
      var gOf = function (a) { return fig.gripOf(armAt(a)); };
      var eyeY = loc(fig.neckBase(hip, ta), ta, 0.1 * H, 0.04 * H)[1];
      var thigh = ["t", hip, kn, fig.R.thigh[0], fig.R.thigh[1], fig.R.thigh[2]];
      var a0 = bisect(function (a) { return gOf(a)[1] - eyeY; }, -40, 40);
      var a1 = bisect(function (a) { return capGap(gOf(a), BR, thigh); }, a0 + 10, 120);
      var tp = TP.straightarm;
      floorLine(svg, FY, 6, 294);
      // cable stack
      mk("rect", { x: n2(COL), y: n2(PUL[1] - 8), width: n2(0.09 * M), height: n2(FY - PUL[1] + 8), rx: 2, "class": "sm-eq" }, svg);
      mk("rect", { x: n2(COL - 0.01 * M), y: n2(FY - 0.06 * M), width: n2(0.25 * M), height: n2(0.06 * M), "class": "sm-eq" }, svg);
      mk("circle", { cx: n2(PUL[0]), cy: n2(PUL[1]), r: n2(0.05 * M), "class": "sm-hub" }, svg);
      traceOf(svg, function (u) { return gOf(lerp(a0 - 3, a1, u)); }, 40);
      var cable = mk("line", { "class": "sm-cable" }, svg);
      var nl = { h: hip, k: kn, a: [AX, AY], f: 0 }, fl = { h: add(hip, FAR), k: add(kn, FAR), a: [AX + FAR[0], AY], f: 0 };
      fig.farArm(svg); fig.farLeg(svg); fig.body(svg); fig.nearLeg(svg); fig.nearArm(svg);
      var bar = mk("circle", { r: n2(0.025 * M), "class": "sm-hub" }, svg);
      var last = null;
      var draw = function (t) {
        var a = lerp(a0, a1, tp(t)), na = armAt(a), fa = fig.armFK(add(sh, FAR), a, a - ELB), g = fig.gripOf(na);
        var P = { hip: hip, ta: ta, neck: -6, nl: nl, fl: fl, na: na, fa: fa, g: g }; last = P;
        fig.set(P); setLine(cable, PUL, g); bar.setAttribute("cx", n2(g[0])); bar.setAttribute("cy", n2(g[1]));
      };
      svg.__sm = {
        W: 300,
        probe: function () {
          var pr = fig.probe(), P = last, hc = loc(fig.neckBase(hip, ta), ta + P.neck, 0.095 * H, 0);
          pr.fixed = [["near foot", P.nl.a], ["far foot", P.fl.a], ["shoulder", P.na.s], ["hip", hip]];
          pr.floorY = FY;
          pr.bars = [{ name: "bar", c: P.g, r: BR, ignore: ["near hand", "far hand", "near forearm", "far forearm"] }];
          pr.extra = { elbowAngle: 180 - Math.abs(angOf(P.na.s, P.na.e) - angOf(P.na.e, P.na.w)), cableToHead: segDist(hc, PUL, P.g).d - 0.075 * H, barVsEye: (P.g[1] - eyeY) };
          return pr;
        }
      };
      return draw;
    }
  };

  // =====================================================================
  // 10. Cable external rotation (top-down, LEFT arm)
  // =====================================================================
  A.externalrot = {
    period: TP.externalrot.period,
    view: "0 0 300 200",
    cap: "From above, left arm. Elbow pinned on the towel. Only the forearm swings out.",
    label: "Cable external rotation seen from directly above, working the left arm. The upper arm hangs at the side with the elbow bent to 90 degrees and pinned against a rolled towel, with the cable coming from the right at elbow height. The forearm swings from across the belly outwards to about 50 degrees past pointing straight ahead, while the elbow stays exactly where it is, then returns slowly.",
    build: function (svg) {
      // top view: x = person's right (screen right), z = forward (screen up), metres
      var M = 232, O = [150, 140], Hm = 1.78;
      var P2 = function (x, z) { return [O[0] + x * M, O[1] - z * M]; };
      var FAL = 0.146 * Hm, GRL = 0.045 * Hm;
      var EL = [-0.245, 0.03];
      var WAIST = { a: 0.152, b: 0.112, z: 0.0 };
      var hand = function (th) { var r = th * D2R; return [EL[0] - Math.sin(r) * (FAL + GRL), EL[1] + Math.cos(r) * (FAL + GRL)]; };
      var wrist = function (th) { var r = th * D2R; return [EL[0] - Math.sin(r) * FAL, EL[1] + Math.cos(r) * FAL]; };
      var waistGap = function (th) {
        var best = 1e9;
        for (var i = 0; i <= 30; i++) {
          var f = i / 30, h = hand(th), q = [lerp(EL[0], h[0], f), lerp(EL[1], h[1], f)];
          var r = Math.hypot(q[0] / WAIST.a, (q[1] - WAIST.z) / WAIST.b);
          var gap = (r - 1) * Math.min(WAIST.a, WAIST.b) - lerp(0.04, 0.03, f);
          if (gap < best) best = gap;
        }
        return best;
      };
      var PUL = [0.5, 0.3];
      var th0 = Math.ceil(bisect(function (th) { return waistGap(th) - 0.012; }, -80, 0)), th1 = 50;
      var tp = TP.externalrot;
      // cable column
      var pc = P2(PUL[0] + 0.05, PUL[1]);
      mk("rect", { x: n2(pc[0] - 0.05 * M), y: n2(pc[1] - 0.06 * M), width: n2(0.1 * M), height: n2(0.12 * M), rx: 3, "class": "sm-eq" }, svg);
      var pp = P2(PUL[0], PUL[1]);
      mk("circle", { cx: n2(pp[0]), cy: n2(pp[1]), r: n2(0.03 * M), "class": "sm-hub" }, svg);
      // straight-ahead guide and the hand arc
      var e2 = P2(EL[0], EL[1]);
      line(svg, e2, P2(EL[0], EL[1] + FAL + GRL + 0.04), "sm-floor");
      traceOf(svg, function (u) { var h = hand(lerp(th0 - 2, th1 + 2, u)); return P2(h[0], h[1]); }, 40);
      var cable = mk("line", { "class": "sm-cable" }, svg);
      // body from above, facing up the screen
      var trunk = [[0, 0.125], [0.12, 0.11], [0.2, 0.075], [0.245, 0.02], [0.235, -0.05], [0.17, -0.095], [0.06, -0.11], [0, -0.11]];
      var ring = trunk.concat(trunk.slice(1, -1).reverse().map(function (q) { return [-q[0], q[1]]; }));
      mk("path", { d: catmull(ring.map(function (q) { return P2(q[0], q[1]); }), 4).d, "class": "sm-skin" }, svg);
      // right arm hanging (deltoid cap)
      var rd = P2(0.2, 0.0);
      mk("circle", { cx: n2(rd[0]), cy: n2(rd[1]), r: n2(0.058 * M), "class": "sm-skin" }, svg);
      // head
      var hc = P2(0, 0.005);
      [-1, 1].forEach(function (s) { var e = P2(s * 0.078, -0.005); mk("ellipse", { cx: n2(e[0]), cy: n2(e[1]), rx: n2(0.014 * M), ry: n2(0.024 * M), "class": "sm-skin" }, svg); });
      mk("path", { d: catmull([[0, 0.128], [0.02, 0.104], [0.045, 0.09], [0.075, 0.03], [0.072, -0.05], [0.04, -0.1], [0, -0.11], [-0.04, -0.1], [-0.072, -0.05], [-0.075, 0.03], [-0.045, 0.09], [-0.02, 0.104]].map(function (q) { return P2(q[0], q[1] + 0.005); }), 4).d, "class": "sm-skin" }, svg);
      // towel roll between the left elbow and the trunk
      mk("path", { d: capPath(P2(-0.205, 0.1), P2(-0.205, -0.05), 0.028 * M, 0.028 * M), "class": "sm-towel" }, svg);
      // left shoulder and upper arm (hanging, so foreshortened from above)
      var ld = P2(-0.19, 0.0);
      mk("path", { d: capPath(ld, e2, 0.05 * M, 0.042 * M), "class": "sm-skin" }, svg);
      mk("circle", { cx: n2(ld[0]), cy: n2(ld[1]), r: n2(0.058 * M), "class": "sm-skin" }, svg);
      var fore = mk("path", { "class": "sm-skin" }, svg);
      var fist = mk("path", { "class": "sm-skin" }, svg);
      var handle = mk("circle", { r: n2(0.018 * M), "class": "sm-hub" }, svg);
      var last = null;
      var draw = function (t) {
        var th = lerp(th0, th1, tp(t)), w = wrist(th), h = hand(th);
        last = { th: th, w: w, h: h };
        fore.setAttribute("d", capPath(e2, P2(w[0], w[1]), 0.04 * M, 0.028 * M));
        var hp = P2(h[0], h[1]), wp = P2(w[0], w[1]);
        fist.setAttribute("d", capPath(wp, P2(lerp(w[0], h[0], 1.15), lerp(w[1], h[1], 1.15)), 0.03 * M, 0.034 * M));
        handle.setAttribute("cx", n2(hp[0])); handle.setAttribute("cy", n2(hp[1]));
        setLine(cable, pp, hp);
      };
      svg.__sm = {
        W: 300, is3d: true,
        probe: function () {
          var q = last;
          return {
            segs: [["forearm", P2(EL[0], EL[1]), P2(q.w[0], q.w[1]), FAL * M], ["hand", P2(q.w[0], q.w[1]), P2(q.h[0], q.h[1]), GRL * M]], caps: [], outlines: [],
            fixed: [["elbow", P2(EL[0], EL[1])]],
            extra: {
              forearmAngle: q.th, th0: th0, th1: th1, waistGap: waistGap(q.th),
              cableToWaist: (function () {
                var best = 1e9;
                for (var i = 0; i <= 40; i++) { var f = i / 40, x = lerp(PUL[0], q.h[0], f), z = lerp(PUL[1], q.h[1], f); best = Math.min(best, (Math.hypot(x / WAIST.a, z / WAIST.b) - 1) * WAIST.b); }
                return best;
              })()
            }
          };
        }
      };
      return draw;
    }
  };

  return A;
})();
