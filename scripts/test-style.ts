import { parseBody } from "../src/lib/figure/parse";
const doc = String.raw`\node[draw, rounded corners, fill=blue!10] at (0,0) {输入};`;
const fig = parseBody(doc);
const el: any = fig.elements[0];
console.log("style:", JSON.stringify(el.style), "boxed:", el.boxed, "rounded:", el.rounded);
