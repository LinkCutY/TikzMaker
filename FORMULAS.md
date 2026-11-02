# TikZ Studio 公式总览

> 本文列出 TikZ Studio 图 → TikZ 链路中实际参与计算的公式：坐标与度量、取点预算、样条与参数族拟合、形状约束、稳健统计、模型选择与验收阈值、图像证据、几何运算。
>
> 阅读约定：
> - 所有公式均对应代码实现，标注为 `路径:行号`，可直接跳读核对。
> - $x,y$ 是场景归一化坐标（每轴 $0..1000$，$y$ 向下）；$p_x,p_y$ 是源图像素；$W,H$ 是原图宽高。
> - 项目原则：**不做逐像素描迹**。取点预算只约束"模型给出的语义关键点"，不读像素；图像证据只用于优化有限参数，不转成输出顶点。
> - 标为 **超参数** 的系数是人为选定的启发式，不是统计推导结果。

> 渲染说明：公式为 TeX 数学语法（行内 `$...$`、独立 `$$...$$`），需用支持数学渲染的 Markdown 查看器打开（VS Code Markdown Preview、Typora、Obsidian、GitHub 等）；纯文本编辑器只会显示源码。

## 目录

1. [坐标与度量](#1-坐标与度量)
2. [取点公式](#2-取点公式)
3. [拟合公式](#3-拟合公式)
4. [约束与正则](#4-约束与正则)
5. [稳健统计](#5-稳健统计)
6. [模型选择与验收](#6-模型选择与验收)
7. [其他拟合器](#7-其他拟合器)
8. [图像证据](#8-图像证据)
9. [几何运算](#9-几何运算)
10. [阈值与参数总表](#10-阈值与参数总表)
11. [已知缺口](#11-已知缺口)

---

## 1. 坐标与度量

### 1.1 归一化 ↔ 源像素

$$p_x=\frac{x}{1000}\,W,\qquad p_y=\frac{y}{1000}\,H$$

反向：$x=1000\,p_x/W$，$y=1000\,p_y/H$。

### 1.2 各向同性度量（长度与转角都在此度量下计算）

$$\begin{aligned}
D&=\sqrt{W^2+H^2},\\
u&=x\cdot\frac{W}{D},\qquad v=y\cdot\frac{H}{D}.
\end{aligned}$$

用途：同一张图等比放大后预算不变；独立面板合成后仍沿用该面板的对角线尺度。见 [curve-budget.mjs](server/curve-budget.mjs:89)。

### 1.3 绘图区（plot-uv，$y$ 向上）

$$u=\frac{p_x-b_x}{b_w},\qquad v=1-\frac{p_y-b_y}{b_h}$$

反变换：

$$p_x=b_x+u\,b_w,\qquad p_y=b_y+(1-v)\,b_h$$

见 [plot-frame.mjs](server/plot-frame.mjs:3)。场景坐标仍是版面坐标（$y$ 向下），只有这一处边界负责换算。

### 1.4 坐标轴标定（线性 / 对数二选一）

对刻度点 $(u_i,\,w_i)$（$u_i$ 为归一化像素位置，$w_i$ 为刻度读数）做最小二乘：

$$\hat a=\frac{\sum_i (u_i-\bar u)(z_i-\bar z)}{\sum_i (u_i-\bar u)^2},\qquad \hat b=\bar z-\hat a\,\bar u,
\qquad z_i=\begin{cases}w_i & \text{线性}\\ \ln w_i & \text{对数}\end{cases}$$

$$E_{\mathrm{px}}=\max_i\left|\frac{z_i-\hat b}{\hat a}-u_i\right|\cdot \mathrm{span}$$

判据与选择：

$$E_{\mathrm{px}}\le 2\ \text{px}\ \Longrightarrow\ \text{接受};\qquad
\text{选对数}\iff \text{对数可行}\ \wedge\ \big(\text{线性不可行}\ \vee\ E^{\log}_{\mathrm{px}}+0.5<E^{\mathrm{lin}}_{\mathrm{px}}\big)$$

其中对数仅在刻度数 $\ge 3$ 时尝试；刻度数 $\ge 3$ 才标记 verified。见 [plot-frame.mjs](server/plot-frame.mjs:10)。

### 1.5 刻度读数共识（抗单个读错的数字）

对每一对刻度 $(i,j)$ 建立模型 $w=a+b\,u$，容差

$$T=\max\big(0.05,\;|b|\cdot 2\big)$$

统计内点，按「内点数最多，其次残差平方和最小」选模型，再对内点重拟合：

$$\mathrm{rmse}_{\mathrm{px}}=\frac{\mathrm{rmse}}{|b|},\qquad \mathrm{rmse}=\sqrt{\frac1n\sum_i\big(a+b\,u_i-w_i\big)^2}$$

见 [axis.mjs](server/axis.mjs:11)。

### 1.6 子图相似变换注册（无旋转）

$$q=s\,p+t,\qquad
s=\frac{\sum_k (p_k-\bar p)\cdot(q_k-\bar q)}{\sum_k\lVert p_k-\bar p\rVert^2},\qquad
t=\bar q-s\,\bar p$$

修剪最小二乘：每轮删除误差最大的关键点后重拟合，最多 6 轮，直到

$$\max_k\big\lVert s\,p_k+t-q_k\big\rVert\le 6\ \text{px}$$

接受条件：$\mathrm{RMS}\le 18\ \text{px}$。见 [register.mjs](server/register.mjs:58)。

---

## 2. 取点公式

### 2.1 自适应控制点预算（核心公式）

$$\boxed{
N_{\mathrm{req}}=2+n+\sum_{j=1}^{n+1}\max\left\{0,\;
\left\lceil \frac{S_j}{p}\sqrt{\min\left(1,\frac{\Theta_j}{\theta_0}\right)}\right\rceil-1\right\}
}$$

| 符号 | 含义 | 默认值 |
| --- | --- | --- |
| $n$ | 去重后的有效结构点数（不含两端） | — |
| $S_j$ | 第 $j$ 段折线弧长（模型关键点之间，非图像轮廓） | — |
| $\Theta_j$ | 该段**内部**累计绝对转角（端点转角已由 $2+n$ 付过） | — |
| $p$ | 弯曲区间的长度尺度 | $40$ |
| $\theta_0$ | 转角参考尺度 | $\pi/2$ |

实现见 [curve-budget.mjs](server/curve-budget.mjs:89)，常量见 [curve-budget.mjs](server/curve-budget.mjs:13)。

要点：

- $\Theta_j=0$（直线段）时根号项为 $0$，无论多长都不增点；
- $\sqrt{\cdot}$ 是**复杂度启发式**，不是拟合误差的保证；
- 公式输出是**简化目标**，单段硬上限 $N_{\max}=48$；超限要求"按有意义的边界拆分"，不静默删结构；
- 不生成等间距采样点——预算是上限，不是配额。

### 2.2 有效结构点判据

**转角**（叉积 / 点积形式，直接给出有符号角）：

$$\tau_i=\operatorname{atan2}\big(a_xb_y-a_yb_x,\;a_xb_x+a_yb_y\big),\quad
a=P_i-P_{i-1},\;b=P_{i+1}-P_i$$

- 明显折角：$|\tau_i|\ge 60^\circ$；
- 转角噪声：$|\tau_i|<3^\circ$ 不参与凹凸判定；
- 局部极值：纵向增量变号，且两侧单调度（prominence）$\ge 2$ 像素；
- 有效拐点：$\operatorname{sign}\tau$ 由正转负（或反之），两侧同向累计转角均 $\ge 15^\circ$，取弧长中点最近的候选点；同一位置只计一次。

**显著性（prominence）**：

$$\Pi=\min\Big(\big|y_{\mathrm{left}}-y\big|,\;\big|y_{\mathrm{right}}-y\big|\Big)\ \ge\ \varepsilon$$

其中 $\varepsilon=2$（噪声容限）。见 [curve-structure.mjs](server/curve-structure.mjs:2)。

### 2.3 保形几何简化（Douglas–Peucker）

$$d(p,ab)=\left\lVert p-\big(a+\mathrm{clamp}(t,0,1)(b-a)\big)\right\rVert,\qquad
t=\frac{(p-a)\cdot(b-a)}{\lVert b-a\rVert^2}$$

递归保留 $d>\varepsilon$ 的最远点。仅用于**估计复杂度**，简化结果不直接替换输出曲线。见 [simplify.ts](src/lib/figure/simplify.ts:22)、[shrink.mjs](server/shrink.mjs:70)。

### 2.4 填满剩余预算的几何显著度

$$s_i=\frac{\big|(B-A)\times(C-B)\big|}{\lVert AB\rVert+\lVert BC\rVert}$$

按 $s_i$ 从大到小补齐，而不是"每隔 $N$ 个点取一个"。见 [curve-landmarks.mjs](server/curve-landmarks.mjs:170)。

### 2.5 保形删点的整段误差上界

把原样条与候选样条限制到同一原始区间后，二者之差仍是三次多项式，落在其 4 个 Bernstein 控制系数的凸包内：

$$\big\lVert f-\tilde f\big\rVert_\infty\ \le\ \max_{k\in\{0,1,2,3\}}\big|c_k-\tilde c_k\big|\cdot\frac{h}{1000}\ \le\ 1.5\ \text{px}$$

区间对齐用 de Casteljau 细分，因此误差界覆盖整段，不只覆盖稀疏采样点。见 [scene-fit.mjs](server/scene-fit.mjs:208)。

### 2.6 点数上限

| 对象 | 上限 | 实现 |
| --- | --- | --- |
| 平滑曲线语义控制点 | $48$ | [curve-budget.mjs](server/curve-budget.mjs:13) |
| 输入点列 | $2048$ | 同上 |
| 离散观测点 / 标记 | $80$ | [series-geometry.mjs](server/series-geometry.mjs:10) |
| 显式 Bézier 段 | $24$ | [scene.mjs](server/scene.mjs:9) |
| 场景对象 / 路径 / 标签 | $260/60/160$ | 同上 |
| 拟合 B 样条系数 | $16$ | [scene-fit.mjs](server/scene-fit.mjs:413) |

---

## 3. 拟合公式

### 3.1 主拟合器：低维三次 B 样条

**基函数（Cox–de Boor 递推，clamped 结点）**

$$B_{i,0}(t)=\begin{cases}1,& t_i\le t<t_{i+1}\\ 0,&\text{otherwise}\end{cases}$$

$$B_{i,p}(t)=\frac{t-t_i}{t_{i+p}-t_i}B_{i,p-1}(t)+\frac{t_{i+p+1}-t}{t_{i+p+1}-t_{i+1}}B_{i+1,p-1}(t)$$

结点向量：$[0,0,0,0,\;\kappa_1,\dots,\kappa_{K-4},\;1,1,1,1]$。

**模型与目标函数**

$$f(x)=\sum_{j=1}^{K}c_j\,B_{j,3}(x),\qquad K\le 16$$

$$\min_{\mathbf c}\ \sum_{i=1}^{N} w_i\big(f(x_i)-y_i\big)^2+\rho\,N\,\mathbf c^{\top}R\,\mathbf c+\mu\lVert\mathbf c\rVert^2$$

其中

$$R_{pq}=\int_0^1 B''_p(u)B''_q(u)\,du$$

为弯曲能量矩阵，$\rho$ 即 ridge（候选搜索取 $10^{-8}\sim10^{-5}$，默认 $2\times10^{-3}$），$\mu=10^{-7}$ 为数值稳定项。

**权重**

$$w_i=\tilde w_i\cdot\rho_i\cdot\left(\frac{\max(0.5,\,w_{\mathrm{line}}/2)}{\sigma_i}\right)^{2}$$

- $\tilde w_i$：24 区间均衡权重，$\tilde w_i=\dfrac{m}{B\,c_{\mathrm{bin}(i)}}$，$m$ 为训练点数，$B$ 为非空区间数，$c$ 为区间计数；
- $\rho_i$：稳健权重（§5.1）；
- $\sigma_i$：RANSAC 给出的局部噪声尺度；
- 核验后的交点附加在 robustCount 之后，权重为 $1$，**不参与**稳健降权。

**端点消除**：clamped B 样条满足 $c_1=f(0)$、$c_K=f(1)$，端点约束直接消元而不是加软惩罚。

**迭代停止**：IRLS 至多 8 轮，$\max_j|c_j-c_j^{\text{prev}}|\cdot s_y<0.01$ 像素时提前退出。见 [scene-fit.mjs](server/scene-fit.mjs:87)。

### 3.2 训练 / 验证划分

实线用窄空间条带（避免宽块藏住整段陡升）：

$$\text{stripe}=\max\left(2,\ \frac{(x_{\max}-x_{\min})\,p_x}{160}\right)$$

$$\text{heldOut}(t)\iff \left\lfloor \frac{t\,(x_{\max}-x_{\min})\,p_x}{\text{stripe}}\right\rfloor \bmod 4=1$$

虚线整段留出：

$$\text{heldOut}\iff \left\lfloor \frac{s+\varphi}{P}\right\rfloor \bmod 4=1,\qquad s=\text{已走过的矢量弧长}$$

验证集不进入 RANSAC、不进入尺度估计、不进入权重。见 [scene-fit.mjs](server/scene-fit.mjs:343)。

### 3.3 分区误差度量

把横坐标分成 24 个区间，逐区间求 RMSE：

$$\mathrm{RMSE}_b=\sqrt{\frac1{n_b}\sum_{i\in b}\big(f(x_i)-y_i\big)^2}$$

$$E_{\mathrm{bal}}=\sqrt{\frac1{B}\sum_{b}\mathrm{RMSE}_b^{2}},\qquad
E_{\mathrm{worst}}=\max_b \mathrm{RMSE}_b$$

$E_{\mathrm{bal}}$ 为均衡误差，$E_{\mathrm{worst}}$ 为最差区间误差。见 [scene-fit.mjs](server/scene-fit.mjs:190)。

---

## 4. 约束与正则

### 4.1 单调性 = 系数有序

对三次 B 样条，系数有序是导数不变号的**充分条件**：

$$c_1\ \ge\ c_2\ \ge\ \cdots\ \ge\ c_K\quad\Longrightarrow\quad f'(x)\le 0\quad\forall x\in[0,1]$$

投影 $\Pi_{\mathcal C}$ 用等距回归（PAVA 分块均值）：相邻块违反序关系时合并并取均值。求解用加速投影梯度（FISTA 式），步长取 $\lVert A\rVert_\infty$ 的倒数，最多 600 轮：

$$\begin{aligned}
z_{k+1}&=\Pi_{\mathcal C}\Big(z_k-\tfrac1L\big(Az_k-b\big)\Big),\\
t_{k+1}&=\tfrac{1+\sqrt{1+4t_k^2}}{2},\\
x_{k+1}&=z_{k+1}+\frac{t_k-1}{t_{k+1}}\big(z_{k+1}-z_k\big).
\end{aligned}$$

端点被固定的系数在投影中作为边界约束处理。见 [scene-fit.mjs](server/scene-fit.mjs:56)。

### 4.2 形状约束（等式 + 不等式）

$$f(t_e)=y_e\ \text{（等式）},\qquad f'(t_e)=0\ \text{（光滑极值）},\qquad y_e-\tau_e\le f(t_e)\le y_e+\tau_e$$

端点区间：$\ell\le f(0)\le h$、$\ell\le f(1)\le h$。

**整段单调**（Bernstein 导数控制量非负，不只在采样点成立）：对每个多项式段 $[a,b]$、内部点 $m=(a+b)/2$、$\delta=\min(10^{-9},(b-a)\cdot10^{-5})$，要求

$$\sigma\,B'_{j}(a+\delta)\ \ge\ 0,\qquad
\sigma\,B'_{j}(m)\ \ge\ 0,\qquad
\sigma\,\Big(2B'_j(m)-\tfrac12\big(B'_j(a+\delta)+B'_j(b-\delta)\big)\Big)\ \ge\ 0$$

约束不相容时返回失败，不放松成高权重近似。求解为消去等式后的对偶投影坐标下降（$\le 800$ 轮）。见 [spline-constraints.mjs](server/spline-constraints.mjs:62)。

### 4.3 曲率正则矩阵

$$R_{pq}=\int_0^1 B''_p B''_q\,dx=\sum_{\text{段}}\frac{h_s}{2}\sum_{g=1}^{2}B''_p(x_{s,g})B''_q(x_{s,g}),\qquad
x_{s,g}=m_s\pm\frac{h_s}{\sqrt3}$$

2 点 Gauss 求积对分段线性 $f''$ 的乘积是精确的。见 [spline-constraints.mjs](server/spline-constraints.mjs:16)。

---

## 5. 稳健统计

### 5.1 损失函数与权重

$$r_i=f(x_i)-y_i,\qquad a_i=\frac{|r_i|}{\delta},\qquad \delta=1.5\,\sigma$$

$$\rho_{\mathrm{Huber}}(r)=\begin{cases}\dfrac{r^2}{2},& |r|\le\delta\\[4pt]
\delta\big(|r|-\tfrac{\delta}{2}\big),& |r|>\delta\end{cases}
\qquad\Longrightarrow\qquad
w_i=\begin{cases}1,& a_i\le1\\ 1/a_i,& a_i>1\end{cases}$$

$$\text{soft-L1:}\qquad w_i=\frac{1}{\sqrt{1+a_i^2}}$$

见 [robust-fit.mjs](server/robust-fit.mjs:12)。

### 5.2 稳健尺度（MAD）

$$\sigma=\max\Big(\text{floor},\;1.4826\cdot\operatorname{median}\big|r_i-\operatorname{median}(r)\big|\Big),\qquad
\text{floor}=\max\big(0.5,\;w_{\mathrm{line}}/2\big)$$

$$\sigma_{\mathrm{adapt}}=\operatorname{clamp}\Big(\operatorname{MAD}\big(r_i/\sigma_i\big),\;1,\;3\Big)$$

上下界防止"把系统性偏差说成任意大的测量噪声"。见 [robust-fit.mjs](server/robust-fit.mjs:9)。

### 5.3 局部 RANSAC 初始化

**假设**：局部二次 $y=v+l x+q x^2$（3 点插值；任意两点的 $x$ 间距 $<0.08$ 视为退化）。

**内点阈值**：

$$T=2.5\sqrt{\text{floor}^2+\Big(\tfrac12\,\text{slope}\Big)^2}$$

其中 slope 由窗口首尾四分位的 $y$ 中位数差除以窗口宽度得到。

**一致集要求**：

$$|I|\ \ge\ \max\big(9,\;0.6\,N_w\big),\qquad \#\{\text{横向四分位桶}\}\ \ge\ 4$$

分布充分的一致使必要：一段密集平台不能把其余曲线判为离群。

**所需试验次数**（$r$ 为一致集比例）：

$$N_{\mathrm{trials}}=\left\lceil\frac{\ln 0.01}{\ln\big(1-r^{3}\big)}\right\rceil,\qquad N_{\mathrm{trials}}\le 96$$

**预算**：$\le 24$ 个窗口，每曲线初始化 $\le 600\ \mathrm{ms}$，固定随机种子，权重下界 $0.15$，且仅用于首轮。

**重拟合**：对一致集做加权二次最小二乘（正规方程 + 部分主元消元）。

**窗口切分与尺度**：

$$\text{parts}=\left\lceil (b-a)\cdot 8\right\rceil,\qquad \sigma=\operatorname{clamp}\big(\operatorname{MAD}(r_I),\;\text{base},\;3\,\text{base}\big)$$

见 [robust-fit.mjs](server/robust-fit.mjs:40)。

---

## 6. 模型选择与验收

### 6.1 候选损失

$$\boxed{
L=E_{\mathrm{bal}}^2+0.5\,E_{\mathrm{worst}}^2+0.12\,K+8\,L_{\mathrm{cross}}
}$$

$$L_{\mathrm{cross}}=\frac{1}{|\mathcal C|}\sum_{c\in\mathcal C}\mathrm{conf}_c\big(f(t_c)-y_c\big)^2$$

其中 $K$ 为样条系数个数（复杂度项），$0.5$、$0.12$、$8$ 均为**超参数**。见 [scene-fit.mjs](server/scene-fit.mjs:468)。

### 6.2 交点权重与置信度

$$\mathrm{conf}_c=\frac{1}{1+\big(u_c/w\big)^2},\qquad
W_{\mathrm{cross}}=8\cdot\frac{N_{\mathrm{train}}}{24}$$

即"一个交点相当于 8 个普通证据窗口"，且两条曲线共用同一个图像坐标，而不是各自猜一个位置。见 [scene-fit.mjs](server/scene-fit.mjs:392)。

### 6.3 接受门槛

令 $\mathrm{tol}=\max(2.5,\;1.5\,w_{\mathrm{line}})$。

**严格通过**：

$$\begin{aligned}
&E_{\mathrm{bal}}\le \mathrm{tol},\\
&E_{\mathrm{worst}}\le\max(4,\;1.5\,\mathrm{tol}),\\
&E_{\mathrm{bal}}<0.85\,E^{\mathrm{before}}_{\mathrm{bal}},\\
&E_{\mathrm{worst}}\le\max\big(\mathrm{tol},\,E^{\mathrm{before}}_{\mathrm{worst}}\big).
\end{aligned}$$

**provisional（改善候选，强制待复核，不能自动通过）**：

$$\begin{aligned}
&E_{\mathrm{bal}}\le\max(8,\;2\,\mathrm{tol}),\\
&E_{\mathrm{worst}}\le\max(16,\;3\,\mathrm{tol}),\\
&E_{\mathrm{bal}}<0.6\,E^{\mathrm{before}}_{\mathrm{bal}},\\
&E_{\mathrm{worst}}<0.8\,E^{\mathrm{before}}_{\mathrm{worst}}.
\end{aligned}$$

**同等拟合时**（$\Delta E_{\mathrm{bal}}\le0.2$、$\Delta E_{\mathrm{worst}}\le0.3$、$\Delta E_{\mathrm{cross}}\le0.3$）选弯曲能量 $\mathbf c^{\top}R\mathbf c$ 更小者。见 [scene-fit.mjs](server/scene-fit.mjs:496)。

### 6.4 证据门槛

$$N_{\mathrm{evidence}}\ge 35,\qquad
\big|\{\text{20 格中非空}\}\big|\ge\begin{cases}16,&\text{实线}\\ 6,&\text{虚线}\end{cases}$$

$$N_{\mathrm{train}}\ge 25,\qquad N_{\mathrm{test}}\ge 12,\qquad x_{\max}-x_{\min}\ge 80$$

### 6.5 同色归属竞争

$$\mathrm{own}_k=\frac{\exp\!\left(-\dfrac{(y-p_k(x))^2}{2\sigma_k^2}\right)\cdot\big(\text{dashVisible}\ ?\ 1:0.15\big)}{\sum_{m}\exp\!\left(-\dfrac{(y-p_m(x))^2}{2\sigma_m^2}\right)\cdot\big(\text{dashVisible}\ ?\ 1:0.15\big)}$$

$$\sigma_k=\max(4,\;0.025\,H),\qquad \mathrm{own}_k<0.65\ \Longrightarrow\ \text{该像素判为歧义，丢弃}$$

竞争系列超过 8 条时拒绝单曲线拟合（密集同色系列需要共享模板）。见 [scene-fit.mjs](server/scene-fit.mjs:325)。

### 6.6 状态机

| 状态 | 条件 | 是否可自动通过 |
| --- | --- | --- |
| fitted | 严格门槛全部满足 | 是 |
| provisional | 满足改善门槛 | 否，需复核 |
| kept-model | 证据不足 / 时间预算 / 域太短 / 颜色不支持 / 端点无证据 / 线型退化 | 否 |

---

## 7. 其他拟合器

### 7.1 归一化自然三次回归样条

以截断幂基表达（$k_0=0$，$k_1<\dots<k_m$ 为内结点）：

$$d(k)=\frac{(u-k)_+^3-(u-1)_+^3}{1-k},\qquad
\phi_i(u)=d(k_i)-d(k_m),\qquad
f(u)=\beta_0+\beta_1u+\sum_{i=0}^{m-1}\gamma_i\,\phi_i(u)$$

$$\min_{\boldsymbol\beta}\ \sum_i w_i\,\rho\!\left(\frac{f(u_i)-y_i}{s}\right)+\frac{\lambda}{h^2}\sum_{i}\big(\Delta^2 f_i\big)^2$$

其中 $u=(x-x_{\min})/s_x$、$y$ 已归一化，$h=1/\text{steps}$、$\text{steps}=\max(8,K+6)$，因此平滑强度不随图像分辨率增长。

**Huber IRLS**（3 轮）：

$$\sigma=1.4826\cdot\operatorname{median}|r|,\qquad \delta=1.5\,\sigma,\qquad
w_i=\min\left(1,\frac{\delta}{|r_i|}\right)$$

若 $\max_i|r_i|\le 1.5\delta$ 则退回普通最小二乘。见 [spline.mjs](server/spline.mjs:74)。

**贪心结点加密**（$\mathrm{params}=2+\#\text{knots}\le 14$）：在最大残差处加结点，避开两端 $8\%$，与既有结点间距 $\ge2\%$，若 RMSE 不下降则停止。见 [spline.mjs](server/spline.mjs:251)。

### 7.2 PCHIP（Fritsch–Carlson）单调斜率

$$w_1=2h_i+h_{i-1},\qquad w_2=h_i+2h_{i-1}$$

$$m_i=\begin{cases}
0, & \delta_{i-1}\delta_i\le 0\\[4pt]
\dfrac{w_1+w_2}{\dfrac{w_1}{\delta_{i-1}}+\dfrac{w_2}{\delta_i}}, & \delta_{i-1}\delta_i>0
\end{cases}
\qquad \delta_i=\frac{y_{i+1}-y_i}{h_i}$$

Bézier 控制点：

$$c_1=\Big(a+\tfrac{h}{3},\; y_a+m_a\tfrac{h}{3}\Big),\qquad
c_2=\Big(b-\tfrac{h}{3},\; y_b-m_b\tfrac{h}{3}\Big)$$

见 [spline.mjs](server/spline.mjs:168)、[scene.mjs](server/scene.mjs:143)。

### 7.3 Catmull–Rom

$$c_1=P_1+\frac{P_2-P_0}{6},\qquad c_2=P_2-\frac{P_3-P_1}{6}$$

见 [plotcurve.mjs](server/plotcurve.mjs:14)。

### 7.4 四个函数值 → 精确三次 Bézier

给定 $p=f(0)$、$u=f(1/3)$、$v=f(2/3)$、$q=f(1)$：

$$r=27u-8p-q,\qquad s=27v-p-8q$$

$$c_{1y}=\frac{2r-s}{18},\qquad c_{2y}=\frac{2s-r}{18},\qquad
c_{1x}=a+\frac{b-a}{3},\qquad c_{2x}=b-\frac{b-a}{3}$$

用途：避免中心差分把 C0 接点两侧斜率混合、把真实折角磨圆。见 [scene-fit.mjs](server/scene-fit.mjs:144)。

### 7.5 低参数函数族（优先于样条）

$$\text{tanhPlateau:}\quad y=y_0+\frac{A}{2}\left[\tanh\!\Big(\frac{x-z_L}{|s_L|}\Big)-\tanh\!\Big(\frac{x-z_R}{|s_R|}\Big)\right]$$

6 参数：$y_0,\,A,\,z_L,\,z_R,\,s_L,\,s_R$。

$$\text{genDip:}\quad y=\inf-\text{depth}\cdot\exp\!\Big[-\big(\min(2,\big|\tfrac{x-\mu}{\sigma}\big|)\big)^{p}\Big],\quad p\in[1,8]$$

5 参数。

$$\text{gauss:}\quad y=\text{base}+A\exp\!\Big[-\big(\min(20,\big|\tfrac{x-\mu}{\sigma}\big|)\big)^2\Big]$$

4 参数。

**选择规则**：族与样条都必须满足容差，然后**参数少者胜**（并列时留给样条）：

$$\text{选族}\iff \mathrm{RMSE}_{\text{family}}\le\tau\ \wedge\ k_{\text{family}}<k_{\text{spline}}$$

见 [family.mjs](server/family.mjs:76)。

### 7.6 Levenberg–Marquardt

$$\big(J^{\top}J+\lambda\,\mathrm{diag}(J^{\top}J)\big)\,\Delta=-J^{\top}r,\qquad
\boldsymbol\theta\leftarrow\boldsymbol\theta+\Delta$$

$$\lambda\leftarrow\frac{\lambda}{3}\ (\text{接受}),\qquad \lambda\leftarrow 5\lambda\ (\text{拒绝}),\qquad \lambda_0=0.01,\ \le 60\ \text{轮}$$

有限差分雅可比步长 $h_j=\max(10^{-6},10^{-4}|\theta_j|)$。见 [family.mjs](server/family.mjs:20)。

### 7.7 峰族拟合（数字化模块）

$$\begin{aligned}
\text{gaussian:}&\quad y=\text{base}-a\exp\!\big(-((x-c)/s)^2\big)\\
\text{lorentzian:}&\quad y=\text{base}-\frac{a}{\big(1+((x-c)/s)^2\big)^2}\\
\text{sech}^2:&\quad y=\text{base}-\frac{a}{\cosh^2\!\big((x-c)/s\big)}
\end{aligned}$$

有界坐标下降，损失为 $\delta=3$ 的 Huber：

$$\ell(d)=\begin{cases}d^2,& d<3\\ 6d-9,& d\ge3\end{cases}
\qquad d=|y-f(x)|$$

步长初值 $(\mathrm{hi}-\mathrm{lo})/8$，失败则 $\times0.6$，$\le100$ 轮，步长 $<0.002$ 停止。见 [digitize.mjs](server/digitize.mjs:34)。

### 7.8 多曲线联合拟合

$$\boxed{
L=w_{\mathrm{fit}}\sum_k \omega_k r_k^2
+w_{\mathrm{ext}}\sum_{\mathrm{ext}}\big[f'(x_{\mathrm{ext}})\big]^2
+w_{\mathrm{ord}}\sum_{\mathrm{ord}}\max(0,\;m-g)^2
+w_{\mathrm{ax}}\sum_{\mathrm{ax}}(v-v^{*})^2
+w_{\mathrm{cpx}}\sum k
}$$

| 权重 | 值 | 含义 |
| --- | --- | --- |
| $w_{\mathrm{fit}}$ | $1$ | 数据残差；地标点权重 $\omega=6$ |
| $w_{\mathrm{ext}}$ | $1.5$ | 极值处导数应为 $0$ |
| $w_{\mathrm{ord}}$ | $20$ | 垂直次序违反量 $m-g$ |
| $w_{\mathrm{ax}}$ | $20$ | 轴接触值偏差 |
| $w_{\mathrm{cpx}}$ | $0.35$ | 复杂度（参数总数） |
| 硬失败 | $10^{9}$ | 违反 $\mathrm{conf}\ge0.85$ 的关系 |

搜索：束搜索 $\mathrm{beam}=8$。见 [joint-fit.mjs](server/joint-fit.mjs:182)。

### 7.9 交点计数（二分求根）

在 $[x_{\min},x_{\max}]$ 上取 129 个采样点加两条序列的全部顶点，对

$$g(x)=f_A(x)-f_B(x)$$

找变号区间，二分 35 次；两端同时 $|g|<10^{-7}$ 视为重合而非交点。

$$\text{通过}\iff \#\{\text{根}\}=\text{expected}$$

见 [curve-relations.mjs](server/curve-relations.mjs:130)。

---

## 8. 图像证据

> 本节各量只用于**有限参数优化**，不转成输出顶点，不提取逐列坐标。

### 8.1 墨迹似然

$$d=255-\mathbf c,\qquad p=255-\mathbf I,\qquad
\alpha=\operatorname{clamp}\!\left(\frac{p\cdot d}{d\cdot d},0,1\right)$$

$$\mathcal L(\mathbf I;\mathbf c)=\alpha\exp\!\left(-\frac{\lVert p-\alpha d\rVert^2}{2\cdot 35^2}\right)$$

$\alpha$ 是抗锯齿覆盖率，指数项惩罚色相偏离。见 [stroke-evidence.mjs](server/stroke-evidence.mjs:4)。

### 8.2 像素入选与颜色门限

$$\text{chroma}=\sqrt{(r-g)^2+(b-g)^2}\ \ge\ 25,\qquad \mathcal L\ \ge\ 0.3$$

竞争色以 $1.02$ 倍压过即排除；灰色曲线用 RGB 距离 $>24$ 判为异色。见 [scene-fit.mjs](server/scene-fit.mjs:306)。

### 8.3 虚线周期 / 占空比 / 相位

沿弧长积分，采样数

$$N_s=\operatorname{clamp}\!\left(\left\lceil\frac{S}{0.4\,w}\right\rceil,\;256,\;2048\right)$$

按线宽与弧长而非图像列，避免把一像素点稀释成 $1/3$ 墨迹。

$$\mathrm{score}(P,\mathrm{on},\varphi)=\frac1{|I|}\sum_{i\in I}\Big[\big(\mathrm{ink}_i-\mathbf{1}\{(s_i+\varphi)\bmod P<\mathrm{on}\}\big)^2+0.2\,\mathrm{bg}_i^2\Big]$$

搜索范围：

$$P\in\Big[\max(3,L/100),\ \min(L/3,\max(40,L/12))\Big]$$

$$\mathrm{duty}\in\{0.2,0.35,0.5,0.65,0.8\},\qquad 16\ \text{个相位}$$

再与 $P/2,\dots,P/6$ 的次谐波比较（防锁到 $2\times$/$3\times$ 周期），最后 6 轮半步细化。

**可靠判据**：

$$\text{cov}>0.06,\quad \#\mathrm{on}\ge4,\quad \#\mathrm{off}\ge4,\quad
\text{contrast}>0.15,\quad \mathrm{loss}<0.32,\quad \mathrm{loss}<0.8\,\mathrm{loss}_{\text{solid}},\quad L/P\ge3$$

见 [stroke-evidence.mjs](server/stroke-evidence.mjs:25)。

### 8.4 极值局部二次模板

$$\kappa=\frac12\left[\frac{a_y-b_y}{(b_x-a_x)^2}+\frac{c_y-b_y}{(c_x-b_x)^2}\right]$$

$$y(x)=y_0+\lambda\,\kappa\,(x-x_0)^2,\qquad \lambda\in\{0.5,1,2\}$$

$$\mathrm{score}=\frac1n\sum_i\Big(\mathrm{ink}_i-0.25\,\overline{\mathrm{bg}}_i\Big)\ \ge\ 0.45$$

$\sigma_x,\sigma_y$ 由 $\mathrm{score}\ge\mathrm{best}-0.08$ 的可行集方差给出（平坦窗口 $\sigma_x$ 合法地大）。见 [stroke-evidence.mjs](server/stroke-evidence.mjs:92)。

### 8.5 实心圆标记：矩拟合

$$c_x=\frac1n\sum x,\qquad c_y=\frac1n\sum y$$

$$v_x=\frac1n\sum x^2-c_x^2,\qquad v_y=\frac1n\sum y^2-c_y^2,\qquad
\mathrm{cov}=\frac1n\sum xy-c_xc_y$$

$$\mathrm{trace}=v_x+v_y,\qquad \mathrm{disc}=\sqrt{(v_x-v_y)^2+4\,\mathrm{cov}^2}$$

$$\text{圆度}=\frac{\mathrm{trace}+\mathrm{disc}}{\mathrm{trace}-\mathrm{disc}}\ \le\ 2\ (\text{空心 }2.5),\qquad
r=\sqrt{\frac{n}{\pi}}+e$$

填充率 $n/A_{\mathrm{bbox}}\ge0.5$，$2\le r\le18$。见 [plot-observations.mjs](server/plot-observations.mjs:43)、[marker-fit.mjs](server/marker-fit.mjs:52)。

### 8.6 空心标记：16 方向环模板

$$\mathrm{score}=\frac1{16}\sum_{k=0}^{15}\mathbf{1}\{\mathrm{on}(x+s\cos\theta_k,\;c_y+s\sin\theta_k)\}\ \ge\ 0.75,\qquad \theta_k=\frac{k\pi}{8}$$

方形模板：

$$s=\frac{r}{\max(|\cos\theta_k|,|\sin\theta_k|)}$$

见 [marker-fit.mjs](server/marker-fit.mjs:44)。

### 8.7 参考线

取墨迹计数 $s_y$ 满足 $s_y\ge0.8\,\max s_y$ 的行，加权质心：

$$c_y=\frac{\sum_y y\,s_y}{\sum_y s_y},\qquad \text{要求}\ \max_y s_y\ge0.25\,W$$

虚线参数：

$$\mathrm{dashOn}=\text{第 }80\text{ 百分位连续段长},\qquad
\mathrm{dashOff}=\operatorname{median}\{\text{有效间断}\}$$

见 [plot-observations.mjs](server/plot-observations.mjs:69)。

### 8.8 交点核验与定位不确定性

两侧方向夹角需 $\Delta\theta\ge10^\circ$（细化时 $\ge5^\circ$），得分

$$\mathrm{score}=\min(\mathrm{score}_A,\mathrm{score}_B)-0.001\,d_{\mathrm{expected}}$$

定位不确定性（交角越浅越不确定）：

$$u=\frac{w}{2\,|\sin\Delta\theta|}\ \ge\ 0.5,\qquad
u>0.65\,L\ \Longrightarrow\ \text{拒绝（病态位置）}$$

见 [crossing-evidence.mjs](server/crossing-evidence.mjs:53)。

---

## 9. 几何运算

### 9.1 三次 Bézier

$$\mathbf p(t)=(1-t)^3\mathbf p_0+3(1-t)^2t\,\mathbf p_1+3(1-t)t^2\mathbf p_2+t^3\mathbf p_3$$

**de Casteljau 分割**：

$$\begin{aligned}
\mathbf a&=\mathrm{mix}(p_0,p_1),&\mathbf b&=\mathrm{mix}(p_1,p_2),&\mathbf d&=\mathrm{mix}(p_2,p_3),\\
\mathbf e&=\mathrm{mix}(a,b),&\mathbf f&=\mathrm{mix}(b,d),&\mathbf g&=\mathrm{mix}(e,f)
\end{aligned}$$

左段 $(p_0,a,e,g)$，右段 $(g,f,d,p_3)$。

**与边界求交**：先由二次式给出候选切点，再对所有分割区间做 45 次二分确认变号根。见 [curve-clip.mjs](server/curve-clip.mjs:10)。

### 9.2 一般参数路径求交（凸包排除）

$$\text{AABB 相交}\iff a_x\le b_{x,\max}\ \wedge\ b_x\le a_{x,\max}\ \wedge\ a_y\le b_{y,\max}\ \wedge\ b_y\le a_{y,\max}$$

弦叉积求参数：

$$t=\frac{w\times v}{u\times v},\qquad s=\frac{w\times u}{u\times v},\qquad u=a_3-a_0,\ v=b_3-b_0,\ w=b_0-a_0$$

$t,s\in[0,1]$ 即为候选交点；细分到直径 $<0.05\ \mathrm{px}$，深度 $\le36$，工作量 $\le20000$。歧义（相切/重合）返回 unresolved，不谎报通过。见 [vector-crossings.mjs](server/vector-crossings.mjs:15)。

### 9.3 弧长（保虚线相位的复合 Gauss–Legendre）

$$L=\sum_{j=0}^{3}\sum_{i=1}^{5}\frac{w_i}{8}\left\lVert C'\!\left(\frac{j+(x_i+1)/2}{4}\right)\right\rVert$$

节点 $x_i=\pm0.9061798459,\ \pm0.5384693101,\ 0$；权重 $w_i=0.2369268851,\ 0.4786286705,\ 0.5688888889$（各 $\times2$）。见 [curve-clip.mjs](server/curve-clip.mjs:22)。

### 9.4 矩形绘图区裁剪

对每条三次段，解 $C_x(t)=x_0,\ x_0+w$ 与 $C_y(t)=y_0,\ y_0+h$，按参数排序切分，只保留中点在框内的子段；弧长累加给出被裁掉部分的偏移，用于延续 dash 相位：

$$\varphi_{\mathrm{new}}=\varphi_{\mathrm{old}}+\sum_{\text{dropped}}L_{\text{seg}}$$

见 [curve-clip.mjs](server/curve-clip.mjs:31)。

---

## 10. 阈值与参数总表

### 10.1 取点与结构

| 参数 | 值 | 位置 |
| --- | --- | --- |
| $p$（长度尺度） | $40$ | [curve-budget.mjs](server/curve-budget.mjs:13) |
| $\theta_0$（转角参考） | $\pi/2$ | 同上 |
| $N_{\max}$（平滑点硬上限） | $48$ | 同上 |
| 噪声容限 $\varepsilon$ | $2$ | 同上 |
| 折角阈值 | $60^\circ$ | 同上 |
| 转角噪声 | $3^\circ$ | 同上 |
| 拐点双侧累计转角 | $15^\circ$ | 同上 |
| 保形删点误差 | $1.5\ \mathrm{px}$ | [scene-fit.mjs](server/scene-fit.mjs:227) |
| 输入点上限 | $2048$ | [curve-budget.mjs](server/curve-budget.mjs:13) |

### 10.2 拟合与验收

| 参数 | 值 | 位置 |
| --- | --- | --- |
| B 样条系数上限 $K$ | $16$ | [scene-fit.mjs](server/scene-fit.mjs:413) |
| IRLS 轮数 | $8$ | [scene-fit.mjs](server/scene-fit.mjs:104) |
| 收敛阈值 | $0.01\ \mathrm{px}$ | 同上 |
| 容差 $\mathrm{tol}$ | $\max(2.5,\,1.5w)$ | [scene-fit.mjs](server/scene-fit.mjs:496) |
| 最差区间门槛 | $\max(4,\,1.5\,\mathrm{tol})$ | 同上 |
| 必须改善比例 | $0.85$ | 同上 |
| 分区数 | $24$ | [scene-fit.mjs](server/scene-fit.mjs:184) |
| 证据点下限 | $35$ | [scene-fit.mjs](server/scene-fit.mjs:336) |
| 覆盖格下限（实线/虚线） | $16/6$（共 20 格） | [scene-fit.mjs](server/scene-fit.mjs:341) |
| 训练/验证下限 | $25/12$ | [scene-fit.mjs](server/scene-fit.mjs:352) |
| 域长度下限 | $80$ | [scene-fit.mjs](server/scene-fit.mjs:277) |

### 10.3 稳健统计

| 参数 | 值 | 位置 |
| --- | --- | --- |
| MAD 系数 | $1.4826$ | [robust-fit.mjs](server/robust-fit.mjs:9) |
| Huber $\delta$ | $1.5\sigma$ | [robust-fit.mjs](server/robust-fit.mjs:12) |
| 自适应尺度夹取 | $[1,3]$ | [robust-fit.mjs](server/robust-fit.mjs:105) |
| RANSAC 阈值系数 | $2.5$ | [robust-fit.mjs](server/robust-fit.mjs:63) |
| RANSAC 窗口数 | $\le24$ | 同上 |
| RANSAC 每窗口试验 | $\le96$ | 同上 |
| RANSAC 初始权重下界 | $0.15$ | 同上 |
| 每曲线初始化时限 | $600\ \mathrm{ms}$ | [scene-fit.mjs](server/scene-fit.mjs:400) |

### 10.4 图像证据

| 参数 | 值 | 位置 |
| --- | --- | --- |
| 墨迹高斯宽度 | $35$ | [stroke-evidence.mjs](server/stroke-evidence.mjs:4) |
| 色度下限 | $25$ | [scene-fit.mjs](server/scene-fit.mjs:312) |
| 墨迹似然下限 | $0.3$ | 同上 |
| 同色竞争余量 | $1.02$ | 同上 |
| 归属阈值 | $0.65$ | [scene-fit.mjs](server/scene-fit.mjs:332) |
| 行不确定度 $\sigma$ | $\max(4,0.025H)$ | [scene-fit.mjs](server/scene-fit.mjs:327) |
| 虚线 loss 阈值 | $<0.32$ 且 $<0.8\,\mathrm{loss}_{\text{solid}}$ | [stroke-evidence.mjs](server/stroke-evidence.mjs:88) |
| 交点权重 | $8$ 个窗口 | [scene-fit.mjs](server/scene-fit.mjs:394) |
| 交点不确定性拒绝 | $u>0.65L$ | [crossing-evidence.mjs](server/crossing-evidence.mjs:54) |

### 10.5 几何验收

| 判据 | 阈值 | 位置 |
| --- | --- | --- |
| 墨迹支持率 | $\ge0.6$ | [verify.mjs](server/verify.mjs:143) |
| 最大折角（防锯齿伪造） | $\le28^\circ$ | [verify.mjs](server/verify.mjs:426) |
| 曲线越出坐标框 | $>2\%$ 即 major | [quality.ts](src/lib/figure/quality.ts:22) |
| 拟合几何值域 | $[-50,1050]$ | [scene-fit.mjs](server/scene-fit.mjs:537) |
| 中值定理见证 | $\lvert f'(\xi)-m\rvert\le0.005\max(1,\lvert m\rvert)$，且左右导数差同阈值 | [text-validation.ts](src/lib/figure/text-validation.ts:7) |
| 弦端点在曲线上 | $\max(0.003,\ 0.002\lVert AB\rVert)$ | 同上 |

---

## 11. 已知缺口

1. **交点数 $t$ 尚未进入预算公式。** [problems.md](problems.md:1) 建议

   $$N_{\mathrm{req}}=2+n+t+\sum_{j=1}^{n+1}\max\left\{0,\left\lceil\frac{S_j}{p}\sqrt{\min\left(1,\frac{\Theta_j}{\theta_0}\right)}\right\rceil-1\right\}$$

   但 [curve-budget.mjs](server/curve-budget.mjs:89) 的实现只有 $2+n+\sum$，没有 $t$。交点目前只以 $8\times$ 权重进入**拟合**，没有抬升**取点预算**。

2. **系数是超参数，不是统计推导。** $\sqrt{\cdot}$ 复杂度权重、$0.5E_{\mathrm{worst}}^2$、$0.12K$、$8\times$ 交点权重、$1.5\sigma$ 的 Huber $\delta$ 都是人为选取；[CURVE_POINT_BUDGET.md](CURVE_POINT_BUDGET.md) 已明确"平方根权重是启发式，不是拟合误差的数学保证"。

3. **验收阈值是工程门槛，不是置信区间。** $\mathrm{tol}$、$E_{\mathrm{bal}}<0.85E_{\mathrm{before}}$ 等回答的是"是否值得替换原几何"，不能读作误差概率界。

4. **坐标标定仍依赖模型给出的刻度文字。** 刻度位置由图像证据校正，但读数字符未被独立 OCR 核实，因此轴对齐错误无法被本文公式完全排除。
