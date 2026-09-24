/*!
 * Liquid Glass UI —— 交互层 v1.0.0
 *
 * 只管「看着像玻璃、摸着像水」，不碰业务：不发请求、不改表单、不改页面元素的 class。
 * 删掉这个 <script>，页面照样能用——liquid-glass.css 里有不带脚本的退路。
 * 原理、参数怎么来的、踩过的坑，见 references/ 下的文档。
 *
 * 做的七件事：
 *   1 分档：用户选的三档（完整 / 精简 / 关闭，没选过是「自动」）写在 <html data-lg-mode>，
 *     材质档写在 <html data-lg-tier>：l0 实色 / l1 模糊 / l2 模糊 + 折射 / l3 再加 HDR 高光。
 *   2 折射：按每块玻璃的实际尺寸现算一张位移贴图（圆角矩形 + 凸斜面 + 斯涅尔定律），
 *     挂成 SVG 滤镜交给 backdrop-filter。只有 Chromium 认 backdrop-filter 里的 url()。
 *   3 透镜：鼠标经过 / 键盘聚焦时，一颗清玻璃按弹簧物理流到那一项下面；经过的项微微放大、跟手。
 *   4 液态滑块：选中项底下那块，前沿先到、后沿后到，中途被拉长、落定回弹。
 *   5 指尖光：玻璃按钮上跟着指针走的一小团光（只写 CSS 变量 --mx / --my）。
 *   6 玻璃提示：把 title 小黄框换成玻璃气泡，离开时原样放回（读屏照样读得到）。
 *   7 HDR 高光：HDR 屏上玻璃上沿一道比页面白更亮的光。
 *
 * 配置两种写法，可以混用：
 *   · 用 liquid-glass.css 里的组件类（.lg-nav、.lg-seg、.lg-menu、.lg-panel、.lg-list、.lg-table-wrap……），
 *     下面的 PRESETS 已经给它们配好了透镜、滑块、折射，不用再写什么；
 *   · 自己的结构用 data 属性打开：data-lg-lens、data-lg-slider、data-lg-refract、data-lg-hdr、data-lg-tip、data-lg-glow。
 *     详见 references/integration.md。
 *   · 全局选项写在加载本文件之前的 window.LiquidGlassConfig 里（存储键、提示文案、是否弹提示……）。
 *
 * 纪律（改之前先看）：
 *   · 只写 data-* 属性、内联 style 与 CSS 变量，不增删页面元素的 class——不少页面脚本按 className 全等判断，
 *     多一个类就认不出来。自己插进去的元素才用 lg-* 类。
 *   · 插进去的元素一律追加在末尾、绝对定位、margin:0——插在前面会被 `> * + *` 这类间距规则挤歪。
 *   · 带 backdrop-filter 的玻璃，祖先不能有 filter / opacity<1 / mask，否则它「采不到背景」；
 *     所以透镜的淡入淡出只改子层的 opacity，外层只改 transform。
 *   · 只用 ES5：老浏览器上一个语法错误就是整个文件不执行。scripts/check.mjs 会拦。
 */
