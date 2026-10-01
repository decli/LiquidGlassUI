# 接入指南

把套件接进一个现有项目：放哪些文件、写什么标记、有哪些开关和接口、在框架里要注意什么。

## 目录

1. 最小接入（三步）
2. 组件类速查
3. data 属性速查（自己的结构怎么接）
4. 页面负责写的状态
5. 全局配置 `LiquidGlassConfig`
6. 脚本接口与事件
7. 常见做法：加一块玻璃、加一组可悬停的项、加一个多选一、三档开关、链接式侧栏、窄屏
8. 主题与品牌色
9. 在 React / Vue / 其他框架里用
10. 内容安全策略（CSP）、离线内网、老浏览器
11. 上线前的检查清单

---

## 1. 最小接入（三步）

**① 拷两个文件**进项目的静态目录：`assets/liquid-glass.css`、`assets/liquid-glass.js`。不需要构建，不依赖任何库，不走 CDN。

**② `<head>` 里**：样式表 + 一段不闪的内联脚本（赶在样式生效前定好主题与档位，否则深色下会先闪一下浅色）。

```html
<html lang="zh-CN">
<head>
  <link rel="stylesheet" href="/static/liquid-glass.css">
  <script>
  (function () {
    var d = document.documentElement, g = null;
    try { g = localStorage.getItem('lg.glass'); } catch (e) {}
    if (g !== 'full' && g !== 'lite' && g !== 'off') { g = 'auto'; }
    d.setAttribute('data-lg-mode', g);
    d.setAttribute('data-lg-tier', g === 'off' || g === 'lite' ? 'l0' : 'l1');
    // 主题：data-theme = light | dark | auto；不写就跟随系统
  })();
  </script>
</head>
```

存储键 `lg.glass` 要和第 ③ 步 `LiquidGlassConfig.storageKey` 一致（缺省就是它）。

**③ `<body>` 最后**：脚本。

```html
  <script src="/static/liquid-glass.js"></script>
</body>
```

然后给页面元素套上组件类（第 2 节）。先打开 `assets/demo/index.html` 看一遍完整的写法，照抄最快。

`<html lang>` 以 `zh` 开头时，脚本弹出的提示是中文，否则是英文。

## 2. 组件类速查

**凡是玻璃都要带 `.lg-glass`**，再加上具体的组件类。

