import { measureTexts } from "../server/metrics.mjs";
let failed = 0;
const ok = (n, c, e) => { if (c) console.log("  ok   " + n); else { failed++; console.log("  FAIL " + n + (e === undefined ? "" : " :: " + JSON.stringify(e))); } };
const entries = [
  { tex: "A", mode: "math", sizeCm: 0.62 },
  { tex: "A^{(p)}", mode: "math", sizeCm: 0.62 },
  { tex: "Frob", mode: "text", sizeCm: 0.62 },
];
const m = await measureTexts(entries);
console.log(JSON.stringify(m));
ok("every entry measured", m.every(Boolean), m);
if (m.every(Boolean)) {
  ok("A is about one glyph wide", m[0].w > 0.3 && m[0].w < 0.9, m[0].w);
  ok("A^{(p)} is wider than A", m[1].w > m[0].w + 0.15, [m[0].w, m[1].w]);
  ok("Frob is wider than A", m[2].w > m[0].w, [m[0].w, m[2].w]);
  ok("heights are positive", m.every((x) => x.h > 0));
}
console.log(failed ? "\n" + failed + " check(s) failed" : "\nall checks passed");
if (failed) process.exitCode = 1;
