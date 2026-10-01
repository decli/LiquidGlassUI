/*!
 * Liquid Glass UI —— 交互层 v1.2.0
 *
 * 只管「看着像玻璃、摸着像水」，不碰业务：不发请求、不改表单、不改页面元素的 class。
 * 删掉这个 <script>，页面照样能用——liquid-glass.css 里有不带脚本的退路。
 * 原理、参数怎么来的、踩过的坑，见 references/ 下的文档。
 *
 * 做的八件事：
 *   1 分档：用户选的三档（完整 / 精简 / 关闭，没选过是「自动」）写在 <html data-lg-mode>，
 *     材质档写在 <html data-lg-tier>：l0 实色 / l1 模糊 / l2 模糊 + 折射 / l3 再加 HDR 高光。
 *   2 折射：照 iOS 26 的玻璃边——边上放大、模糊、散射（加一点色散），正中一个像素都不动。
 *     位移贴图切成九宫格，尺寸变了只挪不重画；挂成 SVG 滤镜交给 backdrop-filter。只有 Chromium 认 backdrop-filter 里的 url()。
 *   3 透镜：鼠标经过 / 键盘聚焦时，一颗清玻璃按弹簧物理流到那一项下面；经过的项微微放大、跟手。
 *   4 液态滑块：选中项底下那块，前沿先到、后沿后到，中途被拉长、落定回弹。
 *     分段开关的滑块还能按住：浮起成一块盖在字上面、会折射的透镜，能拖、拖过两端像橡皮筋、甩一下会形变（§5.5）。
 *   5 指尖光：玻璃按钮上跟着指针走的一小团光（只写 CSS 变量 --mx / --my）。
 *   6 玻璃提示：把 title 小黄框换成玻璃气泡，离开时原样放回（读屏照样读得到）。
 *   7 HDR 高光：HDR 屏上玻璃上沿一道比页面白更亮的光。
 *
 * 引入（详见 references/integration.md §1）：
 *   · 页面里 <script src="liquid-glass.js"> 一行（配一行 liquid-glass.css）：自己跑起来，全局有 LiquidGlass；
 *   · 打包工具 / 框架里 import LiquidGlass from 'liquid-glass-ui'（npm i github:decli/LiquidGlassUI），
 *     要改配置就在 import 之后调 LiquidGlass.init({ … })；
 *   · 服务端渲染（没有 window）、太老的浏览器：拿到的是一个什么都不做的替身，照常调用不会报错。
 *
 * 配置两种写法，可以混用：
 *   · 用 liquid-glass.css 里的组件类（.lg-nav、.lg-seg、.lg-menu、.lg-panel、.lg-list、.lg-table-wrap……），
 *     下面的 PRESETS 已经给它们配好了透镜、滑块、折射，不用再写什么；
 *   · 自己的结构用 data 属性打开：data-lg-lens、data-lg-slider、data-lg-refract、data-lg-hdr、data-lg-tip、data-lg-glow。
 *     详见 references/integration.md。
 *   · 全局选项写在加载本文件之前的 window.LiquidGlassConfig 里（存储键、提示文案、是否弹提示……），
 *     或者加载之后调 LiquidGlass.init(同一套选项)。
 *
 * 纪律（改之前先看）：
 *   · 只写 data-* 属性、内联 style 与 CSS 变量，不增删页面元素的 class——不少页面脚本按 className 全等判断，
 *     多一个类就认不出来。自己插进去的元素才用 lg-* 类。
 *   · 插进去的元素一律追加在末尾、绝对定位、margin:0——插在前面会被 `> * + *` 这类间距规则挤歪。
 *   · 带 backdrop-filter 的玻璃，祖先不能有 filter / opacity<1 / mask，否则它「采不到背景」；
 *     所以透镜的淡入淡出只改子层的 opacity，外层只改 transform。
 *   · 只用 ES5：老浏览器上一个语法错误就是整个文件不执行。scripts/check.mjs 会拦。
 */
