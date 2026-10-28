# HTML 位置速查：不要背顺序，背“盒子”

## 1. 一句话

HTML 不是“从上到下的命令”，而是“一层套一层的盒子”。知道一个标签属于哪个盒子，位置就定了。

## 2. 文档树

~~~text
document
└─ html                 ← 根盒子
   ├─ head              ← 给浏览器看：编码、标题、样式
   │  ├─ meta charset
   │  ├─ meta viewport
   │  ├─ title
   │  └─ style / link
   └─ body              ← 给人看：标题、段落、画布、按钮
      ├─ h1 / p / canvas / ...
      └─ script
~~~

## 3. 最小骨架（先背这 10 行）

~~~html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>页面标题</title>
</head>
<body>
  <h1>内容</h1>
</body>
</html>
~~~

能默写这 10 行，就已经会 80% 的“顺序”。

## 4. 位置表

| 标签 / 东西 | 放哪里 | 作用 | 页面上可见？ | 要闭合？ |
|---|---|---|---|---|
| `<!doctype html>` | 文件第一行 | 告诉浏览器用现代标准 | 否 | 否 |
| `<html>` | 包住全部 | 根元素 | 否 | 是 |
| `<head>` | html 里，body 前 | 元信息 | 否 | 是 |
| `<meta charset>` | head 第一行 | 字符编码 | 否 | 否 |
| `<meta viewport>` | head，charset 后 | 手机适配 | 否 | 否 |
| `<title>` | head | 标签页文字 | 标签页 | 是 |
| `<style>` | head（通常） | 内部 CSS | 否 | 是 |
| `<link>` | head | 外部 CSS / 图标 | 否 | 否 |
| `<script>` | body 末尾，或 head + defer | JavaScript | 否 | 是 |
| `<body>` | html 里，head 后 | 可见内容 | 是 | 是 |
| `<h1>` `<p>` `<canvas>` | body | 内容 | 是 | 是 |

## 5. 四条硬规则

1. `<!doctype html>` 永远第一行。
2. `charset` 在 `head` 里越早越好，最好第一行；必须在任何中文内容之前，且在前 1024 字节内。
3. `head` 在 `body` 前；`body` 里才是用户看得到的东西。
4. `script` 放 `body` 末尾，或 `head` 里加 `defer`；闭合标签“后开先关”。

## 6. 为什么 charset 要最早？

浏览器拿到的是字节。它必须先知道“这些字节按 UTF-8 解码”，才能把中文显示对。如果 charset 写在中文后面，浏览器可能已经用错编码读了前面一段。规范要求它出现在文档前 1024 字节内，实际写法就是 head 第一行。

## 7. meta 是“空元素”

`meta`、`link`、`br`、`hr`、`img`、`input` 没有结束标签。不要写 `</meta>`。

空元素 = 只有开始标签，自己就结束了。

## 8. 为什么 script 要放最后？

浏览器从上到下解析。script 放在 h1 前面时，h1 还没被创建，`document.querySelector("h1")` 会得到 `null`。放 body 末尾，等页面元素都建好再执行，最稳。

进阶：`<script src="app.js" defer></script>` 放 head 也可以；`defer` 表示“下载完先别跑，等 HTML 解析完再按顺序跑”。

## 9. 浏览器很宽容，但别依赖

漏结束标签、顺序写错，浏览器经常还能显示——它在帮你修。但修出来的结构不一定是你想要的，而且不同浏览器可能修得不一样。先写对，再谈“能跑”。

## 10. 要背什么，不背什么

- 背：10 行骨架、4 条硬规则、十来个常用标签（h1、p、div、span、a、img、ul/li、button、canvas、script/style/meta/title）。
- 不背：所有标签、所有属性、所有 CSS。用到再查。
- 顺序不是背的，是“盒子关系”推出来的。

## 11. 5 分钟练习

1. 关掉这份文档，凭记忆写一遍 10 行骨架。
2. 对照，改错。
3. 连续 3 天各写一遍。
4. 实验：把 `script` 移到 `head` 里（h1 前面），在 Console 运行 `document.querySelector("h1")`，看是不是 `null`；再移回 body 末尾。这个实验能让你记住“为什么脚本在最后”。

## 12. 对照检查

写完一个页面，按顺序问自己：

- 第一行是 `<!doctype html>` 吗？
- `<html>` 包住了全部吗？
- `<head>` 在 `<body>` 前面吗？
- `charset` 是 head 的第一行吗？
- 可见内容都在 body 里吗？
- `script` 在 body 末尾（或 head + defer）吗？
- 每个非空元素都有结束标签吗？
