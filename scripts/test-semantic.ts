import { validateSemantic, layoutSemantic, compileSemantic } from "../server/semantic.mjs";
let failed = 0;
const ok = (n, c, e) => { if (c) console.log("  ok   " + n); else { failed++; console.log("  FAIL " + n + (e === undefined ? "" : " :: " + JSON.stringify(e))); } };

const good = {
  kind: "commutative_diagram",
  nodes: [
    { id: "A", label: { mode: "math", tex: "A" } },
    { id: "X", label: { mode: "math", tex: "X" } },
    { id: "B", label: { mode: "math", tex: "A^{(p)}" } },
  ],
  edges: [
    { id: "e1", from: "A", to: "X", route: "straight", arrow: "end" },
    { id: "e2", from: "X", to: "B", route: "straight", arrow: "end" },
    { id: "e3", from: "A", to: "B", route: "arc", side: "above", arrow: "end" },
  ],
  labels: [
    { owner: "e1", mode: "math", tex: "f", side: "below", position: 0.5 },
    { owner: "e3", mode: "text", tex: "Frob", side: "above", position: 0.5 },
  ],
};

console.log("validation");
ok("accepts the reference structure", validateSemantic(good).ok, validateSemantic(good).errors);
ok("rejects an edge with an unknown node", !validateSemantic({ nodes: good.nodes, edges: [{ id: "e", from: "A", to: "Z" }], labels: [] }).ok);
ok("rejects a duplicate node id", !validateSemantic({ nodes: [good.nodes[0], good.nodes[0]], edges: [], labels: [] }).ok);
ok("rejects a label with no owner", !validateSemantic({ nodes: good.nodes, edges: [], labels: [{ tex: "f" }] }).ok);

console.log("layout");
const layout = layoutSemantic(good, { widthCm: 12, heightCm: 4.2 });
const A = layout.placed.get("A"), X = layout.placed.get("X"), B = layout.placed.get("B");
ok("A < X < B", A.x < X.x && X.x < B.x, [A.x, X.x, B.x]);
ok("same baseline", A.y === X.y && X.y === B.y);
ok("inside the canvas", A.x > 0 && B.x < 12, [A.x, B.x]);

console.log("compile");
const tikz = compileSemantic(JSON.parse(JSON.stringify(good)), layout);
ok("named nodes", /\\node \(n1\) at/.test(tikz) && /\\node \(n3\) at/.test(tikz), tikz.slice(0, 200));
ok("bounding box inside the picture", /begin\{tikzpicture\}[^\n]*\n\s*\\useasboundingbox/.test(tikz));
ok("native arrows", (tikz.match(/\[->\]/g) || []).length === 3, (tikz.match(/\[->\]/g) || []).length);
ok("one cubic arc", (tikz.match(/\.\. controls/g) || []).length === 1);
ok("edge labels placed twice", (tikz.match(/\\node at/g) || []).length === 2);
ok("math kept for A and f", /\$A\$/.test(tikz) && /\$f\$/.test(tikz));
ok("text kept for Frob", /\{Frob\}/.test(tikz));

const below = JSON.parse(JSON.stringify(good));
below.edges = [{ id: "e4", from: "A", to: "B", route: "arc", side: "below", arrow: "end" }];
below.labels = [{ owner: "e4", mode: "text", tex: "below", side: "below", position: 0.35 }];
const belowLayout = layoutSemantic(below, { widthCm: 12, heightCm: 4.2 });
const belowTikz = compileSemantic(below, belowLayout);
ok("below arc uses south anchors", /\(n1\.south\).*\(n3\.south\)/.test(belowTikz), belowTikz.split("\n").find((line) => line.includes("controls")));
const belowControls = /controls \(([-\d.]+),([-\d.]+)\) and \(([-\d.]+),([-\d.]+)\)/.exec(belowTikz);
ok("below arc bends downward", !!belowControls && Number(belowControls[2]) < belowLayout.baseline, belowControls);

console.log(failed ? "\n" + failed + " check(s) failed" : "\nall checks passed");
if (failed) process.exitCode = 1;
