# The Shed Manual: exercise animations report

## What's here

| File | What it is |
| --- | --- |
| `anims.js` | The deliverable. Defines `ANIMS` (10 entries) and `ANIM_CSS`. Plain ES2017, no imports, libraries, network or assets. |
| `shed-manual-new.html` | The page with `anims.js` and `ANIM_CSS` dropped in (built by `build-page.cjs`). |
| `sheets/` | 20 contact sheets (`<key>-light.png`, `<key>-dark.png`), 12 evenly spaced frames each, plus 4 phone-width page captures. |
| `harness.html` | Mounts every animation with the page's own mount code, and contains the automated checks and the contact-sheet renderer. |
| `verify.cjs` | Playwright: runs the checks (241 samples per rep), prints the pass/fail table, writes the sheets. `node verify.cjs` |
| `test-page.cjs` | Playwright: tests `shed-manual-new.html` in light, dark and under a strict hash-based CSP. `node test-page.cjs` |
| `build-page.cjs` | Rebuilds `shed-manual-new.html` from `shed-manual.html` + `anims.js`. |

## How it's built

- **One rig, ten scenes.** A shared side-view figure is driven by forward kinematics from fixed contacts and two-bone IK for hands on bars and handles. Segment lengths come from the anthropometric fractions in the brief. Limbs are tapered shapes with rounded joints (built once, then moved with a single `transform` per segment per frame), so lengths cannot drift. Near limbs are `--ink` with a thin `--bg` seam; far limbs are `--muted` at 50% opacity.
- **Constraint solving happens once, in `build`.** The deadlift, RDL, hip thrust, Bulgarian and landmine solve their key positions from real constraints: bar touching the shins or thighs, plates or glutes reaching the floor, bench pivot, bar reach and so on. The deadlift precomputes a lookup table. Each frame is then plain FK/IK. The worst case is 0.28 ms per `draw()` with the CPU throttled 6× (a 60 fps frame has 16.7 ms).
- **Tempo.** Each rep is a list of eased moves and holds, so velocity is zero at every turnaround and the loop closes exactly. `draw(0)` and `draw(1)` produce identical SVG.
- **Face pull** uses a small true-3D rig (orthographic camera, slightly above and behind). **External rotation** is a top-down rig. Their lengths are checked in 3D and reported in screen pixels.

## Results per animation

All checks pass for all ten: 241 samples per rep, 0.5 px tolerance for lengths and planted contacts, and 0.75 px allowed for touching contacts (bar on legs, back on bench, feet on floor).

| Animation | View | Tempo (ms) | Lengths | Contacts | Floor | Bench/plate | Bar | Drift | Loop |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| landmine | side, single arm (near) | hold 350 · press 1000 · top 350 · lower 2000 (3700) | 0.000 | 0.000 | 0.40 | n/a | 0.28 | n/a | pass |
| facepull | behind, slightly left and above (3D) | reach 350 · pull 1000 · squeeze 700 · return 2000 (4050) | 0.000 | 0.000 | n/a | n/a | n/a | n/a | pass |
| rdl | side | top 450 · lower 2000 · bottom 350 · up 1100 (3900) | 0.000 | 0.000 | 0.35 | n/a | 0.04 | 0.00% | pass |
| deadlift | side | set 450 · lift 1000 · lockout 550 · lower 2000 (4000) | 0.000 | 0.000 | 0.35 | n/a | 0.58 | 0.00% | pass |
| hipthrust | side | bottom 300 · drive 1000 · squeeze 900 · lower 2000 (4200) | 0.000 | 0.000 | 0.53 | −0.27 | −0.07 | n/a | pass |
| bulgarian | side | top 300 · lower 2000 · bottom 300 · up 1000 (3600) | 0.000 | 0.000 | 0.35 | −0.30 | n/a | n/a | pass |
| rollout | side | start 400 · roll out 2000 · hold 350 · pull back 1200 (3950) | 0.000 | 0.000 | 0.00 | n/a | n/a | n/a | pass |
| deadbug | side, lying | per side: rest 300 · reach 2000 · hold 400 · return 1000; both sides per loop (7400) | 0.000 | 0.000 | 0.17 | n/a | n/a | n/a | pass |
| straightarm | side | top 350 · pull 1000 · squeeze 500 · return 2000 (3850) | 0.000 | 0.000 | 0.31 | n/a | −0.02 | n/a | pass |
| externalrot | top-down, LEFT arm | start 400 · rotate out 1200 · hold 600 · return 2000 (4200) | 0.000 | 0.000 (elbow fixed) | n/a | n/a | n/a | n/a | pass |

Positive numbers in the Floor, Bench/plate and Bar columns are the deepest touch in pixels; negative numbers mean a clear gap.

