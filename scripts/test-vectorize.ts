import { parseColor, parsePathData, parseSvg, svgToTikz } from "../server/vectorize.mjs";

let failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log("  ok   " + name);
  else {
    failed++;
    console.log("  FAIL " + name + (extra === undefined ? "" : " :: " + JSON.stringify(extra)));
  }
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
const kinds = (d: string) => parsePathData(d).subpaths.flatMap((s: any) => s.segs.map((g: any) => g.kind)).join("");

console.log("colour");
ok("#abc", JSON.stringify(parseColor("#abc")) === "[170,187,204]");
ok("#ff8800", JSON.stringify(parseColor("#ff8800")) === "[255,136,0]");
ok("#ff880080 ignores alpha", JSON.stringify(parseColor("#ff880080")) === "[255,136,0]");
ok("rgb()", JSON.stringify(parseColor("rgb(1, 2, 3)")) === "[1,2,3]");
ok("none -> null", parseColor("none") === null);

console.log("path grammar");
ok("M L L Z", kinds("M0,0 L10,0 L10,10 Z") === "LLZ");
ok("relative m l z", kinds("m10,10 l5,0 l0,5 z") === "LLZ");
ok("implicit lineto after M", kinds("M0,0 10,0 10,10") === "LL");
ok("H / V", kinds("M0,0 H10 V10") === "LL");
const hv = parsePathData("M0,0 H10 V10").subpaths[0].segs;
ok("H endpoint", near(hv[0].to[0], 10) && near(hv[0].to[1], 0));
ok("V endpoint", near(hv[1].to[0], 10) && near(hv[1].to[1], 10));
ok("cubic", kinds("M0,0 C1,0 2,1 3,1") === "C");
const smooth = parsePathData("M0,0 C1,0 2,1 3,1 S5,3 6,4").subpaths[0].segs;
ok("S reflects the previous control point", near(smooth[1].c1[0], 4) && near(smooth[1].c1[1], 1), smooth[1].c1);
const quad = parsePathData("M0,0 Q3,3 6,0").subpaths[0].segs[0];
ok("Q -> cubic c1 (2,2)", near(quad.c1[0], 2) && near(quad.c1[1], 2), quad.c1);
ok("Q -> cubic c2 (4,2)", near(quad.c2[0], 4) && near(quad.c2[1], 2), quad.c2);
ok("arc degrades to a line", kinds("M0,0 A5,5 0 0 1 10,0") === "L" && parsePathData("M0,0 A5,5 0 0 1 10,0").arcs === 1);
ok("two subpaths", parsePathData("M0,0 L1,0 Z M5,5 L6,5 Z").subpaths.length === 2);

console.log("svg -> tikz");
const box = "<svg width=\"10\" height=\"10\"><path d=\"M0,0 L10,0 L10,10 Z\" fill=\"#123456\"/></svg>";
const r = svgToTikz(box, { targetWidthCm: 12, dropWhite: false });
ok("y flipped: top-left -> (0,12)", r.body.includes("(0,12)"), r.body.slice(0, 120));
ok("bottom-right -> (12,0)", r.body.includes("(12,0)"), r.body);
ok("closed with cycle", (r.body.match(/-- cycle/g) || []).length === 1);
ok("colour defined once", (r.document.match(/\\definecolor/g) || []).length === 1);
ok("colour values", r.body.includes("{RGB}{18,52,86}"), r.body.split("\n")[0]);
ok("viewport comment", r.document.includes("% @viewport 0 0 12 12"));
ok("stats rings/segments", r.stats.rings === 1 && r.stats.segments === 3, r.stats);

const hole = svgToTikz("<svg width=\"10\" height=\"10\"><path d=\"M0,0 L10,0 L10,10 Z M2,2 L8,2 L8,8 Z\" fill=\"#222222\"/></svg>", { dropWhite: false });
ok("holes get even odd rule", hole.body.includes("even odd rule"), hole.body.slice(0, 160));

const dedupe = svgToTikz("<svg width=\"10\" height=\"10\"><path d=\"M0,0 L1,0 L1,1 Z\" fill=\"#112233\"/><path d=\"M5,5 L6,5 L6,6 Z\" fill=\"#112233\"/></svg>", { dropWhite: false });
ok("same colour reuses one definition", (dedupe.document.match(/\\definecolor/g) || []).length === 1, dedupe.document.slice(0, 200));
ok("two fills emitted", (dedupe.body.match(/\\fill\[/g) || []).length === 2);

const white = svgToTikz("<svg width=\"10\" height=\"10\"><path d=\"M0,0 L10,0 L10,10 Z\" fill=\"#ffffff\"/><path d=\"M1,1 L2,1 L2,2 Z\" fill=\"#000000\"/></svg>", {});
ok("white background dropped", white.stats.dropped === 1 && !white.body.includes("{RGB}{255,255,255}"), white.stats);

const vb = svgToTikz("<svg viewBox=\"0 0 20 10\"><path d=\"M0,0 L20,0 L20,10 Z\" fill=\"#000000\"/></svg>", { targetWidthCm: 12 });
ok("viewBox scales by units (20 -> 12cm, 10 -> 6cm)", vb.body.includes("(12,0)") && vb.body.includes("(0,6)"), vb.body.slice(0, 160));
ok("viewBox height reported", near(vb.stats.heightCm, 6), vb.stats);

const tiny = svgToTikz("<svg width=\"100\" height=\"100\"><path d=\"M0,0 L1,0 L1,1 Z\" fill=\"#000\"/><path d=\"M10,10 L90,10 L90,90 Z\" fill=\"#000\"/></svg>", { dropWhite: false, minAreaPx: 100 });
ok("minAreaPx drops specks", tiny.stats.rings === 1, tiny.stats);

const precision = svgToTikz(box, { targetWidthCm: 7, precision: 1, dropWhite: false });
ok("precision=1 rounds coordinates", /\(-?[\d.]+,(-?[\d.]+)\)/.test(precision.body) && !/\.\d\d/.test(precision.body), precision.body);

console.log("labels / nodes");
const labelled = svgToTikz(box, {
  targetWidthCm: 12,
  dropWhite: false,
  labels: [
    { box: [0, 0, 1000, 1000], tex: "$x$" },
    { box: [250, 250, 500, 500], tex: "50% & more" },
    { box: [0, 0, 10] as any, tex: "broken box" },
    { box: [0, 0, 10, 10], tex: "   " },
    null as any,
  ],
});
ok("valid labels become nodes", labelled.stats.labels === 2, labelled.stats);
ok("node command emitted", labelled.document.includes("\\node[anchor=center"), labelled.body.slice(-160));
ok("centre label lands in the middle", labelled.body.includes("(6,6)"), labelled.body.slice(-160));
ok("special characters escaped", labelled.body.includes("50\\% \\& more"), labelled.body.slice(-120));
ok("broken labels ignored", !labelled.body.includes("broken box"));

console.log(failed ? "\n" + failed + " check(s) failed" : "\nall checks passed");
if (failed) process.exitCode = 1;
