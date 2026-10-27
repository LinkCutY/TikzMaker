import { curveShapeIssues } from "../server/verify.mjs";

let failed = 0;
function ok(name, cond, extra) {
  if (cond) console.log("  ok   " + name);
  else { failed++; console.log("  FAIL " + name + (extra === undefined ? "" : " :: " + JSON.stringify(extra))); }
}
const gaussian = (cx, baseY, amp) => {
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const x = 50 + i * 90;
    const y = baseY - amp * Math.exp(-(((x - cx) / 260) ** 2));
    pts.push([x, y]);
  }
  return { points: pts };
};
const triangle = (cx, baseY, amp) => ({ points: [[50, baseY], [cx - 200, baseY - 20], [cx, baseY - amp], [cx + 200, baseY - 20], [950, baseY]] });

console.log("peak sharpness");
const smooth = [gaussian(500, 700, 300), gaussian(500, 640, 300), gaussian(500, 580, 300), gaussian(500, 520, 300)];
ok("smooth gaussian peaks are not flagged", curveShapeIssues(smooth).filter((i) => i.kind === "peak-sharp").length === 0, curveShapeIssues(smooth));
const sharp = [triangle(500, 700, 300), triangle(500, 640, 300), triangle(500, 580, 300), triangle(500, 520, 300)];
const sharpIssues = curveShapeIssues(sharp);
ok("triangular peaks are flagged", sharpIssues.filter((i) => i.kind === "peak-sharp").length >= 3, sharpIssues);
ok("the message names an angle", /顶角 \d+°/.test(sharpIssues.find((i) => i.kind === "peak-sharp").message), sharpIssues[0]?.message);

console.log("kinks");
// a V notch on the shoulder (not the apex): 300 -> 480 -> 300 in 30 units
const kinked = [[50, 500], [130, 300], [170, 520], [210, 300], [500, 150], [950, 500]];
const kinks = curveShapeIssues([{ points: kinked }, ...smooth.slice(0, 3)]);
ok("a sharp corner is flagged with its location", kinks.some((i) => i.kind === "kink" && /x≈/.test(i.message)), kinks);

console.log("peak alignment");
const misaligned = [gaussian(300, 700, 300), gaussian(450, 640, 300), gaussian(600, 580, 300), gaussian(750, 520, 300)];
const mis = curveShapeIssues(misaligned);
ok("scattered peaks are reported", mis.some((i) => i.kind === "peak-misaligned"), mis);
ok("aligned peaks are not reported", !curveShapeIssues(smooth).some((i) => i.kind === "peak-misaligned"));

console.log(failed ? "\n" + failed + " check(s) failed" : "\nall checks passed");
if (failed) process.exitCode = 1;