| 类 | 是什么 | 标记要点 |
|---|---|---|
| `.lg-page` | 页面底（纯色、字体、字号） | 挂在 `<body>` |
| `.lg-shell` / `.lg-main` / `.lg-head` | 侧栏 + 内容区的外壳、内容区、页头 | 可选，自己的版式也行 |
| `.lg-glass` | 玻璃材质 | 宿主自己不要写 `background` |
| `.lg-glass--menu` / `--bar` | 更实的弹出层玻璃 / 工具条玻璃 | 修饰 `.lg-glass` |
| `.lg-card` | 实心厚玻璃（卡片） | 不带 `.lg-glass` |
| `.lg-btn` / `--primary` / `--danger` / `--sm` | 次要白玻璃 / 主操作蓝 / 危险红 / 小号 | `<button>` 或 `<a>` |
| `.lg-glass.lg-chip` | 页头上可按的玻璃胶囊 | 里面可放 `.lg-dot`、`.lg-chip-muted`、`.lg-chip-strong`、`.lg-chip-caret`、`.lg-chip-ico`、`.lg-kbd`；危险态加 `.lg-chip--danger` |
| `.lg-field` | 输入框 / 下拉 / 多行 | `input`、`select`、`textarea` 都行；标签用 `.lg-label` |
| `.lg-seg` / `--sm` / `--block` | 分段开关（多选一） | 直接子元素是 `<button aria-pressed>` |
| `.lg-glass.lg-seg.lg-seg--glass` | 玻璃导航条（iOS 26 的标签栏） | 直接子元素是 `<button aria-pressed>`，里面一个图标（`<svg>`）+ 一个 `<span>` 字；放在能滚的内容底部（`position: sticky; bottom: …` 或 `fixed`），见 7.3 |
| `.lg-glass.lg-sidebar` | 侧栏 | 折叠：`data-collapsed="true"` |
| `.lg-nav` | 侧栏菜单区（滚动的那一层） | 里面交替放 `.lg-nav-group` 与 `.lg-nav-plate` |
| `.lg-nav-group` | 组标题按钮 | `aria-expanded` + `aria-controls`；子元素 `.lg-nav-group-caret`（svg）、`-title`、`-badge`、`-count`；危险组加 `--danger` |
| `.lg-nav-plate` / `--danger` | 一组菜单项的底板 | 收起时 `hidden` |
| `.lg-nav-item` / `--danger` | 菜单项 | 选中：`aria-selected="true"`（标签页）或 `aria-current="page"`（链接）；子元素 `.lg-nav-icon`、`.lg-nav-label`、`.lg-nav-key` |
| `.lg-brand` / `.lg-brand-mark` / `-text` / `-name` / `-sub` | 侧栏顶部品牌 | |
| `.lg-icon-btn` / `.lg-pill-btn` | 圆形小图标按钮 / 小胶囊按钮 | 放在 `data-lg-lens` 容器里就有透镜 |
| `.lg-sidebar-foot` / `.lg-row` / `.lg-row-label` | 侧栏底部的一排排「标签 + 开关」 | 三档开关那一排再加 `.lg-mode-row`（没有脚本时隐藏） |
| `.lg-account` / `.lg-account-name` | 账号行 | |
| `.lg-glass.lg-menu` | 弹出菜单 | `position: fixed`，页面脚本负责定位；项 `.lg-menu-item`，当前项 `aria-checked="true"`；`.lg-radio`、`.lg-menu-title`、`.lg-menu-sep`、`.lg-menu-sub` |
| `.lg-scrim` > `.lg-glass.lg-panel` | 命令面板（遮罩 + 面板） | `.lg-panel-input`、`.lg-list` > `.lg-list-item`（光标：`.is-cursor` 或 `aria-selected="true"`）、`.lg-list-meta`、`.lg-list-empty`、`.lg-panel-foot` |
| `.lg-glass.lg-toolbar` / `--sticky` | 工具条 / 粘在底部的保存条 | 子元素间距自动；`.lg-grow` 撑开、`.lg-count` 计数 |
| `.lg-table-wrap` > `.lg-table` | 表格 | **表头写在 `<thead>` 里**（粘住的表头与行悬停都认它）；数字列 `.lg-num`；角标 `.lg-badge--good/warn/bad`（怎么选色见 design-spec.md §5.4） |
| `.lg-toasts` > `.lg-glass.lg-toast` / `--good` / `--bad` | 浮动提示 | 容器不存在时脚本会自己建 |
| `.lg-note[data-kind=ok|info]` / `.lg-alert` | 灰色说明 / 红色报错 | 一句话，图标自动 |
| `.lg-center` > `.lg-glass.lg-dialog` | 页面正中的玻璃卡片（登录框） | |
| `.lg-fields` / `.lg-field--auto` | 一行筛选条件 + 按钮（底边对齐、放不下换行）/ 不占满整行的输入框 | `.lg-fields` 的子元素：`<div>`（标签 + 输入框）或按钮 |
| `.lg-kbd`、`.lg-grow`、`.lg-hint`、`.lg-actions`、`.lg-form-grid`、`.lg-card-title` | 小工具类 | |

## 3. data 属性速查（自己的结构怎么接）

组件类已经配好了透镜、滑块、折射（见 `liquid-glass.js` 顶部的 `PRE`）。自己的结构用下面这些属性打开：