(function (root, factory) {
  // 通用模块：<script> 引入 → 全局 LiquidGlass；CommonJS / 打包工具 → module.exports（全局也照样有一份）。
  // 不走 AMD：老后台里常有 RequireJS，一个匿名 define() 落在它外面就是一个报错
  var api = factory(typeof window !== 'undefined' ? window : null, typeof document !== 'undefined' ? document : null);
  if (typeof module === 'object' && module && module.exports) { module.exports = api; }
  if (root && !root.LiquidGlass) { root.LiquidGlass = api; }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function (win, doc) {
  'use strict';

  /**
   * 什么都不做的替身：服务端渲染（没有 window / document）、太老的浏览器（样式表的降级规则兜底）。
   * 方法都在、都不报错，调用方不用先判断「能不能用」
   */
  function inert() {
    var self = {
      version: '1.2.0', supported: false,
      init: function () { return self; }, mode: function () { return 'off'; }, tier: function () { return 'l0'; },
      setMode: function () {}, refresh: function () {}, describe: function () { return ''; }, notify: function () {}
    };
    return self;
  }
  if (!win || !doc) { return inert(); }

  var root = doc.documentElement;
  var CSSx = win.CSS;
  // 太老的浏览器（IE11 等）：没有 CSS 变量或 closest，什么都不做，样式表的降级规则兜底
  if (!CSSx || typeof CSSx.supports !== 'function' || !CSSx.supports('--lg-probe', '0')
      || !win.requestAnimationFrame || !Element.prototype.closest || !Element.prototype.matches) {
    return inert();
  }
  if (win.LiquidGlass && win.LiquidGlass.version) { return win.LiquidGlass; }       // 加载了两遍（比如 <script> 和 import 各一次）

  // 配置推导出来的值：configure() 写，LiquidGlass.init() 换配置时重写
  var CFG, MODE_KEY, SLOW_KEY, M, LENS, SLIDER, REFRACT, HDR, TIP_SEL, TIP_ALT, GLOW_SEL, ON_SEL;
  var SVGNS = 'http://www.w3.org/2000/svg', XLINK = 'http://www.w3.org/1999/xlink';

  /* ── 文案：页面 lang 以 zh 开头用中文，否则英文；LiquidGlassConfig.messages 可逐条覆盖 ── */
  var TEXT = {
    zh: {
      full: '完整', lite: '精简', off: '关闭', auto: '（自动）', colon: '：',
      offNote: '关闭：不用玻璃效果——面板是实色，悬停叠一层薄暗，选中项用自己的底色，没有动画',
      liteNote: '精简：面板不透明、不折射，悬停与选中直接到位、不做流动动画。省显卡，远程桌面上更顺',
      noBackdrop: '这个浏览器不支持背景模糊，面板换成实色，流动动画照常',
      lessTransparency: '系统设置了「减少透明度」，面板换成实色，流动动画照常',
      notChromium: '半透明 + 流动动画。只有 Chrome / Edge 能折射，这里不折射',
      slow: '刚才动画掉帧，先不折射。点「完整」可强制打开；还卡就点「精简」',
      softGpu: '显卡是软件渲染（远程桌面、虚拟机常见），先不折射。点「完整」可强制打开；觉得卡就点「精简」',
      refract: '半透明 + 边缘折射 + 流动动画', hdr: ' + HDR 高光',
      switchTitle: '玻璃效果。', toast: '玻璃效果 · '
    },
    en: {
      full: 'Full', lite: 'Lite', off: 'Off', auto: ' (auto)', colon: ': ',
      offNote: 'Off: no glass effects — solid panels, hover shows a light tint, the selected item keeps its own colour, no animation',
      liteNote: 'Lite: opaque panels, no refraction; hover and selection snap into place without fluid motion. Easier on the GPU and on remote desktops',
      noBackdrop: 'this browser cannot blur the backdrop, so panels are solid; motion stays on',
      lessTransparency: 'the system asks for reduced transparency, so panels are solid; motion stays on',
      notChromium: 'translucent + fluid motion. Only Chrome / Edge can refract, so no refraction here',
      slow: 'frames were dropped, refraction is paused. Pick “Full” to force it; pick “Lite” if it still stutters',
      softGpu: 'the GPU is software-rendered (common on remote desktops and VMs), refraction is paused. Pick “Full” to force it; pick “Lite” if it stutters',
      refract: 'translucent + edge refraction + fluid motion', hdr: ' + HDR highlight',
      switchTitle: 'Glass effects. ', toast: 'Glass effects · '
    }
  };

  function assign(a, b) { for (var k in b) { if (Object.prototype.hasOwnProperty.call(b, k)) { a[k] = b[k]; } } return a; }
  function load(k) { try { return win.localStorage.getItem(k); } catch (e) { return null; } }
  function save(k, v) {
    try { if (v === null) { win.localStorage.removeItem(k); } else { win.localStorage.setItem(k, v); } } catch (e) {}
  }
  function mq(q) { try { return win.matchMedia(q).matches; } catch (e) { return false; } }
  function onMq(q, fn) {
    try {
      var m = win.matchMedia(q);
      if (m.addEventListener) { m.addEventListener('change', fn); } else if (m.addListener) { m.addListener(fn); }
    } catch (e) {}
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function visible(el) { return !!el && el.offsetWidth > 0 && el.offsetHeight > 0; }
  function num(v, d) { var n = parseFloat(v); return isNaN(n) ? d : n; }
  function ensurePositioned(el) {
    if (win.getComputedStyle(el).position === 'static') { el.style.position = 'relative'; }
  }

  /* ══ 预设：组件类 → 透镜 / 滑块 / 折射 / HDR 的参数 ══════════════════════════
   * 数值是一块块调出来的，来历见 references/design-spec.md。LiquidGlassConfig 里给同名数组可整组替换，
   * presets:false 则全部关掉、只认 data 属性。
   *   pad   透镜比项大一圈（有底色的胶囊用，边上露出玻璃）
   *   mag   被透镜盖住的项放大多少：窄项 3–5%；宽列表项 ≤ 1.5%（放大以中心为原点，500px 宽放大 2% 左边的字就跳 5px）；整行 0
   *   rad   透镜圆角；不写就照那一项自己的圆角
   *   under 表格一类整行：垫一块亮板，指尖光跟着指针走；不放大、不折射、不跟手位移，按下往里收一点（不鼓出去）
   * 折射（refract）：
   *   bezel 玻璃边宽（px）；depth 最外缘位移（px，缺省 0.45 × bezel）；disp 色散（缺省 0.08）；scatter 边上乳白的浓度（缺省 0.05）
   * 滑块（slider）kind 为 seg 的（分段开关）还能按住拖：按住选中项它浮起成一块会折射的透镜，见 §5.5。
   */
  var PRESETS = {
    lens: [
      { sel: '.lg-nav', items: '.lg-nav-item, .lg-nav-group', pad: 3, mag: 0.025 },
      { sel: '.lg-seg', items: '.lg-seg > button', pad: 0, mag: 0.04 },
      { sel: '.lg-menu', items: '.lg-menu-item', pad: 0, mag: 0.015 },
      { sel: '.lg-list', items: '.lg-list-item', pad: 0, mag: 0.012 },
      { sel: '.lg-table-wrap', items: 'tbody tr', pad: 0, mag: 0, rad: 10, under: true }
    ],
    slider: [
      { sel: '.lg-nav', items: '.lg-nav-item', kind: 'nav' },
      { sel: '.lg-seg', items: '.lg-seg > button', kind: 'seg' },
      { sel: '.lg-list', items: '.lg-list-item', kind: 'cursor' }
    ],
    // 只给「背后真有内容」的玻璃：弹出层盖在正文上、保存条底下滚着表单。背后是纯色页面底的玻璃折了也看不出来，白花显卡
    refract: [
      { sel: '.lg-menu', bezel: 18, depth: 8 },
      { sel: '.lg-panel', bezel: 24, depth: 11 },
      { sel: '.lg-toolbar--sticky', bezel: 14, depth: 6 }
      // 玻璃导航条（.lg-seg--glass）整条的边默认不折射：条只有 58px 高，边上那一圈占得太多，实测是一圈发灰的厚边；
      // 折射留给按住时浮起的那块透镜。要开就在条上写 data-lg-refract="9 4"
    ],
    hdr: [
      { sel: '.lg-sidebar', spots: 'top bottom' },
      { sel: '.lg-dialog', spots: 'top bottom' },
      { sel: '.lg-panel', spots: 'top' },
      { sel: '.lg-chip', spots: 'top' },
      { sel: '.lg-seg--glass', spots: 'top' }
    ]
  };
  /** 读一套配置（window.LiquidGlassConfig 或 LiquidGlass.init 给的），算出各处要用的值 */
  function configure(c) {
    CFG = c || {};
    MODE_KEY = CFG.storageKey || 'lg.glass';
    SLOW_KEY = MODE_KEY + '.slow';
    M = TEXT[(CFG.lang || root.getAttribute('lang') || '').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en'];
    if (CFG.messages) { M = assign(assign({}, M), CFG.messages); }
    var pre = CFG.presets === false ? {} : PRESETS;
    LENS = CFG.lens || pre.lens || [];
    SLIDER = CFG.slider || pre.slider || [];
    REFRACT = CFG.refract || pre.refract || [];
    HDR = CFG.hdr || pre.hdr || [];
    TIP_SEL = CFG.tips || '[data-lg-tip][title], [data-lg-tip] [title], .lg-sidebar [title], .lg-chip[title], [data-lg-mode-switch][title]';
    TIP_ALT = TIP_SEL + ', ' + TIP_SEL.replace(/\[title\]/g, '[data-lg-title]');
    GLOW_SEL = CFG.glow || '.lg-btn, .lg-chip, [data-lg-glow]';
    // 「选中」除了 aria-* 之外还认哪些写法。页面自己用 class 标选中（比如 .on、.active）时，在 on 里补上
    ON_SEL = '.is-cursor, .is-active, [data-lg-on]' + (CFG.on ? ', ' + CFG.on : '');
  }
  configure(win.LiquidGlassConfig);
  var DANGER_SEL = '.lg-nav-item--danger, [data-lg-danger]';

  /* ══ 1 分档 ═════════════════════════════════════════════════════════════ */

  var still = mq('(prefers-reduced-motion: reduce)');
  var slow = false;
  try { slow = win.sessionStorage.getItem(SLOW_KEY) === '1'; } catch (e) {}
  var tier = '', mode = '';
  /** 动画直接到位：系统要求减少动态效果，或者在「精简」档 */
  function calm() { return still || mode === 'lite'; }

  /** 用户选的：full / lite / off；没选过是 auto（能折射就折射，机器吃力就自动先不折射） */
  function pref() {
    var p = load(MODE_KEY);
    return p === 'full' || p === 'lite' || p === 'off' ? p : 'auto';
  }

  function hasBackdrop() {
    return CSSx.supports('backdrop-filter', 'blur(1px)') || CSSx.supports('-webkit-backdrop-filter', 'blur(1px)');
  }

  /**
   * backdrop-filter 里的 url(#滤镜) 只有 Chromium 系认。CSS.supports 问不出来——
   * Safari / Firefox 也回答「支持」，然后静默丢掉整条声明，连模糊都没了。所以按浏览器品牌判断。
   */
  function chromium() {
    var d = navigator.userAgentData, i;
    if (d && d.brands) {
      for (i = 0; i < d.brands.length; i++) { if (/Chromium/.test(d.brands[i].brand)) { return true; } }
      return false;
    }
    var ua = navigator.userAgent || '', m = /Chrome\/(\d+)/.exec(ua);
    return !!m && +m[1] >= 90 && !/Edge\//.test(ua);
  }

  var gpu = null;
  /** 显卡名。远程桌面、虚拟机、没装显卡驱动时是软件渲染，折射每一帧都靠 CPU 算，会卡 */
  function renderer() {
    if (gpu !== null) { return gpu; }
    gpu = 'none';
    try {
      var c = doc.createElement('canvas');
      var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (gl) {
        var ext = gl.getExtension('WEBGL_debug_renderer_info');
        gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
        var lose = gl.getExtension('WEBGL_lose_context');
        if (lose) { lose.loseContext(); }
      }
    } catch (e) { gpu = 'none'; }
    return gpu;
  }
  function softwareGpu() {
    var r = renderer();
    return r === 'none' || /SwiftShader|llvmpipe|softpipe|Software|Basic Render|Microsoft Basic/i.test(r);
  }

  function tierFor(p) {
    if (p === 'off' || p === 'lite' || !hasBackdrop() || mq('(prefers-reduced-transparency: reduce)')) { return 'l0'; }
    if (!chromium()) { return 'l1'; }
    if (p === 'auto' && (slow || softwareGpu())) { return 'l1'; }
    return mq('(dynamic-range: high)') ? 'l3' : 'l2';
  }

  /** 这一档实际是什么样、为什么——写进开关的提示，点开关时也弹这一句 */
  function tierNote(p, t) {
    if (p === 'off') { return M.offNote; }
    if (p === 'lite') { return M.liteNote; }
    var head = M.full + (p === 'auto' ? M.auto : '') + M.colon;
    if (t === 'l0') { return head + (!hasBackdrop() ? M.noBackdrop : M.lessTransparency); }
    if (t === 'l1') { return head + (!chromium() ? M.notChromium : slow ? M.slow : M.softGpu); }
    return head + M.refract + (t === 'l3' ? M.hdr : '');
  }

  function applyTier() {
    var p = pref(), t = tierFor(p), m = p === 'off' ? 'off' : p === 'lite' ? 'lite' : 'full', changed = false;
    root.setAttribute('data-lg-mode', p);
    if (m !== mode) {
      mode = m; changed = true;
      resetItems();                                   // 换档时被放大的项先复原，下次经过再按新档量
      // 「关闭」：撤掉透镜与滑块，去掉 data-lg-lens，样式表里 html:not([data-lg-lens]) 那套悬停与选中底色接手
      if (m === 'off') { teardown(); root.removeAttribute('data-lg-lens'); } else { root.setAttribute('data-lg-lens', ''); }
      scheduleSync();
    }
    if (t !== tier || root.getAttribute('data-lg-tier') !== t) {
      tier = t; changed = true;
      root.setAttribute('data-lg-tier', t);
      refreshAllRefract();
      scheduleSync();
    }
    var shown = p === 'auto' ? 'full' : p, i, bs = doc.querySelectorAll('[data-lg-mode-set]');
    for (i = 0; i < bs.length; i++) {
      var on = bs[i].getAttribute('data-lg-mode-set') === shown ? 'true' : 'false';
      if (bs[i].getAttribute('aria-pressed') !== on) { bs[i].setAttribute('aria-pressed', on); }
    }
    var g = doc.querySelectorAll('[data-lg-mode-switch]');
    for (i = 0; i < g.length; i++) {
      var note = M.switchTitle + tierNote(p, t);
      if (g[i].hasAttribute('data-lg-title')) { g[i].setAttribute('data-lg-title', note); } else { g[i].setAttribute('title', note); }
    }
    if (changed) { emit('lg:modechange', { mode: p, tier: t }); }
  }
  function refracting() { return tier === 'l2' || tier === 'l3'; }

  function emit(name, detail) {
    var ev;
    try { ev = new win.CustomEvent(name, { detail: detail }); } catch (e) {
      try { ev = doc.createEvent('CustomEvent'); ev.initCustomEvent(name, false, false, detail); } catch (e2) { return; }
    }
    doc.dispatchEvent(ev);
  }

  /* ══ 2 折射：位移贴图 + SVG 滤镜 ═════════════════════════════════════════
   *
   * 照 iOS 26 的玻璃边：**放大 + 模糊 + 散射**（外加一点色散），正中一个像素都不重采样。
   *
   * 几何：圆角矩形，离边 b（边宽）以内是斜面。斜面**往里取样、越靠边位移越大**：
   *   D(s) = K·b·(1 − s/b)²，K = 0.45，s 是离边的距离
   * 最外缘 D′ = −0.9：边上那一圈被拉开约十倍（放大），往里平滑落回原样；取样位置 s + D(s) 处处单调
   * （处处 D′ > −1），不折叠——同一段内容不会被画两遍，边上也不会出现镜像。
   * （上一版按斯涅尔定律 + 凸超椭圆算：位移全挤在最外两三个像素里，而且在那儿折叠了，边上的字被画两遍。）
   *
   * 位移图四个通道：R / G = 往哪边取样（128 = 不动），B = 位移大小 m = (1 − s/b)²（0 中间、1 最外缘），A = 形状。
   * 滤镜拿 m 当权重：红绿蓝三路按略不同的强度位移（色散）；越靠边叠越多的模糊（m^1.6）和一层很淡的乳白（散射）；
   * m 太小的地方直接用原图——中间一个像素都不重采样。
   *
   * 位移图按九宫格切：四个角（c × c，c = max(圆角, 边宽)）、四条边（沿边方向处处一样，存一条 2 像素宽的图拉伸），
   * 中间不放（透明 = 用原图）。尺寸变了只改这八块的 x / y / width / height，不重画贴图——
   * 拖窗口、透镜跟着项宽变的时候，折射都不用撤。
   */
  var K = 0.45, TILE_PX = 2;
  var tileSets = {}, tileCount = 0;
  var PARTS = ['t', 'b', 'l', 'r', 'tl', 'tr', 'bl', 'br'];
  // 每块是不是在右边 / 下边（是的话坐标镜像过去按左上角算，法向再翻回来）
  var SIDE = { t: [0, 0], b: [0, 1], l: [0, 0], r: [1, 0], tl: [0, 0], tr: [1, 0], bl: [0, 1], br: [1, 1] };

  /**
   * 左上角那一块里的一点 (x, y)（从元素左上角量）：离边多远、朝外的单位法向。
   * 圆角那一格里离的是圆弧（在弧外是负数），其余离的是更近的那条直边。
   */
  function corner(x, y, r, out) {
    var dx = x - r, dy = y - r;
    if (dx < 0 && dy < 0) {
      var l = Math.sqrt(dx * dx + dy * dy);
      out[0] = r - l; out[1] = l > 1e-6 ? dx / l : 0; out[2] = l > 1e-6 ? dy / l : 0;
    } else if (x < y) { out[0] = x; out[1] = -1; out[2] = 0; }
    else { out[0] = y; out[1] = 0; out[2] = -1; }
  }
  /**
   * 一个像素：离边 s、朝外的法向 (nx, ny)、边宽 b、覆盖率 cov、剖面指数 pw。往里取样 = 沿法向的反方向。
   * 位移大小 m = (1 − s/b)^pw：pw = 2 是默认的玻璃板（边上弯、正中平）；pw = 3 是凸透镜（data-lg-refract="lens"，
   * 斜面一直到中线）——放大率连同它的变化率都从中线平滑地长出来，看不出「外面一圈在弯、里面一块是平的」
   */
  function texel(px, i, s, nx, ny, b, cov, pw) {
    if (s >= b) { px[i] = 128; px[i + 1] = 128; px[i + 2] = 0; }
    else {
      var m = 1 - Math.max(s, 0) / b;
      m = pw === 3 ? m * m * m : m * m;
      px[i] = Math.round(127.5 - nx * m * 127.5);
      px[i + 1] = Math.round(127.5 - ny * m * 127.5);
      px[i + 2] = Math.round(m * 255);
    }
    px[i + 3] = Math.round(cov * 255);
  }

  /** 一套九宫格贴图（八张 data URL），按「角的边长 × 圆角 × 边宽 × 剖面」缓存。贴图按 2 倍密度画，高分屏上也细 */
  function tileSet(c, r, b, pw) {
    var key = c.toFixed(2) + '|' + r.toFixed(2) + '|' + b.toFixed(2) + '|' + pw;
    if (tileSets[key]) { return tileSets[key]; }
    if (tileCount > 24) { tileSets = {}; tileCount = 0; }
    var n = Math.max(2, Math.ceil(c * TILE_PX)), u = c / n, set = {}, o = [0, 0, 0], p, k;
    for (p = 0; p < PARTS.length; p++) {
      k = PARTS[p];
      var edge = k.length === 1, rt = SIDE[k][0], bt = SIDE[k][1];
      var W = k === 't' || k === 'b' ? 2 : n, H = k === 'l' || k === 'r' ? 2 : n;
      var cv = doc.createElement('canvas');
      cv.width = W; cv.height = H;
      var g = cv.getContext('2d'), img = g.createImageData(W, H), px = img.data, x, y;
      for (y = 0; y < H; y++) {
        for (x = 0; x < W; x++) {
          var lx = (x + 0.5) * u, ly = (y + 0.5) * u, i = (y * W + x) * 4;
          if (edge) {
            if (k === 't') { texel(px, i, ly, 0, -1, b, 1, pw); }
            else if (k === 'b') { texel(px, i, c - ly, 0, 1, b, 1, pw); }
            else if (k === 'l') { texel(px, i, lx, -1, 0, b, 1, pw); }
            else { texel(px, i, c - lx, 1, 0, b, 1, pw); }
            continue;
          }
          var tx = rt ? c - lx : lx, ty = bt ? c - ly : ly, cov = 1, sx, sy;
          if (tx < r && ty < r) {                       // 圆弧那一格：4×4 超采样算覆盖率，弧外透明
            cov = 0;
            for (sy = 0; sy < 4; sy++) {
              for (sx = 0; sx < 4; sx++) {
                var ax = (rt ? c - (x + (sx + 0.5) / 4) * u : (x + (sx + 0.5) / 4) * u) - r;
                var ay = (bt ? c - (y + (sy + 0.5) / 4) * u : (y + (sy + 0.5) / 4) * u) - r;
                if (ax >= 0 || ay >= 0 || ax * ax + ay * ay <= r * r) { cov += 1 / 16; }
              }
            }
          }
          corner(tx, ty, r, o);
          texel(px, i, o[0], rt ? -o[1] : o[1], bt ? -o[2] : o[2], b, cov, pw);
        }
      }
      g.putImageData(img, 0, 0);
      set[k] = cv.toDataURL('image/png');
    }
    tileCount++;
    return (tileSets[key] = set);
  }

  var defs = null, filterSeq = 0;
  function svgEl(name, attrs) {
    var e = doc.createElementNS(SVGNS, name), k;
    for (k in attrs) { if (Object.prototype.hasOwnProperty.call(attrs, k)) { e.setAttribute(k, attrs[k]); } }
    return e;
  }
  function svgDefs() {
    if (defs && defs.parentNode) { return defs; }
    defs = svgEl('svg', { 'class': 'lg-defs', width: '0', height: '0', 'aria-hidden': 'true', focusable: 'false' });
    defs.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:hidden';
    doc.body.appendChild(defs);
    return defs;
  }

  var ONLY = {
    R: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
    G: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
    B: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0'
  };

  /**
   * 一块玻璃的滤镜。disp > 0 时红绿蓝三路分开位移（色散），否则一路。
   *   位移图：透明的 128 底 + 九宫格八块（贴图没加载出来时那一块是透明的，m = 0，用原图——绝不会整片错位）
   *   → 位移（放大）→ 按 m^1.6 叠一层模糊 → 按 m 叠一层乳白 → 只在 m 明显的地方用（m × 12 截到 1）→ 按形状裁 → 垫在原图上面
   * color-interpolation-filters 必须是 sRGB（缺省的线性 RGB 会把 128 算成 55 左右，整片往一边偏）；
   * 滤镜区域用缺省值（写 userSpaceOnUse 加 x/y 坐标原点会跑掉）。
   * 乳白的颜色走令牌 --lg-scatter：深色底上同样的白要淡一半，不然边上一圈发灰。
   */
  function newFilter(disp) {
    var id = 'lgf-' + (++filterSeq), i;
    var f = svgEl('filter', { id: id, 'color-interpolation-filters': 'sRGB' });
    var F = { id: id, node: f, disp: disp, parts: {}, dm: [], soft: null, veil: null, sig: '' };
    function fe(name, attrs) { return f.appendChild(svgEl(name, attrs)); }
    function merge(result, ins) {
      var m = fe('feMerge', result ? { result: result } : {});
      for (var j = 0; j < ins.length; j++) { m.appendChild(svgEl('feMergeNode', { 'in': ins[j] })); }
    }
    function alpha(input, result, attrs) {
      var t = fe('feComponentTransfer', { 'in': input, result: result });
      return t.appendChild(svgEl('feFuncA', attrs));
    }
    fe('feFlood', { 'flood-color': 'rgb(128,128,0)', 'flood-opacity': '0', result: 'n0' });
    var ins = ['n0'];
    for (i = 0; i < PARTS.length; i++) {
      F.parts[PARTS[i]] = fe('feImage', { x: '0', y: '0', width: '1', height: '1', preserveAspectRatio: 'none', result: 'p' + PARTS[i] });
      ins.push('p' + PARTS[i]);
    }
    merge('map', ins);
    if (disp) {
      for (i = 0; i < 3; i++) {
        var ch = 'RGB'.charAt(i);
        F.dm.push(fe('feDisplacementMap', { 'in': 'SourceGraphic', in2: 'map', scale: '0', xChannelSelector: 'R', yChannelSelector: 'G', result: 'd' + ch }));
        fe('feColorMatrix', { 'in': 'd' + ch, type: 'matrix', values: ONLY[ch], result: 'c' + ch });
      }
      fe('feComposite', { 'in': 'cR', in2: 'cG', operator: 'arithmetic', k1: '0', k2: '1', k3: '1', k4: '0', result: 'rg' });
      fe('feComposite', { 'in': 'rg', in2: 'cB', operator: 'arithmetic', k1: '0', k2: '1', k3: '1', k4: '0', result: 'sharp' });
    } else {
      F.dm.push(fe('feDisplacementMap', { 'in': 'SourceGraphic', in2: 'map', scale: '0', xChannelSelector: 'R', yChannelSelector: 'G', result: 'sharp' }));
    }
    fe('feColorMatrix', { 'in': 'map', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0', result: 'm' });
    F.soft = fe('feGaussianBlur', { 'in': 'sharp', stdDeviation: '0.5', result: 'soft' });
    alpha('m', 'bw', { type: 'gamma', amplitude: '1', exponent: '1.6', offset: '0' });
    fe('feComposite', { 'in': 'soft', in2: 'bw', operator: 'in', result: 'softIn' });
    merge('lensed', ['sharp', 'softIn']);
    var white = fe('feFlood', { 'flood-color': '#ffffff', result: 'white' });
    white.style.setProperty('flood-color', 'var(--lg-scatter, #ffffff)');
    F.veil = alpha('m', 'vw', { type: 'linear', slope: '0.05', intercept: '0' });
    fe('feComposite', { 'in': 'white', in2: 'vw', operator: 'in', result: 'veil' });
    merge('glowed', ['lensed', 'veil']);
    alpha('m', 'rw', { type: 'linear', slope: '12', intercept: '0' });
    fe('feComposite', { 'in': 'glowed', in2: 'rw', operator: 'in', result: 'rim' });
    fe('feComposite', { 'in': 'rim', in2: 'map', operator: 'in', result: 'shaped' });
    merge('', ['SourceGraphic', 'shaped']);
    svgDefs().appendChild(f);
    return F;
  }
  function dropFilter(F) { if (F && F.node.parentNode) { F.node.parentNode.removeChild(F.node); } }

  /**
   * 按元素的布局尺寸摆好九宫格、定好强度（look：bezel 边宽、depth 最外缘位移、disp 色散、blur 最外缘模糊、scatter 散射）。
   * 和上次一样就什么都不做；只是尺寸变了就只挪这八块。
   */
  function setGeom(F, w, h, r, look) {
    w = Math.round(w); h = Math.round(h);
    var lim = Math.min(w, h) / 2;
    r = clamp(r, 0, lim);
    var b = clamp(look.bezel, 2, Math.max(2, lim - 1)), c = Math.max(r, b), pw = look.power === 3 ? 3 : 2;
    // 缺省的最外缘位移 (2K/pw)·b：最外缘 D′ = −2K = −0.9，任何剖面都放大约十倍、不折叠
    var depth = look.depth || b * 2 * K / pw, blur = look.blur || 0.5, scat = look.scatter == null ? 0.05 : look.scatter;
    var sig = w + 'x' + h + '|' + r.toFixed(2) + '|' + b.toFixed(2) + '|' + depth.toFixed(2) + '|' + blur.toFixed(2) + '|' + scat + '|' + pw;
    if (sig === F.sig) { return; }
    F.sig = sig;
    var set = tileSet(c, r, b, pw), mid = (w - 2 * c + 2).toFixed(2), tall = (h - 2 * c + 2).toFixed(2), k;
    var box = {
      t: [c - 1, 0, mid, c], b: [c - 1, h - c, mid, c], l: [0, c - 1, c, tall], r: [w - c, c - 1, c, tall],
      tl: [0, 0, c, c], tr: [w - c, 0, c, c], bl: [0, h - c, c, c], br: [w - c, h - c, c, c]
    };
    for (k in box) {
      if (!Object.prototype.hasOwnProperty.call(box, k)) { continue; }
      var im = F.parts[k], g = box[k];
      if (im.__url !== set[k]) {
        im.__url = set[k];
        im.setAttribute('href', set[k]);
        im.setAttributeNS(XLINK, 'xlink:href', set[k]);
      }
      im.setAttribute('x', String(g[0])); im.setAttribute('y', String(g[1]));
      im.setAttribute('width', String(g[2])); im.setAttribute('height', String(g[3]));
    }
    // feDisplacementMap 取 (C − 0.5) × scale，C 在 0–1 之间，所以 scale = 2 × 最外缘位移。红多折一点、蓝少折一点
    var s = 2 * depth, d = F.disp || 0;
    if (F.dm.length === 3) {
      F.dm[0].setAttribute('scale', (s * (1 + d)).toFixed(2));
      F.dm[1].setAttribute('scale', s.toFixed(2));
      F.dm[2].setAttribute('scale', (s * (1 - d)).toFixed(2));
    } else { F.dm[0].setAttribute('scale', s.toFixed(2)); }
    F.soft.setAttribute('stdDeviation', Math.max(0.5, blur).toFixed(2));
    F.veil.setAttribute('slope', String(scat));
  }

  /**
   * 透镜和背后的页面之间隔着「背景根」吗：自己或祖先带 filter / backdrop-filter / mask / clip-path / mix-blend-mode。
   * 有的话 Chromium 只把那个祖先里面的东西交给折射滤镜，输出还会把原图换掉——浮起来是一块发暗的方块。
   * 检测到就不开折射，只留模糊。透明度不算：页面切换的淡入淡出会误判（它只让玻璃暂时采不到背景，不出方块）。
   */
  function isolated(el) {
    for (var n = el; n && n !== doc.body && n !== root; n = n.parentElement) {
      var s = win.getComputedStyle(n);
      if ((s.filter && s.filter !== 'none') || (s.clipPath && s.clipPath !== 'none')
          || (s.mixBlendMode && s.mixBlendMode !== 'normal')) { return true; }
      var bf = s.backdropFilter || s.webkitBackdropFilter, mk = s.maskImage || s.webkitMaskImage;
      if ((bf && bf !== 'none') || (mk && mk !== 'none')) { return true; }
    }
    return false;
  }

  /**
   * 一块玻璃的折射强度。预设里写的直接用；data-lg-refract="边宽 [最外缘位移]" 照写的用
   * （三个数是老写法「边宽 隆起 厚度」，第三个数当位移用）；不给值时按尺寸取：边宽 = 短边 × 0.2，夹在 10–24px。
   * 位移缺省 = 0.45 × 边宽。面板越大，边越宽、折得越多；小控件边窄，不然整颗都在弯、字看着晃。
   */
  function refractParams(el, cfg, w, h) {
    var b = cfg.bezel, d = cfg.depth, pw = cfg.power === 3 ? 3 : 2;
    if (!b) {
      var raw = el.getAttribute('data-lg-refract') || '', v = raw.split(/[\s,]+/);
      if (/^\s*lens\b/i.test(raw)) {
        // 凸透镜：斜面一直到中线（setGeom 夹到短边一半减 1）、三次剖面——整块连续地弯，没有平的内圈。给小块的玻璃用
        b = Math.min(w, h) / 2; pw = 3; d = v.length >= 2 ? num(v[1], 0) : 0;
      } else if (v[0] !== '' && !isNaN(parseFloat(v[0]))) {
        b = num(v[0], 16);
        d = v.length >= 3 ? num(v[2], 0) : v.length === 2 ? num(v[1], 0) : 0;
      } else { b = clamp(Math.round(Math.min(w, h) * 0.2), 10, 24); }
    }
    return {
      bezel: b, depth: d || b * 2 * K / pw, power: pw, blur: Math.max(0.5, b * 0.06),
      disp: cfg.disp == null ? 0.08 : cfg.disp, scatter: cfg.scatter == null ? 0.05 : cfg.scatter
    };
  }

  var refractNodes = [];
  var ro = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      var t = entries[i].target;
      if (t.__lgR) { refreshRefract(t); }
      if (t.__lgT) { t.__lgT.resized = true; }
    }
    scheduleSync();
  }) : null;

  function radiusOf(el, w, h) {
    var r = parseFloat(win.getComputedStyle(el).borderTopLeftRadius) || 0;
    return Math.min(r, w / 2, h / 2);
  }

  /** 按此刻的尺寸摆好九宫格并打开折射。尺寸变了（拖窗口、内容重画）也只是挪一挪，不用先撤 */
  function refreshRefract(el) {
    var R = el.__lgR;
    if (!R) { return; }
    if (!refracting() || isolated(el)) {
      if (el.hasAttribute('data-lg-refract-on')) { el.removeAttribute('data-lg-refract-on'); }
      return;
    }
    var w = el.offsetWidth, h = el.offsetHeight;
    if (w < 8 || h < 8) { return; }                  // 藏着的（display:none）等显出来再算
    var c = refractParams(el, R.cfg, w, h);
    if (!R.F || R.F.disp !== c.disp) { dropFilter(R.F); R.F = newFilter(c.disp); }
    setGeom(R.F, w, h, radiusOf(el, w, h), c);
    var ref = 'url(#' + R.F.id + ')';
    if (el.style.getPropertyValue('--lg-ref') !== ref) { el.style.setProperty('--lg-ref', ref); }
    if (el.getAttribute('data-lg-refract-on') !== '') { el.setAttribute('data-lg-refract-on', ''); }
  }
  function refreshAllRefract() { for (var i = 0; i < refractNodes.length; i++) { refreshRefract(refractNodes[i]); } }

  function addRefract(el, cfg) {
    if (el.__lgR) { return; }
    el.__lgR = { cfg: cfg, F: null };
    refractNodes.push(el);
    if (ro) { ro.observe(el); }
    refreshRefract(el);
  }

  function scanRefract() {
    var i, j, list;
    for (i = refractNodes.length - 1; i >= 0; i--) {          // 从页面上撤掉的（整片重画了）连滤镜一起清掉
      var n = refractNodes[i];
      if (!doc.body.contains(n)) {
        if (ro) { ro.unobserve(n); }
        dropFilter(n.__lgR.F);
        n.__lgR = null;
        refractNodes.splice(i, 1);
      }
    }
    for (i = 0; i < REFRACT.length; i++) {
      list = doc.querySelectorAll(REFRACT[i].sel);
      for (j = 0; j < list.length; j++) { addRefract(list[j], REFRACT[i]); }
    }
    list = doc.querySelectorAll('[data-lg-refract]');
    for (j = 0; j < list.length; j++) { addRefract(list[j], {}); }
  }

  /* ══ 3 动画：一个 requestAnimationFrame 循环带所有弹簧 ══════════════════
   *
   * 弹簧参数照 Apple「时长 + 回弹」的换算：刚度 k = (2π/时长)²，阻尼 c = 4π(1−回弹)/时长。
   * 半隐式欧拉积分，每帧拆成不超过 4ms 的小步（慢帧里刚度高的弹簧不发散）；换目标时保留速度，所以中途改道不会顿一下。
   */
  function spring(dur, bounce) { return { k: Math.pow(2 * Math.PI / dur, 2), d: 4 * Math.PI * (1 - bounce) / dur }; }
  var SP = {
    pos: spring(0.38, 0.22), fade: spring(0.3, 0), press: spring(0.26, 0.35),
    lead: spring(0.3, 0.26), lag: spring(0.52, 0.16), same: spring(0.42, 0.18),
    // 分段开关：浮起带一点回弹、落下不回弹；橡皮筋弹回时冲过头压扁一下
    up: spring(0.38, 0.3), down: spring(0.26, 0), band: spring(0.5, 0.5),
    // 拖着的时候滑块追手指：很快、不回弹（直接写位置的话，按下后立刻拖，滑块会从半路一下跳到手指下面）
    drag: spring(0.12, 0),
    // 浮着飞：整块玻璃一起平移（两条边同一根弹簧，不拉长），带一点冲过头再回来
    fly: spring(0.4, 0.28)
  };
  // 一帧拆成不超过 4ms 的小步：刚度高的弹簧（拖动时追手指的那根）在一步 34ms 的慢帧里会发散，一下飞出几百万像素
  function step(o, p, v, target, c, dt) {
    var n = Math.ceil(dt / 0.004), h = dt / n, i;
    for (i = 0; i < n; i++) {
      o[v] += (-c.k * (o[p] - target) - c.d * o[v]) * h;
      o[p] += o[v] * h;
    }
  }

  var anims = [], rafId = 0, lastT = 0, frames = [];
  function animate(o) {
    if (anims.indexOf(o) < 0) { anims.push(o); }
    if (!rafId) { lastT = 0; rafId = win.requestAnimationFrame(tick); }
  }
  function tick(now) {
    var raw = lastT ? now - lastT : 16.7, dt = clamp(raw / 1000, 0.004, 0.034);
    lastT = now;
    watchFrames(raw);
    for (var i = anims.length - 1; i >= 0; i--) {
      var o = anims[i], busy = o.step(dt);
      o.paint();
      if (!busy) { anims.splice(i, 1); }
    }
    rafId = anims.length ? win.requestAnimationFrame(tick) : 0;
  }

  /**
   * 自动档下的掉帧检测：动画期间攒够 45 帧，中位数超过 30ms（不到 33 帧/秒）就先不折射，
   * 本次会话记住。用中位数不用平均数：刚加载、大表格刚画完那几帧的卡顿不会误判。
   * 只在「自动」下生效——用户点过「完整」就是明确要，照开。
   */
  function watchFrames(ms) {
    if (!refracting() || pref() !== 'auto' || slow || !lastT) { return; }
    frames.push(ms);
    if (frames.length < 45) { return; }
    var s = frames.slice().sort(function (a, b) { return a - b; }), med = s[s.length >> 1];
    frames = [];
    if (med > 30) {
      slow = true;
      try { win.sessionStorage.setItem(SLOW_KEY, '1'); } catch (e) {}
      applyTier();
    }
  }

  /** 相对面板的位置。用 offset 系列量：不受 transform（透镜放大、弹出动画）影响，滚动容器里也对 */
  function relRect(surf, t) {
    var x = 0, y = 0, n = t;
    while (n && n !== surf) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    if (n !== surf) {
      var a = t.getBoundingClientRect(), b = surf.getBoundingClientRect();
      x = a.left - b.left - surf.clientLeft + surf.scrollLeft;
      y = a.top - b.top - surf.clientTop + surf.scrollTop;
    }
    return { x: x, y: y, w: t.offsetWidth, h: t.offsetHeight };
  }

  /**
   * 装透镜 / 滑块的容器若是滚动容器（overflow: auto / scroll），记下内容的范围：画的时候整块不许伸出去。
   * 伸出去一点，滚动尺寸就被撑大，滚动条闪一下；竖滚动条一出来占掉宽度，表格横向又溢出，两条互相撑着不走。
   * 量之前先把自己放进去的玻璃藏起来：内容变短时它们还停在原处（表格筛完只剩两行，透镜还在原来第十行那儿），
   * 带着它们量，量到的就是被它们撑大的范围。
   * 再往里让 1px：scrollWidth / scrollHeight 是取过整的（内容其实 439.69px，读出来 440），贴着它画，
   * 在 2 倍屏上多出的那 0.3px 就是一整个物理像素，Chrome 照样算溢出。让 1px 以后一定在真实的内容边以内。
   */
  var OWN_RE = /(^|\s)lg-(lens|thumb|lift)(\s|$)/;
  function scrollBox(el) {
    var s = win.getComputedStyle(el);
    if (!/auto|scroll/.test(s.overflowX + ' ' + s.overflowY)) { return null; }
    var hid = [], k = el.children, i;
    for (i = 0; i < k.length; i++) {
      if (OWN_RE.test(k[i].getAttribute('class') || '')) { hid.push([k[i], k[i].style.display]); k[i].style.display = 'none'; }
    }
    // fit：内容横向放得下（不横着滚）。这时透镜的宽度再按面板内容区写一道上限（liveWidth）
    var box = { w: el.scrollWidth - 1, h: el.scrollHeight - 1, fit: el.scrollWidth <= el.clientWidth };
    for (i = 0; i < hid.length; i++) { hid[i][0].style.display = hid[i][1]; }
    return box;
  }
  /**
   * 透镜 / 滑块的宽度：内容横向放得下时写成 min(算好的宽度, 面板内容区宽度 − 左边的位置 − 1px)。
   * 竖滚动条一冒出来，内容区窄了 15px、整行也跟着窄了；脚本要到下一帧才重量，这一两帧里透镜还是原来那么宽，
   * 横向就溢出、横滚动条闪一下。写成 min()，同一次排版里透镜就跟着变窄。以中心缩放 s 时右沿 = x + w/2 + w·s/2。
   */
  var CSS_MIN = CSSx.supports('width', 'min(1px, 2%)');
  function liveWidth(box, x, w, s) {
    var px = w.toFixed(2) + 'px';
    if (!box || !box.fit || !CSS_MIN) { return px; }
    return 'min(' + px + ', calc((100% - ' + (x + 1).toFixed(2) + 'px) * ' + (2 / (1 + s)).toFixed(4) + '))';
  }
  /**
   * 把以 (x, y) 为左上角、w × h、以中心缩放 (sx, sy) 的一块关进 box 里面；返回 [左上角 x, y, 宽, 高]。
   * 比 box 还大时先把宽高收到放得下（整行宽的透镜正好和表格一样宽，稍一放大就没地方挪），再挪；
   * 收的是宽高、不动缩放——会折射的东西一缩放，透过它的内容就被重采样得发糊
   */
  function keepIn(box, x, y, w, h, sx, sy) {
    if (!box) { return [x, y, w, h]; }
    var cx = x + w / 2, cy = y + h / 2;
    if (w * sx > box.w) { w = Math.max(0, box.w) / sx; }
    if (h * sy > box.h) { h = Math.max(0, box.h) / sy; }
    var hw = w * sx / 2, hh = h * sy / 2;
    if (cx + hw > box.w) { cx = box.w - hw; }
    if (cx - hw < 0) { cx = hw; }
    if (cy + hh > box.h) { cy = box.h - hh; }
    if (cy - hh < 0) { cy = hh; }
    return [cx - w / 2, cy - h / 2, w, h];
  }

  function isOn(el) {
    var cur = el.getAttribute('aria-current');
    return el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-pressed') === 'true'
      || el.getAttribute('aria-checked') === 'true' || (cur !== null && cur !== 'false') || el.matches(ON_SEL);
  }

  /** 一个元素是不是装透镜的面板：data-lg-lens 优先，否则看预设 */
  function lensCfg(el) {
    if (el.hasAttribute('data-lg-lens')) {
      var sig = [el.getAttribute('data-lg-lens'), el.getAttribute('data-lg-pad'), el.getAttribute('data-lg-mag'),
        el.getAttribute('data-lg-rad'), el.hasAttribute('data-lg-under')].join('|');
      if (!el.__lgC || el.__lgC.sig !== sig) {
        var under = el.hasAttribute('data-lg-under'), rad = el.getAttribute('data-lg-rad');
        el.__lgC = {
          sig: sig, items: el.getAttribute('data-lg-lens') || '.lg-item',
          pad: num(el.getAttribute('data-lg-pad'), 0), mag: num(el.getAttribute('data-lg-mag'), under ? 0 : 0.04),
          rad: rad === null ? null : num(rad, null), under: under
        };
      }
      return el.__lgC;
    }
    for (var i = 0; i < LENS.length; i++) { if (el.matches(LENS[i].sel)) { return LENS[i]; } }
    return null;
  }

  /* ══ 4 透镜 ═════════════════════════════════════════════════════════════
   *
   * 每块面板只有一颗，垫在内容下面（照 iPadOS 指针的「高亮底板」）：字压在玻璃上，
   * 透镜的边缘线不会从字上划过去。放大量按「一项被透镜盖住的比例」算，所以透镜滑过去的路上
   * 两项此消彼长，像水滴从一项流到下一项。
   */
  var lenses = [];                                    // 出现过的透镜，离开 / 失焦时逐个问

  /** 从指针下的节点往上找：最近的一块透镜面板，以及它里面指针所在的那一项 */
  function findItem(node) {
    var el = node && node.nodeType === 1 ? node : node && node.parentElement;
    for (var a = el; a && a !== doc.body; a = a.parentElement) {
      var cfg = lensCfg(a);
      if (!cfg) { continue; }
      var it = el.closest(cfg.items);
      if (it && it !== a && a.contains(it)) { return { item: it, surf: a, cfg: cfg }; }
    }
    return null;
  }

  function lensEl(L) {
    var s = doc.createElement('span');
    s.className = 'lg-lens' + (L.cfg.under ? ' lg-lens-under' : '');
    s.setAttribute('aria-hidden', 'true');
    // 整行的透镜不折射（宽行一折，整行的字都在晃），但指尖光照样有——所有能点的东西是同一套悬停动作。
    // 光只跟着指针走、键盘走到这一行时不出（停在宽行正中的一团光像污渍）。
    // 不用 innerHTML：开了 Trusted Types 的页面上它会被拦
    var parts = L.cfg.under ? ['sh', 'glass', 'light'] : ['sh', 'glass', 'ref', 'light'];
    for (var i = 0; i < parts.length; i++) {
      var c = doc.createElement('span');
      c.className = 'lg-lens-' + parts[i];
      s.appendChild(c);
    }
    L.surf.appendChild(s);
    L.ref = s.querySelector('.lg-lens-ref');
    if (L.ref && L.F) { L.ref.style.setProperty('--lg-ref', 'url(#' + L.F.id + ')'); }
    L.settled = false;
    return s;
  }

  function newLens(surf, cfg) {
    ensurePositioned(surf);
    var L = {
      surf: surf, cfg: cfg, el: null, ref: null, F: null,
      x: 0, y: 0, w: 0, h: 0, vx: 0, vy: 0, vw: 0, vh: 0, tx: 0, ty: 0, tw: 0, th: 0,
      a: 0, va: 0, ta: 0, p: 0, vp: 0, tp: 0, px: 0.5, py: 0.5, pw: null, ph: null,
      cur: null, items: [], rad: null, settled: false, still: false, hover: false, focus: false, offT: 0, clip: null
    };
    // 面板的内容区一变（包括滚动条冒出来、收回去：内容区跟着窄 15px），透镜马上按新的范围重量、重新对齐——
    // 不然竖滚动条一出来表格变窄、透镜还是原来那么宽，横向又溢出，两条滚动条互相撑着不走
    if (ro) { ro.observe(surf); }
    L.step = function (dt) { return lensStep(L, dt); };
    L.paint = function () { lensPaint(L); };
    lenses.push(L);
    return L;
  }

  /** 面板里的项：都标上 data-lg-item（样式表据此让它压在透镜上面）；「完整」档再量好位置，用来算放大 */
  function measureItems(L) {
    L.items = [];
    var list = L.surf.querySelectorAll(L.cfg.items), i;
    for (i = 0; i < list.length; i++) { if (!list[i].hasAttribute('data-lg-item')) { list[i].setAttribute('data-lg-item', ''); } }
    if (!L.cfg.mag || mode !== 'full') { return; }            // 「精简」不放大
    for (i = 0; i < list.length; i++) {
      if (!visible(list[i])) { continue; }
      var r = relRect(L.surf, list[i]);
      r.el = list[i]; r.key = '';
      L.items.push(r);
    }
  }

  /** 分段开关被按住 / 滑块在飞：悬停透镜立刻撤掉（不淡出）。它留在终点那一项底下，看着就像选中「跳」过去了 */
  function quietLens(surf) {
    var L = surf.__lgL;
    if (!L) { return; }
    clearTimeout(L.offT);
    L.hover = L.focus = false; L.cur = null; L.ta = 0; L.a = 0; L.va = 0; L.tp = 0; L.p = 0; L.vp = 0;
    animate(L);
  }

  function lensTo(f, ev) {
    var surf = f.surf, t = f.item, cfg = f.cfg;
    if (mode === 'off' || t.disabled || t.getAttribute('aria-disabled') === 'true' || !visible(t)) { return; }
    // 分段开关正被按着、或者滑块正浮着飞：不要悬停透镜（两块玻璃，而且它先到终点）
    if (surf.__lgT && (surf.__lgT.drag || surf.__lgT.fly)) { return; }
    if (t.tagName === 'TR' && !t.querySelector('td')) { return; }   // 表头行（表格没写 <thead> 时它也在 tbody 里）不要透镜
    var L = surf.__lgL;
    if (!L || L.surf !== surf || L.cfg !== cfg) {
      if (L && L.el && L.el.parentNode) { L.el.parentNode.removeChild(L.el); }
      L = surf.__lgL = newLens(surf, cfg);
    }
    if (!L.el || L.el.parentNode !== surf) { L.el = lensEl(L); L.a = 0; L.va = 0; }
    if (ev) { L.hover = true; } else { L.focus = true; }
    clearTimeout(L.offT);
    if (L.cur === t && L.ta === 1) { return; }
    L.cur = t;
    measureItems(L);
    retarget(L, ev);
    if (ev && ev.clientX !== undefined) { lensPointer(L, ev); } else { pointerMark(L, false); }   // 指尖光从指针所在处亮起
    animate(L);
  }

  function retarget(L, ev) {
    var t = L.cur, r = relRect(L.surf, t), pad = L.cfg.pad || 0;
    L.clip = scrollBox(L.surf);
    if (isOn(t)) { L.el.setAttribute('data-onsel', ''); } else { L.el.removeAttribute('data-onsel'); }
    if (L.cfg.rad != null) { L.rad = L.cfg.rad + pad; }
    else {
      var ir = parseFloat(win.getComputedStyle(t).borderTopLeftRadius) || 0;
      L.rad = ir * 2 >= r.h - 1 ? null : ir + pad;       // 本来就是胶囊的，透镜也是胶囊（同心：圆角 = 项圆角 + 外扩）
    }
    L.tx = r.x - pad; L.ty = r.y - pad; L.tw = r.w + 2 * pad; L.th = r.h + 2 * pad; L.ta = 1;
    if (L.a < 0.06 || calm()) {
      L.x = L.tx; L.y = L.ty; L.w = L.tw; L.h = L.th; L.vx = L.vy = L.vw = L.vh = 0;
      if (ev && ev.clientX !== undefined && !calm() && !L.cfg.under) {
        // 第一次出现：从指针所在的地方铺开，像一滴水落下去散成胶囊
        var sr = L.surf.getBoundingClientRect(), k = (sr.width / L.surf.offsetWidth) || 1;
        var px = (ev.clientX - sr.left) / k - L.surf.clientLeft + L.surf.scrollLeft;
        var w0 = L.tw * 0.55, h0 = L.th * 0.7;
        L.w = w0; L.h = h0; L.y = L.ty + (L.th - h0) / 2;
        L.x = clamp(px - w0 / 2, L.tx, L.tx + L.tw - w0);
      }
    }
  }

  function lensOff(L) {
    // 离开时等 0.15 秒再撤：手不会完全静止，擦边出去又回来时透镜不闪
    clearTimeout(L.offT);
    L.offT = setTimeout(function () {
      if (L.hover || L.focus) { return; }
      L.ta = 0; L.tp = 0; L.cur = null;
      animate(L);
    }, 150);
  }

  function lensStep(L, dt) {
    if (calm()) {                                    // 减少动态效果 / 「精简」：直接到位，不拉长、不回弹
      L.x = L.tx; L.y = L.ty; L.w = L.tw; L.h = L.th; L.a = L.ta; L.p = L.tp;
      L.vx = L.vy = L.vw = L.vh = L.va = L.vp = 0; L.still = true;
      return false;
    }
    step(L, 'x', 'vx', L.tx, SP.pos, dt); step(L, 'y', 'vy', L.ty, SP.pos, dt);
    step(L, 'w', 'vw', L.tw, SP.pos, dt); step(L, 'h', 'vh', L.th, SP.pos, dt);
    step(L, 'a', 'va', L.ta, SP.fade, dt); step(L, 'p', 'vp', L.tp, SP.press, dt);
    var off = Math.abs(L.x - L.tx) + Math.abs(L.y - L.ty) + Math.abs(L.w - L.tw) + Math.abs(L.h - L.th);
    var vel = Math.abs(L.vx) + Math.abs(L.vy) + Math.abs(L.vw) + Math.abs(L.vh);
    L.still = off < 0.5 && vel < 8;
    var done = L.still && Math.abs(L.a - L.ta) < 0.004 && Math.abs(L.va) < 0.03
      && Math.abs(L.p - L.tp) < 0.004 && Math.abs(L.vp) < 0.03;
    if (done) {
      L.x = L.tx; L.y = L.ty; L.w = L.tw; L.h = L.th; L.a = L.ta; L.p = L.tp;
      L.vx = L.vy = L.vw = L.vh = L.va = L.vp = 0;
    }
    return !done;
  }

  function lensPaint(L) {
    var el = L.el;
    if (!el) { return; }
    var a = clamp(L.a, 0, 1), p = clamp(L.p, -0.2, 1.2), under = L.cfg.under;
    // 水滴形变：沿运动方向拉长、垂直方向收窄（大致保面积），速度越快越明显。
    // 鼠标比手指收敛：纵向最多拉长 12%、横向 8%
    var sY = under ? 0 : Math.min(0.12, Math.abs(L.vy) / 3800), sX = under ? 0 : Math.min(0.08, Math.abs(L.vx) / 5200);
    var sx = (1 + sX) / (1 + 0.6 * sY), sy = (1 + sY) / (1 + 0.6 * sX);
    // 按下：横向鼓、纵向压，松手回弹像果冻。鼓多少按像素封顶（≤ 12px）：宽的项按比例鼓，一按就顶出面板。
    // 整行不鼓、往里收一点（≤ 8px × 3px）——行占满整张表，往外鼓就被表格裁掉、圆角也没了。
    // 松手的回弹也不许鼓：按压量会冲过头到负的（约 −0.06），照算的话整行透镜比行还大半个像素，最后一行就把滚动条顶出来
    var bw = Math.max(1, L.w), bh = Math.max(1, L.h);
    if (under) { sx *= 1 - Math.min(0.035, 8 / bw) * Math.max(0, p); sy *= 1 - Math.min(0.06, 3 / bh) * Math.max(0, p); }
    else { sx *= 1 + Math.min(0.06, 12 / bw) * p; sy *= 1 - 0.09 * p; }
    var s0 = under ? 1 : 0.86 + 0.14 * a;                 // 出现：从小一圈长出来
    var par = !under && mode === 'full';
    var ox = par ? (L.px - 0.5) * 4 * a : 0, oy = par ? (L.py - 0.5) * 2 * a : 0;   // 跟手视差（「精简」不跟）
    var at = keepIn(L.clip, L.x + ox, L.y + oy, Math.max(0, L.w), Math.max(0, L.h), sx * s0, sy * s0);
    // 撤完了：缩成 0 × 0 停在左上角。看不见的透镜也占着滚动范围——内容一变短，它就把滚动条撑出来
    if (!L.ta && a < 0.002) { at = [0, 0, 0, 0]; sx = sy = s0 = 1; }
    L.pw = at[2]; L.ph = at[3];
    el.style.width = liveWidth(L.clip, at[0], at[2], sx * s0);
    el.style.height = at[3].toFixed(2) + 'px';
    el.style.borderRadius = (L.rad != null ? L.rad : Math.min(at[2], at[3]) / 2).toFixed(2) + 'px';
    el.style.transform = 'translate3d(' + at[0].toFixed(2) + 'px,' + at[1].toFixed(2) + 'px,0) scale('
      + (sx * s0).toFixed(4) + ',' + (sy * s0).toFixed(4) + ')';
    el.style.setProperty('--a', a.toFixed(3));
    el.style.setProperty('--p', Math.max(0, p).toFixed(3));
    var settled = L.still && a > 0.98 && Math.abs(p) < 0.02;
    if (settled !== L.settled) {
      L.settled = settled;
      if (settled) { lensMap(L); el.setAttribute('data-settled', ''); } else { el.removeAttribute('data-settled'); }
    }
    // 透镜底下的项放大：按被盖住的比例；指针下的那一项再跟手挪一点
    for (var i = 0; i < L.items.length; i++) {
      var it = L.items[i];
      var ix = Math.max(0, Math.min(L.x + L.w, it.x + it.w) - Math.max(L.x, it.x)) / (it.w || 1);
      var iy = Math.max(0, Math.min(L.y + L.h, it.y + it.h) - Math.max(L.y, it.y)) / (it.h || 1);
      var m = Math.min(1, ix * iy) * a, cur = it.el === L.cur;
      // 按下那一项缩一点：同样按像素封顶（≤ 6px），宽项缩 3.5% 的话左边的字会跳好几个像素
      var sc = 1 + L.cfg.mag * m - (cur ? Math.min(0.035, 6 / (it.w || 1)) * Math.max(0, p) : 0);
      var tx = cur ? (L.px - 0.5) * 3 * m : 0, ty = cur ? (L.py - 0.5) * 1.5 * m : 0;
      var key = sc.toFixed(4) + '|' + tx.toFixed(2) + '|' + ty.toFixed(2);
      if (key === it.key) { continue; }
      it.key = key;
      it.el.style.transform = (m < 0.002 && Math.abs(sc - 1) < 0.0005) ? ''
        : 'translate3d(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px,0) scale(' + sc.toFixed(4) + ')';
      it.el.style.setProperty('--m', m.toFixed(3));
    }
  }

  /**
   * 透镜停稳时按它此刻的尺寸摆好折射，折射层再淡入。悬停透镜一动就在变形（水滴形、按下的果冻），
   * 而折射的元素绝不能缩放（一缩放，透过它的东西就被重采样得发糊），所以只在停稳、没有缩放的时候开。
   */
  function lensMap(L) {
    if (!L.ref || !refracting() || L.el.hasAttribute('data-onsel') || isolated(L.surf)) { return; }
    if (!L.F) { L.F = newFilter(0.06); L.ref.style.setProperty('--lg-ref', 'url(#' + L.F.id + ')'); }
    var w = Math.round(L.pw != null ? L.pw : L.w), h = Math.round(L.ph != null ? L.ph : L.h);   // 画出来的尺寸（可能被关进滚动范围时收过）
    if (w < 8 || h < 8) { return; }
    var r = L.rad != null ? Math.min(L.rad, h / 2) : h / 2, bez = Math.min(12, h * 0.32);
    setGeom(L.F, w, h, r, { bezel: bez, depth: bez * K, blur: Math.max(0.5, h * 0.02), disp: 0.06, scatter: 0.05 });
  }

  /** 透镜底下是不是指针（不是键盘）：整行的指尖光只在指针在的时候亮 */
  function pointerMark(L, on) {
    if (!L.el || on === L.el.hasAttribute('data-pointer')) { return; }
    if (on) { L.el.setAttribute('data-pointer', ''); } else { L.el.removeAttribute('data-pointer'); }
  }

  function lensPointer(L, ev) {
    if (!L.el || !L.ta) { return; }
    pointerMark(L, true);
    var sr = L.surf.getBoundingClientRect(), k = (sr.width / L.surf.offsetWidth) || 1;
    var cx = (ev.clientX - sr.left) / k - L.surf.clientLeft + L.surf.scrollLeft;
    var cy = (ev.clientY - sr.top) / k - L.surf.clientTop + L.surf.scrollTop;
    L.px = clamp((cx - L.x) / (L.w || 1), 0, 1);
    L.py = clamp((cy - L.y) / (L.h || 1), 0, 1);
    L.el.style.setProperty('--mx', (L.px * 100).toFixed(1) + '%');
    L.el.style.setProperty('--my', (L.py * 100).toFixed(1) + '%');
    animate(L);
  }

  function resetItems() {
    for (var i = 0; i < lenses.length; i++) {
      var L = lenses[i];
      for (var j = 0; j < L.items.length; j++) { L.items[j].el.style.transform = ''; L.items[j].el.style.removeProperty('--m'); }
      L.items = [];
    }
  }

  /** 「关闭」：透镜、滑块全撤，被放大的项复原，面板上的 data-lg-slider-on 去掉（让选中项画回自己的底色） */
  function teardown() {
    var i;
    tipHide();
    anims = [];
    if (rafId) { win.cancelAnimationFrame(rafId); rafId = 0; }
    for (i = 0; i < lenses.length; i++) {
      var L = lenses[i];
      clearTimeout(L.offT);
      if (L.el && L.el.parentNode) { L.el.parentNode.removeChild(L.el); }
      L.el = null; L.items = []; L.cur = null; L.hover = L.focus = false;
      L.a = L.ta = L.va = 0; L.p = L.tp = L.vp = 0; L.settled = false;
    }
    var th = doc.querySelectorAll('[data-lg-slider-on]');
    for (i = 0; i < th.length; i++) {
      var T = th[i].__lgT;
      if (T) {
        if (T.el && T.el.parentNode) { T.el.parentNode.removeChild(T.el); }
        T.el = null; T.cur = null; T.a = T.ta = T.va = 0;
        if (T.drag) { T.drag.moved = false; dragStop(T); }
        dropLift(T); segNear(T, null); segInkOff(T);
        T.up = T.tup = T.vup = 0; T.st = T.vst = 0; T.fly = false; T.S = null; segStretch(T);
        if (th[i].hasAttribute('data-lg-fly')) { th[i].removeAttribute('data-lg-fly'); }
        if (th[i].hasAttribute('data-lg-ink')) { th[i].removeAttribute('data-lg-ink'); }
      }
      th[i].removeAttribute('data-lg-slider-on');
    }
  }

  /** 页面变了（组收起、面板重画）：亮着的透镜跟过去；它罩着的那项没了就撤 */
  function syncLenses() {
    for (var i = lenses.length - 1; i >= 0; i--) {
      var L = lenses[i];
      if (!doc.body.contains(L.surf)) {
        if (L.F) { dropFilter(L.F); }
        if (ro) { ro.unobserve(L.surf); }
        L.surf.__lgL = null; lenses.splice(i, 1); continue;
      }
      if (L.el && L.clip) { L.clip = scrollBox(L.surf); L.paint(); }   // 内容变了：按新的范围再关一次（淡出中的也算）
      if (!L.ta || !L.cur) { continue; }
      if (!L.el || L.el.parentNode !== L.surf || !L.surf.contains(L.cur) || !visible(L.cur)) {
        L.hover = L.focus = false; L.ta = 0; L.cur = null; animate(L);
        continue;
      }
      var r = relRect(L.surf, L.cur), pad = L.cfg.pad || 0;
      if (Math.abs(r.x - pad - L.tx) + Math.abs(r.y - pad - L.ty) + Math.abs(r.w + 2 * pad - L.tw) + Math.abs(r.h + 2 * pad - L.th) > 0.5
          || L.el.hasAttribute('data-onsel') !== isOn(L.cur)) {
        measureItems(L); retarget(L, null); animate(L);
      }
    }
  }

  /* ══ 5 液态滑块 ═════════════════════════════════════════════════════════
   *
   * 选中项底下的那块。换选中时左右（上下）两条边分开走：前沿用快弹簧先到，后沿用慢弹簧后到，
   * 中途被拉长，落定时回弹——这就是「液态」。换色（蓝→红）是两层叠着交叉淡入。
   * 滑块的状态存在面板元素上（__lgT），面板里的内容被 innerHTML 整片重画后，新建的滑块从原来的位置接着滑。
   */
  function newThumb(surf, cfg) {
    ensurePositioned(surf);
    var T = {
      surf: surf, cfg: cfg, el: null, cur: null, resized: false, painted: '',
      l: 0, r: 0, t: 0, b: 0, vl: 0, vr: 0, vt: 0, vb: 0, gl: 0, gr: 0, gt: 0, gb: 0,
      cl: SP.same, cr: SP.same, ct: SP.same, cb: SP.same, a: 0, va: 0, ta: 0, rad: null, w0: 0,
      // 分段开关才用（§5.5）：浮起 up、浮着飞 fly、整条被拉长 / 压扁 st（钉住 pin 那一端）、拖动 drag、浮起的透镜 lz
      up: 0, vup: 0, tup: 0, fly: false, st: 0, vst: 0, pin: 'left', stKey: '', drag: null, lz: null, near: null, pad: 0, userAt: 0,
      pend: null,  // 松手后替用户选的那一项，等页面接手（{ el, until }）
      S: null, clip: null,  // 浮着飞时各项的位置（字的选中色跟着玻璃走）；滚动容器的内容范围
      zS: null, zOld: false, mag: 0   // 玻璃底下的字：各项的位置（浮起时量一次，排版变了重量）、放大多少（--lg-seg-mag）
    };
    T.step = function (dt) { return thumbStep(T, dt); };
    T.paint = function () { thumbPaint(T); };
    return T;
  }

  /**
   * 分段开关：按钮宽度按粗体留——字写进 data-lg-label，样式表在 ::after 里放一份隐形的粗体撑宽，
   * 选中变粗时不再把旁边的项挤开（拖动时「最近的那一项」也会变粗）。按钮里有图标之类的元素就不动它的排版。
   * 顺带量轨道的内边距：浮起的透镜按「一行」（滑块高 + 上下内边距）的高度算。
   */
  function segPrep(T, list) {
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.children.length) { continue; }
      var txt = (b.textContent || '').replace(/\s+/g, ' ').replace(/^ | $/g, '');
      if (txt && b.getAttribute('data-lg-label') !== txt) { b.setAttribute('data-lg-label', txt); }
    }
    T.pad = parseFloat(win.getComputedStyle(T.surf).paddingTop) || 0;
  }

  function syncThumb(surf, cfg) {
    var T = surf.__lgT;
    if (!T || T.cfg.kind !== cfg.kind) {
      if (T && T.el && T.el.parentNode) { T.el.parentNode.removeChild(T.el); }
      if (T) { dropLift(T); }
      T = surf.__lgT = newThumb(surf, cfg);
      if (ro) { ro.observe(surf); }
    }
    T.cfg = cfg;
    if (!T.el || T.el.parentNode !== surf) {
      T.el = doc.createElement('span');
      T.el.className = 'lg-thumb lg-thumb-' + cfg.kind;
      T.el.setAttribute('aria-hidden', 'true');
      surf.appendChild(T.el);
      T.painted = '';
      thumbPaint(T);
    }
    if (surf.getAttribute('data-lg-slider-on') !== cfg.kind) { surf.setAttribute('data-lg-slider-on', cfg.kind); }
    var list = surf.querySelectorAll(cfg.items), cur = null, i;
    if (cfg.kind === 'seg') { segPrep(T, list); }
    for (i = 0; i < list.length; i++) { if (isOn(list[i]) && visible(list[i])) { cur = list[i]; break; } }
    var jump = T.a < 0.05 || calm() || (T.resized && surf.offsetWidth !== T.w0);
    T.resized = false; T.w0 = surf.offsetWidth;
    var clip = scrollBox(surf);
    if (!clip !== !T.clip || (clip && (clip.w !== T.clip.w || clip.h !== T.clip.h))) { T.clip = clip; thumbPaint(T); }   // 范围变了（滚动条进出）：当场按新的关一次
    if (T.zS) { T.zOld = true; animate(T); }         // 排版可能变了：玻璃底下的字下一帧重新量（不先复原，免得闪一帧）
    if (T.drag) {                                    // 按着的时候滑块听手指的；整片重画了就作废，按页面现在的选中落定
      for (i = 0; i < T.drag.S.length; i++) { if (!surf.contains(T.drag.S[i].el)) { dragStop(T); break; } }
      if (T.drag) { return; }
    }
    // 松手后滑块已经先到了用户选的那一项；页面还没改过来（异步处理）的这一小会儿别把它拽回去，过了时限再按页面的来
    if (T.pend) {
      if (cur === T.pend.el || Date.now() > T.pend.until || !surf.contains(T.pend.el)) { T.pend = null; animate(T); } else { return; }
    }
    if (!cur) {
      T.cur = null;
      if (T.ta !== 0) { T.ta = 0; animate(T); }
      return;
    }
    var r = relRect(surf, cur), gl = r.x, gr = r.x + r.w, gt = r.y, gb = r.y + r.h;
    var ir = parseFloat(win.getComputedStyle(cur).borderTopLeftRadius) || 0;
    T.rad = ir * 2 >= r.h - 1 ? null : ir;
    var danger = cur.matches(DANGER_SEL);
    if (danger !== T.el.hasAttribute('data-danger')) {
      if (danger) { T.el.setAttribute('data-danger', ''); } else { T.el.removeAttribute('data-danger'); }
    }
    if (T.cur === cur && T.ta === 1 && Math.abs(gl - T.gl) + Math.abs(gr - T.gr) + Math.abs(gt - T.gt) + Math.abs(gb - T.gb) < 0.5) { return; }
    // 用户自己点 / 按键换的（不是页面从外面改的）：分段开关的滑块浮着飞过去，到了再落下
    if (cfg.kind === 'seg' && T.cur && cur !== T.cur && !jump && !T.drag && liftOn() && Date.now() - T.userAt < 700) {
      ensureLift(T); T.tup = 1; T.fly = true; T.S = segStops(T); quietLens(T.surf);
    }
    // 往哪边走，哪边就是前沿
    T.cl = gl < T.gl ? SP.lead : gl > T.gl ? SP.lag : SP.same;
    T.cr = gr > T.gr ? SP.lead : gr < T.gr ? SP.lag : SP.same;
    T.ct = gt < T.gt ? SP.lead : gt > T.gt ? SP.lag : SP.same;
    T.cb = gb > T.gb ? SP.lead : gb < T.gb ? SP.lag : SP.same;
    if (T.fly) { T.cl = T.cr = SP.fly; }            // 浮着飞的是一整块玻璃：两条边一起走，不拉长
    T.gl = gl; T.gr = gr; T.gt = gt; T.gb = gb;
    T.cur = cur; T.ta = 1;
    if (jump) { T.l = gl; T.r = gr; T.t = gt; T.b = gb; T.vl = T.vr = T.vt = T.vb = 0; }
    animate(T);
  }

  function thumbStep(T, dt) {
    var held = !!(T.drag && T.drag.moved);            // 拖着：目标由手指定，滑块用一根很快的弹簧追（SP.drag）
    if (calm()) {
      T.l = T.gl; T.r = T.gr; T.t = T.gt; T.b = T.gb;
      T.a = T.ta; T.vl = T.vr = T.vt = T.vb = T.va = 0;
      T.up = T.tup = T.vup = 0; T.st = T.vst = 0; T.fly = false;
      if (T.surf.hasAttribute('data-lg-fly')) { T.surf.removeAttribute('data-lg-fly'); segNear(T, null); }
      return false;
    }
    step(T, 'l', 'vl', T.gl, T.cl, dt); step(T, 'r', 'vr', T.gr, T.cr, dt);
    step(T, 't', 'vt', T.gt, T.ct, dt); step(T, 'b', 'vb', T.gb, T.cb, dt);
    step(T, 'a', 'va', T.ta, SP.fade, dt);
    var busy = Math.abs(T.a - T.ta) > 0.004 || Math.abs(T.va) > 0.03;
    if (T.cfg.kind === 'seg') {
      step(T, 'up', 'vup', T.tup, T.tup ? SP.up : SP.down, dt);
      if (!held) { step(T, 'st', 'vst', 0, SP.band, dt); }
      // 飞的路上，离玻璃最近的那一项先变成选中的样子：选中色跟着玻璃走，而不是一点就跳到终点
      if (T.fly && T.S && !(T.drag && T.drag.moved)) { segNear(T, nearest(T.S, (T.l + T.r) / 2).el); }
      // 浮着飞过去的：完全浮起来、而且中心到了才落下——相邻两项之间 0.2 秒就到，不等浮起的话透镜只闪一下
      if (T.fly && !T.drag && T.up > 0.9 && Math.abs(T.l + T.r - T.gl - T.gr) < 8) { T.fly = false; T.tup = 0; T.S = null; segNear(T, null); }
      if (!!T.fly !== T.surf.hasAttribute('data-lg-fly')) {
        if (T.fly) { T.surf.setAttribute('data-lg-fly', ''); } else { T.surf.removeAttribute('data-lg-fly'); }
      }
      var moving = T.fly || Math.abs(T.up - T.tup) > 0.005 || Math.abs(T.vup) > 0.05
        || (!held && (Math.abs(T.st) > 0.0002 || Math.abs(T.vst) > 0.003));
      if (!moving) { T.up = T.tup; T.vup = 0; if (!held) { T.st = T.vst = 0; } }
      busy = busy || moving;
    }
    if (held) {
      return busy || Math.abs(T.l - T.gl) + Math.abs(T.r - T.gr) > 0.3 || Math.abs(T.vl) + Math.abs(T.vr) > 6;
    }
    // 拉长有上限：跳得远时后沿不能拖成一整条，最多比落点那一项长出 44px（横向 56px），后沿被前沿拽着走
    var maxV = T.gb - T.gt + 44, maxH = T.gr - T.gl + 56;
    if (T.b - T.t > maxV) { if (T.ct === SP.lag) { T.t = T.b - maxV; } else if (T.cb === SP.lag) { T.b = T.t + maxV; } }
    if (T.r - T.l > maxH) { if (T.cl === SP.lag) { T.l = T.r - maxH; } else if (T.cr === SP.lag) { T.r = T.l + maxH; } }
    var off = Math.abs(T.l - T.gl) + Math.abs(T.r - T.gr) + Math.abs(T.t - T.gt) + Math.abs(T.b - T.gb);
    var vel = Math.abs(T.vl) + Math.abs(T.vr) + Math.abs(T.vt) + Math.abs(T.vb);
    var done = off < 0.3 && vel < 6 && !busy;
    if (done) { T.l = T.gl; T.r = T.gr; T.t = T.gt; T.b = T.gb; T.a = T.ta; T.vl = T.vr = T.vt = T.vb = T.va = 0; }
    return !done;
  }

  function thumbPaint(T) {
    if (!T.el) { return; }
    var a = clamp(T.a, 0, 1), w = Math.max(0, T.r - T.l), h = Math.max(0, T.b - T.t), s = 0.9 + 0.1 * a;
    var sx = s, sy = s, op = a;
    if (T.cfg.kind === 'seg') {
      var up = clamp(T.up, 0, 1.3), Z = T.lz && T.lz.el.parentNode === T.surf ? T.lz : null, L = null;
      if (Z && (up > 0.01 || T.tup) && w > 0 && h > 0) {
        // 有透镜：平胶囊一边放大到透镜的大小一边化开，同一时刻透镜的边从平胶囊的大小长出来——看上去是同一块玻璃浮起来
        L = liftRect(T);
        sx *= 1 + (L.w / w - 1) * up; sy *= 1 + (L.h / h - 1) * up;
        op *= Math.max(0, 1 - up * 2.5);             // 化得快一点：飞的时候平胶囊被液态拉长，留着就是两层
      } else {
        sx *= 1 + 0.05 * up; sy *= 1 + 0.1 * up;     // 不能折射：滑块自己放大一点，就是「按住了」
      }
      segStretch(T);
      liftPaint(T, Z, L, w, h, up);
      segInk(T, up);
    }
    var rad = T.rad != null ? T.rad : h / 2;
    var at = keepIn(T.clip, T.l, T.t, w, h, sx, sy);      // 滚动容器里（侧栏菜单、命令面板列表）：回弹不许把滚动尺寸撑大
    w = at[2]; h = at[3];
    var key = at[0].toFixed(2) + '|' + at[1].toFixed(2) + '|' + w.toFixed(2) + '|' + h.toFixed(2) + '|' + op.toFixed(3) + '|'
      + sx.toFixed(4) + '|' + sy.toFixed(4) + '|' + rad;
    if (key === T.painted) { return; }
    T.painted = key;
    T.el.style.width = liveWidth(T.clip, at[0], w, sx);
    T.el.style.height = h.toFixed(2) + 'px';
    T.el.style.borderRadius = Math.min(rad, h / 2, w / 2).toFixed(2) + 'px';
    T.el.style.transform = 'translate3d(' + at[0].toFixed(2) + 'px,' + at[1].toFixed(2) + 'px,0) scale(' + sx.toFixed(4) + ',' + sy.toFixed(4) + ')';
    T.el.style.opacity = op.toFixed(3);
  }

  function syncThumbs() {
    var i, j, list, el, done = [];
    list = doc.querySelectorAll('[data-lg-slider]');
    for (j = 0; j < list.length; j++) {
      el = list[j];
      var kind = el.getAttribute('data-lg-kind') || 'seg', items = el.getAttribute('data-lg-slider') || '.lg-item';
      if (!el.__lgS || el.__lgS.kind !== kind || el.__lgS.items !== items) { el.__lgS = { kind: kind, items: items }; }
      syncThumb(el, el.__lgS);
      done.push(el);
    }
    for (i = 0; i < SLIDER.length; i++) {
      list = doc.querySelectorAll(SLIDER[i].sel);
      for (j = 0; j < list.length; j++) { if (done.indexOf(list[j]) < 0) { syncThumb(list[j], SLIDER[i]); } }
    }
  }

  /* ══ 5.5 分段开关：按住浮起、拖、橡皮筋、甩 ═════════════════════════════
   *
   * 照 iOS 26 的标签栏：
   *   · 按住任意一项，滑块浮起成一块清玻璃透镜（比这一行高两成、比项左右各宽 7px），盖在字上面，
   *     边上把底下的字放大、弯折；按的不是选中项的话，它浮着飞到手指下面。松手落回去。浮起带一点回弹，落下不回弹。
   *   · 按住拖：透镜跟着手指走，宽度在相邻两项之间过渡；离得最近的那一项先变成选中的样子。
   *     松手落到最近的一项；快速一甩（≥ 0.6 px/ms）往甩的方向再走一格（最多一格）。
   *   · 拖过两端：整条像橡皮筋被拉长，越拉越费劲，最多拉长轨道宽的 5%（≤ 18px）；松手弹回、略压扁一下再停。
   *     大力一甩，整条朝甩的方向形变（≤ 3.5%）再回弹。钉住的是另一端，所以是朝手指那边变形。
   *   · 点别的项（或用键盘换选中）：滑块浮着、整块飞过去（两条边同一根弹簧，不拉长），完全浮起来而且到了才落下。
   *     路上只有这一块玻璃：悬停透镜按下就撤；选中色跟着离玻璃最近的那一项走，终点等玻璃到了才亮。
   * 选中由页面决定：拖完松手，脚本替用户「点」一下落到的那一项（element.click()），页面照常处理；
   * 紧跟在拖动后面、浏览器自己补的那一下 click 被吞掉，不然它会把选中又点回原处。
   * 透镜只平移、绝不缩放（缩放会把透过它的东西重采样得发糊）；尺寸跟着项宽变，只挪九宫格。
   * 「精简」与「减少动态效果」：照样能拖，但不浮起、不拉长、不回弹；「关闭」没有滑块，也就不能拖。
   */
  var FLICK = 0.6, dragT = null, eatClick = null;
  // 甩出去时给橡皮筋的初速度：阻尼比 0.5 的弹簧，从 0 出发、初速 v0，最远到 0.546·v0/ω
  var BAND_KICK = 2 * Math.PI / 0.5 / 0.546;

  function liftOn() { return mode === 'full' && !still; }

  /**
   * 浮起来的那块透镜（追加在分段开关末尾，z 3，盖在字上面）。能折射才要它（Chromium、「完整」、和页面之间没有背景根）；
   * 不能折射时不要——一块不折射的清玻璃只是一个空框，这时滑块自己放大一点就是「按住了」。
   */
  function ensureLift(T) {
    var Z = T.lz;
    if (!refracting() || isolated(T.surf)) { dropLift(T); return null; }
    if (Z && Z.el.parentNode === T.surf) { return Z; }
    dropLift(T);
    var el = doc.createElement('span'), ref = doc.createElement('span'), rim = doc.createElement('span');
    el.className = 'lg-lift'; ref.className = 'lg-lift-ref'; rim.className = 'lg-lift-rim';
    el.setAttribute('aria-hidden', 'true');
    el.appendChild(ref); el.appendChild(rim);
    T.surf.appendChild(el);
    var F = newFilter(0.1);
    ref.style.setProperty('--lg-ref', 'url(#' + F.id + ')');
    return (T.lz = { el: el, ref: ref, rim: rim, F: F, key: '' });
  }
  function dropLift(T) {
    var Z = T.lz;
    if (!Z) { return; }
    if (Z.el.parentNode) { Z.el.parentNode.removeChild(Z.el); }
    dropFilter(Z.F);
    T.lz = null;
  }

  /**
   * 透镜摆在哪、多大：中心永远是滑块中心（字在正中）；比这一行高两成，伸出上下沿；比项左右各宽 7px。
   * 停在两端时两边对称收窄、不伸出轨道（整块往里挪的话字就不在正中了）。
   * 拖着的时候宽度跟着手指下的滑块走；飞的时候是终点那一项的宽度——飞行中只平移、不变形。
   */
  function liftRect(T) {
    var cx = (T.l + T.r) / 2, cy = (T.t + T.b) / 2;
    var base = T.drag && T.drag.moved ? T.r - T.l : T.gr - T.gl;
    var H = Math.round((T.gb - T.gt + 2 * T.pad) * 1.2), room = 2 * Math.min(cx, T.w0 - cx);
    var W = Math.round(Math.max(base, Math.min(Math.max(H, base + 14), room)));
    return { x: cx - W / 2, y: cy - H / 2, w: W, h: H };
  }

  function liftPaint(T, Z, L, w, h, up) {
    if (!Z) { return; }
    if (!L) { if (Z.el.hasAttribute('data-up')) { Z.el.removeAttribute('data-up'); Z.key = ''; } return; }
    if (!Z.el.hasAttribute('data-up')) { Z.el.setAttribute('data-up', ''); }
    var key = L.x.toFixed(2) + '|' + L.y.toFixed(2) + '|' + L.w + '|' + L.h + '|' + up.toFixed(3) + '|' + w.toFixed(1) + '|' + h.toFixed(1);
    if (key === Z.key) { return; }
    Z.key = key;
    Z.el.style.width = L.w + 'px';
    Z.el.style.height = L.h + 'px';
    Z.el.style.transform = 'translate3d(' + L.x.toFixed(2) + 'px,' + L.y.toFixed(2) + 'px,0)';
    // 透镜：斜面占半高的六成，正中约四成高原样透出；色散比面板略重（字就在它底下）
    var bez = 0.3 * L.h;
    setGeom(Z.F, L.w, L.h, L.h / 2, { bezel: bez, depth: bez * K, blur: Math.max(0.5, L.h * 0.024), disp: 0.1, scatter: 0.06 });
    Z.ref.style.opacity = clamp((up - 0.15) / 0.6, 0, 1).toFixed(3);
    // 边：从平胶囊的大小长到透镜的大小（浮起的回弹让它略大一点再收回），很快淡入
    var rx = w / L.w + (1 - w / L.w) * up, ry = h / L.h + (1 - h / L.h) * up;
    Z.rim.style.transform = 'scale(' + rx.toFixed(4) + ',' + ry.toFixed(4) + ')';
    Z.rim.style.opacity = clamp(up * 2, 0, 1).toFixed(3);
  }

  /** 拖过两端整条被拉长（st > 0）、弹回时略压扁（st < 0）：钉住 pin 那一端；横向拉长时竖向收一点，看着是同一团东西被拉长 */
  function segStretch(T) {
    var st = Math.abs(T.st) < 0.0002 ? 0 : T.st, key = st ? st.toFixed(4) + T.pin : '';
    if (key === T.stKey) { return; }
    T.stKey = key;
    var s = T.surf.style;
    if (!st) { s.transform = ''; s.transformOrigin = ''; return; }
    s.transform = 'scale(' + (1 + st).toFixed(4) + ',' + (1 - st * 0.35).toFixed(4) + ')';
    s.transformOrigin = T.pin === 'right' ? '100% 50%' : '0 50%';
  }

  /** 指针下的分段开关，和指针在哪一项上 */
  function segAt(node) {
    var el = node && node.nodeType === 1 ? node : node && node.parentElement;
    for (var a = el; a && a !== doc.body; a = a.parentElement) {
      var T = a.__lgT;
      if (T && T.el && T.cfg.kind === 'seg' && a.getAttribute('data-lg-slider-on') === 'seg') {
        var it = el.closest(T.cfg.items);
        return it && it !== a && a.contains(it) ? { T: T, item: it } : null;
      }
    }
    return null;
  }

  /** 能停的位置（各项的位置与宽度）。折成多行的不拖：横着拖没法跨行 */
  function segStops(T) {
    var list = T.surf.querySelectorAll(T.cfg.items), out = [], i;
    for (i = 0; i < list.length; i++) {
      if (!visible(list[i])) { continue; }
      var r = relRect(T.surf, list[i]);
      if (out.length && Math.abs(r.y - out[0].y) > 2) { return null; }
      r.el = list[i];
      out.push(r);
    }
    return out.length > 1 ? out : null;
  }

  /** 手指拖到 c 时滑块的左边和宽度：宽度在相邻两项之间按位置过渡；两端钉住 */
  function dragThumb(S, c) {
    var last = S[S.length - 1], i = 1;
    c = clamp(c, S[0].x + S[0].w / 2, last.x + last.w / 2);
    while (i < S.length - 1 && S[i].x + S[i].w / 2 < c) { i++; }
    var A = S[i - 1], B = S[i], ca = A.x + A.w / 2, cb = B.x + B.w / 2;
    var w = A.w + (B.w - A.w) * (cb > ca ? clamp((c - ca) / (cb - ca), 0, 1) : 0);
    return { l: clamp(c - w / 2, S[0].x, last.x + last.w - w), w: w };
  }
  function nearest(S, x) {
    var best = S[0];
    for (var i = 1; i < S.length; i++) { if (Math.abs(S[i].x + S[i].w / 2 - x) < Math.abs(best.x + best.w / 2 - x)) { best = S[i]; } }
    return best;
  }
  /** 松手落到哪一项：慢慢拖到哪就是哪（松手那一下带的一点速度不算）；快速一甩往甩的方向最多再走一格 */
  function snapStop(S, c, v) {
    var here = nearest(S, c);
    if (Math.abs(v) < FLICK) { return here; }
    var from = S.indexOf(here), to = S.indexOf(nearest(S, c + clamp(v * 110, -90, 90)));
    return S[from + clamp(to - from, -1, 1)] || here;
  }
  /** 手指拖过第一项 / 最后一项的中心多远（带方向），换成整条被拉长多少像素：越拉越费劲，永远到不了 max */
  function rubber(S, c, max) {
    var lo = S[0].x + S[0].w / 2, hi = S[S.length - 1].x + S[S.length - 1].w / 2;
    var over = c < lo ? c - lo : c > hi ? c - hi : 0;
    if (!over || max <= 0) { return 0; }
    return (over < 0 ? -1 : 1) * max * (1 - 1 / (Math.abs(over) / max * 0.55 + 1));
  }
  function segNear(T, el) {
    if (T.near === el) { return; }
    if (T.near) { T.near.removeAttribute('data-lg-near'); }
    T.near = el;
    if (el) { el.setAttribute('data-lg-near', ''); }
  }

  /**
   * 玻璃底下的字（照 iOS 26 的标签栏）：被玻璃盖住多少，就放大多少、变粗多少、换成选中色多少。
   * 盖住的比例按滑块此刻的两条边和每一项的位置算——和玻璃的移动是同一个连续量：飞过两项之间时，
   * 一枚字一边缩回、一边褪色，另一枚一边放大、一边上色，不是到了中点「啪」地换一枚。
   * 放大 = 盖住的比例 × 浮起的程度：只有浮起的透镜才放大（落下时字跟着玻璃一起缩回）；颜色、粗细只看盖住多少。
   * 放大写在独立的 scale 属性上，不碰 transform（悬停透镜的放大写在那里）；颜色和粗细由样式表按 --lg-z 算，
   * 这样「精简」档拖动时（不浮起）字照样跟着滑块换色。
   */
  function segInk(T, up) {
    var on = segInkMode(T);
    if (!on && up < 0.002) { if (T.zS) { segInkOff(T); } return; }
    if (!T.zS || T.zOld) {
      var old = T.zS || [], S = segStops(T) || [], els = [], j;
      T.zS = S; T.zOld = false;
      for (j = 0; j < S.length; j++) { els.push(S[j].el); }
      // 重量以后不在了的项（页面整片重画过）：复原
      for (j = 0; j < old.length; j++) {
        if (els.indexOf(old[j].el) < 0) { old[j].el.style.scale = ''; old[j].el.style.removeProperty('--lg-z'); }
      }
      T.mag = clamp(parseFloat(win.getComputedStyle(T.surf).getPropertyValue('--lg-seg-mag')) || 0, 0, 0.4);
    }
    var u = clamp(up, 0, 1.3);
    for (var i = 0; i < T.zS.length; i++) {
      var it = T.zS[i];
      var z = clamp((Math.min(T.r, it.x + it.w) - Math.max(T.l, it.x)) / (it.w || 1), 0, 1);
      var sc = 1 + T.mag * z * u, key = z.toFixed(3) + '|' + sc.toFixed(4);
      if (key === it.key) { continue; }
      it.key = key;
      it.el.style.setProperty('--lg-z', z.toFixed(3));
      it.el.style.scale = sc > 1.0005 ? sc.toFixed(4) : '';
    }
  }
  /**
   * 字的选中样子跟着玻璃走（surf 上的 data-lg-ink）：拖着、浮着飞，以及松手后页面还没把选中改过来的那一小会儿。
   * 最后这一段不能漏：玻璃已经落定、页面的 click 还没处理完的那一两帧里，样式表会按页面的旧选中画——
   * 原来那一项一下变粗变色、玻璃底下那一项反而变回普通，闪一下。
   */
  function segInkMode(T) {
    var on = !!(T.drag && T.drag.moved) || !!T.fly || !!(T.pend && T.pend.el === T.cur && !isOn(T.cur));
    if (on !== T.surf.hasAttribute('data-lg-ink')) {
      if (on) { T.surf.setAttribute('data-lg-ink', ''); } else { T.surf.removeAttribute('data-lg-ink'); }
    }
    return on;
  }
  function segInkOff(T) {
    var S = T.zS;
    T.zS = null;
    if (!S) { return; }
    for (var i = 0; i < S.length; i++) { S[i].el.style.scale = ''; S[i].el.style.removeProperty('--lg-z'); }
  }

  /** 拖动收场：撤掉拖动状态与指针捕获 */
  function dragStop(T) {
    var D = T.drag;
    if (dragT === T) { dragT = null; }
    T.drag = null;
    if (!D) { return; }
    if (T.surf.hasAttribute('data-lg-drag')) { T.surf.removeAttribute('data-lg-drag'); }
    try { if (T.surf.hasPointerCapture && T.surf.hasPointerCapture(D.id)) { T.surf.releasePointerCapture(D.id); } } catch (e) {}
    if (!D.moved && !T.fly) { T.tup = 0; }          // 只按了一下选中项：落回去。按的是别的项：浮着飞到了再落
    animate(T);
  }

  /* ══ 6 HDR 高光 ═════════════════════════════════════════════════════════
   *
   * 一张 96×12 的 16 位 PNG，带 cICP 块（BT.2020 原色 + PQ 传递函数），像素值编码成「参考白 203 尼特的 3 倍」。
   * HDR 屏上它比页面上最白的白还亮，像玻璃上沿真的反了一道光；普通屏上浏览器把它压成白色。
   * 只在 l3（HDR 屏 + Chromium + 完整）插进去；样式表里再用 (dynamic-range: high) 把一次关。
   * 这张图由 scripts/hdr_png.py 生成。
   */
  var HDR_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAAAMEAYAAADNPmRaAAAABGNJQ1AJEAABTSMj/gAABVRJREFUeNrtmumLVmUYh99x9HWaGRlnxi1n3KZxy5Qyl8hsctfU0Tb8oKEYYYa4VCRiYhmN0kYofWiTQiptV6koDLLILClNoSJsL5KwiCwiKoq4r+vAef6FOfjhQuac89z37/d7lvO+b2nfnv//lSpgJewOa2ED7AcHwWFwNBwPJ8OZsB0ugkvhDXAt3AC3wLvhdvgI3AWfhfvh6/AgfA8ehR/Dk/AbeAr+DM/AP+DfwYoS7ArRqaIa9oB1sB42wl4JeydM/96YPKcuGac6qaNrvk7rzvo4k/R5KtHhZKLT0UTHg4nO+xMfdiU+bU983JL4vDbJwdIkJ+1JjiYnORud5HBQktOGJMfdk5xnQpVhK1wIO+A7CFsDKbBiN0ToLlfDF4OVDFx5I3w/2HUUvBeeDnabD58Plrm/zP3ld4PdW+BGeDxYNRwicBXGndUHLoNPwx+D1dRTvQI+AQlCTRWcAHlODfrUoEPNIfgl/D1Yi761BLq2CQ5O2JRcV84/J3vuoWTcjqSuCfm67SPra0W+b3XIdFmW100dM12H53XPfGjJ+5T5Vpv3VZ/1PcvBqHxOstzU5nNlzsxdlsNF+Zya2yzHC5Ocl50ACF5aDRG84jEGZGZWTqRQDOvGTCs3IwANVE3NC1nNzK/Zg7EI14MG6pjBPRcE69cHGx4NNr4R7PVZsPevwb6seP16Bs9mJe3PzG9ixjf9Fmz+NDhgX3AgdQ2aFRzcBfL3IQg65Jdgyyb4b/CcmyErZyv6tCJ462H4T3DoUNgG5yVsy1/nfdlzOvLjOK51WJd1Wrd92Jd92rc6qIs6qZs6qqs6q7s+6Is+6Zs+6qs+67s5MBfmxNyYI3NlzsydOTSX5tTcmmNzneW80QkwEv7AjWwRldfx4D8ZkIaqnqLAFyicrbIOoeqZaY1c14eVqN86hPwKwa/AiLcw7gIMpuDh1DFyeXDUq8ExGHj+lODYm4LjHgxOYEW46JngxQ8HL8GASy8LtmHwlB3BaazA01mRZnwfnIVRs9mS51wbvPzK4Fy24rk/Beex9c/HoPn3wC+C7ays7WMT9slfl93XnH+u4ziudViXdVq3fdiXfdq3OqiLOqmbOqqrOqu7PuiLPumbPuqrPuu7OTAX5sTcmCNzZc7MnTk0l+bU3Jpjc23OSyNL+TNWBQJXbmZmfcuDn2RmvkIBFNbwAIXOoAHOYAP70uiI4DBWuHNZmcYg0Fhm5MRxwUmcCdsYb9oxjOTMOpcVcQGNXfV1cNHe4GK29qUYsfz24PUEaiXGr+IMuea84DpWoFsQcD1b/Abu34jAm14Kbt4avAMjt7C13/lX8K7+wQ7O6B1HglsXwwPwdMID+eu8z+f4XMdxXOuwLuu0bvuwL/u0b3VQF3VSN3VUV3VWd33QF33SN33UV33Wd3NgLsyJuTFH5sqcmTtzaC7Nqbk1x+banJdmlvJbQhdmXrc1bD0I1oOZ3sDZsi9bS/PnFPh4cMROGsG48QNo+L7gVF7mZvOytICXmms+CS5ZheC8tK1ka1/DlnorO9VtSwgAdW/j//dzBt3BCvAQW+VODNuF8LunB5/jTL2Xo8fLrBSvzQkewMA3WWHfRodDrLCHvwseuTD4waTghwThGDp+xEp6nLPyCXQ4sSRhff467/M5PtdxHNc6rMs6rds+7Ms+7Vsd1EWd1E0d1VWdtyU+6Is+6Zs+6qs+67s5MBfmxNyYI3NlzsydOTSX5tTcmmNzbc5Lq4sJUEyAYgIUR6DiCNTZj0DFS3DxEtypX4KLj0GLj0E79cegxRdhxRdhnfqLsOKnEMVPITrlTyH+AyTBKezZdmD6AAAAAElFTkSuQmCC';
  var SPOTS = { top: [14, 44, 0, 1], bottom: [58, 30, -1, 0.45] };

  function hdrSpots(host) {
    var v = host.getAttribute('data-lg-hdr'), s = null, i;
    if (v === null) {
      for (i = 0; i < HDR.length; i++) { if (host.matches(HDR[i].sel)) { s = HDR[i].spots; break; } }
    } else { s = v || 'top'; }
    var out = [], parts = String(s || '').split(/\s+/);
    for (i = 0; i < parts.length; i++) { if (SPOTS[parts[i]]) { out.push(SPOTS[parts[i]]); } }
    return out;
  }

  function syncHdr() {
    var on = tier === 'l3', i, j, k, sel = '[data-lg-hdr]';
    for (i = 0; i < HDR.length; i++) { sel += ', ' + HDR[i].sel; }
    var list = doc.querySelectorAll(sel);
    for (j = 0; j < list.length; j++) {
      var host = list[j], have = [], c = host.children;
      for (k = 0; k < c.length; k++) { if (c[k].className === 'lg-hdr') { have.push(c[k]); } }
      if (!on) { for (k = 0; k < have.length; k++) { host.removeChild(have[k]); } continue; }
      if (have.length) { continue; }
      var spots = hdrSpots(host);
      for (k = 0; k < spots.length; k++) {
        var s = spots[k], im = doc.createElement('img');
        im.className = 'lg-hdr'; im.alt = ''; im.setAttribute('aria-hidden', 'true'); im.src = HDR_PNG;
        im.style.left = s[0] + '%'; im.style.width = s[1] + '%'; im.style.opacity = String(s[3]);
        if (s[2] < 0) { im.style.top = 'auto'; im.style.bottom = '0'; im.style.transform = 'scaleY(-1)'; }
        host.appendChild(im);
      }
    }
  }

  /* ══ 7 玻璃提示 ═════════════════════════════════════════════════════════
   *
   * title 在悬停时暂时收起来，换成玻璃气泡；离开时原样放回（读屏仍读得到）。
   * 一项上看得见的字已经是 title 的内容（而且没被省略号截断）时不重复提示，浏览器的小黄框也一并压住——
   * 展开的侧栏里菜单项就是这样；折叠成图标轨时字藏起来了，才提示。
   */
  var tipEl = null, tipFor = null, tipTimer = 0;

  function redundant(t, text) {
    var vis = (t.innerText || '').replace(/\s+/g, ' ');
    if (vis.indexOf(text.replace(/\s+/g, ' ')) < 0) { return false; }
    var c = [t].concat(Array.prototype.slice.call(t.children));
    for (var i = 0; i < c.length; i++) { if (c[i].scrollWidth > c[i].clientWidth + 1) { return false; } }
    return true;
  }

  function tipTarget(node) {
    var el = node && node.nodeType === 1 ? node : node && node.parentElement;
    return el ? el.closest(TIP_ALT) : null;
  }
  function tipShow(t) {
    var text = t.getAttribute('title') || t.getAttribute('data-lg-title');
    if (!text || mode === 'off') { return; }
    if (t.hasAttribute('title')) { t.setAttribute('data-lg-title', text); t.removeAttribute('title'); }
    tipFor = t;
    clearTimeout(tipTimer);
    if (redundant(t, text)) { return; }             // 看得见的字就是提示内容：不弹气泡，也不让浏览器弹小黄框
    tipTimer = setTimeout(function () {
      if (tipFor !== t || !visible(t)) { return; }
      if (!tipEl) {
        tipEl = doc.createElement('div');
        tipEl.className = 'lg-glass lg-tip';
        tipEl.setAttribute('role', 'tooltip');
        doc.body.appendChild(tipEl);
      }
      tipEl.textContent = t.getAttribute('data-lg-title') || '';
      tipEl.hidden = false;
      tipEl.removeAttribute('data-side');
      var r = t.getBoundingClientRect(), side = t.closest('.lg-sidebar, [data-lg-tip="right"]');
      var w = tipEl.offsetWidth, h = tipEl.offsetHeight, x, y;
      if (side) {
        var sr = side.getBoundingClientRect();
        x = sr.right + 10; y = r.top + r.height / 2 - h / 2;
        tipEl.setAttribute('data-side', 'right');
      } else {
        x = r.left + r.width / 2 - w / 2; y = r.bottom + 8;
      }
      tipEl.style.left = clamp(x, 8, win.innerWidth - w - 8) + 'px';
      tipEl.style.top = clamp(y, 8, win.innerHeight - h - 8) + 'px';
      tipEl.style.animation = 'none';
      void tipEl.offsetWidth;                         // 重新播放弹出动画
      tipEl.style.animation = '';
    }, 420);
  }
  function tipHide() {
    clearTimeout(tipTimer);
    if (tipEl) { tipEl.hidden = true; }
    var t = tipFor;
    tipFor = null;
    if (t && !t.hasAttribute('title') && t.getAttribute('data-lg-title')) { t.setAttribute('title', t.getAttribute('data-lg-title')); }
    if (t) { t.removeAttribute('data-lg-title'); }
  }

  /* ══ 8 事件：全挂在 document 上（面板的内容会整片重画，挂在元素上会丢） ═════ */

  var lastMove = null;

  doc.addEventListener('mouseover', function (ev) {
    var f = findItem(ev.target);
    if (f) { lensTo(f, ev); }
    var t = tipTarget(ev.target);
    if (t && t !== tipFor) { tipHide(); tipShow(t); }
  }, true);

  doc.addEventListener('mouseout', function (ev) {
    var to = ev.relatedTarget, i;
    for (i = 0; i < lenses.length; i++) {
      var L = lenses[i];
      if (!L.hover || !L.surf.contains(ev.target)) { continue; }
      if (to && to.nodeType === 1 && L.surf.contains(to)) { continue; }   // 还在这块面板里（包括项之间的缝）
      L.hover = false;
      lensOff(L);
    }
    if (tipFor && tipFor.contains(ev.target) && !(to && tipFor.contains(to))) { tipHide(); }
  }, true);

  doc.addEventListener('focusin', function (ev) {
    var f = findItem(ev.target);
    if (!f) { return; }
    var kb = true;
    try { kb = f.item.matches(':focus-visible'); } catch (e) {}
    if (kb) { lensTo(f, null); }                      // 鼠标点出来的焦点不触发（鼠标本来就在那儿）
    var t = tipTarget(ev.target);
    if (kb && t) { tipHide(); tipShow(t); }
  });
  doc.addEventListener('focusout', function (ev) {
    var to = ev.relatedTarget;
    for (var i = 0; i < lenses.length; i++) {
      var L = lenses[i];
      if (!L.focus || !L.surf.contains(ev.target)) { continue; }
      if (to && L.surf.contains(to)) { continue; }
      L.focus = false;
      if (!L.hover) { lensOff(L); }
    }
    if (tipFor && tipFor === ev.target) { tipHide(); }
  });

  doc.addEventListener('mousedown', function (ev) {
    tipHide();
    if (mode !== 'full') { return; }                 // 按下的果冻形变只在「完整」里做
    for (var i = 0; i < lenses.length; i++) {
      var L = lenses[i];
      if (L.ta && L.hover && L.surf.contains(ev.target)) { L.tp = 1; animate(L); }
    }
  }, true);
  function release() {
    for (var i = 0; i < lenses.length; i++) { if (lenses[i].tp) { lenses[i].tp = 0; animate(lenses[i]); } }
  }
  doc.addEventListener('mouseup', release, true);
  win.addEventListener('blur', release);
  doc.addEventListener('keydown', function (ev) {
    if (tipFor) { tipHide(); }
    var f = segAt(ev.target);                        // 键盘在分段开关里换选中：滑块也浮着飞过去
    if (f) { f.T.userAt = Date.now(); }
  }, true);
  win.addEventListener('scroll', function () { if (tipFor) { tipHide(); } }, true);

  doc.addEventListener('mousemove', function (ev) {
    if (!lastMove) { win.requestAnimationFrame(flushMove); }
    lastMove = ev;
  }, true);
  function flushMove() {
    var ev = lastMove, i;
    lastMove = null;
    if (!ev || !ev.target || ev.target.nodeType !== 1 || mode !== 'full') { return; }   // 指尖光与跟手只在「完整」里
    var b = ev.target.closest(GLOW_SEL);
    if (b && !b.disabled) {
      var r = b.getBoundingClientRect();
      if (r.width) {
        b.style.setProperty('--mx', ((ev.clientX - r.left) / r.width * 100).toFixed(1) + '%');
        b.style.setProperty('--my', ((ev.clientY - r.top) / r.height * 100).toFixed(1) + '%');
      }
    }
    for (i = 0; i < lenses.length; i++) {
      if (lenses[i].hover && lenses[i].surf.contains(ev.target)) { lensPointer(lenses[i], ev); }
    }
  }

  // 分段开关：按住浮起、拖、橡皮筋、甩（§5.5）
  doc.addEventListener('pointerdown', function (ev) {
    if (mode === 'off' || !ev.isPrimary || ev.button !== 0 || dragT) { return; }
    var f = segAt(ev.target);
    if (!f) { return; }
    var T = f.T, it = f.item, i;
    T.userAt = Date.now();
    if (!T.cur || it.disabled || it.getAttribute('aria-disabled') === 'true') { return; }
    var S = segStops(T), at = null;
    if (!S) { return; }
    for (i = 0; i < S.length; i++) { if (S[i].el === it) { at = S[i]; } }
    if (!at) { return; }
    T.st = T.vst = 0; segStretch(T);                  // 上一次的回弹还没停：先收住再量
    T.pend = null;
    var k = (T.surf.getBoundingClientRect().width / T.surf.offsetWidth) || 1;
    T.drag = { id: ev.pointerId, x0: ev.clientX, c0: at.x + at.w / 2, c: at.x + at.w / 2, k: k, S: S,
      lastX: ev.clientX, t: ev.timeStamp, v: 0, moved: false };
    dragT = T;
    T.fly = false;
    quietLens(T.surf);
    if (it !== T.cur) {
      // 按在别的项上（iOS 26：手指按在哪一项，玻璃就到哪一项底下）：滑块浮起、整块飞到手指下面，选不选由松手时的点击交给页面
      T.fly = liftOn();
      T.cl = at.x < T.gl ? SP.lead : SP.lag; T.cr = at.x + at.w > T.gr ? SP.lead : SP.lag;
      if (T.fly) { T.cl = T.cr = SP.fly; T.S = S; }
      T.gl = at.x; T.gr = at.x + at.w; T.cur = it;
    }
    if (liftOn()) { ensureLift(T); T.tup = 1; }     // 一按下就浮起来
    animate(T);
  }, true);

  doc.addEventListener('pointermove', function (ev) {
    var T = dragT;
    if (!T || !T.drag || ev.pointerId !== T.drag.id) { return; }
    var D = T.drag, dx = (ev.clientX - D.x0) / D.k;
    if (!D.moved) {
      if (Math.abs(dx) < 5) { return; }
      D.moved = true;
      // 动起来才捕获指针：只按一下不动的话，click 还落在按钮上，页面照常处理
      try { T.surf.setPointerCapture(D.id); } catch (e) {}
      T.surf.setAttribute('data-lg-drag', '');
      tipHide();
      var L = T.surf.__lgL;                          // 悬停透镜让开：不要两层玻璃
      if (L) { L.hover = L.focus = false; L.ta = 0; L.cur = null; animate(L); }
    }
    // 速度做一阶低通：高回报率鼠标每个事件的差分都在跳
    D.v += ((ev.clientX - D.lastX) / D.k / Math.max(1, ev.timeStamp - D.t) - D.v) * 0.35;
    D.lastX = ev.clientX; D.t = ev.timeStamp; D.c = D.c0 + dx;
    var g = dragThumb(D.S, D.c);
    T.gl = g.l; T.gr = g.l + g.w; T.cl = T.cr = SP.drag;
    if (!calm()) {
      var px = rubber(D.S, D.c, Math.min(18, T.w0 * 0.05));
      T.st = Math.abs(px) / (T.w0 || 1); T.vst = 0;
      if (px) { T.pin = px < 0 ? 'right' : 'left'; }
    }
    segNear(T, nearest(D.S, D.c).el);
    if (ev.cancelable) { ev.preventDefault(); }
    animate(T);
  }, true);

  function dragEnd(ev) {
    var T = dragT;
    if (!T || !T.drag || ev.pointerId !== T.drag.id) { return; }
    var D = T.drag;
    dragStop(T);
    if (!D.moved) {                                  // 只是按了一下：点击照常交给页面（按的是别的项，滑块已经先到了）
      if (T.cur && !isOn(T.cur)) { T.pend = { el: T.cur, until: Date.now() + 1200 }; setTimeout(scheduleSync, 1250); }
      segInkMode(T);
      return;
    }
    // 指针被系统收走（pointercancel）时按此刻的位置落定，不算甩
    var v = ev.type === 'pointerup' && ev.timeStamp - D.t < 90 ? D.v : 0;
    var to = snapStop(D.S, D.c, v);
    if (!calm() && Math.abs(v) >= FLICK && Math.abs(T.st) < 0.0002) {
      T.pin = v > 0 ? 'left' : 'right';              // 大力一甩：整条朝甩的方向形变，再回弹
      T.vst = Math.min(0.035, Math.abs(v) * 0.012) * BAND_KICK;
    }
    // 先按落点飞过去（浮着飞，到了再落下）；页面换了选中后再对一遍，也还是这里
    T.fly = T.tup > 0;
    T.cl = to.x < T.l ? SP.lead : SP.lag; T.cr = to.x + to.w > T.r ? SP.lead : SP.lag;
    if (T.fly) { T.cl = T.cr = SP.fly; T.S = D.S; }
    T.gl = to.x; T.gr = to.x + to.w; T.cur = to.el;
    segNear(T, to.el);
    // 现在就记下「替用户选了这一项」：下面的 click 要等到下一个任务，这之间字的样子不能退回页面的旧选中
    if (!isOn(to.el)) { T.pend = { el: to.el, until: Date.now() + 1200 }; }
    segInkMode(T);
    eatClick = T.surf;
    setTimeout(function () {
      eatClick = null;
      if (T.surf.contains(to.el) && !isOn(to.el)) {
        T.pend = { el: to.el, until: Date.now() + 1200 };
        to.el.click();
        setTimeout(scheduleSync, 1250);              // 页面最后也没接受这次选中：滑块回到真正选中的那一项
      }
      if (!T.fly) { segNear(T, null); }
      scheduleSync();
    }, 0);
    animate(T);
  }
  doc.addEventListener('pointerup', dragEnd, true);
  doc.addEventListener('pointercancel', dragEnd, true);
  // 拖完松手，浏览器还会补一下 click（落在按下的那一项或整条上），吞掉它；脚本自己点的那一下（isTrusted 为假）放行
  doc.addEventListener('click', function (ev) {
    if (eatClick && ev.isTrusted !== false && eatClick.contains(ev.target)) { ev.stopPropagation(); ev.preventDefault(); }
  }, true);

  // 三档开关：任何带 data-lg-mode-set="full|lite|off" 的按钮
  doc.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest('[data-lg-mode-set]') : null;
    if (!b) { return; }
    setMode(b.getAttribute('data-lg-mode-set'), true);
  });

  function setMode(v, announce) {
    if (v !== 'full' && v !== 'lite' && v !== 'off') { v = null; }       // 'auto' 或别的：回到自动
    save(MODE_KEY, v);
    if (v === 'full') { slow = false; try { win.sessionStorage.removeItem(SLOW_KEY); } catch (e) {} }
    applyTier();
    if (announce) { notify(M.toast + tierNote(pref(), tier)); }
  }

  /**
   * 点了开关当场弹一句这一档是什么样——不然用户分不清点没点上。
   * LiquidGlassConfig.notify: false 不弹；给一个函数则交给页面自己的提示组件。
   */
  function notify(text) {
    if (CFG.notify === false) { return; }
    if (typeof CFG.notify === 'function') { CFG.notify(text); return; }
    var box = doc.querySelector('.lg-toasts');
    if (!box) {
      box = doc.createElement('div');
      box.className = 'lg-toasts';
      box.setAttribute('aria-live', 'polite');
      doc.body.appendChild(box);
    }
    var el = doc.createElement('div');
    el.className = 'lg-glass lg-toast';
    el.setAttribute('role', 'status');
    el.textContent = text;
    box.appendChild(el);
    setTimeout(function () { if (el.parentNode) { el.parentNode.removeChild(el); } }, 4000);
  }

  /* ══ 9 页面变了就对一遍：一帧最多一次 ═══════════════════════════════════ */

  var syncQueued = false;
  function scheduleSync() {
    if (syncQueued) { return; }
    syncQueued = true;
    win.requestAnimationFrame(function () { syncQueued = false; sync(); });
  }
  function sync() {
    if (!doc.body) { return; }
    scanRefract();
    if (mode !== 'off') { syncThumbs(); syncLenses(); }
    syncHdr();
  }

  var started = false;
  function start() {
    if (started) { return; }
    started = true;
    if (typeof win.MutationObserver === 'function') {
      new win.MutationObserver(scheduleSync).observe(doc.body, {
        subtree: true, childList: true, attributes: true,
        attributeFilter: ['aria-pressed', 'aria-selected', 'aria-checked', 'aria-current', 'aria-expanded',
          'hidden', 'class', 'data-lg-on', 'data-collapsed']
      });
    }
    win.addEventListener('resize', scheduleSync);
    onMq('(prefers-reduced-motion: reduce)', function () { still = mq('(prefers-reduced-motion: reduce)'); });
    onMq('(dynamic-range: high)', applyTier);
    onMq('(prefers-reduced-transparency: reduce)', applyTier);
    // 字体晚到会让菜单项变宽变窄，滑块要重新对齐
    if (doc.fonts && doc.fonts.ready && doc.fonts.ready.then) { doc.fonts.ready.then(scheduleSync); }
    applyTier();
    sync();
  }

  // data-lg-js：脚本在。三档开关靠它才显示——「关闭」时 data-lg-lens 会被撤掉，开关不能跟着消失
  root.setAttribute('data-lg-js', '');
  // 放在 <head> 里同步加载时，赶在页面画出来之前先把档位写上（就是 integration.md 里那段「不闪」的内联脚本做的事）：
  // 用户选过「关闭 / 精简」的，刷新时不会先闪一下玻璃。材质先按 l0 / l1 写，跑起来以后再按浏览器与显卡升上去
  if (!root.hasAttribute('data-lg-mode')) {
    var p0 = pref();
    root.setAttribute('data-lg-mode', p0);
    if (!root.hasAttribute('data-lg-tier')) { root.setAttribute('data-lg-tier', p0 === 'off' || p0 === 'lite' ? 'l0' : 'l1'); }
  }

  /** 撤掉所有折射（换配置时：新的预设可能不再给这些元素折射） */
  function forgetRefract() {
    for (var i = 0; i < refractNodes.length; i++) {
      var n = refractNodes[i];
      if (n.__lgR) { dropFilter(n.__lgR.F); n.__lgR = null; }
      n.removeAttribute('data-lg-refract-on');
      n.style.removeProperty('--lg-ref');
    }
    refractNodes = [];
  }

  /**
   * 换配置：和 window.LiquidGlassConfig 同一套选项，只覆盖给了的那几项。打包工具里 import 会被提到最前面，
   * 来不及在加载前写全局配置，就在 import 之后调它。还没跑起来（页面没加载完）就只是记下；
   * 已经跑起来了就按新配置整套重来一遍——撤掉透镜、滑块、折射、HDR 高光，再按新的预设长出来。一般只在启动时调一次
   */
  function init(options) {
    configure(assign(assign({}, CFG), options || {}));
    try { slow = win.sessionStorage.getItem(SLOW_KEY) === '1'; } catch (e) { slow = false; }
    if (started) {
      teardown();
      forgetRefract();
      var hs = doc.querySelectorAll('img.lg-hdr');
      for (var i = 0; i < hs.length; i++) { if (hs[i].parentNode) { hs[i].parentNode.removeChild(hs[i]); } }
      mode = ''; tier = '';                            // 让 applyTier 按新配置整套重写一遍
      applyTier();
      sync();
    }
    return api;
  }

  var api = win.LiquidGlass = {
    version: '1.2.0',
    /** true：真的在跑；false：服务端渲染、太老的浏览器拿到的替身 */
    supported: true,
    /** 换配置（同 window.LiquidGlassConfig 的选项），返回 LiquidGlass 本身 */
    init: init,
    /** 用户选的档：'auto' | 'full' | 'lite' | 'off' */
    mode: function () { return pref(); },
    /** 实际的材质档：'l0' | 'l1' | 'l2' | 'l3' */
    tier: function () { return tier; },
    /** 换档（'auto' 回到自动）；第二个参数为 true 时弹一句提示 */
    setMode: setMode,
    /** 页面结构大改之后手动对一遍（平时 MutationObserver 会自己发现） */
    refresh: scheduleSync,
    /** 这一档的说明文字 */
    describe: function () { return tierNote(pref(), tier); },
    notify: notify
  };

  if (doc.body) { start(); } else { doc.addEventListener('DOMContentLoaded', start); }
  return api;
});
