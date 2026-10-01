---
name: liquid-glass-ui
license: MIT
description: >-
  把网页界面做成 Apple Liquid Glass（液态玻璃）风格的完整套件与方法：可直接拷用、零依赖的 CSS + ES5 脚本
  （背景模糊 + 照 iOS 26 的边缘折射——边上放大、模糊、散射、色散，正中原样、会流动的透镜悬停、液态滑块、
  分段开关按住浮起成一块会折射的透镜并能拖 / 橡皮筋 / 甩、指尖光、玻璃提示、HDR 高光、完整/精简/关闭三档与自动降级），
  外加定稿的设计规范、技术原理、踩坑清单、多轮评审的设计决策，以及静态检查与真浏览器截图校验脚本。
  只要用户提到 Liquid Glass、液态玻璃、毛玻璃、玻璃拟态、glassmorphism、frosted glass、backdrop-filter、
  iOS 26 / macOS 26 风格、苹果风侧栏，或者想给后台、控制台、管理工具、仪表盘、登录页「换一套更有质感 / 更像苹果的外观」，
  就用这个 skill——即使用户没有明说「液态玻璃」。Use it for any request to build or restyle a web UI with
  Apple-style Liquid Glass, glassmorphism, refraction, frosted panels, fluid hover effects or an iPadOS-style grouped sidebar.
---

# Liquid Glass UI

一套照 Apple Liquid Glass 做的网页材质与组件：控制层（侧栏、页头胶囊、弹出层、工具条、提示）是会折射的玻璃，
内容层（卡片、表格）是不透光的「实心厚玻璃」；悬停是一颗会流动的清玻璃透镜，选中是一块前沿先到、后沿后到的液态滑块；
分段开关像 iOS 26 的标签栏，按住任一项它浮起成一块盖在字上面、会折射的透镜，能拖、拖过两端像橡皮筋；
还有一条浮在内容上面的玻璃导航条（`.lg-seg--glass`，图标 + 字）。
玻璃边的折射照 iOS 26：边上那一圈把背后的内容放大、轻微模糊、泛一层乳白和一点彩边，正中一个像素都不动。
不需要构建、不依赖任何库、不走 CDN；不加载脚本页面照样能用。

这里的每个数值和做法都经过了多轮真机评审——先用现成的，别从零重写。

## 套件里有什么

| 路径 | 是什么 | 什么时候用 |
|---|---|---|
| `assets/liquid-glass.css` | 令牌（浅 / 深 / 跟随系统）+ 玻璃材质 + 全部组件 + 分档与无障碍 | 拷进项目 |
| `assets/liquid-glass.js` | ES5 交互层：分档、折射（九宫格位移贴图 + 滤镜链）、透镜、液态滑块、分段开关的浮起与拖动、指尖光、玻璃提示、HDR | 拷进项目 |
| `assets/demo/index.html` | 完整的演示页（侧栏、页头、表单、分段、表格、弹出菜单、命令面板、登录页、折射演示） | **写标记前先打开看、照抄结构** |
| `scripts/check.mjs` | 静态检查：ES5、不改 class、令牌一致、类名没拼错（只要 Node） | 改过 CSS / JS 之后 |
| `scripts/shoot.mjs` | 真浏览器截图 + 三档可区分校验（要 Playwright） | 交付前；给用户看效果 |
| `scripts/displacement_map.py` | 离线生成位移贴图 / 固定尺寸元素的完整 SVG 滤镜；`--selftest`（不折叠、正中不动、九宫格拼回去一样） | 调折射参数、做不带脚本的静态折射 |
| `scripts/hdr_png.py` | 生成 HDR 高光贴片（16 位 PNG + cICP） | 换高光形状、核对内嵌的那张 |
| `references/design-spec.md` | 定稿的设计规范：令牌、每个组件的尺寸、动效参数、三档定义 | 做任何视觉决定时 |
| `references/integration.md` | 接入指南：组件类、data 属性、配置、接口、框架、CSP、检查清单 | 接进项目时 |
| `references/principles.md` | 技术原理：玻璃怎么搭、折射的位移曲线与滤镜链、九宫格、HDR、弹簧、分段开关的浮起与拖动、分档、背景根 | 改算法或解释原理时 |
| `references/pitfalls.md` | 35 个「不报错、只是静静地坏掉」的坑，按症状查 | 出现诡异现象时先查 |
| `references/design-decisions.md` | 每轮评审指出了什么、为什么这样改 | 用户想改风格、或你想「改回」某个做法之前 |