| 属性 | 写在哪 | 作用 |
|---|---|---|
| `data-lg-lens="项的选择器"` | 一组可悬停项的容器 | 悬停 / 键盘焦点时一颗透镜流到那一项底下。不给值时项是 `.lg-item` |
| `data-lg-pad="3"` | 同上 | 透镜比项大多少像素（有底色的胶囊用 2–3，露出一圈玻璃） |
| `data-lg-mag="0.04"` | 同上 | 被盖住的项放大多少：窄项 0.03–0.05，宽列表项 ≤ 0.015，整行 0 |
| `data-lg-rad="10"` | 同上 | 透镜圆角；不写就照项自己的圆角 |
| `data-lg-under` | 同上 | 整行形态（表格行一类）：垫亮板，指尖光跟着指针走；不放大、不折射、不跟手位移，按下往里收一点 |
| `data-lg-slider="项的选择器"` | 多选一的容器 | 选中项底下一块液态滑块。不给值时项是 `.lg-item` |
| `data-lg-kind="seg|nav|cursor"` | 同上 | 滑块长相：白玻璃 / 蓝色（危险项红色）/ 主色浅玻璃光标。`seg` 还能按住浮起、拖（第 7.3 节） |
| `data-lg-refract` 或 `="边宽 [最外缘位移]"` | 一块 `.lg-glass` | 打开折射（只在 l2 / l3 生效）：边上那一圈放大、模糊、泛一点乳白和彩边，正中原样。不给值按尺寸取（边宽 = 短边 × 0.2，夹在 10–24px；位移 = 0.45 × 边宽）。老写法「边宽 隆起 厚度」三个数照样认，第三个数当位移用 |
| `data-lg-hdr` 或 `="top bottom"` | 一块 `.lg-glass` | HDR 屏上上沿（和下沿）一道比白更亮的高光 |
| `data-lg-tip` / `data-lg-tip="right"` | 元素或容器 | 把里面的 `title` 换成玻璃提示；`right` 表示出现在容器右边 |
| `data-lg-glow` | 任意可点的元素 | 写 `--mx` / `--my`，配合自己的 `radial-gradient` 做指尖光 |
| `data-lg-mode-set="full|lite|off"` | 按钮 | 三档开关；脚本负责 `aria-pressed` 与存储 |
| `data-lg-mode-switch` | 开关那一组的容器 | 脚本在它的提示里写「现在实际是哪一档、为什么」 |
| `data-lg-danger` | 选中项 | nav 滑块换成红色（`.lg-nav-item--danger` 同效） |
| `data-lg-on` | 项 | 当作「选中」（`aria-*` 都不合适时用） |

透镜的项要压在透镜上面：写 `.lg-item` 类最省事；用自定义选择器时脚本会给项标上 `data-lg-item`，样式表据此处理。
装透镜 / 滑块的容器如果是 `position: static`，脚本会给它补一个 `position: relative`。

## 4. 页面负责写的状态

脚本只「看」这些状态，从不改它们。页面改了，透镜与滑块自己跟过去（`MutationObserver` 盯着，一帧最多对一遍），不需要通知。

| 状态 | 写法 |
|---|---|
| 选中 | `aria-selected="true"` / `aria-pressed="true"` / `aria-checked="true"` / `aria-current="page"`，或 `.is-cursor` / `.is-active` / `data-lg-on`。页面原来用自己的类标选中（比如 `.on`、`.active`）：**推荐**在切换处顺手写上对应的 `aria-*`（读屏也需要它，组件类的选中样式也认它）；不想动页面脚本就在 `LiquidGlassConfig.on` 里写上这个类，透镜与滑块照样认得 |
| 收起 / 展开 | `aria-expanded` + 底板的 `hidden` |
| 收起的组里有当前页 | 组标题上 `data-has-active` |
| 侧栏折叠 | `.lg-sidebar[data-collapsed="true"]` |
| 主题 | `<html data-theme="light|dark|auto">`（写在 `<html>` 上，不要写在 `<body>`） |

## 5. 全局配置 `LiquidGlassConfig`

写在加载 `liquid-glass.js` **之前**，全部可选：

```html
<script>
window.LiquidGlassConfig = {
  storageKey: 'myapp.glass',   // 档位存在 localStorage 的键；同一域名下有多个应用时分开。<head> 那段脚本也要用同一个
  lang: 'zh',                  // 提示文案的语言，缺省看 <html lang>
  messages: { toast: '界面效果 · ' },   // 逐条覆盖文案（键名见脚本里的 TEXT）
  notify: function (text) { myToast(text); },   // 换成自己的提示组件；false 则不弹
  on: '.on, .active',          // 页面自己用哪些类标「选中」（aria-* 与 .is-cursor / .is-active 之外的）
  presets: true,               // false：不认组件类，只认 data 属性
  lens: [ /* 整组替换透镜预设：{ sel, items, pad, mag, rad, under } */ ],
  slider: [ /* { sel, items, kind } */ ],
  refract: [ /* { sel, bezel, depth, disp, scatter }：边宽、最外缘位移（缺省 0.45 × 边宽）、色散（缺省 0.08）、散射（缺省 0.05） */ ],
  hdr: [ /* { sel, spots: 'top bottom' } */ ],
  tips: '.my-toolbar [title]', // 哪些 title 换成玻璃提示（整串替换）
  glow: '.lg-btn, .my-button'  // 哪些元素写指尖光的 --mx / --my（整串替换）
};
</script>
```

## 6. 脚本接口与事件

