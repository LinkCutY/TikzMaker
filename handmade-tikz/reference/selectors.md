# `#id` 和 `.class`：名字和标签，不是命名空间/结构体

## 1. 一句话

HTML 负责“创建元素”，CSS 负责“按名字或标签找到元素，再改样式”。

- `id` 是元素的**唯一名字**（像身份证）。
- `class` 是元素的**共享标签**（像分类贴纸）。
- `#shelf`、`.box` 是 CSS 的**选择器写法**，不是元素本身。

## 2. 三个层次，别混在一起

1. **元素**：真实存在的一个盒子，例如 `<div class="box">1</div>`。
2. **属性**：贴在元素上的信息，例如 `id="shelf"`、`class="box"`。
3. **选择器**：CSS 用来找元素的写法，例如 `#shelf`、`.box`、`div`。

## 3. 对照你的说法

| 你的说法 | 更准确的说法 |
|---|---|
| `#shelf` 是一个 namespace | `id="shelf"` 是这一个元素的唯一名字；`#shelf` 是“按名字找它”的选择器 |
| `.box` 是一个 struct | `.box` 是“找所有带 box 标签的元素”的选择器；class 只是标签，不是类型定义 |
| `<div class="box">...` 是调用 struct | 这是创建一个 div 元素，并给它贴上 box 标签；CSS 不会“调用”它 |
| 标签里是“struct 的内部内容” | 标签里是元素的文本或子元素；CSS 默认不关心里面有什么 |

## 4. 点和井号只写在 CSS 里

HTML 里：

~~~html
<div id="shelf">
  <div class="box">1</div>
  <div class="box">2</div>
  <div class="box">3</div>
</div>
~~~

CSS 里：

~~~css
#shelf {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
}

.box {
  padding: 40px;
}
~~~

注意：

- HTML 写 `class="box"`，**不带点**。
- CSS 写 `.box`，**带点**。
- HTML 写 `id="shelf"`，**不带井号**。
- CSS 写 `#shelf`，**带井号**。

点号和井号是 CSS 的“记号”，不是名字的一部分。  
如果你在 HTML 里写 `class=".box"`，那个 class 的名字就真的叫 `.box`，和 CSS 的 `.box` 对不上。

## 5. class 是标签，不是 struct

- 一个元素可以贴多个标签：`class="box big red"`。
- 多个元素可以贴同一个标签：三个 `<div class="box">`。
- 标签没有字段、没有方法、没有构造函数。
- CSS 不能凭一个 class 创建元素；元素必须先在 HTML 里存在。
- 真正的“类 / 结构体 / 对象”是后面 JavaScript 的内容，到时再学。

所以：`class="box"` 不是“声明一个 box 类型”，而是“给这个已经存在的 div 贴一张写着 box 的贴纸”。

## 6. id 是身份证，不是 namespace

- 一个页面里，`id` 应该唯一。
- `#shelf` 只选中 `id="shelf"` 的那一个元素。
- `id` 可以用在三个地方：
  - CSS：`#shelf { ... }`
  - JavaScript：`document.getElementById("shelf")`
  - 页面内跳转：`<a href="#shelf">`
- namespace 是“给一组名字加前缀，避免重名”；`id` 是“单个元素的唯一编号”。两者不是一回事。

## 7. 浏览器实际做了什么

1. 读 HTML，搭出一棵元素树。
2. 读 CSS，得到一张规则表。
3. 对每条规则，找到匹配的元素，把样式应用上去。

没有“调用 class”这一步。  
CSS 只是“查找 + 应用”，不会创建元素，也不会执行函数。

## 8. 用 grid-lab 验证

~~~html
<div id="shelf">
  <div class="box">1</div>
  <div class="box">2</div>
  <div class="box">3</div>
</div>
~~~

- `#shelf` 选中外面的大盒子。
- `.box` 同时选中里面三个小盒子。
- 所以 `#shelf { display: grid; ... }` 只让大盒子变成格子架；
- `.box { padding: 40px; ... }` 让三个小盒子都变高、变深色。
- 小盒子不需要写 grid；它们只是被放进格子里。

## 9. 小测验

~~~html
<div id="shelf">
  <div class="box">1</div>
  <div class="box big">2</div>
</div>
~~~

分别选中谁？

- `#shelf`
- `.box`
- `.big`
- `div`

答案：

- `#shelf`：外面的大盒子，1 个。
- `.box`：里面两个小盒子，2 个。
- `.big`：只有第二个小盒子，1 个。
- `div`：页面上所有 div，3 个。

## 10. 常见错误

- HTML 里写 `class=".box"`：多了一个点，名字就变了。
- HTML 里写 `id="#shelf"`：多了一个井号。
- 以为 `class` 只能有一个：它可以用空格写多个。
- 以为 `.box` 只能选 `div`：任何元素只要 `class="box"` 都能被选中。
- 以为 `id` 可以重复：CSS 和 JS 都会假设它唯一。
- 以为 CSS 能创建元素：不能，元素必须先由 HTML 创建。