## 工作流程

### 1. 先看懂现有页面，定三件事

- **哪些是控制层、哪些是内容层。** 浮在内容上面、里面是按钮和少量文字的（导航、页头、工具条、弹出层、提示）做成玻璃；
  卡片、表格、表单分组做成实心厚玻璃（`.lg-card`）。玻璃叠玻璃会糊，字读不清。
- **页面底用纯色**，不要为了「让玻璃显出来」铺点阵、字纹、大图——评审里被嫌丑过两次。折射只给背后真有内容的玻璃（弹出层、底部保存条）。
- **运行环境**：离线内网？老浏览器？远程桌面？套件已经处理（全本地文件、ES5、三档 + 自动降级），但要在交付说明里写清楚用户能怎么切。

### 2. 接入

1. 把 `assets/liquid-glass.css`、`assets/liquid-glass.js` 拷进项目静态目录（保留文件头注释）。
2. `<head>`：样式表 + 不闪的内联脚本（先写好 `data-lg-mode` 与临时材质档）。`<body>` 最后：脚本。代码见 `references/integration.md` §1。
3. 按 `assets/demo/index.html` 的结构给页面元素套组件类。凡是玻璃都带 `.lg-glass`，再加具体组件类
   （`.lg-sidebar`、`.lg-chip`、`.lg-menu`、`.lg-panel`、`.lg-toolbar`、`.lg-dialog`……）。完整列表见 integration.md §2。
4. 自己的结构用 data 属性接：`data-lg-lens`（透镜）、`data-lg-slider`（液态滑块）、`data-lg-refract`（折射）、
   `data-lg-hdr`、`data-lg-tip`、`data-lg-glow`、`data-lg-mode-set`（三档开关）。见 integration.md §3。
5. 选中、收起这些状态由页面用 `aria-selected` / `aria-pressed` / `aria-checked` / `aria-current` / `hidden` 表达；
   脚本只看不改，透镜和滑块自己跟过去，不需要通知它。页面原来用自己的类标选中（`.on`、`.active`）时，
   在切换处顺手补上 `aria-*`（推荐），或者在 `LiquidGlassConfig.on` 里写上那个类。
   侧栏用 `<a>` 链接、表格没有 `<thead>`、一行筛选条件、窄屏这些情况见 integration.md §2 与 §7。
6. 放一个三档开关（完整 / 精简 / 关闭），通常在侧栏底部或设置页。
7. 品牌色不是蓝色时，只改 design-spec.md §3.2 列出的那几个令牌（浅深两套）。

### 3. 验证（交付前都要跑）

```bash
node scripts/check.mjs [你的.css 你的.js 你的页面.html]   # 不给参数就查套件自己
node scripts/shoot.mjs --url http://localhost:8080/ [--key 你的档位存储键] [--hover '悬停哪一项']
# 浅 / 深 × 三档 6 张全屏 + 三档校验；不给 --url 就拍演示页的整套截图，
# 并逐个悬停演示页里每一个能点的元素（都要有反馈）、核对所有玻璃是同一种材质、
# 核对玻璃正中和不折射时逐像素一样而外圈在弯、把分段开关按住 / 拖 / 甩 / 拉过两端 / 精简档都过一遍
```

然后按 integration.md §11 的清单真机过一遍（设备像素比 1 和 2、快速划过菜单、跨很远换选中、打开弹出层、系统无障碍设置）。
**三档必须肉眼分得出来**；截图前把档位设成 `full`（无头浏览器是软件渲染，自动档会先不折射——不是坏了）。
把截图给用户看，而不是只说「做好了」。

## 不能破的规则（以及为什么）

1. **滤镜不挂在带投影的元素上。** 玻璃 = 宿主（位置、圆角、投影，背景透明）+ `::before`（底色 + backdrop-filter）+ `::after`（高光环）。
   Chromium 按「含投影的溢出范围」算滤镜坐标，挂在宿主上折射会整片错位。
2. **玻璃的祖先不加 `opacity` / `filter` / `mask` / `clip-path`，弹出动画只动 `transform`、不淡入。**
   否则那个祖先成了「背景根」，玻璃采不到页面，淡入那几百毫秒会跳亮。遮罩只调暗、不模糊。