(function (win, doc) {
  'use strict';

  var root = doc.documentElement;
  var CSSx = win.CSS;
  // 太老的浏览器（IE11 等）：没有 CSS 变量或 closest，什么都不做，样式表的降级规则兜底
  if (!CSSx || typeof CSSx.supports !== 'function' || !CSSx.supports('--lg-probe', '0')
      || !win.requestAnimationFrame || !Element.prototype.closest || !Element.prototype.matches) {
    return;
  }
  if (win.LiquidGlass && win.LiquidGlass.version) { return; }       // 加载了两遍

  var CFG = win.LiquidGlassConfig || {};
  var MODE_KEY = CFG.storageKey || 'lg.glass';
  var SLOW_KEY = MODE_KEY + '.slow';
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
  var M = TEXT[(CFG.lang || root.getAttribute('lang') || '').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en'];
  if (CFG.messages) { M = assign(assign({}, M), CFG.messages); }

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
   *   under 表格一类整行：只垫一块亮板，不折射、不跟手、没有光斑
   */
  var PRE = CFG.presets === false ? {} : {
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
      { sel: '.lg-menu', bezel: 18, height: 16, thick: 8 },
      { sel: '.lg-panel', bezel: 24, height: 22, thick: 11 },
      { sel: '.lg-toolbar--sticky', bezel: 14, height: 12, thick: 6 }
    ],
    hdr: [
      { sel: '.lg-sidebar', spots: 'top bottom' },
      { sel: '.lg-dialog', spots: 'top bottom' },
      { sel: '.lg-panel', spots: 'top' },
      { sel: '.lg-chip', spots: 'top' }
    ]
  };
  var LENS = CFG.lens || PRE.lens || [];
  var SLIDER = CFG.slider || PRE.slider || [];
  var REFRACT = CFG.refract || PRE.refract || [];
  var HDR = CFG.hdr || PRE.hdr || [];
  var TIP_SEL = CFG.tips || '[data-lg-tip][title], [data-lg-tip] [title], .lg-sidebar [title], .lg-chip[title], [data-lg-mode-switch][title]';
  var TIP_ALT = TIP_SEL + ', ' + TIP_SEL.replace(/\[title\]/g, '[data-lg-title]');
  var GLOW_SEL = CFG.glow || '.lg-btn, .lg-chip, [data-lg-glow]';
  // 「选中」除了 aria-* 之外还认哪些写法。页面自己用 class 标选中（比如 .on、.active）时，在 LiquidGlassConfig.on 里补上
  var ON_SEL = '.is-cursor, .is-active, [data-lg-on]' + (CFG.on ? ', ' + CFG.on : '');
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
   * 几何：圆角矩形的有符号距离（Inigo Quilez 的公式），离边缘 bezel 像素以内是一圈凸起的玻璃边，
   * 中间是平的。边的剖面用凸超椭圆 h(u) = (1-(1-u)^4)^¼（u=0 最外沿，u=1 进入平面）。
   * 光学：视线垂直向下，在斜面上按斯涅尔定律折射（空气→玻璃 n=1.5），穿过恒定厚度 thick 的玻璃，
   * 横向偏移 = thick·tan(θ−θt)。边缘偏得最多、往里单调减小，指向玻璃内部（凸透镜把光往中间收）。
   * 编码：R = x 偏移、G = y 偏移，128 = 不动；feDisplacementMap 的 scale = 2 × 最大偏移。
   */
  var maps = {}, mapCount = 0;

  function sdf(px, py, hw, hh, r, out) {
    var qx = Math.abs(px) - (hw - r), qy = Math.abs(py) - (hh - r);
    var ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0;
    var d = Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r, nx, ny;
    if (qx > 0 && qy > 0) { var l = Math.sqrt(qx * qx + qy * qy) || 1; nx = qx / l; ny = qy / l; }
    else if (qx > qy) { nx = 1; ny = 0; } else { nx = 0; ny = 1; }
    out[0] = d; out[1] = px < 0 ? -nx : nx; out[2] = py < 0 ? -ny : ny;
  }

  function makeMap(w, h, r, bezel, height, thick) {
    w = Math.max(4, Math.round(w)); h = Math.max(4, Math.round(h));
    var hw = w / 2, hh = h / 2;
    r = clamp(r, 0, Math.min(hw, hh));
    bezel = clamp(bezel, 2, Math.min(hw, hh));
    var key = w + 'x' + h + 'x' + r.toFixed(1) + 'x' + bezel.toFixed(1) + 'x' + height + 'x' + thick;
    if (maps[key]) { return maps[key]; }
    if (mapCount > 48) { maps = {}; mapCount = 0; }
    var eta = 1 / 1.5, n = w * h, dx = new Float32Array(n), dy = new Float32Array(n), maxd = 1e-6;
    var s = [0, 0, 0], x, y, sx, sy;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        sdf(x + 0.5 - hw, y + 0.5 - hh, hw, hh, r, s);
        if (-s[0] >= bezel + 1 || s[0] > 1) { continue; }          // 平面或外面：不动
        var ax = 0, ay = 0;
        for (sy = 0; sy < 2; sy++) {                                 // 2×2 超采样，只在斜面上算
          for (sx = 0; sx < 2; sx++) {
            sdf(x + (sx + 0.5) / 2 - hw, y + (sy + 0.5) / 2 - hh, hw, hh, r, s);
            var t = -s[0];
            if (t <= 0 || t >= bezel) { continue; }
            var u = Math.max(t / bezel, 1e-4), a = 1 - Math.pow(1 - u, 4);
            var dh = Math.pow(1 - u, 3) * Math.pow(a, -0.75);        // h'(u)
            var theta = Math.atan(height / bezel * dh);                // 法线偏离竖直的角度
            var tt = Math.asin(eta * Math.sin(theta));                  // 折射角
            var travel = thick * Math.tan(theta - tt);
            ax -= s[1] * travel; ay -= s[2] * travel;
          }
        }
        ax /= 4; ay /= 4;
        dx[y * w + x] = ax; dy[y * w + x] = ay;
        if (Math.abs(ax) > maxd) { maxd = Math.abs(ax); }
        if (Math.abs(ay) > maxd) { maxd = Math.abs(ay); }
      }
    }
    var scale = 2 * maxd, c = doc.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d'), img = g.createImageData(w, h), px = img.data, i;
    for (i = 0; i < n; i++) {
      px[i * 4] = clamp(Math.round(255 * (0.5 + dx[i] / scale)), 0, 255);
      px[i * 4 + 1] = clamp(Math.round(255 * (0.5 + dy[i] / scale)), 0, 255);
      px[i * 4 + 2] = 128;
      px[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    mapCount++;
    return (maps[key] = { url: c.toDataURL('image/png'), scale: scale, w: w, h: h });
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

  /**
   * 一块玻璃的滤镜：底下先铺一层 128 灰（= 不位移），贴图叠上去，再做位移。
   * 贴图没加载出来时是灰底、整片不动——绝不能整片错位。
   * color-interpolation-filters 必须是 sRGB（缺省的线性 RGB 会把 128 算成 55 左右，整片往一边偏）；
   * 滤镜区域用缺省值（写 userSpaceOnUse 加 x/y 坐标原点会跑掉）。
   */
  function newFilter() {
    var id = 'lgf-' + (++filterSeq);
    var f = svgEl('filter', { id: id, 'color-interpolation-filters': 'sRGB' });
    f.appendChild(svgEl('feFlood', { 'flood-color': 'rgb(128,128,128)', result: 'flat' }));
    var im = f.appendChild(svgEl('feImage', { x: '0', y: '0', width: '1', height: '1', preserveAspectRatio: 'none', result: 'm0' }));
    f.appendChild(svgEl('feComposite', { 'in': 'm0', in2: 'flat', operator: 'over', result: 'map' }));
    var dm = f.appendChild(svgEl('feDisplacementMap', { 'in': 'SourceGraphic', in2: 'map', scale: '0', xChannelSelector: 'R', yChannelSelector: 'G' }));
    svgDefs().appendChild(f);
    return { id: id, node: f, img: im, dm: dm, url: '' };
  }
  function setMap(F, m) {
    if (F.url === m.url) { return; }
    F.url = m.url;
    F.img.setAttribute('width', String(m.w));
    F.img.setAttribute('height', String(m.h));
    F.img.setAttribute('href', m.url);
    F.img.setAttributeNS(XLINK, 'xlink:href', m.url);
    F.dm.setAttribute('scale', m.scale.toFixed(2));
  }
  function dropFilter(F) { if (F && F.node.parentNode) { F.node.parentNode.removeChild(F.node); } }

  /**
   * 一块玻璃的折射参数。预设里写死的直接用；data-lg-refract="边宽 隆起 厚度" 照写的用；
   * data-lg-refract 不给值时按尺寸取：边宽 = 短边 × 0.2（夹在 10–24px），隆起 = 边宽 − 2，厚度 = 边宽 × 0.45。
   * 规律：面板越大，边越宽、越厚，折弯越明显；小控件边窄，不然整颗都在弯、字看着晃。
   */
  function refractParams(el, cfg, w, h) {
    if (cfg.bezel) { return cfg; }
    var v = (el.getAttribute('data-lg-refract') || '').split(/[\s,]+/);
    if (v.length >= 3 && v[0] !== '') { return { bezel: num(v[0], 16), height: num(v[1], 14), thick: num(v[2], 7) }; }
    var b = clamp(Math.round(Math.min(w, h) * 0.2), 10, 24);
    return { bezel: b, height: b - 2, thick: Math.round(b * 0.45) };
  }

  var refractNodes = [];
  var ro = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      var t = entries[i].target;
      if (t.__lgR) { resized(t); }
      if (t.__lgT) { t.__lgT.resized = true; }
    }
    scheduleSync();
  }) : null;

  /**
   * 尺寸变了：拖窗口时每一帧都在变，每帧重算贴图会卡。先撤掉折射（只剩模糊，看着是干净的），
   * 停手 140ms 后再按新尺寸算一张。第一次出现（原先是 0 × 0，比如菜单刚打开）直接算。
   */
  function resized(el) {
    var R = el.__lgR;
    if (!R || !refracting()) { return; }
    var w = el.offsetWidth, h = el.offsetHeight;
    if (w < 8 || h < 8 || (w === R.w && h === R.h)) { return; }
    if (!R.w) { refreshRefract(el); return; }
    if (el.hasAttribute('data-lg-refract-on')) { el.removeAttribute('data-lg-refract-on'); }
    clearTimeout(R.timer);
    R.timer = setTimeout(function () { refreshRefract(el); }, 140);
  }

  function radiusOf(el, w, h) {
    var r = parseFloat(win.getComputedStyle(el).borderTopLeftRadius) || 0;
    return Math.min(r, w / 2, h / 2);
  }

  function refreshRefract(el) {
    var R = el.__lgR;
    if (!R) { return; }
    if (!refracting()) {
      if (el.hasAttribute('data-lg-refract-on')) { el.removeAttribute('data-lg-refract-on'); }
      return;
    }
    var w = el.offsetWidth, h = el.offsetHeight;
    if (w < 8 || h < 8) { return; }                  // 藏着的（display:none）等显出来再算
    var c = refractParams(el, R.cfg, w, h), r = radiusOf(el, w, h);
    R.w = w; R.h = h;
    setMap(R.F, makeMap(w, h, r, Math.min(c.bezel, h / 2 - 1), c.height, c.thick));
    el.style.setProperty('--lg-ref', 'url(#' + R.F.id + ')');
    if (el.getAttribute('data-lg-refract-on') !== '') { el.setAttribute('data-lg-refract-on', ''); }
  }
  function refreshAllRefract() { for (var i = 0; i < refractNodes.length; i++) { refreshRefract(refractNodes[i]); } }

  function addRefract(el, cfg) {
    if (el.__lgR) { return; }
    el.__lgR = { cfg: cfg, F: newFilter(), w: 0, h: 0, timer: 0 };
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
        clearTimeout(n.__lgR.timer);
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
   * 半隐式欧拉积分；换目标时保留速度，所以中途改道不会顿一下。
   */
  function spring(dur, bounce) { return { k: Math.pow(2 * Math.PI / dur, 2), d: 4 * Math.PI * (1 - bounce) / dur }; }
  var SP = {
    pos: spring(0.38, 0.22), fade: spring(0.3, 0), press: spring(0.26, 0.35),
    lead: spring(0.3, 0.26), lag: spring(0.52, 0.16), same: spring(0.42, 0.18)
  };
  function step(o, p, v, target, c, dt) {
    var acc = -c.k * (o[p] - target) - c.d * o[v];
    o[v] += acc * dt;
    o[p] += o[v] * dt;
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
    // 整行的透镜不跟手：不要折射层，也不要指尖那团光（宽行正中一团光斑像污渍）。
    // 不用 innerHTML：开了 Trusted Types 的页面上它会被拦
    var parts = L.cfg.under ? ['sh', 'glass'] : ['sh', 'glass', 'ref', 'light'];
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
      a: 0, va: 0, ta: 0, p: 0, vp: 0, tp: 0, px: 0.5, py: 0.5,
      cur: null, items: [], rad: null, settled: false, still: false, hover: false, focus: false, offT: 0
    };
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

  function lensTo(f, ev) {
    var surf = f.surf, t = f.item, cfg = f.cfg;
    if (mode === 'off' || t.disabled || t.getAttribute('aria-disabled') === 'true' || !visible(t)) { return; }
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
    animate(L);
  }

  function retarget(L, ev) {
    var t = L.cur, r = relRect(L.surf, t), pad = L.cfg.pad || 0;
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
    sx *= 1 + 0.06 * p; sy *= 1 - 0.09 * p;              // 按下：横向鼓、纵向压，松手回弹像果冻
    var s0 = under ? 1 : 0.86 + 0.14 * a;                 // 出现：从小一圈长出来
    var par = !under && mode === 'full';
    var ox = par ? (L.px - 0.5) * 4 * a : 0, oy = par ? (L.py - 0.5) * 2 * a : 0;   // 跟手视差（「精简」不跟）
    el.style.width = Math.max(0, L.w).toFixed(2) + 'px';
    el.style.height = Math.max(0, L.h).toFixed(2) + 'px';
    el.style.borderRadius = (L.rad != null ? L.rad : Math.max(0, Math.min(L.w, L.h)) / 2).toFixed(2) + 'px';
    el.style.transform = 'translate3d(' + (L.x + ox).toFixed(2) + 'px,' + (L.y + oy).toFixed(2) + 'px,0) scale('
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
      var sc = 1 + L.cfg.mag * m - (cur ? 0.035 * Math.max(0, p) : 0);
      var tx = cur ? (L.px - 0.5) * 3 * m : 0, ty = cur ? (L.py - 0.5) * 1.5 * m : 0;
      var key = sc.toFixed(4) + '|' + tx.toFixed(2) + '|' + ty.toFixed(2);
      if (key === it.key) { continue; }
      it.key = key;
      it.el.style.transform = (m < 0.002 && Math.abs(sc - 1) < 0.0005) ? ''
        : 'translate3d(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px,0) scale(' + sc.toFixed(4) + ')';
      it.el.style.setProperty('--m', m.toFixed(3));
    }
  }

  /** 透镜停稳时按它此刻的实际尺寸配一张贴图，折射层再淡入（移动中在变形，贴图跟不上，开着会在字上划出缝） */
  function lensMap(L) {
    if (!L.ref || !refracting() || L.el.hasAttribute('data-onsel')) { return; }
    if (!L.F) { L.F = newFilter(); L.ref.style.setProperty('--lg-ref', 'url(#' + L.F.id + ')'); }
    var w = Math.round(L.w), h = Math.round(L.h);
    if (w < 8 || h < 8) { return; }
    var r = L.rad != null ? Math.min(L.rad, h / 2) : h / 2, bez = Math.min(12, h * 0.32);
    setMap(L.F, makeMap(w, h, r, bez, bez - 2, bez * 0.42));
  }

  function lensPointer(L, ev) {
    if (!L.el || !L.ta || L.cfg.under) { return; }
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
      }
      th[i].removeAttribute('data-lg-slider-on');
    }
  }

  /** 页面变了（组收起、面板重画）：亮着的透镜跟过去；它罩着的那项没了就撤 */
  function syncLenses() {
    for (var i = lenses.length - 1; i >= 0; i--) {
      var L = lenses[i];
      if (!doc.body.contains(L.surf)) { if (L.F) { dropFilter(L.F); } L.surf.__lgL = null; lenses.splice(i, 1); continue; }
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
      cl: SP.same, cr: SP.same, ct: SP.same, cb: SP.same, a: 0, va: 0, ta: 0, rad: null, w0: 0
    };
    T.step = function (dt) { return thumbStep(T, dt); };
    T.paint = function () { thumbPaint(T); };
    return T;
  }

  function syncThumb(surf, cfg) {
    var T = surf.__lgT;
    if (!T || T.cfg.kind !== cfg.kind) {
      if (T && T.el && T.el.parentNode) { T.el.parentNode.removeChild(T.el); }
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
    for (i = 0; i < list.length; i++) { if (isOn(list[i]) && visible(list[i])) { cur = list[i]; break; } }
    var jump = T.a < 0.05 || calm() || (T.resized && surf.offsetWidth !== T.w0);
    T.resized = false; T.w0 = surf.offsetWidth;
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
    // 往哪边走，哪边就是前沿
    T.cl = gl < T.gl ? SP.lead : gl > T.gl ? SP.lag : SP.same;
    T.cr = gr > T.gr ? SP.lead : gr < T.gr ? SP.lag : SP.same;
    T.ct = gt < T.gt ? SP.lead : gt > T.gt ? SP.lag : SP.same;
    T.cb = gb > T.gb ? SP.lead : gb < T.gb ? SP.lag : SP.same;
    T.gl = gl; T.gr = gr; T.gt = gt; T.gb = gb;
    T.cur = cur; T.ta = 1;
    if (jump) { T.l = gl; T.r = gr; T.t = gt; T.b = gb; T.vl = T.vr = T.vt = T.vb = 0; }
    animate(T);
  }

  function thumbStep(T, dt) {
    if (calm()) {
      T.l = T.gl; T.r = T.gr; T.t = T.gt; T.b = T.gb; T.a = T.ta; T.vl = T.vr = T.vt = T.vb = T.va = 0;
      return false;
    }
    step(T, 'l', 'vl', T.gl, T.cl, dt); step(T, 'r', 'vr', T.gr, T.cr, dt);
    step(T, 't', 'vt', T.gt, T.ct, dt); step(T, 'b', 'vb', T.gb, T.cb, dt);
    step(T, 'a', 'va', T.ta, SP.fade, dt);
    // 拉长有上限：跳得远时后沿不能拖成一整条，最多比落点那一项长出 44px（横向 56px），后沿被前沿拽着走
    var maxV = T.gb - T.gt + 44, maxH = T.gr - T.gl + 56;
    if (T.b - T.t > maxV) { if (T.ct === SP.lag) { T.t = T.b - maxV; } else if (T.cb === SP.lag) { T.b = T.t + maxV; } }
    if (T.r - T.l > maxH) { if (T.cl === SP.lag) { T.l = T.r - maxH; } else if (T.cr === SP.lag) { T.r = T.l + maxH; } }
    var off = Math.abs(T.l - T.gl) + Math.abs(T.r - T.gr) + Math.abs(T.t - T.gt) + Math.abs(T.b - T.gb);
    var vel = Math.abs(T.vl) + Math.abs(T.vr) + Math.abs(T.vt) + Math.abs(T.vb);
    var done = off < 0.3 && vel < 6 && Math.abs(T.a - T.ta) < 0.004 && Math.abs(T.va) < 0.03;
    if (done) { T.l = T.gl; T.r = T.gr; T.t = T.gt; T.b = T.gb; T.a = T.ta; T.vl = T.vr = T.vt = T.vb = T.va = 0; }
    return !done;
  }

  function thumbPaint(T) {
    if (!T.el) { return; }
    var a = clamp(T.a, 0, 1), w = Math.max(0, T.r - T.l), h = Math.max(0, T.b - T.t), s = 0.9 + 0.1 * a;
    var rad = T.rad != null ? T.rad : h / 2;
    var key = T.l.toFixed(2) + '|' + T.t.toFixed(2) + '|' + w.toFixed(2) + '|' + h.toFixed(2) + '|' + a.toFixed(3) + '|' + rad;
    if (key === T.painted) { return; }
    T.painted = key;
    T.el.style.width = w.toFixed(2) + 'px';
    T.el.style.height = h.toFixed(2) + 'px';
    T.el.style.borderRadius = Math.min(rad, h / 2, w / 2).toFixed(2) + 'px';
    T.el.style.transform = 'translate3d(' + T.l.toFixed(2) + 'px,' + T.t.toFixed(2) + 'px,0) scale(' + s.toFixed(4) + ')';
    T.el.style.opacity = a.toFixed(3);
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
  doc.addEventListener('keydown', function () { if (tipFor) { tipHide(); } }, true);
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

  function start() {
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

  win.LiquidGlass = {
    version: '1.0.0',
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
})(window, document);
