import { autofixSource } from "../server/autofix.mjs";

const doc = [
  "\\begin{tikzpicture}",
  "\\draw[leftcol, thick] (0,0) -- (1,1);",
  "\\draw[fill=leftcol] (0,0) rectangle (2,2);",
  "\\node[draw=leftcol] at (0,0) {x};",
  "\\end{tikzpicture}",
].join("\n");
const r = autofixSource(doc, [{ message: "Package pgfkeys Error: I do not know the key '/tikz/leftcol' and" }]);
console.log("fixes:", r.fixes.join(" / "));
console.log(r.code);