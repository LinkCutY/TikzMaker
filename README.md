# TikZ Studio

TikZ Studio 是一个面向论文插图的本地 TikZ 工作台，提供源码编辑、可视化画布、实时编译、格式导出，以及由视觉模型驱动的“图片 / 文字 → 可编辑 TikZ”工作流。

项目当前重点不是把图片轮廓机械地搬进 TikZ，而是先识别图的结构，再用节点、连线、文字、坐标轴、图例和低参数曲线重新构造。生成结果应当简洁、可解释、可继续编辑，并能够通过 LaTeX 编译和视觉回查。

> 当前状态：研究与开发版本。Windows 桌面启动流程已经可用，核心转换链路和回归测试已建立；复杂科学图的跨曲线约束、极值保持和坐标语义仍在继续完善，详见 [NEXT.md](NEXT.md)。

## 主要能力

- CodeMirror 6 TikZ/LaTeX 编辑器：语法高亮、补全、搜索、错误定位和自动编译。
- 服务端真实 LaTeX 编译：支持 XeLaTeX、PdfLaTeX、LuaLaTeX 探测，预览输出为 SVG。
- 可视化画布：线、贝塞尔曲线、矩形、圆、文本、坐标轴和函数图形可拖拽编辑。
- 双向同步：受控 TikZ 子集可以在源码与画布模型之间往返转换。
- 多格式导出：TEX、PDF、SVG 和高分辨率 PNG。
- 文生 TikZ：模型生成后自动编译，失败时携带诊断信息修复。
- 图转 TikZ：支持裁切、多面板拆分、图形分类、结构化识别、数学拟合、图例重建和视觉评审。
- OpenAI 兼容接口：可连接 DeepSeek、OpenAI、通义、GLM、Kimi、本地 Ollama 或自定义网关。
- Windows 桌面入口：双击启动时会安全地重启本项目 API，避免旧后端继续占用端口。

## 图转 TikZ 的设计原则

### 禁止逐像素描点

项目把这个约束写入了服务端策略，而不只依赖提示词：

- 图片必须转换为语义对象或拟合参数；
- `trace`、`outline`、`skeleton`、`vectorize` 等描摹表示会被 API 以 `422 TRACING_DISABLED` 拒绝；
- 曲线控制点预算不随图片分辨率增长，单条曲线最多保留 12 个语义控制点；
- 不允许用大量微小线段、轮廓多边形或残差图形伪装成“可编辑重建”。

这意味着一张 4000 px 的截图不会比 400 px 的截图生成更多坐标点。复杂度由图中对象的数量决定，而不是由像素数量决定。

### 语义重建与数学拟合

当前工作流大致如下：

```text
输入图片
  → 裁切 / 多面板拆分
  → 图形分类（diagram / plot / generic）
  → OCR 与结构化视觉识别
  → 节点、边、标签、坐标轴、图例、稀疏曲线
  → 参数族拟合或归一化自然三次回归样条
  → 生成 TikZ
  → LaTeX 编译
  → 几何检查 + 视觉模型回查
  → 验收或携带证据重试
```

对于科学曲线，优先寻找低参数表达，而不是复制采样噪声。例如可用统一的族模型表示为

\[
y_k(x)=b_k+a_k\,\phi_k\!\left(\frac{x-\mu_k}{\sigma_k};\theta_k\right),
\]

其中基线、幅度、中心、尺度和形状参数由稀疏地标拟合。没有合适参数族时，才使用带复杂度惩罚的低自由度样条。坐标统一在裁切面板的归一化空间中处理，再映射到 TikZ 画布。

图例作为“线型样本 + 文本 + 对应数据序列”的原子对象生成，避免主曲线、图例线段和 OCR 文本互相重复。最新的跨曲线相对位置、极值和坐标标定方案在 [NEXT.md](NEXT.md) 中给出。

## 快速开始

### 环境要求

- Node.js 18 或更高版本；
- npm；
- TeX Live，至少提供 `xelatex`（推荐同时安装 `pdflatex` 和 `lualatex`）；
- Python 3；
- PyMuPDF，用于 PDF → SVG/PNG 渲染：

```powershell
python -m pip install pymupdf
```

### 开发模式

```powershell
npm install
npm run dev
```

浏览器打开 <http://127.0.0.1:5188>。Vite 前端使用 5188 端口，API 使用 8788 端口。

### 生产模式

```powershell
npm run build
npm start
```

生产模式由后端在 <http://127.0.0.1:8788> 同时提供 API 和已经构建的前端。

### Windows 桌面启动

依赖安装完成后，可以双击仓库根目录的 `TikZ Studio.vbs`。它会调用 `scripts/launch.ps1`：

1. 检查 8788 端口的占用者；
2. 只终止能够确认属于本项目的旧 API 进程；
3. 每次启动都重新加载 `server/index.mjs`；
4. 如果 Vite 尚未运行，则启动前端；
5. 使用 Edge 应用窗口打开 TikZ Studio，Edge 不存在时退回默认浏览器。

脚本不会结束占用 8788 端口的未知程序，而会弹窗说明问题。运行日志写入被 Git 忽略的 `logs/` 目录。

## 配置模型服务

1. 打开右侧“文生 TikZ”；
2. 选择服务商，或填写 OpenAI 兼容的 Base URL；
3. 填写 API Key 和模型 ID；
4. 点击“保存并测试”，确认模型列表和图片输入能力；
5. 文生图直接输入描述；图转 TikZ 切换到“图片识别”，上传、粘贴或裁切图片后运行。

