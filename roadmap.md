# Roadmap — 自 NO_TRACING_REBUILD_PLAN.md 以来的实施记录

> 记录时间：2026-10-26  
> 依据文件：`NO_TRACING_REBUILD_PLAN.md`（含 §1–§11）  
> 本文只记录**实际代码状态**，每条都有落点文件与验证方式；未完成的明确列出。

---

## 0. 一句话现状

- **§1 四条禁令**：已把四条对应的代码路径删除或封死（前端选项、旧接口、残余轮廓、骨架行走、逐列描点）。
- **§8 阶段 1 / 阶段 2**：阶段 2 的门槛已在真实模型上通过（交换图 3 节点 3 边 2 标签，95 分）。
- **§10.1 / §10.2 / §10.3 / §11**：主要机制已落地并带测试；§10.2 与 §10.3 仍有明确缺口（见 §3）。
- **§7 验收**：只完成了策略验收与语义验收；几何/排版/项目/泛化/效率验收未做。

---

## 1. 已完成（按方案编号）

### §1 不可放宽的约束

| 禁令 | 处理 | 落点 |
| --- | --- | --- |
| 逐像素描点 | 删除 `digitizePlot` 调用；`measured` 恒为 `{applied:false, curves:[], count:0}` | `server/ai.mjs` |
| 轮廓追踪 | `traceRaster` / `traceDocument` 不再被图片链路 import | `server/ai.mjs`（只保留 `decodePng`） |
| 骨架行走 | `server/fitcurve.mjs` **整文件删除**；`scripts/test-fitcurve.ts` 删除 | 文件系统 |
| 密集采样转 Bézier | `primitives.mjs` 增加点数预算：折线 > 12 点直接丢弃并记录 | `server/primitives.mjs` |
| 残余轮廓填补 | `composeFigure` 中 `traceRaster(plotResidual(...))` 整段删除 | `server/ai.mjs` |
| 嵌入原图 | 从未实现 | — |
| 重试/旧接口/前端重新启用 | 重试路径无描点调用；`/api/vectorize` → **410**；`trace/legacy` → **422**；前端三个开关（换描摹方式 / 高保真还原 / 旧版轮廓描摹）**已删除** | `server/index.mjs`、`src/components/AiDrawer.tsx` |
| 策略单点裁决 | `requireRepresentation` / `COMPLEXITY_BUDGET` / `provenanceOf` | `server/policy.mjs` |
| 回归测试 | 源码扫描：图片链路不得出现 `digitizePlot/plotResidual/fitFigure/traceRaster/traceDocument/skeletonize/traceSkeleton/coloredCurves` | `scripts/test-policy.ts` |

### §2 已查明的工程问题

| 编号 | 状态 | 说明 |
| --- | --- | --- |
| §2.1 表示层无关系 | ✅ | `server/semantic.mjs`：Node / Edge / Label + 命名节点 + 原生箭头 |
| §2.2 文字契约 | ⚠️ 部分 | 语义 IR 有 `mode: math|text`；`textext.mjs` 仍猜模式；`primitives.mjs` 仍按字符串全局去重 |
| §2.3 共用坐标图规则 | ⚠️ 部分 | 示意图先走语义协议；`FIGURE_PROTOCOL` 仍作兜底 |
| §2.4 残余描摹 | ✅ | 见 §1 |
| §2.5 两套输出表示 | ❌ | `src/lib/figure/types.ts`、`src/store.ts` 未改 |

### §3 目标架构

- ✅ Document / Node / Edge / Label（`semantic.mjs`）
- ❌ Constraints 只被 `validateSemantic` 解析、不被求解器消费
- ❌ Plot / Evidence 对象未建立
- ❌ 前后端共享契约未建立

### §4 当前交换图的最小正确结构

| 条款 | 状态 | 证据 |
| --- | --- | --- |
| 结构 JSON（nodes/edges/labels） | ✅ | `validateSemantic` 接受示例结构，拒绝未知节点/重复 id/无主标签 |
| §4.1 数学坐标系 | ✅ | `layoutSemantic` 输出 cm；y 向下只在输入边界 |
| §4.2 基线 + 从左到右 + TeX 实测宽度 | ✅ | `server/metrics.mjs`：`A`=0.55cm、`A^{(p)}`=1.51cm；测试 6 项 |
| §4.3 箭头从锚点发出 | ✅ | `compileSemantic` 用 `.east/.west`，路径为命名节点 |
| §4.4 三次 Bézier 上弧 + 避开中间节点 | ✅ | 峰高 = 中间节点顶部 + 0.55cm |
| §4.5 标签 = B(t) + 法向偏移 | ❌ | 目前是 B(t) + **竖直**偏移，不是法向 |
| §4.6 样式全图统一 | ✅ | 线宽/字号在 picture 级 |
| §4.7 真编译预览 / 画布真排版 | ⚠️ 一半 | 预览是真编译；画布仍是 Unicode 近似 |

### §7 验收体系