```js
LiquidGlass.version      // '1.1.0'
LiquidGlass.mode()       // 用户选的档：'auto' | 'full' | 'lite' | 'off'
LiquidGlass.tier()       // 实际材质档：'l0' | 'l1' | 'l2' | 'l3'
LiquidGlass.setMode('lite', true)   // 换档（'auto' 回到自动）；第二个参数 true 时弹一句提示
LiquidGlass.describe()   // 这一档的说明文字
LiquidGlass.refresh()    // 页面结构大改后手动对一遍（平时不需要）
LiquidGlass.notify('…')  // 弹一句玻璃浮动提示

document.addEventListener('lg:modechange', function (e) {
  console.log(e.detail.mode, e.detail.tier);   // 档位或材质档变了
});
```

脚本在不支持 CSS 变量或 `Element.closest` 的浏览器上什么都不做，`window.LiquidGlass` 也不存在——用之前先判断。

## 7. 常见做法

### 7.1 加一块玻璃面板

1. 想清楚它是不是**控制层**：浮在内容上面、里面是按钮和少量文字的才做成玻璃。卡片、表格不做。
2. `class="lg-glass"`；宿主不写 `background`；它若不是 `fixed` / `sticky`，`.lg-glass` 自带 `position: relative; z-index: 0`。
3. 按大小给模糊：`style="--lg-b: 18px"`；背后是正文的加 `.lg-glass--menu`，背后有内容滚过的加 `.lg-glass--bar`。
4. 它浮在内容多变的东西上（有东西从它底下滚过、或者它盖在正文上）才加 `data-lg-refract`；背后只有纯色页面底的不加。
5. 会弹出来的话用 `animation: lg-pop .42s cubic-bezier(.3,1.4,.5,1) both`（只动 transform），**不要淡入**。
6. 它若是滚动容器，玻璃层会跟着滚——让它里面的某一块滚。

### 7.2 加一组可悬停的项

```html
<div class="my-list" data-lg-lens=".my-row" data-lg-mag="0.012">
  <button class="my-row">……</button>
  <button class="my-row">……</button>
</div>
```

- 放大量：窄项 3–5%，宽项 ≤ 1.5%，整行 0 + `data-lg-under`。
- 原来的悬停样式改成 `html:not([data-lg-lens]) .my-row:hover { box-shadow: inset 0 0 0 999px var(--lg-hover); }`
  （没有脚本 / 「关闭」档的退路）。**别再写不带前缀的 `:hover` 叠暗**，否则有透镜时两层叠在一起。
- 选中态若有自己的底色，确认它用的是第 4 节里的某种写法，透镜落上去才会切到「选中」形态。

### 7.3 加一个多选一

直接用 `.lg-seg`，自动得到凹槽 + 液态滑块 + 透镜：

```html
<div class="lg-seg" role="group" aria-label="时间范围">
  <button type="button" aria-pressed="true">今天</button>
  <button type="button" aria-pressed="false">本周</button>
</div>
```

选中只改 `aria-pressed`，滑块自己跟过去。自己的结构用 `data-lg-slider=".my-tab" data-lg-kind="seg"`，
并在 CSS 里写 `[data-lg-slider-on] .my-tab[aria-selected="true"] { background: transparent; }`（有滑块时选中项自己不画底）。

**按住浮起、拖**（iOS 26 标签栏那样，kind 为 `seg` 的滑块都有）：

- 按住任一项，滑块浮起成一块清玻璃透镜，盖在字上面、边上折射底下的字（Chrome / Edge 的「完整」档；别的浏览器上滑块放大一点）；
  按的不是选中项，滑块先飞到手指下面，选不选等松手时的点击交给页面。
- 按住横向拖（从哪一项起拖都行）：透镜跟着手指走，最近的那一项标上 `data-lg-near`（样式表让它先变成选中的样子）；松手落到最近一项，
  快速一甩往甩的方向最多再走一格；拖过两端整条像橡皮筋被拉长。
- **松手后脚本替用户点一下落到的那一项**（`element.click()`），页面的点击处理照常运行、照常改 `aria-pressed`——
  所以页面的点击处理要能处理 `click()`（绑在按钮上或委托在容器上都行；别只听 `pointerup` / `mousedown`）。
  页面不接受这次选中，滑块就回到真正选中的那一项（页面异步改选中的，滑块先在新位置等 1.2 秒）。浏览器在拖完后自己补的那一下 click 会被吞掉。
