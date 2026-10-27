# NEXT：科学曲线的极值、相对位置与联合约束

更新时间：2026-10-27。

本节是下一位 agent 应优先实施的任务。后面的 DeTikZify 等资料调研保留为附录，不属于本轮必须修改的范围。

## 1. 问题与目标

当前曲线图能够编译并通过整图视觉评审，但仍可能产生科学含义明显错误的局部关系。例如原图中棕黄色点线 `V(z)` 的中心最低点应沉到紫色 `γ(z)` 平台以下并接近纵轴的 `0`，当前输出却让两者在中心附近几乎相接。

这不是用户操作错误，而是当前流水线只分别拟合每条曲线，没有把“极值”“零轴接触”“两条曲线的上下关系”作为必须满足的结构约束。

本轮目标：

- 保留当前“不逐像素描点”的表示策略。
- 从稀疏语义证据中显式提取端点、极值、交点、平台边界和拐点。
- 同时标定横轴和纵轴，把拟合从图像坐标提升到数据坐标。
- 对多条曲线进行联合约束拟合，保持原图中的上下次序和交点关系。
- 增加局部结构硬验收，使整图高分不能掩盖中心极值错误。
- 保持对其他峰图、谷图、多系列曲线、能带图和相交曲线的普适性；禁止只为 `γ(z)` 和 `V(z)` 写特例。

## 2. 绝对约束

### 2.1 禁止逐像素描点

这一前提必须写死并由测试守住：

- 禁止沿图像骨架、轮廓或彩色像素逐点追踪曲线。
- 禁止把几十或几百个像素采样点直接写成 TikZ 坐标串或 Bézier 链。
- 每条曲线最多保留 12 个模型提供的稀疏语义控制点。
- Douglas–Peucker 等简化算法只能作用于模型已经返回的稀疏点，不能作用于像素轮廓。
- 图像像素只允许用于边框、坐标轴、刻度、图例样条和少量语义地标的验证，不得成为曲线路径表示。
- 最终输出必须是有限参数函数、受限样条或少量可解释 Bézier 段。

继续运行 `scripts/test-policy.ts` 中的 no-tracing source scan；新增模块也必须加入扫描范围。

### 2.2 不按曲线名称硬编码

不能出现类似 `if name === "V(z)"` 的业务逻辑。应当使用一般化关系对象，例如：

```json
{
  "relations": [
    {
      "kind": "vertical-order",
      "at": { "kind": "extremum", "seriesId": "curve-2" },
      "aboveSeriesId": "curve-1",
      "belowSeriesId": "curve-2",
      "marginPx": 8,
      "confidence": 0.94
    },
    {
      "kind": "axis-contact",
      "seriesId": "curve-2",
      "axis": "y",
      "value": 0,
      "at": { "kind": "minimum" },
      "confidence": 0.91
    }
  ]
}
```

只有图像中存在足够证据时才生成和执行关系约束。

## 3. 当前错误的根因

### 3.1 中心极小值不是强制控制点

模型可能返回超过 12 个点，当前按序号压缩到 12 点。唯一的中心谷底可能被丢弃或权重被削弱；两侧普通点反而占据大部分拟合权重。

压缩后必须保留的集合为

$$
\mathcal M=
\{\text{左右端点、局部极大值、局部极小值、交点、平台边界、显著拐点}\}.
$$

只有剩余名额才允许用于补充覆盖点。

### 3.2 纵轴没有成为数据约束

当前横轴刻度已经做线性标定，但纵轴的 `0`、`1` 主要作为文字绘制，没有进入曲线拟合。系统因此不知道黄色谷底在科学数据上应接近 `0`。

应从纵轴刻度建立

$$
v(y_{\mathrm{px}})=a_y+b_y y_{\mathrm{px}},
$$

其中图像纵坐标向下，所以通常有 $b_y<0$。拟合、极值和曲线关系应优先在数据坐标 $v$ 中计算。

### 3.3 曲线被独立拟合

单条曲线可以拥有较低残差，同时违反与另一条曲线的上下关系。当前没有约束

