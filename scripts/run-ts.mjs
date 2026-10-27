import { build } from "esbuild";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";

const entry = process.argv[2];
if (!entry) throw new Error("Usage: node scripts/run-ts.mjs scripts/test-name.ts");
await mkdir(".probe-tests", { recursive: true });
const outfile = resolve(".probe-tests", entry.replace(/[^a-zA-Z0-9_-]/g, "_") + ".mjs");
await build({ entryPoints: [resolve(entry)], bundle: true, platform: "node", format: "esm", outfile, packages: "external" });
await import(pathToFileURL(outfile).href);
