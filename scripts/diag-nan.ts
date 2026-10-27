import { parseBody } from "../src/lib/figure/parse";

const cases: [string, string][] = [
  ["plain", String.raw`\node at (3,2.6) {函数 $y=\sin(e^x)$ 的图像};`],
  ["braced y", String.raw`\node at (3,{2.6}) {函数 $y=\sin(e^x)$ 的图像};`],
  ["braced both", String.raw`\node at ({3},{2.6}) {标题};`],
  ["anchor above", String.raw`\node[above] at (3,2.6) {标题};`],
  ["dash coords", String.raw`\node at (3, 2.6) {标题};`],
];

for (const [name, src] of cases) {
  const fig = parseBody(src);
  const el: any = fig.elements[0];
  console.log(name.padEnd(14), el ? `kind=${el.kind} at=(${el.at?.x}, ${el.at?.y}) text=${JSON.stringify(el.text)}` : "NO ELEMENT");
}
