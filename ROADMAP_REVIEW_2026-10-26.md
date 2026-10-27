# Roadmap 实测审查报告

日期：2026-10-26。范围：当前工作区代码、roadmap.md 中新增模块、两张用户样例的真实模型流程，以及画布实际采用的解析入口。未修改应用运行逻辑。

## 执行结果

| 项目 | 结果 |
| --- | --- |
| TypeScript `tsc --noEmit` | 通过 |
| Vite 生产构建 | 通过；输出到 `.probe-tests/roadmap-review/dist` |
| policy / semantic / metrics / legend / spline / imageterm / family / axis / primitives / figure-roundtrip / mathmode / style-preservation | 12 组均通过，但发现断言覆盖不足，见下文 |
| project-roundtrip | 默认 8792 端口不可用；设置 TEST_SERVER=8788 并使用本轮交换图输出后通过，8 个元素，项目编译成功 |
| 交换图真实模型调用 | deepseek-flash；3 节点、3 边、2 标签；编译成功、评审 95 分；墨迹覆盖率约 18%，被 55% 门槛拒绝；最终 ok=false；端到端约 13.1 秒 |
| 曲线图真实模型调用 | deepseek-flash；错误进入 diagram，11 节点、2 边、0 标签；评审 40 分，局部修复候选 20 分未采纳；最终 ok=false；约 24.2 秒 |
| `/api/vectorize` | 确认返回 410 |
| 请求 `representation=trace` | 没有返回 422，未捕获 PolicyError 导致 API 进程退出；已恢复服务 |

模型调用均经工作区运行中的 `/api/ai/text2tikz`，使用项目编译、渲染及模型评审。没有独立渲染或查看自行生成的图片。前端验证调用与 store 相同的 parseBodySafe 入口；本轮没有执行浏览器拖拽、刷新、保存重开的完整 UI 操作。

结束前复查：API 健康接口返回 ok=true，前端返回 HTTP 200。不过健康接口的 rendererInfo 字段报告 `Error: spawn EPERM`，说明渲染器版本探测仍有权限异常；本轮项目编译调用已有成功结果，不能据此断定整个渲染功能不可用。

## 1. [P1] 禁用表示的异常直接终止 API

位置：`server/index.mjs:381`、`server/index.mjs:285`、`server/policy.mjs:31`。

SSE 路由在 try/catch 之前调用 aiPayload；其中 requireRepresentation 会抛 PolicyError。当前 Express 4 的异步处理没有在此捕获拒绝，Node 进程退出。

已复现：向 text2tikz 发送 mode=image、representation=trace，客户端 ECONNRESET，随后 8788 ECONNREFUSED；原日志 `logs/api.err.log` 保存了对应堆栈。源码单元测试只验证函数会抛错，没有测试 HTTP 接口仍然存活。

影响：一个本应被拒绝的请求会让生成、编译等全部 API 不可用。

建议：在设置 SSE 响应头之前捕获请求解析和策略异常，返回相应 HTTP JSON 错误；补充拒绝请求后健康检查仍成功的接口测试。本次已恢复后台 API，未重试崩溃请求。

## 2. [P1] 曲线图没有接上新的分类入口，实际被当成交换图

位置：`server/ai.mjs:947`、`server/ai.mjs:1107`、`server/semantic.mjs` 的 validateSemantic。

measured 被固定为 applied=false，因此原测量分支永远不可达。else 对所有图片调用 understandDiagram，只要返回的节点/边结构通过校验就接受为 diagram，没有先验证输入确实属于该图类。

本轮第四张原图被识别为 11 个节点、2 条边。输出把 gamma(z)、V(z)、轴名和数字排成一行，部分节点坐标超出画幅，数据曲线消失。实际模型评审 40 分，最终拒绝。

此外，语义协议失败后的图元回退里，fitted.elements 被置为空，再与文字合并，模型识别出的非文字 elements 会被清掉。关闭旧路径后缺少正确替代路径。

建议：显式分类后分派 diagram/plot/geometry；校验语义类型及其必需结构。曲线图必须进入系列、轴、图例和拟合流程。禁用旧算法时保留模型已经识别出的合规图元。

证据：`.probe-tests/live/roadmap-review-plot/report.json`、`result.tex`。

## 3. [P1] 新图例和刻度发射代码不可达