### Measured form points

- **Deadlift.** Set-up: back 27° above horizontal, shins 11° forward and touching the bar, hips 0.65 m, arms 6° ahead of vertical. Bar at the knees: back 46°, shins vertical. Knee angle rises monotonically from 99° to 180° (no re-bend). Lockout: torso vertical (90.0°, no lean back), bar against the thighs.
- **RDL.** Knee fixed at 158° (22° of bend) throughout; the bar stops 6 cm below the knee joint.
- **Hip thrust.** Top: torso 2.7° and thigh 2.7° (one straight tabletop line), shin within 1° of vertical. The back pivots on the bench edge (0.000 px movement). Bottom: hip angle 98°.
- **Bulgarian.** Rear knee 3 cm above the floor at the bottom; the hip drops straight down (0.000 px horizontal travel); front shin 16° forward at the bottom; front thigh within 3° of parallel.
- **Rollout.** Knee, hip and shoulder are dead straight at full reach (hip angle 180°). Belly and knees stay clear of or just touch the floor.
- **Dead bug.** The back is flat on the floor and fixed. Heels hover 8 cm or more above the floor at full reach.
- **Straight-arm pulldown.** Elbow fixed at 164°; the bar starts exactly at eye level and finishes touching the thighs; shoulders fixed.
- **Face pull.** Elbows stay 5 to 7 cm above the shoulder joints for the whole rep. At the finish: elbows 33 cm out from the shoulder, 20 cm behind it, and hands beside the ears. Rope strands keep constant length.
- **External rotation.** The elbow is fixed (0.000 px). The forearm sweeps from 46° across the belly (as far as it can go and still clear the belly with the towel in place) to 50° past straight ahead.

## Integration test (`shed-manual-new.html`)

- All 10 animations run, pause and resume in light mode, dark mode, and under a strict CSP. The CSP allows only the page's own inline `<script>` and `<style>` blocks by SHA-256 hash, plus Google Fonts.
- The animations log no console errors and make no network requests. The only requests are the page's existing Google Fonts.
- `ANIM_CSS` is pasted into the page's static `<style>` block, not injected at runtime, so a hash-based CSP still covers it. The old stick-figure CSS and rig were removed. The mount code is unchanged.
- **A note on CSP, not caused by this work.** Under the strict test policy the browser blocks 12 inline `style="…"` attributes. All of them are in the existing page: the 6 header stripes and the 6 filter-chip colour dots. The original `shed-manual.html` produces the same 12 under the same policy. If your real CSP doesn't allow inline style attributes, those two bits of the page need moving to classes. The animations use none.

## What I'm not entirely happy with

- **Face pull: the start position reads less clearly than the finish.** From behind, "arms reaching to the pulley" is foreshortened, so the start looks like the arms raised up and forward. The finish (elbows high and wide, forearms up, hands by the ears), which is the important part for the shoulder, reads clearly. The near (ink) arm is the left one on purpose. The legs are cropped by the frame to keep the arms large enough to read on a phone.
- **Deadlift: the back angle steepens by about 19°** (27° → 46°) between the floor and the knees. With these proportions and the bar kept on the shins over mid-foot, a perfectly constant back angle is geometrically impossible: the knees would lock out before the bar reached them. The hips and shoulders still rise together, with no hips-first shoot-up. This matches published deadlift kinematics.
- **RDL: the arms angle back up to 27° at the bottom.** That is what keeps the bar on the legs over mid-foot with the knees fixed at a soft bend. Some coaches would hinge a little less deep.
- **Hip thrust: the 45 cm plates dominate the frame.** They're drawn true to scale as a translucent ring so the hips show through. Bottom depth is limited by the folding thigh meeting the bar, so the plates stop about 15 cm off the floor instead of touching.
- **Bulgarian: the front shin leans back 12° at the top.** That follows from "the hip drops straight down" combined with a stance that puts the shin 16° forward at the bottom.
- **Stylisation.**
  - Hands are drawn as fists, wrist to grip centre 0.045 H, not open 0.108 H hands.
  - For symmetrical lifts, far-side limbs are offset by about 1% of height so they show behind the near ones; this isn't true perspective.
  - There's no towel drawn under the hip-thrust bar.
  - The landmine shows a 20 kg-sized (45 cm) plate edge-on. That's heavy for shoulder rehab; it's there as a scale reference.
- **Reduced motion.** The page shows the frame at `t = 0.25` for users who prefer reduced motion. I checked it is a meaningful mid-movement frame for all ten, but it wasn't designed per animation.
- **Test hook.** Each SVG carries a small `__sm.probe()` function so the harness can read joint positions. It only runs when called and costs nothing while animating, but it is test-only code in the shipped file.
