import { buildDocument, generateBody } from "../src/lib/figure/generate";
import { parseBody } from "../src/lib/figure/parse";
import { defaultStyle, type Figure } from "../src/lib/figure/types";

let fails = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (!cond) {
    fails++;
    console.log("FAIL:", name, JSON.stringify(extra));
  } else console.log("ok:", name);
};

const fig: Figure = {
  elements: [
    {
      id: "n1",
      kind: "node",
      name: "文本 1",
      at: { x: 3, y: 2.6 },
      text: "函数 $y=\\sin(e^x)$ 的图像",
      style: defaultStyle(),
      boxed: false,
      rounded: 0,
      fontSize: 10,
      anchor: "south",
    },
  ],
};

const doc = buildDocument(fig);
check("generated keeps $", doc.includes("$y=\\sin(e^x)$"), doc.split("\n").find((l) => l.includes("node")));

const back = parseBody(generateBody(fig));
const node: any = back.elements[0];
check("parse keeps $", node?.text === "函数 $y=\\sin(e^x)$ 的图像", node?.text);
check("re-generate identical", buildDocument(back) === doc);

// legacy text that already lost its delimiters must not produce broken TikZ
const legacy: Figure = {
  elements: [{ ...(fig.elements[0] as any), text: "函数 y=\\sin(e^x) 的图像" }],
};
const legacyDoc = generateBody(legacy);
check("legacy wrapped in $", legacyDoc.includes("{$函数 y=\\sin(e^x) 的图像$}"), legacyDoc);

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