- ✅ §7.1 策略验收（`test-policy`）
- ✅ §7.2 语义验收（真实模型：3 节点 / 3 边 / 2 标签）
- ❌ §7.3 几何归一化度量、§7.4 排版验收、§7.5 项目全链路、§7.6 泛化、§7.7 效率

### §8 实施顺序

| 阶段 | 状态 |
| --- | --- |
| 阶段 1 边界与失败基线 | ✅ 四条禁令路径已封闭，且有源码扫描回归 |
| 阶段 2 语义表示与确定性编译 | ✅ 真实模型通过；可编译 |
| 阶段 3 约束布局与统一预览 | ⚠️ 布局与度量完成；排版/保存重开未验 |
| 阶段 4 局部修复与工作流 | ⚠️ 只完成对象级修复；缓存/预算/耗时统计未做 |
| 阶段 5 按图类扩展 | ❌ 未开始 |

### §9 主要代码落点

| 文件 | 状态 |
| --- | --- |
| `server/ai.mjs` | ✅ 协议分派、删除残余描摹、对象级修复、图例/刻度阶段 |
| `server/primitives.mjs` | ⚠️ 只加了点数预算与参数族输出；箭头/文字契约未迁入、字符串去重仍在 |
| `server/textext.mjs` | ❌ 未改 |
| `server/index.mjs` | ✅ 统一入口策略、封闭 vectorize |
| `src/lib/figure/types.ts` | ⚠️ 只加了 `parseErrors` |
| `src/store.ts` | ❌ 未改 |
| `src/components/canvas/DrawCanvas.tsx` | ⚠️ `displayText` 改为 Unicode 数学近似 |
| `src/components/AiDrawer.tsx` | ⚠️ 已删描摹开关；阶段状态展示未增强 |
| 新增模块 | ✅ `policy.mjs`、`semantic.mjs`、`metrics.mjs`、`legend.mjs`、`spline.mjs`、`imageterm.mjs`、`family.mjs`、`axis.mjs` |

### §10.1 画布一致性

| 项 | 状态 | 落点 |
| --- | --- | --- |
| 未解析坐标显式报错（不补零） | ✅ | `parse.ts` 的 `parseErrors` |
| 节点锚点 `(n1.east)` 解析 | ✅ | 按文字尺寸估算半宽/半高 |
| 图片级字体继承 | ✅ | 解析得 17.641pt（此前恒为 10pt） |
| viewport 从 `\useasboundingbox` 读取 | ✅ | {0,0,12,4.816} |
| bridge 其余样式继承 | ❌ | 未动 |
| 语义模型直接交前端 | ❌ | 仍靠解析 TikZ 回推 |
| 画布真排版 | ❌ | Unicode 近似（`A^{(p)}` → `A⁽ᵖ⁾`） |
| `parseErrors` 在界面展示 | ❌ | 只进了类型 |

实测（项目解析器解析语义图）：8 个元素、0 个解析错误、viewport 正确、两条箭头保留、弧线为 7 点 poly 且 `style.arrow="->"`。

### §10.2 图例条目

| 项 | 状态 | 说明 |
| --- | --- | --- |
| LegendEntry 原子对象（稳定 id、seriesId、样式、基线） | ✅ | `server/legend.mjs`，测试 14 项 |
| 配对：只在同一基线上挂标签 | ✅ | `pairLegendEntries` |
| 拒绝凭空补条目（无样例 / 无标签 / 条目多于曲线） | ✅ | `validateLegend` |
| 共同基线发射（样例 + 标签同 y） | ✅ | `emitLegendTikz` |
| 裁切坐标契约（声明而非猜测） | ✅ | `decompose.mjs` 改为声明 0..1000 + 超界报错 |
| 接进主流程 | ⚠️ | 已接：步骤流出现 `legend ok 1 条 · γ(z)→curve0`；**只识别出 1 条**（棕色点线在流程内仍漏检） |
| 模型确认条目↔系列 | ❌ | 现为颜色/线型匹配 |

### §10.3 曲线函数化 + 刻度对象

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 参数族（tanh 平台 / 广义凹陷 / 高斯） | ✅ | `server/family.mjs`，LM 拟合，pgfmath 表达式 |
| 族与样条的模型选择 | ✅ | 都达标才比较；参数少者胜；样条更简单则用样条 |
| 以函数绘图输出 | ✅ | `plot[domain=a:b, samples=160] (\x,{...})` |
| 刻度对象（数值 + 位置 + 短刻度线 + 标签） | ✅ | `server/axis.mjs`：`buildTicks` / `tickTikz` |
| 轴标定（稳健线性拟合 + 离群剔除） | ✅ | 实测 6 刻度、残差 **0.02px**、剔除 0 |
| 曲线身份 / 交叉处不换系列 | ❌ | 未做 |
| 曲线参数对应真实数据坐标 | ⚠️ | 标定已可用，但尚未把族参数换算到数据单位 |

### §11 曲线拟合

