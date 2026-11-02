// Representative expression-coordinate regression, with correct and incorrect
// witnesses. These constants are test data, never a production diagram template.
export function meanValueDocument(correct=false){
  const xi=correct?2.95:2;
  const tangent=correct?'1.930875+1.365*(5.6-2.95)':'0.95';
  return String.raw`\documentclass[tikz,border=8pt]{standalone}
\usepackage{amsmath}
\begin{document}
\begin{tikzpicture}
\draw[->] (0,0) -- (6,0) node[right] {$x$};
\draw[->] (0,0) -- (0,9) node[above] {$y$};
% y = 0.35*(x-1)^2+0.6
\draw[blue] plot[domain=0.3:5.6,samples=120] (\x,{0.35*(\x-1)^2+0.6});
\draw[gray] (0.3,{0.35*(0.3-1)^2+0.6}) -- (5.6,{0.35*(5.6-1)^2+0.6});
\draw[red] (${xi},{0.35*(${xi}-1)^2+0.6}) -- (5.6,{${tangent}});
\fill (0.3,{0.35*(0.3-1)^2+0.6}) circle (2pt);
\fill (5.6,{0.35*(5.6-1)^2+0.6}) circle (2pt);
\fill[red] (${xi},{0.35*(${xi}-1)^2+0.6}) circle (2pt);
\node[above] at (${xi},{0.35*(${xi}-1)^2+0.6}) {$\xi$};
\node at (4,2) {$f'(\xi)=\dfrac{f(b)-f(a)}{b-a}$};
\end{tikzpicture}
\end{document}`;
}
