// Minimal OpenAI-compatible mock used to exercise the generate→compile→repair loop.
import http from "node:http";

const BROKEN = [
  "\\documentclass[tikz,border=8pt]{standalone}",
  "\\usepackage{ctex}",
  "\\begin{document}",
  "\\begin{tikzpicture}",
  "  \\node[draw, rounded corners, fill=blue!10] at (0,0) {数据};",
  "  \\node[draw, rounded corners, fill=blue!10] at (4,0) {模型};",
  "  \\draw[thick, ->] (0.9,0) -- (3.1,0);",
  "  \\draw[thick, ->] (4,-0.6) -- (4,-1.6) node[below] {\\result};",
  "\\end{tikzpicture}",
  "\\end{document}",
].join("\n");

const FIXED = [
  "\\documentclass[tikz,border=8pt]{standalone}",
  "\\usepackage{ctex}",
  "\\begin{document}",
  "\\begin{tikzpicture}",
  "  \\node[draw, rounded corners, fill=blue!10] at (0,0) {数据};",
  "  \\node[draw, rounded corners, fill=blue!10] at (4,0) {模型};",
  "  \\draw[thick, ->] (0.9,0) -- (3.1,0);",
  "  \\node[draw, rounded corners, fill=orange!15] at (4,-2) {结果};",
  "  \\draw[thick, ->] (4,-0.6) -- (4,-1.6);",
  "\\end{tikzpicture}",
  "\\end{document}",
].join("\n");

// Scenario documents: a prompt containing "SCENARIO:<name>" selects one, so the
// two-agent loop can be exercised against realistic model mistakes.
const AXES = [
  "\\draw[->, thick] (-3.6,0) -- (3.6,0) node[right] {$x$};",
  "\\draw[->, thick] (0,-1.6) -- (0,1.6) node[above] {$y$};",
];
// pgfmath trig is degrees, so cos(sin(x)) needs deg() around the inner result.
const CURVE = "% y = cos(sin(x))\n\\draw[blue, thick] plot[domain=-3.14:3.14, samples=300, smooth] (\\x, {cos(deg(sin(\\x r)) r)});";