位置：`server/ai.mjs:879`。

composeFigure 在 pixelMeasurement.applied=false 时立即返回 primitivesToTikz。新加入的 tickTikz / emitLegendTikz 在 return 之后；主流程又固定 measured.applied=false。因此即使 model.axis 或 model.legend 构造成功，也不会由新发射器输出。

影响：步骤显示“图例 ok”或“轴标定 ok”不足以证明最终文档包含它们。

建议：把合规图例、轴刻度合成与已经禁用的像素测量条件分离。集成测试从 model.legend/model.axis 进入正式 compose 路径，验证最终 TikZ，并通过项目编译。

## 4. [P1] 新参数曲线与图例输出器存在运行时和 TeX 错误

### 4.1 未定义的 opt

位置：`server/primitives.mjs:366`、`server/primitives.mjs:373`。

族函数及分段曲线路径使用 opt，但 opt 只在前一个图元循环的块作用域中定义。使用 25 个平台形状的稀疏测试点调用 primitivesToTikz，复现 `ReferenceError: opt is not defined`。该输入仅用于隔离生成器错误，不来自图像追踪。

### 4.2 函数输出反斜杠重复

位置：`server/family.mjs:200`。

familyTikz 实际生成双反斜杠 draw 和双反斜杠 x，而表达式中的变量是单反斜杠。通过项目 `/api/compile` 编译，返回 `Undefined control sequence`。现有 test-family 只匹配 plot[domain 字样，没有编译输出。

### 4.3 图例颜色格式非法

位置：`server/legend.mjs:126`。

emitLegendTikz 输出 `draw=#917fa4`。项目 TeX 编译失败：`Illegal parameter number in definition of \\tikz@temp`。其他生成器已经把颜色转成合法 rgb 形式，此模块未复用相同规则。

建议：先修输出契约和实际编译测试，再修图例识别。否则即使识别正确，接通新路径仍会失败。

证据：`.probe-tests/roadmap-review/reproductions.json`、`family.tex`、`legend.tex`。

## 5. [P1] 画布的实际入口仍丢失全局字体并改变锚点

位置：`src/lib/figure/bridge.ts:9`、`src/store.ts:486`。

parseBody 的新增逻辑可以读取整份源码中的全局字体，但 UI 使用 parseBodySafe：它先剥掉 tikzpicture 的选项，只将内部 body 交给 parseBody。

同一份本轮真实模型输出：

- 直接 parseBody：5 个文字字号均为 17.641 pt。
- UI 的 parseBodySafe：5 个文字字号均为 10 pt。
- 第一条箭头的横向端点从 4.475 / 5.215 cm 变为 4.253 / 5.437 cm，因锚点计算依赖估计文字尺寸。
- 两者均返回 8 个元素、0 个解析错误，viewport 正确；因此只看对象数量和编译成功不会发现损坏。
- 画布重建后的 TikZ 可以编译，但排版已经改变。

建议：保留 picture 选项或显式传入继承样式；回归测试使用 store 实际调用的 bridge。长期使用共享语义结构和真实文字度量。

## 6. [P1] 通用样条尚未覆盖正常输入，并有数值与预算问题

### 6.1 正常稀疏输入绕过新拟合器

位置：`server/primitives.mjs:329`。

仅在 curve.points.length>12 时进入新样条／函数族选择。识图协议要求的是 4–10 个关键点；9 点复现输出直接产生 8 段 Catmull–Rom，未进入新算法。这与“稀疏证据输入后进行受约束拟合”的目标不符。

### 6.2 坐标缩放导致不同结果

位置：`server/spline.mjs:44`、`server/spline.mjs:84`。

对同一个二次函数，原坐标拟合误差 0.01739、4 个参数并通过；x、y 均乘 1000 且容差同步放大后，归一化误差变成 0.08673、只剩 2 个参数并失败。项目输入恰好使用 0..1000 坐标。

当前未归一化截断幂基，形成正规方程后又按整矩阵 trace 给所有系数统一加 ridge，高次列会严重影响低次系数。建议在统一尺度下求解，采用稳定基和数值求解方法。

### 6.3 参数预算会超出

位置：`server/spline.mjs:216`。

循环条件使用 best.params<=maxK，在等于上限时仍添加节点。maxK=3 的二次、正弦和指数输入均得到 4 个参数。

### 6.4 输出误差和报告误差不一致

位置：`server/spline.mjs:272`。

直线分支用最小二乘误差决定是否通过，发射时却改为连接输入首尾两点。复现容差 0.3，报告误差 0.28284、ok=true，实际输出误差 0.31623，超出容差。

此外，primitives 会继续使用 model.ok=false 的样条，仅在说明里写“未达误差要求”，没有将该失败传递为生成失败。

### 6.5 现有通过测试不能证明拟合质量

test-spline 中振荡案例误差为 0.20136，而设定容差是 0.02；测试只断言类型和参数数量，因此依然通过。缩放测试仅放大 y，没有覆盖项目的 x、y 同时缩放。

建议：先修正规化、参数预算、报告与发射一致性，并测试最终发射曲线的误差；再把默认稀疏输入接入新流程。单纯继续添加函数族无法解决这些问题。

## 7. [P2] 交换图结构通过，但最终验收仍失败

位置：`server/policy.mjs:80`、`server/ai.mjs:1557`。

本轮交换图结构、编译和模型评审均通过，最终因墨迹覆盖率约 18% 被拒绝。不能仅凭 95 分认定结果正确，也不能把这次运行记录为端到端通过。

当前门槛还规定至少 3 个 draw，合法的单线／单曲线图也会被拒绝。需要按图类建立结构完整性与归一化几何指标，检查裁切、缩放和布局的对应关系。保留验证门槛，但校准它衡量的对象。

证据：`.probe-tests/live/roadmap-review-diagram/report.json`。

## 8. [P2] 裁切坐标声明仍与提示词矛盾

位置：`server/decompose.mjs:86`、`server/decompose.mjs:108`。

提示词仍要求 FULL-IMAGE 坐标，转换代码和新增注释却把输入声明成 crop 0..1000，再加裁切偏移。仅检查是否超过 1150 不能区分两种同为 0..1000 的坐标系。

这是代码核对确认的协议矛盾；本轮真实模型样例未执行到这个局部分支，不能归因于本轮已观察到的全部错位。建议改成明确字段及唯一转换契约，并增加给定裁切窗口的确定性变换测试。

## 9. 其他已确认缺口

- `checkComplexity` / `provenanceOf` 只有定义和测试，未接入当前生成器，不能据此宣称全路径执行统一预算与来源检查。
- `compileSemantic` 的 below 弧线仍输出 north 锚点并向上设置控制点，确定性复现可见。
- 图例配对只按 y 距离，横向 gap 仍是恒为零的占位表达式；右侧无关文本也可能配上。
- 图像优化项没有接入主生成流程；这一点 roadmap 已如实列出。
- 样条的单调处理、平台处理后应重新计算真实输出误差；现有结构不保证报告值随输出更新。

## 建议修复顺序

1. 捕获接口策略异常，保证非法请求不能终止服务。
2. 正确分派图类，恢复 plot 专用的识别、拟合、图例和轴生成流程。
3. 修复函数／图例生成器的 JavaScript 与 TeX 错误，接通不可达输出分支。
4. 修复实际 UI bridge 的样式继承与锚点一致性。
5. 修复样条尺度、预算、验收误差，接入常见的稀疏输入。
6. 校准分图类验收，随后进行真实模型保留集和完整 UI 回归。

## 可复现记录

- `.probe-tests/roadmap-review/tests.json`：首次 13 个脚本记录；其中 project-roundtrip 首次因默认旧端口失败，修正环境后单独运行通过。
- `.probe-tests/roadmap-review/reproduce.mjs`：针对已发现风险的复现程序，调用项目现有函数及 `/api/compile`。
- `.probe-tests/roadmap-review/reproductions.json`：复现的实测数值与编译错误。
- `.probe-tests/roadmap-review/manifest.json`：核对时的源码 SHA-256、修改时间、Node 版本及服务状态。
- `.probe-tests/live/roadmap-review-diagram/`、`.probe-tests/live/roadmap-review-plot/`：实际模型返回及项目事件。
- `logs/api.err.log`：策略异常引发服务退出的堆栈。
- `.probe-tests/roadmap-review/api-restored.*.log`：恢复后的 API 日志。

审查期间只新增测试、报告、构建和模型输出记录；未修复业务代码，已恢复测试触发退出的 API 服务。
