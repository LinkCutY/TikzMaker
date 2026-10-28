# 从零手写 Mini TikZ Studio

> 这是一份学习计划，不是产品需求文档。
> 目标：让你能独立写出、解释、修改一个项目，而不是再让 AI 生成一个。

## 1. 最终要做成什么

### v1：无依赖版（第 1–10 课）

一个可以直接双击打开的网页：

- 三栏布局：源码 / 画布 / 状态栏
- 画线、矩形、圆、文字
- 选中、拖动、删除
- 撤销 / 重做
- 刷新后内容还在（localStorage）
- 画布 → TikZ 代码
- TikZ 子集 → 画布（解析）
- 导出 .tex / .json / .svg

### v2：工程化版（第 11–14 课）

用 Vite + TypeScript + React 重写同一功能。目的不是“再写一遍”，而是亲手体会：

- 为什么要模块化
- 类型能防住什么错
- React 到底帮你做了什么
- 构建工具解决了什么问题

### v3：真编译（第 15–17 课）

Node/Express 后端 + 本机 XeLaTeX：

- POST /api/compile
- PDF / SVG / PNG 导出
- 错误日志回传
- 基础测试

### v4：选修

图片 → TikZ 的 AI 工作流。等你能独立维护前面所有代码，再碰它。

## 2. 和原项目的关系

原项目 D:\FDU_AIagentDevelop 保持原样，继续能运行。

我们在 handmade-tikz 里另起炉灶：

- 不 import 原项目的任何代码；
- 不修改原项目文件；
- 每学完一个模块，再打开原项目对应文件对照；
- 等你的实现稳定后，再一个模块一个模块地替换回原项目。

这不是逃避重构，而是把“重构一个 2.6 万行的项目”拆成“先能独立写 1000 行，再逐步接管”。

## 3. 为什么不在原项目上直接改

原项目约 209 个源文件、2.6 万行、1.2 MB，包含 React、TypeScript、Vite、Zustand、CodeMirror、Express、LaTeX 编译、PDF/SVG 渲染、图像识别、曲线拟合、AI 调用。

零基础直接读它，等于还没学认字就去读长篇小说。正确顺序：

1. 写一个 500 行以内、能跑的小系统；
2. 每一行都能解释；
3. 逐步加功能，长到 5000 行；
4. 再回到原项目，按模块替换。

## 4. 学习约定

1. **你打字，我不代写。** 卡住可以问；需要示范时你明确说，我才写。
2. 每课只引入一个新概念，每课结束都有能运行的东西。
3. 每行代码都要能用自己的话解释；解释不了就标记出来。
4. 先让错误发生，再学会读错误信息。
5. 一次 30–90 分钟；卡住 20 分钟就问我，不要硬耗。
6. 不复制粘贴整段代码；可以看着抄，但手要动、脑要跟。
7. 每课写 3 行记录：学了什么 / 哪里卡住 / 还有什么不懂。
8. 第 3 课后开始用 git，每课一个 commit。

## 5. 路线图

| 阶段 | 课 | 主题 | 本课成品 |
|---|---|---|---|
| A 基础 | L01 | HTML：网页的骨架 | 一个能打开的页面 |
| | L02 | CSS：Grid 入门与编辑器布局 | 三个盒子 → 编辑器骨架 |
| | L03 | JS 基础：变量、函数、对象、事件 | 按钮能改界面 |
| | L04 | Canvas：坐标与图形 | 能画线、矩形、圆 |
| B 核心 | L05 | 数据模型：图元与重绘 | 画面由数据生成 |
| | L06 | 交互：选中、拖动、删除 | 可编辑画布 |
| | L07 | 撤销/重做与 localStorage | 刷新不丢 |
| | L08 | 生成 TikZ 代码 | 画布 → 代码 |
| | L09 | 解析 TikZ（上）：词法与语法 | 代码 → 图元 |
| | L10 | 解析 TikZ（下）+ SVG 预览 | 代码 → 画面 |
| C 工程化 | L11 | ES Modules：拆分文件 | 多文件工程 |
| | L12 | TypeScript：给代码加安全带 | 类型安全 |
| | L13 | Vite + npm：开发服务器与构建 | 标准前端工程 |
| | L14 | React：组件、状态、Hooks | 组件化界面 |
| D 后端 | L15 | Node/Express：第一个 API | /api/compile |
| | L16 | 调用 XeLaTeX：真编译与导出 | PDF/SVG/PNG |
| | L17 | 测试与整合：替换原项目模块 | 可回归的模块 |
| 选修 | L18 | 图片 → TikZ 的 AI 工作流 | 最后再碰 |

