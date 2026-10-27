# Image conversion improvement gates

Each stage requires local regression checks and a fresh call to the configured
real model before the next stage begins. Historical replies and mock services
are useful fixtures, but do not count as live acceptance.

## 1. Curve transforms and export/reopen

Implemented:
- Scale function values and their input coordinates with the panel frame.
- Preserve translated function geometry in exported coordinate-list metadata.
- Reject invalid transform parameters.

Local verification passed:
- `node scripts/run-ts.mjs scripts/test-panel-transform.ts`
- Existing `test-figure.ts` and `test-merge2.ts`
- TypeScript check and Vite production build

Live acceptance: **pending**. No successful real-model call yet. The network
request needs explicit approval to send the user's paper image to DeepSeek.
Reports and previews go to `.probe-tests/live/<stage>/`; credentials are never
included. The live script refuses a mock model or localhost endpoint.

## Remaining stages (not started)

2. Image prompt parameters and deterministic repairs.
3. Whole-job deadline, cancellation, retry policy and incremental panel delivery.
4. Style preservation, structural/geometric checks and visual comparison.
5. General image reconstruction and multiple figure categories.

Final acceptance must include the supplied four-panel figure and additional
figure categories. A successful compile alone is not evidence of visual fidelity.

## Live test configuration

Set `TIKZ_AI_KEY_FILE` to the user-provided credential file, or set `TIKZ_AI_KEY`
in the process environment. `TIKZ_AI_BASE_URL` and `TIKZ_AI_MODEL` default to the
project's previously used DeepSeek endpoint and `deepseek-flash` model.
Set `TEST_IMAGE`, `TEST_LABEL`, optionally `TEST_REQUIRE_CURVES=1`, and run:

```
node scripts/run-ts.mjs scripts/live-vision-stage.ts
```

The current stage uses actual `runGeneration`, parses the returned document,
checks curve geometry at multiple scales, compiles the original and merged
documents, and saves rendered previews for inspection.