API Key 只保存在当前浏览器的 `localStorage`，请求时通过 `x-ai-key` 交给本机后端；它不会写入仓库。不要提交含密钥的 `.env`、日志或测试输出。

没有真实模型密钥时，可以使用仓库内的模拟服务验证生成—编译—修复链路：

```powershell
node scripts/mock-llm.mjs
```

随后把服务地址设为 `http://127.0.0.1:8899/v1`，Key 可填写任意非空字符串。

## 图转 TikZ 的推荐操作

对于论文截图，建议按下面的顺序操作：

1. 打开“文生 TikZ” → “图片识别”；
2. 粘贴或选择图片；
3. 多面板论文图先框选单个面板，或者使用面板拆分；
4. 选择“理解重画”；
5. 保持“画布兼容模式”开启；
6. 需要严格对照时开启视觉评审；
7. 点击“理解并生成 TikZ”；
8. 结果通过后替换编辑器内容，再到“画布”或“预览”检查。

“编译成功”只表示 LaTeX 合法，不表示语义正确。项目会额外检查曲线数量、图节点/连线数量、墨迹覆盖率、复杂度预算和视觉评审结果。

## 常用命令

```powershell
# TypeScript 检查 + Vite 生产构建
npm run build

# 关键策略、曲线工作流、输出集成和 UI 桥接回归
node scripts/test-api-policy.mjs
node scripts/test-plot-workflow.mjs
node scripts/test-output-integration.mjs
node scripts/run-ts.mjs scripts/test-ui-bridge.ts

# 更多确定性测试示例
npm run test:roundtrip
npm run test:primitives
npm run test:curves
npm run test:verify
```

`test-output-integration.mjs` 会调用正在运行的本地 API 并使用 XeLaTeX 编译输出；运行前请确认后端和 TeX 环境可用。

真实模型验收通过项目自身的生成链路执行：

```powershell
$env:TIKZ_AI_KEY_FILE = 'C:\path\to\key.txt'
$env:TEST_IMAGE = 'C:\path\to\sample.png'
$env:TEST_LABEL = 'manual-live-check'
node scripts/live-project.mjs
```

测试产物写入 `.probe-tests/`，该目录默认不会提交。不要把密钥直接写进脚本或命令历史。

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/health` | 检测 LaTeX 引擎、渲染器和服务状态 |
| `GET` | `/api/version` | 获取当前服务版本和能力标记 |
| `POST` | `/api/compile` | 编译 TikZ/LaTeX，返回 SVG、尺寸和诊断 |
| `POST` | `/api/export` | 导出 TEX、PDF、SVG 或 PNG |
| `POST` | `/api/lint` | TikZ 静态检查与结构统计 |
| `POST` | `/api/ai/text2tikz` | SSE 生成、编译、修复和评审流程 |
| `POST` | `/api/ai/generate` | 非流式生成接口 |
| `POST` | `/api/ai/compare` | 原图与生成结果的视觉比较 |
| `POST` | `/api/ai/labels` | 识别并结构化返回图片文字 |
| `POST` | `/api/ai/check` | 检查模型服务并读取模型列表/模态 |

最小编译示例：

```powershell
$body = @{
  source = '\begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}'
  engine = 'xelatex'
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri http://127.0.0.1:8788/api/compile `
  -Method Post `
  -ContentType 'application/json' `
  -Body $body
```

## 项目结构

```text
src/
  components/           React 界面、编辑器、预览、AI 抽屉和画布
  components/canvas/    可视化画布、工具栏和属性检查器
  lib/figure/           图形模型、TikZ 生成/解析、合并和质量检查
server/
  index.mjs             Express API 与路由
  ai.mjs                模型编排、图形分类、重试和验收
  policy.mjs            禁止描摹、复杂度预算和类别验收门槛
  primitives.mjs        结构化图元与科学曲线生成
  family.mjs            低参数函数族及坐标映射
  spline.mjs            归一化自然三次回归样条
  legend.mjs            图例识别与原子化输出
  semantic.mjs          节点、边、弧和标签的语义几何
  latex.mjs             LaTeX 引擎、编译和错误解析
  python/render.py      PDF → SVG/PNG
scripts/                启动器、确定性测试、真实模型测试和诊断工具
tools/                  OCR / 数学 OCR 辅助脚本
```

## 安全与边界

- LaTeX 编译固定禁用 shell escape；
- 后端默认只监听 `127.0.0.1`；
- 视觉模型请求会把用户选择的图片发送到所配置的模型服务，并消耗相应账户额度；
- API Key、日志、构建目录、虚拟环境和真实模型测试产物均应保持在 Git 之外；
- 画布只解析项目支持的受控 TikZ 子集；自由模式生成的复杂 TikZ 可以预览和导出，但未必能在画布中逐项编辑；
- OCR、图例关联、坐标标定和跨曲线关系仍可能出错。对论文数据图请人工核对刻度、极值和相对位置。

## 开发文档

- [NEXT.md](NEXT.md)：下一阶段实施规范，重点是极值、相对位置、联合约束和真实模型验收；
- [ROADMAP_REVIEW_2026-10-26.md](ROADMAP_REVIEW_2026-10-26.md)：阶段性路线审查；
- [NO_TRACING_REBUILD_PLAN.md](NO_TRACING_REBUILD_PLAN.md)：禁止描摹的底层重建设计；
- [VALIDATION.md](VALIDATION.md)：图像转换改进的验收记录；
- [roadmap.md](roadmap.md)：早期路线与实现记录。

贡献代码时，请保持“一个阶段通过确定性测试和真实模型验收后，再进入下一阶段”的工作方式，并为新的视觉规则补充最小失败样例和回归测试。