- 拖动中容器上有 `data-lg-drag`；拖过两端时脚本往容器上写 `transform`（拉长、弹回），弹完清掉。容器自己的 `transform` 会在这几百毫秒里被盖住。
- 按钮里只有文字时，脚本把字写进 `data-lg-label`，样式表按粗体留宽度（选中变粗不挤动旁边的项）；按钮里有图标等元素时不动它的排版。
- 容器挂在一个带 `filter` / `backdrop-filter` / `mask` 的祖先里时不出透镜（隔着背景根会画成一块暗方块，见 pitfalls.md #28）；
  玻璃面板（`.lg-glass`）里没问题——它的毛玻璃画在伪元素上。
- 窄屏上要是还会折成多行，就不能横着拖了（只能点）。

**玻璃导航条**（iOS 26 的标签栏）：同一套交互，换成浮在内容上面的一整块玻璃、图标 + 字、等宽铺满。放在能滚的内容底部：

```html
<div class="my-scroller">            <!-- 能滚的内容；导航条是它最后一个子元素 -->
  …内容…
  <nav class="lg-glass lg-seg lg-seg--glass" role="group" aria-label="主导航" style="position: sticky; bottom: 10px; z-index: 2">
    <button type="button" aria-pressed="true"><svg …></svg><span>概览</span></button>
    <button type="button" aria-pressed="false"><svg …></svg><span>交给 AI</span></button>
    <button type="button" aria-pressed="false"><svg …></svg><span>设置</span></button>
  </nav>
</div>
```

`.lg-glass` 自带 `position: relative; z-index: 0`，要粘住就用更具体的选择器（或内联样式）改成 `sticky` / `fixed`。
装导航条的滚动容器横向别让它滚（`overflow-x: hidden; overflow-y: auto`）：拖过两端时条像橡皮筋被拉长 ≤ 18px，横向能滚的话就会闪出横滚动条。
选中项的图标和字是主色；整条的边默认不折射，背后有大图想看到边缘弯折就加 `data-lg-refract="9 4"`。

### 7.4 三档开关

```html
<div class="lg-row lg-mode-row">
  <span class="lg-row-label">玻璃</span>
  <div class="lg-seg lg-seg--sm lg-seg--block" role="group" aria-label="玻璃效果" data-lg-mode-switch>
    <button type="button" data-lg-mode-set="full" aria-pressed="true">完整</button>
    <button type="button" data-lg-mode-set="lite" aria-pressed="false">精简</button>
    <button type="button" data-lg-mode-set="off" aria-pressed="false">关闭</button>
  </div>
</div>
```

`.lg-mode-row` 在没有脚本时整排隐藏（按不动的开关不摆出来）；判断用 `html[data-lg-js]`，
**不要**用 `data-lg-lens`——「关闭」档会撤掉 `data-lg-lens`，开关要是跟着消失就再也点不回来了。

### 7.5 侧栏用链接而不是按钮

多页面应用的侧栏通常是 `<a>`：选中写 `aria-current="page"`，其余结构不变。

```html
<div class="lg-nav">
  <button type="button" class="lg-nav-group" aria-expanded="true" aria-controls="grp-a">
    <svg class="lg-nav-group-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>
    <span class="lg-nav-group-title">常用</span><span class="lg-nav-group-count" aria-hidden="true">2</span>
  </button>
  <div class="lg-nav-plate" id="grp-a">
    <a class="lg-nav-item" href="/orders" aria-current="page">
      <span class="lg-nav-icon" aria-hidden="true"><svg>…</svg></span><span class="lg-nav-label">订单</span>
    </a>
    <a class="lg-nav-item" href="/refunds">
      <span class="lg-nav-icon" aria-hidden="true"><svg>…</svg></span><span class="lg-nav-label">退款</span>
    </a>
  </div>
</div>
```

整页跳转时滑块没有「从哪来」，新页面里它直接落在选中项上（不演动画），这是对的。
收起 / 展开组要是想跨页记住，页面自己存 `localStorage`，渲染时写好 `aria-expanded` 与 `hidden`。

### 7.6 窄屏

- 宽度 < 860px 时，页面把侧栏设成 `data-collapsed="true"`（图标轨），变宽了再展开；演示页里有现成的写法（`matchMedia('(max-width: 860px)')`）。
- 样式表在 < 860px 时已经收窄内容区、藏起页头胶囊里的次要文字与快捷键。
- 更窄（手机）时建议把侧栏换成页头上的一个菜单按钮 + 弹出的 `.lg-menu`，而不是继续挤一条竖轨。

## 8. 主题与品牌色

- 主题写在 `<html data-theme>`：`light`、`dark`、`auto`（或不写）= 跟随系统。
- 换品牌色：在自己的样式表里覆盖（浅深两套都要）：