const SCENARIOS = {
  // function requested, but the document only draws axes -> must be rejected
  noplot: ["\\documentclass[tikz,border=8pt]{standalone}", "\\begin{document}", "\\begin{tikzpicture}", ...AXES, "\\node at (0,2) {$\\cos(\\sin x)$};", "\\end{tikzpicture}", "\\end{document}"].join("\n"),
  // the hand-drawn ticks + duplicate axes that broke the canvas
  ticks: ["\\documentclass[tikz,border=8pt]{standalone}", "\\begin{document}", "\\begin{tikzpicture}", ...AXES,
    "\\draw[->, thick] (-0.05,0.5) -- (0,0.5) node[right] {$0.5$};",
    "\\draw[->, thick] (0,-0.05) -- (0,-0.5) node[left] {$-0.5$};", "\\end{tikzpicture}", "\\end{document}"].join("\n"),
  // deg() inside the expression (legal pgfmath, previously unparsable here)
  deg: ["\\documentclass[tikz,border=8pt]{standalone}", "\\begin{document}", "\\begin{tikzpicture}", ...AXES,
    "% y = cos(deg(sin(x))*pi/180)", "\\draw[blue, thick] plot[domain=-3:3, samples=200] (\\x, {cos(deg(sin(\\x))*pi/180)});", "\\end{tikzpicture}", "\\end{document}"].join("\n"),
  good: ["\\documentclass[tikz,border=8pt]{standalone}", "\\begin{document}", "\\begin{tikzpicture}", ...AXES, CURVE, "\\end{tikzpicture}", "\\end{document}"].join("\n"),

  // fails to compile only because of clip options — the server autofix should save it
  clip: [
    "\\documentclass[tikz,border=8pt]{standalone}",
    "\\begin{document}",
    "\\begin{tikzpicture}",
    "\\draw[thick] (-2,-2) rectangle (2,2);",
    "\\clip[even odd rule] (0,0) circle (1);",
    "\\draw[blue] (0,0) circle (1);",
    "\\end{tikzpicture}",
    "\\end{document}",
  ].join("\n"),

  // a model that "draws" a curve by pasting 520 coordinate points
  points: (() => {
    const pts = Array.from({ length: 520 }, (_, i) => `(${(i * 0.01).toFixed(2)},${Math.sin(i / 20).toFixed(3)})`).join(" ");
    return [
      "\\documentclass[tikz,border=8pt]{standalone}",
      "\\begin{document}",
      "\\begin{tikzpicture}",
      "\\draw[blue] plot[smooth] coordinates {" + pts + "};",
      "\\end{tikzpicture}",
      "\\end{document}",
    ].join("\n");
  })(),

  // uses a colour name that was never defined (like `leftcol` from a paper preamble)
  colorname: [
    "\\documentclass[tikz,border=8pt]{standalone}",
    "\\begin{document}",
    "\\begin{tikzpicture}",
    "\\draw[leftcol, thick] (0,0) -- (3,0);",
    "\\draw[fill=leftcol] (0,-1) rectangle (3,-0.4);",
    "\\end{tikzpicture}",
    "\\end{document}",
  ].join("\n"),

  // truncated mid-document (finish_reason: length)
  cut: ["\\documentclass[tikz,border=8pt]{standalone}", "\\begin{document}", "\\begin{tikzpicture}", "\\draw[thick] (0,0) -- (2,0)", "\\draw[thick] (2,0) -- (2,2"].join("\n"),

  // permanently broken (for the time-budget test)
  broken: ["\\documentclass[tikz,border=8pt]{standalone}", "\\begin{document}", "\\begin{tikzpicture}", "\\draw[thick] (0,0) -- (1,0) node[below] {\\undefinedmacro};", "\\end{tikzpicture}", "\\end{document}"].join("\n"),

  // y = sin x over -2pi..2pi (clean, should match the preview exactly)
  sine: [
    "\\documentclass[tikz,border=8pt]{standalone}",
    "\\usepackage{ctex}",
    "\\begin{document}",
    "\\begin{tikzpicture}",
    "\\node at (0,2.1) {$y=\\sin x$ 的图像};",
    "\\draw[->, thick] (-6.9,0) -- (6.9,0) node[right] {$x$};",
    "\\draw[->, thick] (0,-1.6) -- (0,1.6) node[above] {$y$};",
    "% y = sin(x)",
    "\\draw[blue, thick] plot[domain=-6.28:6.28, samples=300, smooth] (\\x, {sin(\\x r)});",
    "\\end{tikzpicture}",
    "\\end{document}",
  ].join("\n"),

  // three-layer network: circles + connecting lines, no axes
  net: (() => {
    const layer = (x, ys) => ys.map((y, i) => `\\draw[thick] (${x},${y}) circle (0.3);`).join("\n");
    const link = (x1, ys1, x2, ys2) =>
      ys1.flatMap((y1) => ys2.map((y2) => `\\draw[gray!70] (${x1},${y1}) -- (${x2},${y2});`)).join("\n");
    const L1 = [1.2, 0, -1.2];
    const L2 = [1.8, 0.6, -0.6, -1.8];
    const L3 = [0.6, -0.6];
    return [
      "\\documentclass[tikz,border=8pt]{standalone}",
      "\\usepackage{ctex}",
      "\\begin{document}",
      "\\begin{tikzpicture}",
      link(0, L1, 3, L2),
      link(3, L2, 6, L3),
      layer(0, L1),
      layer(3, L2),
      layer(6, L3),
      "\\node at (3,3) {\\small 三层神经网络结构图};",
      "\\node[below] at (0,-1.9) {输入层};",
      "\\node[below] at (3,-2.5) {隐藏层};",
      "\\node[below] at (6,-1.3) {输出层};",
      "\\end{tikzpicture}",
      "\\end{document}",
    ].join("\n");
  })(),

  // flowchart with named coordinates (the shape most models write)
  flow: [
    "\\documentclass[tikz,border=8pt]{standalone}",
    "\\usepackage{ctex}",
    "\\begin{document}",
    "\\begin{tikzpicture}[node distance=2cm]",
    "\\node[draw, rounded corners, fill=blue!10] (in) at (0,0) {输入};",
    "\\node[draw, rounded corners, fill=blue!10] (mid) at (4,0) {处理};",
    "\\node[draw, rounded corners, fill=orange!15] (out) at (8,0) {输出};",
    "\\draw[->, thick] (in) -- (mid);",
    "\\draw[->, thick] (mid) -- (out);",
    "\\end{tikzpicture}",
    "\\end{document}",
  ].join("\n"),
};

