import { safeNodeText } from "../server/textext.mjs";
import { primitivesToTikz } from "../server/primitives.mjs";
import { compileToPdf } from "../server/latex.mjs";

let failed = 0;
function ok(name, cond, extra) {
  if (cond) console.log("  ok   " + name);
  else { failed++; console.log("  FAIL " + name + (extra === undefined ? "" : " :: " + JSON.stringify(extra))); }
}

console.log("label sanitising");
ok("underscore -> maths", safeNodeText("z/l_0") === "$z/l_0$", safeNodeText("z/l_0"));
ok("superscript -> maths", safeNodeText("x^2") === "$x^2$");
ok("greek -> command", safeNodeText("γ(z)") === "$\\gamma(z)$", safeNodeText("γ(z)"));
ok("already maths untouched", safeNodeText("$x^2$") === "$x^2$");
ok("plain text untouched", safeNodeText("V(z)") === "V(z)");
ok("cjk untouched", safeNodeText("球") === "球");
ok("percent and ampersand escaped", safeNodeText("50% & more") === "50\\% \\& more", safeNodeText("50% & more"));

console.log("document with axis labels compiles");
const model = {
  type: "plot", summary: "坐标轴", elements: [
    { kind: "polyline", points: [[100, 100], [900, 100], [900, 700], [100, 700]], closed: true, style: { width: 2 } },
    { kind: "text", box: [150, 750, 120, 60], tex: "z/l_0" },
    { kind: "text", box: [60, 300, 90, 60], tex: "γ(z)" },
    { kind: "text", box: [150, 200, 90, 60], tex: "50% & more" },
    { kind: "text", box: [300, 750, 90, 60], tex: "-9" },
  ],
};
const built = primitivesToTikz(model, { aspect: 0.6, imageWidthPx: 900 });
console.log(built.code.split("\n").filter((l) => l.startsWith("\\node")).join("\n"));
const job = await compileToPdf(built.code, { engine: "xelatex", timeoutMs: 120000 });
ok("compiles with no errors", job.ok, job.errors);
await job.cleanup();

console.log(failed ? "\n" + failed + " check(s) failed" : "\nall checks passed");
if (failed) process.exitCode = 1;