3. **玻璃宿主 `background: transparent`。** `<button>` 的默认浅灰底会垫在玻璃下面，同一种玻璃一深一浅。
4. **玻璃脚本只写 `data-*`、内联样式和自己插入的元素，不增删页面元素的 class；只用 ES5。**
   页面脚本常按 `className` 全等判断；老浏览器上一处 ES6 语法就是整个文件不执行。`check.mjs` 两条都拦。
5. **不信 `CSS.supports` 对 `backdrop-filter: url()` 的回答**，按浏览器品牌判断是否 Chromium；非 Chromium 只模糊。
6. **三档按看得见、摸得着的东西分**（精简 = 实色 + 动画直接到位；关闭 = 连透镜、滑块、高光环一起撤），点了当场弹一句提示；
   开关的显示条件用 `data-lg-js`，别用会被「关闭」撤掉的 `data-lg-lens`。
7. **宽的项放大 ≤ 1.5%，表格行 0。** 放大以中心为原点，宽项放大一点左边的字就跳。
8. **一个功能一个入口；说明（灰）与报错（红）分开；同一类控件同一套悬停动作**（浮起 1px + 投影加深 + 指尖光，白按钮的光带主色）。
9. **`:active` 写在 `:hover` 后面；`data-theme` 写在 `<html>` 上。**
10. **降级不能坏功能**：没有脚本、IE11、减少动态效果、减少透明度、增强对比度，每种都要能用。
11. **会折射的元素只平移、不缩放；位移曲线往里取样、取样位置处处单调。** 缩放会把透过它的东西重采样得发糊；
   往外取样是缩小加重影，曲线折叠（某处 D′ < −1）是边上的字画两遍。改折射参数后跑 `displacement_map.py --selftest` 与 `shoot.mjs`。

违反其中一条时，先读 `references/pitfalls.md` 里对应的那一条再动手。

## 常见需求怎么做

- **「给我的后台 / 管理页换成液态玻璃」**：按上面的工作流程；侧栏用分组底板（design-spec.md §4.2），这是评审后定稿的样子。
- **「只要毛玻璃，不要那么多动效」**：照常接入，把缺省档设成精简（`<head>` 脚本里没存值时写 `lite`），或者只用 CSS、不加载脚本。
- **「背景是图片 / 视频，想看到折射」**：给侧栏、页头胶囊加 `data-lg-refract`（背后有内容时折射才有意义）；注意 pitfalls.md #16 的性能。
- **「在 React / Vue 里用」**：脚本全局加载一次即可，状态用 `aria-*` 表达；见 integration.md §9。
- **「换成别的品牌色 / 暗色为主」**：只改令牌；改完跑 `check.mjs`（它会核对两块深色令牌一致）。
- **「要 iOS 26 那样的底部导航条」**：`<nav class="lg-glass lg-seg lg-seg--glass">`，项是 `<button aria-pressed>` 里一个图标 + 一个 `<span>`，
  粘在能滚的内容底部（integration.md §7.3）；无头截图里矮条看着没模糊是无头浏览器的问题（pitfalls.md #34），要在实机上看。
- **「要 iOS 26 标签栏那种按住浮起、能拖的选项」**：直接用 `.lg-seg`（或 `data-lg-slider` + `data-lg-kind="seg"`），已经带了；
  页面的点击处理要能处理 `element.click()`（拖完松手脚本替用户点一下落到的那一项），见 integration.md §7.3。
- **「要一个静态的、不跑脚本的折射」**：`python3 scripts/displacement_map.py --w 宽 --h 高 --svg` 生成一段滤镜贴进页面（仅 Chromium，元素尺寸必须固定）。
- **「为什么是这个样子 / 能不能改回 X」**：先看 `references/design-decisions.md`，把当时的理由告诉用户，再一起决定。

## 交付时告诉用户

- 改了哪些文件、页面上多了哪些类和属性；
- 浏览器差异：Chrome / Edge 有折射，Safari / Firefox 只模糊，IE11 实色；HDR 屏上多一道高光；
- 三档开关在哪、各是什么样；远程桌面上建议用「精简」；
- 附上 `shoot.mjs` 拍的截图（浅 / 深 × 三档）。