说明：

- 每课可能需要 1–2 次坐姿；不要赶。
- L09/L10 是全程最难的，会拆成很多小步。
- 如果某课卡住，我们可以把一课拆成两课。

## 6. 每课怎么上

1. **回顾 5 分钟**：上一课你还能解释吗？
2. **讲 10 分钟**：只讲本课必需的概念。
3. **你写 30–60 分钟**：我看着；你卡住就提问。
4. **运行与调试 15 分钟**：看 Console，改一个小地方。
5. **我 review**：指出错误、命名、重复、可以更简单的地方。
6. **作业 3 行记录**：学了什么 / 哪里卡住 / 还有什么不懂。

每课的验收标准只有三条：

- 能运行；
- 能解释；
- 能自己改一个小地方。

## 7. 环境

已经确认可用：

- Windows
- VS Code
- Edge
- Node v26.4.0、npm 11.17.0
- TeX Live 2026（D:\texlive\2026\bin\windows\xelatex.exe）
- Python 3.14.4

注意：

- 原项目正在运行：5188（前端）、8788（API）。不要占用这两个端口。
- v1 直接双击 HTML 就能看，不需要服务器。
- v2 起我们用 5189 之类的端口。
- 现在不需要安装任何新东西。

## 8. 目录约定

~~~text
D:\FDU_AIagentDevelop\
  ...原项目...
  handmade-tikz\          ← 我们的学习区
    PLAN.md               ← 本文件
    progress.md           ← 进度与学习记录
    lessons\              ← 每课讲义
      01-first-page.md
    reference\            ← 速查资料
      skeleton.html
      html-order.md
      css-basics.md
      css-before-after.png
      grid-lab.html
      grid-before-after.png
      selectors.md
    index.html            ← L01 你创建
    styles.css            ← L02
    app.js                ← L03
    ...
~~~

规则：

- 每个文件不超过 300 行；超过就拆。
- 一个文件只负责一件事。
- 变量名用英文，注释可以用中文。
- 每课结束，代码必须能运行。

## 9. v1 验收标准

- 从空白文件开始，30 分钟内搭出三栏骨架。
- 画布上至少能画线、矩形、圆三种图元。
- 数据与画面分离：改数据，画面跟着变。
- 选中、拖动、删除都正常。
- 撤销/重做至少 20 步。
- 刷新页面后内容还在。
- 能导出 JSON，再导入恢复。
- 能生成 TikZ 代码。
- 能解析自己生成的 TikZ，往返不丢信息。
- 总代码不超过 1500 行，单文件不超过 300 行。
- 你能向别人讲清“鼠标事件 → 数据 → 画面”的数据流。

## 10. 和原项目的对照

| 原项目文件 | 我们什么时候学 | 简化版做什么 |
|---|---|---|
| src/App.tsx | L14 React | 三栏布局与快捷键 |
| src/components/canvas/* | L04–L06 | 画布与交互 |
| src/lib/figure/types.ts | L05 | 图元数据模型 |
| src/lib/figure/generate.ts | L08 | 模型 → TikZ |
| src/lib/figure/parse.ts | L09–L10 | TikZ → 模型 |
| src/store.ts | L07 | 状态、撤销、持久化 |
| server/latex.mjs | L16 | 调用 XeLaTeX |
| server/python/render.py | L16 | PDF → SVG/PNG |
| scripts/test-*.ts | L17 | 回归测试 |
| src/components/AiDrawer.tsx | L18（选修） | AI 生图 |

读原项目时记住：**先看输入输出，再看实现**。不要从第一行开始读。

## 11. 速查资料

- [HTML 骨架模板](reference/skeleton.html)：新建页面时对照这个结构。
- [HTML 位置速查](reference/html-order.md)：一页纸说明每个标签该放哪。
- [CSS 基础](reference/css-basics.md)：style 标签、选择器、盒子模型和常用属性。
- [Grid 初体验](lessons/02a-grid-first.md)：用三个盒子看懂 grid。
- [grid-lab.html](reference/grid-lab.html)：可以直接打开的 grid 小实验。
- [id 和 class](reference/selectors.md)：名字、标签和选择器的区别。

## 12. 现在开始

打开 [第 1 课](lessons/01-first-page.md)，按步骤做。

做完后告诉我“L01 完成”，我会读你的文件并 review。