| 条款 | 状态 | 说明 |
| --- | --- | --- |
| §11.1 三次样条 + 节点预算 + 复杂度不随分辨率 | ✅ | 截断幂基，参数 ≤ 14 |
| §11.2 稀疏证据输入（非逐列/骨架） | ✅ | 输入是模型给的少量点 |
| §11.3 稳健损失 + λ∫f''² + 复杂度 + 图像项 | ✅ | Huber IRLS（可选）、固定网格平滑项、`imageterm.mjs` 的 F1 距离与坐标下降 |
| §11.4 单调 / 平台 / 尖角 / 跳变 | ✅ | PCHIP 强制单调、`applyPlateau`、`segmentShape` 分段与独立路径 |
| §11.4 闭合/周期/多曲线共享基/圆弧模型 | ❌ | 未做 |
| §11.5 Bernstein→Bézier 直接生成 | ✅ | 每区间一段 `.. controls ..`，无采样点 |
| §11.6 模型选择 + 失败标注 + 缩放稳定 | ✅ | `ok` / `reason` 明确未通过；放大 10 倍参数不增加 |
| 图像项接入主流程 | ❌ | 需要 raster + 段，当前曲线多为稀疏点，尚未接线 |

---

## 2. 记录在案的违反与纠正

1. **骨架行走**：我写过 `server/fitcurve.mjs`（`skeletonize` → `traceSkeleton` → `stitchPaths`）并接进示意图链路 → **违反 §1**，已删文件、删测试、删接线。
2. **逐列描点**：保留并使用了 `digitizePlot` 作为曲线唯一来源 → **违反 §1**，已删除调用。
3. **采样点转贝塞尔**：`fitcurve` 把拟合弧采样成 12–16 点再平滑 → **违反 §1**，已删除；当前样条直接输出 Bézier 段。
4. **前端仍可启用描摹** → **违反 §1**，三个开关已删除。
5. **误判阶段 1 通过**：在 `digitize` 还在时我报告过"阶段 1 门槛通过"，实际不成立；已在本文件与对话中更正。

---

## 3. 未完成清单（按优先级）

### 高

1. **§10.2 图例漏检**：流程内 `detectDottedLegend` 只得到 1 条；需定位是检测入参还是配对筛选（`usable` 要求文字非空）导致。
2. **§10.3 曲线身份**：交叉处不得交换 series；图例绑定依赖它。
3. **§4.5 法向偏移**：标签偏移应由曲线法向决定，而非固定竖直偏移。
4. **§11 图像项接线**：把 `refineWithImage` 接入有 raster 且有段的路径。

### 中

5. **§10.1 bridge 样式继承**、语义模型直接交前端、`parseErrors` 界面展示。
6. **§4.7 画布真排版**（KaTeX 或编译 SVG + 覆盖层）。
7. **§2.2** `textext.mjs` 显式类型、`primitives.mjs` 去重按对象身份。
8. **§10.3 刻度→数据坐标**：把族参数换算到 z 值。

### 低（扩展与验收）

9. **§11.4 剩余**：闭合/回环（参数样条）、周期（Fourier 候选）、多曲线共享基、圆弧紧凑模型。
10. **§7.3–7.7**：几何归一化度量、排版验收、项目全链路（上传→预览→编辑→保存重开→导出）、泛化保留集、效率统计。
11. **§8 阶段 5**：流程图/网络图、几何图、函数图、多面板，各自独立保留集。

---

## 4. 测试清单

| 命令 | 覆盖 |
| --- | --- |
| `node scripts/run-ts.mjs scripts/test-policy.ts` | 禁描摹策略、复杂度预算、来源记录、源码扫描 |
| `node scripts/run-ts.mjs scripts/test-semantic.ts` | 语义校验、布局、编译（命名节点/箭头/弧/标签） |
| `node scripts/run-ts.mjs scripts/test-metrics.ts` | TeX 实测文字宽度 |
| `node scripts/run-ts.mjs scripts/test-legend.ts` | 图例原子对象、配对、绑定、拒绝、发射 |
| `node scripts/run-ts.mjs scripts/test-spline.ts` | 自适应样条、Bézier 生成、模型选择、稳健/平滑/单调、拐角/跳变/平台 |
| `node scripts/run-ts.mjs scripts/test-imageterm.ts` | 墨迹提取、F1 距离、图像项坐标下降 |
| `node scripts/run-ts.mjs scripts/test-family.ts` | 参数族拟合、pgfmath 表达式、族 vs 样条选择 |
| `node scripts/run-ts.mjs scripts/test-axis.ts` | 轴标定、离群剔除、刻度对象、发射 |
| `npm run test:primitives` 等 7 个 | 既有图元/线/往返/标签/文字定位/核对/吸附 |

---

## 5. 运行与验收方式

- 启动：桌面 `TikZ Studio`（隐藏启动服务，只开一个应用窗口）
- 改完服务端代码：`重启 TikZ 服务.vbs`
- 前端 `5188` / API `8788`；日志 `logs/dev.out.log`、`logs/api.*.log`、`logs/ai/`
- 验收必须走真实模型与项目预览链路（§7 要求），确定性单元测试只隔离算法错误
