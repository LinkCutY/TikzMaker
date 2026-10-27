import { makeLegendEntry, pairLegendEntries, bindSeries, validateLegend, emitLegendTikz } from "../server/legend.mjs";
let failed = 0;
const ok = (n, c, e) => { if (c) console.log("  ok   " + n); else { failed++; console.log("  FAIL " + n + (e === undefined ? "" : " :: " + JSON.stringify(e))); } };

const samples = [
  { x0: 95, x1: 129, y0: 60, y1: 66, color: "#9989a5", width: 5, dash: "solid" },
  { x0: 94, x1: 127, y0: 150, y1: 156, color: "#a7875f", width: 5, dash: "dotted" },
];
const labels = [
  { x: 160, y: 63, w: 70, h: 20, tex: "\\gamma(z)", mode: "math" },
  { x: 160, y: 153, w: 70, h: 20, tex: "V(z)", mode: "math" },
];

console.log("pairing");
const entries = pairLegendEntries(samples, labels);
ok("one entry per sample", entries.length === 2, entries.length);
ok("stable ids", entries[0].id === "legend-1" && entries[1].id === "legend-2", entries.map((e) => e.id));
ok("labels attached by baseline", entries[0].tex === "\\gamma(z)" && entries[1].tex === "V(z)", entries.map((e) => e.tex));
ok("dash kept", entries[1].sample.dash === "dotted");
const unrelated = pairLegendEntries([samples[0]], [{ x: 20, y: 63, w: 20, h: 20, tex: "tick" }]);
ok("same-row text left of a swatch is not paired", unrelated[0].tex === "", unrelated[0]);

console.log("series binding");
const series = [
  { id: "curve0", color: "#9486a4", dash: "solid" },
  { id: "curve1", color: "#a68760", dash: "dotted" },
];
const bound = bindSeries(entries, series);
ok("solid sample binds to the solid curve", bound[0].seriesId === "curve0", bound[0].seriesId);
ok("dotted sample binds to the dotted curve", bound[1].seriesId === "curve1", bound[1].seriesId);
ok("no problems reported", validateLegend(bound, { series }).length === 0, validateLegend(bound, { series }));

console.log("refusals");
const invented = [makeLegendEntry({ index: 0, sample: samples[0], label: null })];
ok("a label-less entry is a problem", validateLegend(invented, { series }).length > 0, validateLegend(invented, { series }));
ok("a label with no sample is not an entry", pairLegendEntries([], labels).length === 0);
ok("more entries than series is refused", validateLegend(bound.concat([makeLegendEntry({ index: 2, sample: samples[0], label: labels[0], seriesId: "curve2" })]), { series: [series[0]] }).length > 0);

console.log("emission");
const tikz = emitLegendTikz(bound, { widthCm: 12, heightCm: 4.2, widthPx: 909, sizeCm: 0.62 });
ok("two sample strokes", (tikz.match(/\\draw/g) || []).length === 2, tikz);
ok("two labels", (tikz.match(/\\node/g) || []).length === 2, tikz);
const pts = [...tikz.matchAll(/\((-?[\d.]+),(-?[\d.]+)\)/g)].map((m) => Number(m[2]));
// per entry: draw start, draw end, label anchor
ok("labels share the sample baseline", pts.length === 6 && Math.abs(pts[0] - pts[2]) < 0.01 && Math.abs(pts[3] - pts[5]) < 0.01, pts);
ok("dotted style emitted", /dotted/.test(tikz));
ok("math kept", tikz.includes("$\\gamma(z)$"), tikz.split("\n").slice(0, 3));

console.log(failed ? "\n" + failed + " check(s) failed" : "\nall checks passed");
if (failed) process.exitCode = 1;
