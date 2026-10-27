import assert from "node:assert/strict";
import { runPanelJobs } from "../src/lib/panel-runner";
let active = 0, peak = 0;
const calls: number[] = [], snapshots: number[] = [];
const result = await runPanelJobs<number>({ count: 4, initial: new Map([[0, 42]]), concurrency: 2,
  run: async i => { calls.push(i); active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, i === 1 ? 10 : 25)); active--; return i; },
  onUpdate: states => snapshots.push(states.filter(s => s.status === "ok").length),
});
assert.ok(peak <= 2);
assert.ok(!calls.includes(0), "Cached successful panel must never be regenerated");
assert.ok(snapshots.includes(2), "Completed panels must be published before the pool finishes");
assert.equal(result.states.filter(s => s.status === "ok").length, 4);
const started = Date.now();
const deadline = await runPanelJobs({ count: 3, budgetMs: 40, panelBudgetMs: 1000, run: () => new Promise(() => {}) });
assert.ok(Date.now() - started < 250, "A stuck task must not defeat the whole-job deadline");
assert.equal(deadline.states.filter(s => s.status === "fail").length, 3);
const ac = new AbortController();
ac.abort();
let ran = false;
await runPanelJobs({ count: 1, signal: ac.signal, run: async () => { ran = true; } });
assert.equal(ran, false);
console.log("PASS: bounded concurrency, incremental results, cached resume, whole-job deadline and cancellation.");
