import assert from "node:assert/strict";
import net from "node:net";
import { spawn } from "node:child_process";

const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close((err) => err ? reject(err) : resolve(address.port));
  });
});

const child = spawn(process.execPath, ["server/index.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => { stderr += chunk; });

async function waitForHealth() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error("API exited early: " + stderr);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error("API did not become healthy: " + stderr);
}

async function rejectTracing(path, extra = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "image", representation: "trace", ...extra }),
  });
  const body = await response.json();
  assert.equal(response.status, 422, path + " status");
  assert.equal(body.ok, false, path + " ok");
  assert.equal(body.error?.code, "TRACING_DISABLED", path + " code");

  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(health.status, 200, path + " keeps API alive");
}

try {
  await waitForHealth();
  await rejectTracing("/api/ai/text2tikz");
  await rejectTracing("/api/ai/generate");
  await rejectTracing("/api/ai/compare", { source: "\\begin{tikzpicture}\\end{tikzpicture}" });
  console.log("api policy routes: ok");
} finally {
  child.kill();
}