```css
:root { --lg-accent: #0a7d5a; --lg-accent-hover: #075c42; --lg-ring: rgba(10,125,90,.24);
        --lg-accent-glass: rgba(10,125,90,.11); --lg-pro-top: #1f9a73; --lg-pro-bot: #0a7d5a;
        --lg-pro-glow: rgba(10,125,90,.5); --lg-sec-glow: rgba(10,125,90,.13); }
:root[data-theme="dark"] { /* 深色一套，同样的键 */ }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]):not([data-theme="dark"]) { /* 同上 */ } }
```

- 改了令牌之后跑 `node scripts/check.mjs 你的.css 你的.js`：它会核对两块深色令牌是否一致。

## 9. 在 React / Vue / 其他框架里用

- 脚本挂在 `document` 上监听事件、用 `MutationObserver` 发现变化，**不需要**在组件里初始化，也不需要在路由切换后调用什么。
  放在 `index.html` 里加载一次即可（或在应用入口 `import './liquid-glass.js'`，它会自己挂到 `window`）。
- 它往容器末尾追加的元素（`.lg-lens`、`.lg-thumb`、`.lg-lift`、`.lg-hdr`）是框架不认识的节点。React / Vue 只增删自己的节点，
  追加在末尾的外来节点不影响对比；容器整个被卸载时它们跟着消失，脚本下一帧发现后自己清理。
- 选中状态用 `aria-*` 属性表达（第 4 节），不要只靠 `className` 切换——那样透镜认不出「选中」形态（滑块也找不到选中项）。
- 服务端渲染：`<head>` 那段不闪脚本放进文档模板；`data-lg-*` 由脚本在客户端写，服务端不用管。
- 不要让框架管 `<html>` 上的 `data-lg-mode` / `data-lg-tier` / `data-lg-lens` / `data-lg-js`。
- 分段开关拖完是「替用户点一下」：受控组件（React 的 `onClick`、Vue 的 `@click`）照常收到点击，值由组件自己改，不需要额外接线。

## 10. 内容安全策略（CSP）、离线内网、老浏览器

- **CSP**：`<head>` 的不闪脚本是内联的，需要 nonce / hash 或者挪进一个外部小文件；
  折射贴图（九宫格，每种圆角 × 边宽画一次）和 HDR 高光是 `data:` 图片，`img-src` 要允许 `data:`。
  不许 `data:` 的话，用 `scripts/displacement_map.py --svg` 给尺寸固定的元素预先生成一段滤镜（贴图换成你托管的 PNG 文件也行）。脚本写样式用的是 CSSOM（`el.style.x = …`），不受 `style-src` 限制。
- **离线内网**：全部是本地文件，不走 CDN、不加载网络字体，断网照样工作。
- **老浏览器**：不支持 CSS 变量或 `closest` 的（IE11）脚本直接不做事；样式表里 `@media screen\0` 一段给出实色兜底；
  三档开关自动隐藏。脚本只用 ES5，老一点的浏览器也不会因为语法报错而整个不执行。

## 11. 上线前的检查清单

1. `node scripts/check.mjs`（改过副本就把副本路径传进去）：ES5、不改 class、令牌一致、类名没拼错。
2. `node scripts/shoot.mjs --url 你的页面`（档位存在别的键里时加 `--key 你的键`）：浅 / 深 × 完整 / 精简 / 关闭 六张全屏，
   再在一个悬停状态下做三档校验（DOM 上透镜、实色、高光环各自对不对；透镜所在面板里任意两档至少 1% 的像素不同）。
   自动找的悬停项不合适时用 `--hover '选择器'` 指定。**三档要肉眼分得出来**。
3. 设备像素比 1 和 2 各看一眼：1 上看锯齿与细线，2 上看高光。
4. 交互：菜单上下快速划过（透镜不闪、字不被划）、从第一项点到最后一项（滑块流过去、不拖成长条）、
   分段开关按住（浮起成透镜）、拖过去松手（换了选中、不会跳回原处）、拖过两端（像橡皮筋、松手弹回）、
   打开弹出菜单与命令面板（弹出不跳亮）、方向键走命令面板（光标跟着走）、折叠侧栏（滑块直接到位、图标上有玻璃提示）。
5. 系统设置里打开「减少动态效果」「减少透明度」「增强对比度」各看一次。
6. 无头浏览器截图前先把档位设成 `full`：无头 Chromium 是软件渲染，自动档会先不折射。
