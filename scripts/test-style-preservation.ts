import assert from "node:assert/strict";
import { parseBody } from "../src/lib/figure/parse";
import { buildDocument } from "../src/lib/figure/generate";
import { colorToHex } from "../src/lib/figure/colors";
import { assessFigure } from "../src/lib/figure/quality";
const source = String.raw`\definecolor{paper}{RGB}{93,48,135}
\begin{tikzpicture}
\draw[paper,dotted,line width=1.3pt] (0,0) -- (1,1);
\draw[blue!40!purple,dashed] (0,0) -- (2,1);
\fill[{rgb,255:red,45;green,100;blue,210}] (0,0) rectangle (1,1);
\draw[red,fill=red!12] (0,0) -- (1,0) -- (0.5,1) -- cycle;
\node[anchor=north west,font=\fontsize{8.5}{10}\selectfont,text=paper] at (0,2) {Title};
\draw[blue] plot[smooth] coordinates {(0,0) (1,2) (2,0)};
\end{tikzpicture}`;
const fig = parseBody(source);
assert.equal(fig.elements.length, 6);
assert.equal(fig.elements[0].style.color, "#5d3087");
assert.equal(fig.elements[0].style.dotted, true);
assert.equal(fig.elements[0].style.lineWidth, 1.3);
assert.equal(fig.elements[2].style.strokeNone, true);
assert.equal(fig.elements[2].style.fill, "#2d64d2");
assert.equal(fig.elements[4].kind, "node");
if (fig.elements[4].kind === "node") { assert.equal(fig.elements[4].anchor, "north west"); assert.equal(fig.elements[4].fontSize, 8.5); }
assert.equal(fig.elements[5].kind, "poly", "Sampled paths must preserve points, not turn into sin(x)");
const reopened = parseBody(buildDocument(fig));
assert.equal(reopened.elements.length, 6);
assert.equal(colorToHex(reopened.elements[0].style.color), "#5d3087");
assert.equal(reopened.elements[0].style.lineWidth, 1.3);
assert.equal(reopened.elements[2].style.strokeNone, true);
assert.equal(reopened.elements[3].style.fill, "red!12");
assert.equal(reopened.elements[5].kind, "poly");
if (reopened.elements[5].kind === "poly") assert.deepEqual(reopened.elements[5].points, [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 0 }]);
const bad = parseBody(String.raw`\draw (0,0) rectangle (5,3);
\draw plot[domain=0:5] (\x,{5});`);
assert.ok(!assessFigure(bad).ok, "Out-of-frame curves must be rejected");
console.log("PASS: RGB/mixed colors, dotted lines, widths, fills, exact fonts/anchors, sampled paths, and geometry rejection.");
