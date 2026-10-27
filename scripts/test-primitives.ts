import { primitivesToTikz } from "../server/primitives.mjs";

let failed = 0;
function ok(name, cond, extra) {
  if (cond) console.log("  ok   " + name);
  else { failed++; console.log("  FAIL " + name + (extra === undefined ? "" : " :: " + JSON.stringify(extra))); }
}

const base = { type: "geometry", summary: "测试", elements: [] };
const run = (elements, opts) => primitivesToTikz({ ...base, elements }, opts || {});
const has = (out, s) => out.code.includes(s);

console.log("canvas");
const r0 = run([{ kind: "circle", cx: 500, cy: 500, r: 400 }], { aspect: 2 });
ok("width 12cm", r0.stats.widthCm === 12);
ok("height follows aspect", r0.stats.heightCm === 24, r0.stats);
ok("viewport comment", has(r0, "% @viewport 0 0 12 24"));

console.log("primitives");
const c = run([{ kind: "circle", cx: 500, cy: 500, r: 400, style: { stroke: "#112233", width: 2, fill: "#f0f0f0" } }]);
ok("circle is a real circle", has(c, "circle (4.8);"), c.code.split("\n")[5]);
ok("colour converted to rgb spec", has(c, "draw={rgb,255:red,17;green,34;blue,51}"));
ok("fill converted too", has(c, "fill={rgb,255:red,240;green,240;blue,240}"));
ok("no raw # in the document", !c.code.includes("#112233"));

const ellipse = { kind: "ellipse", cx: 500, cy: 400, rx: 300, ry: 80, rotate: 30 };
// Default: a closed cubic chain, because the canvas has no ellipse element.
const e = run([ellipse]);
ok("ellipse becomes 4 cubic segments", (e.code.match(/\.\. controls /g) || []).length === 4, e.code.split("\n")[5]);
ok("ellipse chain is closed", has(e, "-- cycle"));
ok("ellipse is not a native ellipse by default", !has(e, "ellipse ("));

const eNative = run([ellipse], { nativeCurves: true });
ok("nativeCurves restores \\draw ... ellipse", has(eNative, "ellipse (3.6 and "), eNative.code.split("\n")[5]);
ok("native ellipse keeps rotation", has(eNative, "rotate around={30:("));

const arcModel = { kind: "arc", cx: 500, cy: 500, rx: 400, ry: 100, start: 0, end: 180, style: { dash: "dashed" } };
const a = run([arcModel]);
ok("arc starts at the ellipse point", has(a, "(10.8,6)"), a.code.split("\n")[5]);
ok("arc becomes 2 cubic segments (180 deg)", (a.code.match(/\.\. controls /g) || []).length === 2, a.code.split("\n")[5]);
ok("arc keeps dash", has(a, "dashed"));
ok("arc is not a native arc by default", !has(a, "arc["));

const aNative = run([arcModel], { nativeCurves: true });
ok("nativeCurves restores native arc", has(aNative, "start angle=0, end angle=-180"), aNative.code.split("\n")[5]);

const poly = run([{ kind: "polyline", points: [[0, 0], [500, 500], [1000, 0]], closed: true }]);
ok("polyline chain", has(poly, ") -- (") && has(poly, "-- cycle"));

const t = run([{ kind: "text", box: [400, 800, 200, 100], tex: "50% & 球" }]);
ok("text node", has(t, "\\node[anchor=center"));
ok("text escaped", has(t, "50\\% \\& 球"), t.code.split("\n")[5]);
ok("font size from box height", /fontsize\{[\d.]+\}/.test(t.code));

console.log("validation");
const bad = run([
  { kind: "circle", cx: 500, cy: 500, r: 0 },
  { kind: "widget", cx: 1, cy: 1 },
  { kind: "text", box: [0, 0, 10, 10], tex: "  " },
  { kind: "line", x1: 0, y1: 0, x2: 1000, y2: 1000 },
]);
ok("invalid elements dropped, valid kept", bad.stats.elements === 1 && bad.stats.dropped === 3, bad.stats);
ok("coordinates clamped", !/NaN|Infinity/.test(run([{ kind: "circle", cx: 99999, cy: -99999, r: 400 }]).code));

console.log(failed ? "\n" + failed + " check(s) failed" : "\nall checks passed");
if (failed) process.exitCode = 1;
