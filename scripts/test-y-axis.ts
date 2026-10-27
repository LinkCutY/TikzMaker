import { calibrateAxis, calibrate, calibrateYFromFrame } from "../server/axis.mjs";

let failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log("  ok   " + name);
  else { failed++; console.log("  FAIL " + name + (extra === undefined ? "" : " :: " + JSON.stringify(extra))); }
}

console.log("y-axis calibration");
const y = calibrateAxis(
  [
    { py: 100, value: 0 },
    { py: 900, value: 1 },
  ],
  { pixelDirection: "y" },
);
ok("two ticks succeed", y.ok === true);
ok("y-down maps 0 correctly", Math.abs(y.toValue(100) - 0) < 1e-9);
ok("y-down maps 1 correctly", Math.abs(y.toValue(900) - 1) < 1e-9);
ok("data y grows upward while pixel y grows downward", y.toValue(100) < y.toValue(900));
ok("toPixel inverts toValue", Math.abs(y.toPixel(0.5) - 500) < 1e-6);
ok("direction recorded", y.direction === "y");

const x = calibrateAxis([{ px: 100, value: 0 }, { px: 900, value: 1 }], { pixelDirection: "x" });
ok("x-axis calibration stays backward-compatible", x.ok && x.direction === "x");
const old = calibrate([{ px: 100, value: 0 }, { px: 900, value: 1 }]);
ok("legacy calibrate is still an x calibration", old.ok && old.b > 0);

const frame = calibrateYFromFrame({ topPx: 100, bottomPx: 900, topValue: 1, bottomValue: 0 });
ok("frame fallback calibrates", frame.ok === true);
ok("frame fallback inverts", Math.abs(frame.toValue(900)) < 1e-9);

const tooFew = calibrateAxis([{ py: 100, value: 0 }], { pixelDirection: "y" });
ok("fewer than two ticks fail", tooFew.ok === false);

console.log(failed ? "\n" + failed + " check(s) failed" : "\nall checks passed");
if (failed) process.exitCode = 1;