$$
V(\mu)+\delta\leq\gamma(\mu),
$$

其中 $\mu$ 是黄色曲线的中心极小值位置，$\delta>0$ 是原图可见的最小间隔。

如果约束在图像坐标中执行，因为纵坐标向下，方向必须反转：

$$
y_V^{\mathrm{px}}(\mu)
\geq
y_\gamma^{\mathrm{px}}(\mu)+\delta_{\mathrm{px}}.
$$

不得混淆这两个符号方向。

### 3.4 整图指标掩盖局部科学错误

外框、文字、刻度和大部分曲线正确时，整图视觉分数仍可能达到较高水平。中心几十个像素的错误会被平均掉。因此整图 reviewer 只能作为软指标，不能覆盖曲线关系硬门禁。

## 4. 目标数据协议

扩充 plot 曲线协议，但继续限制为稀疏语义信息：

```json
{
  "series": [
    {
      "id": "curve-1",
      "name": "legend text",
      "color": "#rrggbb",
      "dash": "solid",
      "continuous": true,
      "points": [[x, y]],
      "landmarks": [
        { "kind": "left-end", "point": [x, y], "confidence": 0.9 },
        { "kind": "minimum", "point": [x, y], "confidence": 0.95 },
        { "kind": "crossing", "with": "curve-2", "point": [x, y], "confidence": 0.8 },
        { "kind": "right-end", "point": [x, y], "confidence": 0.9 }
      ]
    }
  ],
  "relations": []
}
```

协议要求：

- 每条曲线 6–12 个点。
- 极值处必须至少有“左肩、极值、右肩”三个点。
- `landmarks` 中引用的点必须进入最终控制点集合。
- `continuous=true` 时不得因陡峭斜率自动切断曲线。
- 关系使用 `seriesId`，不要依赖数组顺序或标签文本。
- 模型没有足够把握时应降低 `confidence`，不得虚构轴接触和交点。

## 5. 控制点预算算法

不要再做简单的等序号抽样。建议算法：

1. 对模型返回的稀疏点按横坐标排序并去除重复点。
2. 把端点和所有高置信度 `landmarks` 放入 mandatory 集合。
3. 从相邻斜率符号变化中补充遗漏的局部极值候选。
4. 从曲率或折线偏差最大的区间依次补点，直到达到 12 点。
5. 若 mandatory 本身超过 12 点，按置信度和几何显著度选择，但左右端点与全局极值绝不能删除。
6. 验证简化前后的全局极值位置与数值偏差；超限则拒绝该曲线，而不是静默接受。

建议把逻辑独立到 `server/curve-landmarks.mjs`，并输出：

```js
{
  points,
  landmarks,
  dropped,
  preservedKinds,
  extremumError
}
```

## 6. 纵轴标定

在 `server/axis.mjs` 中增加与横轴对称的纵轴标定接口。不要复制一套不一致的逻辑，建议把当前一维线性标定抽象为：

```js
calibrateAxis(pairs, { pixelDirection: "x" | "y", robust: true })
```

纵轴配对要求：

- 数字标签必须位于纵轴左侧，并与纵向刻度或边框水平对齐。
- `0` 和 `1` 不能混入横轴数字行。
- 使用稳健线性回归并剔除明显 OCR 离群值。
- 返回 `toValue(pixel)` 和 `toPixel(value)`。
- 只有至少两个可靠刻度时才声明数据坐标标定成功。

若只有上下边框和 `0/1` 两个标签，可使用边框上下界作为刻度位置，但必须记录证据来源。

## 7. 普适性联合拟合

每条曲线仍分别生成候选模型，但选择候选时联合计算损失。

### 7.1 单曲线候选

至少比较：

- 直线或低阶多项式；
- 高斯/广义高斯峰谷；
- 双 sigmoid / 双 tanh 平台；
- 单调 Hermite；
- 归一化自然三次回归样条。

不能因为某个参数族能编译就直接选用；必须比较真实残差、参数数量、极值保持和形状约束。

### 7.2 联合目标函数

建议目标：

