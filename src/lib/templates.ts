export interface Template {
  id: string;
  name: string;
  desc: string;
  source: string;
}

const DOC = (body: string) => `\\documentclass[tikz,border=8pt]{standalone}
\\usepackage{ctex}
\\usepackage{amsmath,amssymb}
\\usetikzlibrary{arrows.meta,positioning,calc,shapes.geometric}

\\begin{document}
${body}
\\end{document}
`;

export const templates: Template[] = [
  {
    id: "axes",
    name: "函数曲线",
    desc: "坐标轴 + 平滑函数曲线，演示 plot 与 domain",
    source: DOC(`\\begin{tikzpicture}[font=\\small, >=Stealth]
  \\draw[->, thick] (-0.4,0) -- (5.2,0) node[right] {$t$};
  \\draw[->, thick] (0,-0.4) -- (0,3.4) node[above] {$y$};
  \\foreach \\x in {1,2,3,4} { \\draw[gray!45] (\\x,0) -- (\\x,0.08); \\node[below, gray] at (\\x,0) {$\\x$}; }
  \\draw[thick, blue, domain=0:4.6, smooth, samples=120, variable=\\x]
    plot ({\\x},{2.4*exp(-0.55*\\x)+0.25});
  \\draw[thick, orange, dashed, domain=0:4.6, smooth, samples=120, variable=\\x]
    plot ({\\x},{0.35*\\x});
  \\draw[gray!55, densely dashed] (2.47,0) -- (2.47,0.865) -- (0,0.865);
  \\filldraw[red] (2.47,0.865) circle (2.4pt) node[above right, inner sep=3pt] {交点};
\\end{tikzpicture}`),
  },
  {
    id: "flow",
    name: "流程图",
    desc: "节点 + 定位库 + 箭头，适合方法总览图",
    source: DOC(`\\begin{tikzpicture}[font=\\small, >=Stealth,
  box/.style={draw, rounded corners=2pt, minimum width=3.1cm, minimum height=0.9cm, align=center, fill=blue!5},
  db/.style={draw, cylinder, shape border rotate=90, aspect=0.25, minimum height=1cm, minimum width=2.2cm, fill=orange!10, align=center}]
  \\node[box] (in) {输入数据};
  \\node[box, right=1.2cm of in] (model) {特征提取};
  \\node[db, right=1.2cm of model] (db) {知识库};
  \\node[box, below=1cm of model] (out) {预测结果};
  \\draw[->, thick] (in) -- (model);
  \\draw[->, thick] (model) -- (db);
  \\draw[->, thick] (model) -- (out);
  \\draw[->, thick, dashed, red!70] (db) to[bend right=25] (out);
\\end{tikzpicture}`),
  },
  {
    id: "network",
    name: "神经网络",
    desc: "分层节点与全连接，适合论文结构图",
    source: DOC(`\\begin{tikzpicture}[font=\\scriptsize,
  n/.style={circle, draw, minimum size=6mm, inner sep=0pt, fill=white}]
  \\foreach \\i in {1,...,4} { \\node[n] (a\\i) at (0, -\\i*0.9) {}; }
  \\foreach \\i in {1,...,3} { \\node[n] (b\\i) at (2, -\\i*1.05-0.45) {}; }
  \\foreach \\i in {1,...,2} { \\node[n] (c\\i) at (4, -\\i*1.2-0.9) {}; }
  \\foreach \\i in {1,...,4} { \\foreach \\j in {1,...,3} { \\draw[gray!45] (a\\i) -- (b\\j); } }
  \\foreach \\i in {1,...,3} { \\foreach \\j in {1,...,2} { \\draw[gray!45] (b\\i) -- (c\\j); } }
  \\node[above=0.5cm of a1] {输入层};
  \\node[above=0.5cm of b1] {隐层};
  \\node[above=0.5cm of c1] {输出层};
  \\node[draw, rounded corners, fill=blue!8, above=1.1cm of a1, minimum width=3.6cm] {前向传播};
\\end{tikzpicture}`),
  },
  {
    id: "bezier",
    name: "贝塞尔曲线",
    desc: "控制点可视化，方便后续图形化编辑对照",
    source: DOC(`\\begin{tikzpicture}[font=\\small]
  \\coordinate (P0) at (0,0);
  \\coordinate (P1) at (1.5,2.6);
  \\coordinate (P2) at (3.6,2.6);
  \\coordinate (P3) at (5,0.4);
  \\draw[thick, blue] (P0) .. controls (P1) and (P2) .. (P3);
  \\draw[gray, dashed] (P0) -- (P1) (P2) -- (P3);
  \\foreach \\p in {P0,P1,P2,P3} { \\filldraw[red] (\\p) circle (2.2pt); }
  \\node[below] at (P0) {$P_0$};
  \\node[above] at (P1) {$P_1$};
  \\node[above] at (P2) {$P_2$};
  \\node[below] at (P3) {$P_3$};
  \\node[draw, rounded corners, fill=yellow!18, right=0.3cm of P3] {Cubic Bézier};
\\end{tikzpicture}`),
  },
  {
    id: "blank",
    name: "空白画布",
    desc: "最小模板，只加载常用宏包",
    source: DOC(`\\begin{tikzpicture}
  \\draw[thick, rounded corners] (0,0) rectangle (4,2.4);
  \\node at (2,1.2) {开始绘图};
\\end{tikzpicture}`),
  },
];

export const DEFAULT_SOURCE = templates[0].source;