let compareCalls = 0;
const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (req.url.includes("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          object: "list",
          data: [
            { id: "deepseek-flash", object: "model", name: "DeepSeek-V4.1-Flash 1017", input_modalities: ["text", "image"] },
            { id: "deepseek-v4-pro", object: "model", name: "DeepSeek-V4-Pro", input_modalities: ["text"] },
          ],
        })
      );
      return;
    }
    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {}
    // --- trace pipeline: semantics JSON, then the render-vs-original check ---
    const userText = (body.messages || []).filter((m) => m.role === "user").map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
    const answer = (text) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "mock-x", model: body.model || "mock-tikz", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }));
    };
    if (/Study this figure and describe it as EXACT geometric primitives/.test(userText)) {
      console.log("[" + new Date().toISOString().slice(11, 19) + "] understand -> 球");
      return answer(JSON.stringify({
        type: "geometry",
        summary: "一个球体的几何示意图，带赤道椭圆与底部名称",
        elements: [
          { kind: "circle", cx: 500, cy: 468, r: 432, style: { stroke: "#000000", width: 2, fill: "#f4f4f4", dash: "solid" } },
          { kind: "arc", cx: 500, cy: 452, rx: 430, ry: 78, start: 180, end: 360, style: { stroke: "#000000", width: 0.9, fill: null, dash: "dashed" } },
          { kind: "arc", cx: 500, cy: 452, rx: 430, ry: 78, start: 0, end: 180, style: { stroke: "#000000", width: 1.6, fill: null, dash: "solid" } },
          { kind: "text", box: [452, 866, 96, 96], tex: "球" },
        ],
      }));
    }
    if (/Extract every readable piece of text/.test(userText)) {
      console.log("[" + new Date().toISOString().slice(11, 19) + "] labels ->");
      return answer(JSON.stringify({ labels: [
        { box: [95, 60, 300, 40], tex: "supermode", confidence: 0.9 },
        { box: [60, 105, 120, 30], tex: "m = 1", confidence: 0.8 },
        { box: [10, 10, 20, 20], tex: "", confidence: 0.2 },
      ] }));
    }
    if (/Return ONLY compact JSON/.test(userText)) {
      console.log("[" + new Date().toISOString().slice(11, 19) + "] semantics ->");
      return answer(JSON.stringify({ type: "plot", summary: "ridge plot with a legend panel", labels: [{ box: [95, 70, 305, 80], tex: "supermode", confidence: 0.9 }] }));
    }
    if (/Compare image 1/.test(userText)) {
      compareCalls++;
      console.log("[" + new Date().toISOString().slice(11, 19) + "] compare -> " + (compareCalls === 1 ? "35 fail" : "88 pass"));
      return answer(JSON.stringify(
        compareCalls === 1
          ? { pass: false, score: 35, issues: [{ severity: "major", message: "peaks outside the frame" }], instructions: "merge fragments" }
          : { pass: true, score: 88, issues: [], instructions: "" }
      ));
    }

    const VALID = ["deepseek-flash", "deepseek-v4-pro", "mock-tikz"];
    if (body.model && !VALID.includes(body.model)) {
      // Mirror DeepSeek's real 400: the valid ids are listed in the message.
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message: `The supported API model names are ${VALID.slice(0, 2).join(", ")}, but you passed ${body.model}.`,
            type: "invalid_request_error",
          },
        })
      );
      console.log(`[${new Date().toISOString().slice(11, 19)}] reject model ${body.model}`);
      return;
    }
    const messages = body.messages || [];
    const userTexts = messages.filter((m) => m.role === "user" && typeof m.content === "string").map((m) => String(m.content));

    // --- reviewer role: judge, never rewrite (mirrors the real contract) ---
    const isReviewer = messages.some((m) => typeof m.content === "string" && m.content.includes("You are a TikZ figure reviewer"));
    if (isReviewer) {
      const userMsg = messages.filter((m) => m.role === "user").map((m) => String(m.content)).join("\n");
      // A competent reviewer trusts the static findings it was handed.
      const staticBlocker = /\[blocker\]/.test(userMsg) || /compilation: FAILED/.test(userMsg);
      if (!staticBlocker && /nitpick/.test(userMsg)) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "mock-review-nitpick",
            model: body.model || "mock-tikz",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    verdict: "revise",
                    score: 62,
                    issues: [{ code: "STYLE", severity: "minor", where: "line 4", message: "线条可以再细一点", fix: "thick → thin" }],
                    instructions: "把线宽调细。",
                  }),
                },
                finish_reason: "stop",
              },
            ],
          })
        );
        return;
      }
      const bad = userMsg.includes("\\result") || staticBlocker;
      const verdict = bad
        ? {
            verdict: "revise",
            score: 55,
            issues: [
              {
                code: "MATH_MODE",
                severity: "blocker",
                where: "line 8",
                message: "node 文本里的 \\result 未定义，且没有进数学模式",
                fix: "删掉该节点，或改成 $\\text{结果}$ 并放到独立 node 上",
              },
            ],
            instructions: "第 8 行的 \\result 是未定义命令：把结果标签改成独立 node 的普通中文文本。",
          }
        : { verdict: "pass", score: 88, issues: [], instructions: "" };
      console.log(`[${new Date().toISOString().slice(11, 19)}] reviewer -> ${verdict.verdict}`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "mock-review",
          model: body.model || "mock-tikz",
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(verdict) }, finish_reason: "stop" }],
          usage: { prompt_tokens: 400, completion_tokens: 80, total_tokens: 480 },
        })
      );
      return;
    }

    const isRepair = messages.some(
      (m) => typeof m.content === "string" && /failed to compile|fails to compile|reviewer rejected/i.test(m.content)
    );

    // edit mode: apply a local change to the document that was handed over
    const editAsk = userTexts.find((t) => t.includes("修改下面的 TikZ 文档"));
    if (editAsk && !isRepair) {
      const doc = /```latex\n([\s\S]*?)```/.exec(editAsk)?.[1] ?? "";
      const wantsHoleGone = /洞|去掉|删除|移除/.test(editAsk);
      let edited = doc;
      if (wantsHoleGone) {
        // "remove the hole": drop the small ellipse only, keep everything else
        edited = doc.replace(/^.*ellipse\s*\(0\.06 and 0\.09\).*$\n?/gm, "");
      }
      console.log(`[${new Date().toISOString().slice(11, 19)}] edit -> ${edited === doc ? "unchanged" : "changed"}`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "mock-edit",
          model: body.model || "mock-tikz",
          choices: [{ index: 0, message: { role: "assistant", content: "```latex\n" + edited + "\n```" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 800, completion_tokens: 400, total_tokens: 1200 },
        })
      );
      return;
    }
    // Only the "Request:" line counts — the rules block right below it also
    // mentions sin/cos, which used to hijack the routing.
    const lastUser = userTexts[userTexts.length - 1] ?? "";
    const promptText = (/Request:\s*(.+)/.exec(lastUser)?.[1] ?? lastUser).trim();
    // The marker usually lives in the first prompt; repairs only quote the document.
    const marker = /SCENARIO:(\w+)/.exec(userTexts[0] ?? promptText)?.[1];
    const markerHint = /SCENARIO:(\w+)/.exec(userTexts[0] ?? "")?.[1] ?? null;
    const routed = markerHint === "cut"
      ? "cut"
      : markerHint === "colorname"
      ? "colorname"
      : markerHint === "points"
      ? "points"
      : /clip/i.test(promptText)
      ? "clip"
      : /神经网络/.test(promptText)
      ? "net"
      : /流程图/.test(promptText)
        ? "flow"
        : /cos/i.test(promptText)
          ? "deg"
          : /sin/i.test(promptText)
            ? "sine"
            : null;
    // Unmatched prompts fall back to BROKEN -> FIXED so the compile-retry path
    // is actually exercised.
    const scenarioDoc = (marker && SCENARIOS[marker]) || (routed ? SCENARIOS[routed] : null);
    const doc =
      marker === "broken"
        ? SCENARIOS.broken
        : marker === "colorname"
          ? SCENARIOS.colorname
          : marker === "cut" && !isRepair
          ? SCENARIOS.cut
          : marker === "points"
            ? SCENARIOS.points
            : false ? ""
        : marker === "clip"
          ? SCENARIOS.clip
          : scenarioDoc
          ? (isRepair ? SCENARIOS.good : scenarioDoc)
          : isRepair
            ? FIXED
            : BROKEN;
    const content = "\`\`\`latex\n" + doc + "\n\`\`\`";
    console.log(`[${new Date().toISOString().slice(11, 19)}] ${isRepair ? "repair" : "initial"} request -> ${isRepair ? "FIXED" : "BROKEN"}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "mock-1",
        model: "mock-tikz",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content },
            finish_reason: marker === "cut" && !isRepair ? "length" : "stop",
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      })
    );
  });
});

const PORT = Number(process.env.PORT) || 8899;
server.listen(PORT, "127.0.0.1", () => console.log("mock llm on http://127.0.0.1:" + PORT + "/v1"));