$$
\begin{aligned}
\mathcal L ={}&
\sum_s\sum_i w_{s,i}
\left[f_s(x_{s,i})-y_{s,i}\right]^2 \\
&+\lambda_{\mathrm{ext}}
\sum_{e\in\mathcal E}
\left[f'_{s_e}(x_e)\right]^2 \\
&+\lambda_{\mathrm{order}}
\sum_{r\in\mathcal R_o}
\max\!\left(0,
f_{\mathrm{below}(r)}(x_r)
-f_{\mathrm{above}(r)}(x_r)
+\delta_r\right)^2 \\
&+\lambda_{\mathrm{axis}}
\sum_{r\in\mathcal R_a}
\left[f_{s_r}(x_r)-v_r\right]^2 \\
&+\lambda_{\mathrm{complexity}}K.
\end{aligned}
$$

这里：

- $\mathcal E$ 是极值地标；
- $\mathcal R_o$ 是曲线上下关系；
- $\mathcal R_a$ 是轴接触关系；
- $K$ 是模型参数数量；
- 地标点权重 $w_{s,i}$ 应显著高于普通覆盖点。

如果所有候选都无法满足高置信度硬关系，应拒绝本轮模型结果并请求重新识别，而不是输出“最不坏”的错误图。

### 7.3 约束分类

- 高置信度的端点、全局极值、真实断点和轴接触：硬约束。
- 高置信度上下关系：硬约束或高权重 barrier。
- 对称性、平台平坦度、次要交点：软约束。
- 低置信度模型推断：只作为候选评分，不得强行改变曲线。

## 8. 结构性验收门禁

新增 `server/curve-relations.mjs` 或等价模块，在编译后、整图 reviewer 前执行。

至少检查：

1. 所有 mandatory 地标是否仍在拟合曲线上，误差是否小于容差。
2. 全局极值是否存在且位置、方向正确。
3. `vertical-order` 关系是否成立。
4. `axis-contact` 是否落在标定值的容差内。
5. 声明连续的曲线是否被输出为一个连续路径/函数。
6. 交点数量和左右顺序是否与高置信度地标一致。
7. 曲线是否保持在对应面板框内。

当前样例必须满足：

$$
z_V^*=\arg\min_z V(z),
\qquad
V(z_V^*)+\delta\leq\gamma(z_V^*),
$$

并且在纵轴成功标定时：

$$
|V(z_V^*)-0|<\varepsilon_y.
$$

建议 `δ` 使用原图可见间隔或至少 4–8 个源图像像素；`ε_y` 根据纵轴跨度和检测残差自适应设置，不能固定成只适合本图的常数。

门禁失败时返回明确错误，例如：

```text
curve relation failed: curve-2 minimum is 31 px above its required position;
expected it below curve-1 by at least 6 px near x=50.2%
```

该反馈应直接进入下一轮稀疏曲线识别提示，而不是交给模型猜测“整体看起来哪里不对”。

## 9. 局部视觉回查

整图 reviewer 之外，为每个高置信度关系建立小区域回查框：

- 极值中心及左右肩部；
- 两条曲线的交点；
- 图例样条与标签；
- 轴接触点。

局部 reviewer 只回答结构问题，例如：

- 黄色谷底是否位于紫色平台以下？
- 是否接近 `0` 轴？
- 两条曲线是否连续？
- 是否有遗漏或额外交点？

局部关系失败必须覆盖整图高分。

## 10. 建议修改位置

- `server/ai.mjs`
  - 扩充 `PLOT_CURVES_PROMPT` 和解析协议。
  - 把 landmarks/relations 传入拟合和验收。
  - 关系失败时生成定量重试反馈。
- `server/axis.mjs`
  - 抽象一维轴标定并增加纵轴标定。
- `server/curve-landmarks.mjs`（建议新增）
  - mandatory 地标识别、12 点预算和极值保持。
- `server/curve-relations.mjs`（建议新增）
  - 上下次序、轴接触、交点和连续性校验。
- `server/family.mjs`
  - 暴露候选函数的值、一阶导数、极值和参数界限。
- `server/spline.mjs`
  - 提供受地标约束的自然三次样条；重新计算最终输出的真实残差。
- `server/primitives.mjs`
  - 只发射通过联合选择和结构门禁的最终候选。
- `server/verify.mjs`
  - 把关系检查结果加入验收证据，但不要恢复像素追踪。
- `server/policy.mjs`
  - 检查每条曲线不超过 12 点、来源非 tracing、关系证据完整。

## 11. 实施顺序：每一步通过后再做下一步

### 阶段 A：协议和数据结构

1. 定义 landmarks/relations schema。
2. 严格验证非法 `seriesId`、越界坐标、重复地标和超过 12 点。
3. 增加确定性单元测试。

通过标准：旧 plot JSON 仍可兼容；新协议错误能返回清晰错误；no-tracing 测试通过。

### 阶段 B：地标感知的点预算

1. 实现 mandatory 集合。
2. 用几何显著度填充剩余预算。
3. 验证全局极值和端点不丢失。

测试必须包含：20 点压到 12 点时，位于中心且仅出现一次的谷底仍被保留。

### 阶段 C：纵轴标定

1. 抽象 `calibrateAxis`。
2. 增加 `0/1` 纵轴样例。
3. 测试图像 y 向下、数据 y 向上的符号关系。
4. 测试纵轴数字不会混入横轴。

通过标准：已知像素位置可以稳定映射到 `0` 和 `1`，残差低于设定阈值。

### 阶段 D：联合候选选择

1. 保留当前参数族和样条候选。
2. 增加地标权重和关系惩罚。
3. 对高置信度关系执行硬拒绝。

测试必须包含：两个单独残差都较小、但上下关系错误的候选不能胜出。

### 阶段 E：结构门禁和局部回查

1. 增加极值、上下关系、轴接触、连续性检查。
2. 把失败变成定量反馈。
3. 确认整图 reviewer 的高分不能覆盖关系失败。

### 阶段 F：真实模型测试

通过项目自身 `/api/ai/text2tikz` 调用真实模型，不得由 agent 自己生成一张替代图来冒充测试。

当前样例：

```text
C:\Users\Lenovo\AppData\Local\Temp\codex-clipboard-b6118b0a-bc0e-4c47-853e-458c15ee3818.png
```

可使用现有 `scripts/live-project.mjs`，但不得把 API Key 写入源码、报告或聊天。只有在已有用户授权和现有安全配置下才能调用外部模型。

真实测试至少记录：

- 模型返回的原始曲线点数与压缩后点数；
- 被保留的 landmark 类型；
- 横纵轴标定残差；
- 选中的候选族及参数量；
- 联合损失各项；
- 关系门禁结果；
- 项目编译结果；
- 局部与整图 reviewer 结果。

只有当前图通过后，才能继续用峰图、双曲线交叉图、不连续函数图、多系列 ridge 图做保留集回归。

## 12. 必须新增的回归测试

建议新增：

- `scripts/test-curve-landmarks.mjs`
- `scripts/test-y-axis.ts`
- `scripts/test-curve-relations.mjs`
- `scripts/test-joint-fit.mjs`
- `scripts/test-plot-acceptance.mjs`

核心断言：

- 20→12 点后全局极小值仍存在。
- 极小值左右至少各保留一个肩部点。
- 纵轴 `0/1` 标定方向正确。
- 在数据坐标中 `below` 对应更小的函数值。
- 在像素坐标中 `below` 对应更大的 y 值。
- 违反上下关系的低残差候选被拒绝。
- 合法的不连续曲线仍允许显式分段。
- 陡峭但连续的峰谷不得被误切断。
- 最终 TikZ 不含密集 `coordinates`，每条曲线参数预算合规。
- 图例、刻度、画布 bridge 与保存重开继续通过。

## 13. 本轮完成定义

只有同时满足以下条件才能宣称完成：

- 当前黄色曲线的中心最低点明确位于紫色平台以下。
- 纵轴可标定时，黄色最低点接近数据值 `0`。
- 两条曲线各自连续，交点数量和顺序正确。
- 没有逐像素描点或密集坐标输出。
- 每条曲线最多 12 个稀疏语义控制点。
- TikZ 通过项目编译。
- 结构关系门禁通过。
- 局部 reviewer 与整图 reviewer 均通过。
- 全套既有 policy、axis、legend、family、spline、primitives、UI bridge 和生产构建回归通过。
- 再用至少三类不同科学曲线图验证，不得只对当前图过拟合。

---

# 附录：图像 → TikZ 的资料与能力对照

> 目的：摸清「图片转 TikZ」现有方案的真实能力边界，决定我们这条流水线该借什么、不借什么。
> 结论先行：**目前只有 DeTikZify 是针对「图像→TikZ」训练的专用模型**；其余要么是从 SVG 转格式，要么只能从绘图库对象出发，要么是人工描图工具。

## 一、结论摘要

| 判断 | 依据 |
|---|---|
| 图像 → TikZ 的专用模型**只有 DeTikZify 一家** | 论文、权重、Space 都在，代码 Apache-2.0 |
| 它需要 **GPU（8B）**，不能走用户自带的 API key | 模型卡片与 README |
| 它的强项是「整图语义复现」，弱项同样是**精确坐标**（和我们一样） | 见第六节实测 |
| 我们现在的路线（像素测几何 + 模型读文字）**方向是对的** | 同类问题我们已有确定性约束 |
| 值得直接借鉴的是它的 **MCTS 自评搜索** | 不改权重、多候选择优，与我们「多轮修正」同源 |

## 二、专用模型

### 1. DeTikZify（NeurIPS 2024 spotlight）
- 仓库：https://github.com/potamides/DeTikZify （代码 Apache-2.0）
- 论文：https://arxiv.org/abs/2405.15306 ｜ OpenReview：https://openreview.net/forum?id=bcVLFQCOjc
- 模型：https://huggingface.co/nllg/detikzify-v2.5-8b 、https://huggingface.co/nllg/detikzify-v2-8b
- 在线：https://huggingface.co/spaces/nllg/DeTikZify （免费排队，重启最长 30 分钟）
- 安装：pip install 'detikzify[legacy] @ git+...'，另需 **TeX Live + ghostscript + poppler**
- 能力：输入图片/草图 → 输出可编译 TikZ；自带 **MCTS 推理**（生成多个候选、自评、择优选优，无需再训练）
- 局限：8B 参数，本地要 GPU；输出不含「像素级坐标校验」，复杂图同样会跑偏

### 2. TikZero（ICCV 2025 highlight）
- 论文：https://arxiv.org/abs/2503.11509 ｜ https://iccv.thecvf.com/virtual/2025/poster/51
- 权重：https://huggingface.co/nllg/tikzero-adapter 、https://huggingface.co/nllg/tikzero-plus-10b
- 定位：**文本条件**的零样本图形程序生成（插在 DeTikZify v2 上），不是「读图」路线；但说明「adapter + 搜索」是低成本增强手段

### 3. Sketch2Diagram（ICLR 2025）
- https://proceedings.iclr.cc/paper_files/paper/2025/hash/2567c95fd41459a98a73ba893775d22a-Abstract-Conference.html
- 手绘草图 → 矢量图（不直接产 TikZ），思路可用于「先矢量化再生成」

### 4. Image2TikZ（蒸馏）
- https://github.com/younisraafat22/Image2TikZ
- 把 DeTikZify 蒸馏成更小模型，说明 8B 并非必需，但需要训练 —— 与「不训练」的前提冲突

## 三、成品工具

| 工具 | 输入 | 输出 | 许可 | 评价 |
|---|---|---|---|---|
| https://github.com/yodalego99/raster-to-tikz | 栅格图（人工描） | TikZ | MIT | Windows/.NET 8，**手工描图**，不是自动识别；可参考其吸附/样式面板交互 |
| https://github.com/opentikz/opentikz | 文本/图标 | TikZ | MIT | 论文示意图模板库 + Claude Code skill，做「从零画」 |
| https://letx.app/learn/image-to-latex/ | 图片 | LaTeX | 商业 | 通用文档截图方向 |
| https://huggingface.co/spaces/nllg/DeTikZify | 图片 | TikZ | 免费排队 | 最快做对照实验的入口 |

## 四、工具链（转格式，不「理解」）

| 环节 | 工具 | 说明 |
|---|---|---|
| 栅格 → SVG | potrace、**VTracer**（我们已用） | 忠实但会描成填充块，编辑性差 |
| SVG → TikZ | https://github.com/xyz2tex/svg2tikz 、https://pypi.org/project/svg2tikz/ 、https://github.com/mgmillani/pictikz | 路径级转换，不认语义 |
| 曲线图取点 | https://automeris.io/ | 半自动取数据点，再交给 pgfplots |
| matplotlib → TikZ | https://github.com/JasonGross/tikzplotlib 、https://pypi.org/project/matplot2tikz/0.3.2/ | **只能从对象出发**，图片不行 |

## 五、对我们的启示

1. **不换主干**：DeTikZify 也要吃 GPU、也不能用用户 key，且同样缺像素级校验；我们的「像素测几何 + 模型读文字」在架构上更可控。
2. **借 MCTS**：把「每轮 1 个候选」改成「每轮 2–3 个候选 → compareVision 打分 → 只展开最优」，与现有 maxRounds 机制天然兼容。
3. **评测口径要对齐**：DeTikZify 用 CLIP/SSIM 类相似度；我们已有**墨迹覆盖 / 区域缺失 / 字符级去重**，更贴近「能不能用」。
4. **对照实验**：同一张 user.png 分别跑 DeTikZify 与我们，比较「文字是否重复、刻度是否在轴下、曲线是否连续」。

## 六、实验记录（2026-10-26）

同一张 `user.png` 三方对照：原图 / DeTikZify v2.5-8b（HF Space, sampling 模式, 64s）/ 本地流水线。

**DeTikZify 输出（节选）**：

```tex
\begin{axis}[height=3cm,width=7.5cm,ymin=0,ymax=1.1,xmin=-9.5,xmax=9.5,
  xlabel={$z/l_0$}, ylabel={$\gamma(z)$\\$V(z)$},
  xtick={-9,-6,-3,0,3,6,9}, ytick={0,1}]
\addplot[color=violet, ultra thick, domain=-6:-3]{1};
\addplot[color=violet, ultra thick, domain=-3:3]{0.5};
\addplot[color=orange, ultra thick, dashed, domain=-9:-0.1]{1};
\end{axis}
```

| 维度 | DeTikZify | 我们 |
|---|---|---|
| 坐标轴/刻度 | **好**：`xtick={-9,...,9}`、`xmin/xmax` 全部正确（多了一个 0） | 好：从像素配对刻度行 |
| 轴标签 | 好：`xlabel={$z/l_0$}`；但把图例文字塞进了 `ylabel` | 好：`z/l_0` 在轴下居中 |
| 曲线形状 | **差**：用 `\addplot{0}`/`{1}`/`{0.5}` 拼常数段，**斜坡全丢、V(z) 的凹陷完全没画** | 好：像素拟合，斜坡与凹陷都在 |
| 图例 | 无（并进了 ylabel） | 无样例线（已知待修） |
| 输出形态 | **pgfplots 语义重建**（可编辑、体积极小） | TikZ 图元 + 像素拟合曲线 |
| 耗时 | Space 排队 + 64s（sampling）/ MCTS 更久 | 本机 ~10s（含 1 次模型调用） |
| 成本 | GPU（或排队） | 用户自己的 API key |

**结论**：DeTikZify 强在「猜出这是什么图（坐标轴+刻度+标签）」，弱在「把曲线画准」；
我们的强项正好相反。两者互补：如果要做下一代，理想形态是 **DeTikZify 式的语义骨架 + 我们的像素测量回填曲线**。

对照图：`.shots/three-way.png`

## 七、参考链接

- DeTikZify 仓库 https://github.com/potamides/DeTikZify
- DeTikZify 论文 https://arxiv.org/abs/2405.15306
- DeTikZify Space https://huggingface.co/spaces/nllg/DeTikZify
- 模型 v2.5-8b https://huggingface.co/nllg/detikzify-v2.5-8b
- TikZero 论文 https://arxiv.org/abs/2503.11509
- Sketch2Diagram https://proceedings.iclr.cc/paper_files/paper/2025/hash/2567c95fd41459a98a73ba893775d22a-Abstract-Conference.html
- Image2TikZ https://github.com/younisraafat22/Image2TikZ
- raster-to-tikz https://github.com/yodalego99/raster-to-tikz
- opentikz https://github.com/opentikz/opentikz
- svg2tikz https://github.com/xyz2tex/svg2tikz
- tikzplotlib https://github.com/JasonGross/tikzplotlib
- matplot2tikz https://pypi.org/project/matplot2tikz/0.3.2/
- WebPlotDigitizer https://automeris.io/
## 八、OCR 实验（2026-10-26）

目标：用 OCR 的字符框替换「连通域猜文本块」，解决刻度/标签定位。

实现：`tools/ocr.py`（RapidOCR / PP-OCR，CPU，3× 上采样，约 1.2 s/张）。

| 图片 | OCR 检出数 | 我们的连通域块数 | OCR 识别字符串样例 |
|---|---|---|---|
| user.png | 6 | 12 | `-(2)`（应为 γ(z)）、`2/10`（应为 z/l₀）、`6-`（应为 −6） |
| panel-1.png | 3 | 9 | — |
| flowchart.png | 3 | — | — |
| bars.png | 1 | — | — |
| sphere.png | 0 | — | — |

**结论：PP-OCR 不适合这类小字号数学排版**。它按「场景文字/文档文字」训练，
对这种 20–30 px 的斜体数学符号，检测会合并相邻字符（`−6` 读成 `6-`）、漏检刻度、并把
希腊字母读成 `(2)`。把它接进主链路会**降低**现有准确率，因此保留为可选 provider，默认关闭。

下一步（若仍想用 OCR 级识别）：改用**公式 OCR**（pix2tex / LaTeX-OCR，约 25 MB，CPU 可跑）
只做「识别」，框仍用我们的连通域——这能修正 `γ(z)` 这类字符串，但装它需要 torch（数百 MB）。
### 8.1 公式 OCR（pix2tex / rapid_latex_ocr）实验结果

环境：Python 3.12 venv（`.venv-math`），`rapid_latex_ocr 0.0.9` + onnxruntime（**无需 torch**，模型约 49 MB）。
输入：`user.png` 上我们的 12 个文本块，2× 上采样 + 4 px 留白。

| 真实内容 | OCR 输出 | 结果 |
|---|---|---|
| `1` | `\frac{\sqrt{s}}{\sinh}\,` | ✗ |
| `-9` | `-\mathfrak{M}` | ✗ |
| `-6` | `-\mathfrak{C}` | ✗ |
| `-3` | `-\overline{v}_{41}^{*}` | ✗ |
| `3` | `\iota_{\iota_{\iota}}` | ✗ |
| `6` | `(\stackrel{\cdot}{\downarrow})` | ✗ |
| `9` | `\zeta_{\pm}\rbrace` | ✗ |
| `z/l_0` | `z/l` | 部分 ✓ |
| `V(z)` | 336 秒后输出超长乱码（模型跑飞） | ✗ |

**结论：在这个分辨率下（字高约 25 px），两个 OCR 引擎都不可用。**
瓶颈是**源图分辨率**，不是引擎：pix2tex 训练于「渲染公式」大图，缩到 20–60 px 的细笔画后，
单字符识别基本等于抛硬币（`3` ↔ `9`、`−6` ↔ `\mathfrak{C}`）。

可行的前提：**源图放大 2–4 倍**（或提供原始 PDF/矢量图）后再跑 OCR，才有意义。
在那之前，现有方案（模型读字符串 + 像素按行/按列配对）仍是这个分辨率下的最优解。
