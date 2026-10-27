import assert from "node:assert/strict";
import { FAMILIES, familyTikz } from "../server/family.mjs";
import { makeLegendEntry, emitLegendTikz } from "../server/legend.mjs";
import { primitivesToTikz } from "../server/primitives.mjs";

const server = process.env.TEST_SERVER || "http://127.0.0.1:8788";

async function compile(source, name) {
  const response = await fetch(server + "/api/compile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source, engine: "xelatex" }),
  });
  const result = await response.json();
  assert.equal(result.ok, true, name + ": " + JSON.stringify(result.errors || result.error));
}

const family = familyTikz(
  { family: "gauss", params: [100, 600, 500, 150] },
  [0, 12],
  {
    style: "draw=black",
    inputExpression: "(1000*\\x/12)",
    outputScale: -0.004,
    outputOffset: 4,
  },
);
await compile("\\begin{tikzpicture}\n" + family + "\n\\end{tikzpicture}", "mapped family");

const extremeFunctions = [
  familyTikz(
    { family: "genDip", params: [690.0185, 210.1922, 610.3427, 192.6511, 11.9038] },
    [0.84, 11.82],
    { style: "draw=black", inputExpression: "(1000*\\x/12)", outputScale: -0.0043, outputOffset: 4.2883 },
  ),
  familyTikz(
    { family: "tanhPlateau", params: [47.3059, 232.5655, 456.8658, 704.6017, 35.4175, 51.8847] },
    [0.84, 11.82],
    { style: "draw=black", inputExpression: "(1000*\\x/12)", outputScale: -0.0043, outputOffset: 4.2883 },
  ),
];
await compile("\\begin{tikzpicture}\n" + extremeFunctions.join("\n") + "\n\\end{tikzpicture}", "saturated real-model families");

const legend = emitLegendTikz([
  makeLegendEntry({
    index: 0,
    sample: { x0: 100, x1: 160, y0: 100, y1: 100, color: "#917fa4", width: 2 },
    label: { tex: "\\gamma(z)" },
    seriesId: "curve0",
  }),
]);
await compile("\\begin{tikzpicture}\n" + legend + "\n\\end{tikzpicture}", "legend");

const points = Array.from({ length: 9 }, (_, i) => [
  (i / 8) * 1000,
  300 + 100 * Math.sin((i / 8) * Math.PI),
]);
const sparse = primitivesToTikz(
  { type: "plot", elements: [], curves: [{ points, color: "#917fa4" }] },
  { aspect: 0.4, imageWidthPx: 1000 },
);
assert.ok(sparse.items.some((item) => /拟合|直线/.test(item)), JSON.stringify(sparse.items));
assert.ok((sparse.code.match(/\.\. controls/g) || []).length <= 9, "sparse curve exceeded control budget");
await compile(sparse.code, "sparse fitted curve");

const plateauPoints = Array.from({ length: 9 }, (_, i) => {
  const x = i / 8;
  return [x * 1000, FAMILIES.tanhPlateau.eval(x, [100, 600, 300, 700, 45, 45])];
});
const plateau = primitivesToTikz(
  { type: "plot", elements: [], curves: [{ points: plateauPoints, color: "#917fa4" }] },
  { aspect: 0.4, imageWidthPx: 1000 },
);
assert.ok(!plateau.code.includes("draw=#"), "raw hex colour leaked into TikZ");
await compile(plateau.code, "parameter or spline plateau");

console.log("output integration: ok");
