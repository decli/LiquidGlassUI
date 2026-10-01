#!/usr/bin/env node
/**
 * 用真浏览器把演示页（或你自己的页面）拍下来，并验三档是不是真的分得开。
 *
 *   node scripts/shoot.mjs                     拍演示页的整套截图到 ./shots/，并做三档校验与一致性校验
 *                                              （每个能点的元素悬停都有反馈、都有跟着指针走的指尖光；所有玻璃同一种材质、并排的胶囊不一深一浅）、
 *                                              折射校验（玻璃正中和不折射时逐像素一样、边上确实在弯；透镜和浮起的透镜中间没有平的一块）、
 *                                              分段开关校验（按住浮起、按住别的项、拖、甩、橡皮筋、点、玻璃导航条、精简档）
 *   node scripts/shoot.mjs --out design        换输出目录
 *   node scripts/shoot.mjs --check             只做校验，不留截图
 *   node scripts/shoot.mjs --url http://localhost:3000/  拍你自己的页面：浅 / 深 × 三档 6 张全屏，再做同样的三档校验
 *   node scripts/shoot.mjs --url … --key myapp.glass     你的页面把档位存在别的 localStorage 键里时
 *   node scripts/shoot.mjs --url … --hover '.my-menu a'  三档校验时悬停哪一项（缺省自动找第一个能出透镜的项）
 *
 * 依赖：Playwright（npm i -D playwright，或全局装的也行）。浏览器用 Playwright 自带的 Chromium；
 * 要指定别的，设环境变量 CHROMIUM_PATH。
 *
 * 为什么截图前要先把档位设成「完整」：无头 Chromium 是软件渲染（SwiftShader），
 * 自动档会判断「显卡吃力」而先不折射——截出来看不到折射，不是坏了。
 */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const assets = resolve(here, '..', 'assets');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const checkOnly = args.includes('--check');
const outDir = resolve(opt('--out', 'shots'));
const userUrl = opt('--url', null);
const modeKey = opt('--key', 'lg.glass');
const hoverSel = opt('--hover', null);

async function loadPlaywright() {
  try { return await import('playwright'); } catch (e) { /* 本地没装，找全局 */ }
  const g = execSync('npm root -g').toString().trim();
  for (const f of ['playwright/index.mjs', 'playwright/index.js']) {
    const p = join(g, f);
    if (existsSync(p)) { return await import(pathToFileURL(p).href); }
  }
  throw new Error('找不到 Playwright：先 npm i -D playwright');
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
function serve(dir) {
  return new Promise(ok => {
    const srv = createServer(async (req, res) => {
      const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const f = resolve(dir, '.' + u + (u.endsWith('/') ? 'index.html' : ''));
      if (!f.startsWith(dir + sep)) { res.writeHead(403).end(); return; }
      let body;
      try { body = await readFile(f); } catch (e) { res.writeHead(404).end(); return; }   // 先读再写头：读不到时头还没写，才能回 404
      res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }).end(body);
    });
    srv.listen(0, '127.0.0.1', () => ok(srv));
  });
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const srv = userUrl ? null : await serve(assets);
const base = userUrl || `http://127.0.0.1:${srv.address().port}/demo/`;
const failures = [];

/** 开一页：先写好主题和档位（localStorage），再打开 */
async function open({ theme = 'light', mode = 'full', w = 1440, h = 900, dpr = 1, query = '' } = {}) {
  // 主题三管齐下：演示页读 localStorage；按系统走的页面看 colorScheme；其余的直接在 <html> 上写 data-theme
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, colorScheme: theme === 'dark' ? 'dark' : 'light' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') { errors.push('console: ' + m.text()); } });
  await page.addInitScript(([t, g, k]) => {
    try { localStorage.setItem('lg.demo.theme', t); localStorage.setItem(k, g); } catch (e) {}
  }, [theme, mode, modeKey]);
  await page.goto(base + query);
  await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
  await page.waitForTimeout(700);
  page.__errors = errors;
  return { ctx, page };
}
async function close({ ctx, page }, name) {
  if (page.__errors.length) { failures.push(`${name}: 页面报错\n  ${page.__errors.slice(0, 5).join('\n  ')}`); }
  await ctx.close();
}
async function hover(page, sel, wait = 700) {
  const b = await page.locator(sel).first().boundingBox();
  await page.mouse.move(b.x + b.width * 0.4, b.y + b.height / 2, { steps: 8 });
  await page.waitForTimeout(wait);
}
async function shot(page, file, clip) {
  if (checkOnly) { return null; }
  const path = join(outDir, file);
  await page.screenshot({ path, clip });
  return path;
}
/** 在浏览器里逐像素比两张图：返回不同像素的比例 */
async function diff(a, b) {
  const { ctx, page } = await open();
  const [da, db] = [a, b].map(x => 'data:image/png;base64,' + x.toString('base64'));
  const r = await page.evaluate(async ([sa, sb]) => {
    const load = s => new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.src = s; });
    const [ia, ib] = await Promise.all([load(sa), load(sb)]);
    const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height);
    const px = img => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, w, h).data; };
    const pa = px(ia), pb = px(ib);
    let n = 0;
    for (let i = 0; i < pa.length; i += 4) {
      if (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]) > 24) { n++; }
    }
    return n / (w * h);
  }, [da, db]);
  await ctx.close();
  return r;
}

/** 悬停反馈与玻璃材质的一致性（只对演示页） */
async function consistencyCheck() {
  const views = [
    ['主页面', async () => {}],
    ['工作区菜单', async p => { await p.click('#ws-chip'); await p.waitForTimeout(600); }, '.lg-menu'],
    ['命令面板', async p => { await p.keyboard.press('Control+k'); await p.waitForTimeout(600); }, '.lg-panel'],
    ['登录页', async p => { await p.click('#logout'); await p.waitForTimeout(500); }, '.lg-dialog']
  ];
  let total = 0;
  for (const [name, prep, scope] of views) {
    const o = await open({ mode: 'full' });
    const p = o.page;
    await prep(p);
    // 不只看第一屏：每一个都先滚到视口正中再悬停（表格行在第一屏里被粘住的保存条挡着，以前一行都没验到）
    const n = await p.evaluate(sc => {
      const root = sc ? document.querySelector(sc) : document;
      const els = [...root.querySelectorAll('button, a[href], [role="option"], [role="menuitem"], [role="menuitemradio"], tbody tr')].filter(e => {
        const r = e.getBoundingClientRect();
        return r.width > 4 && r.height > 4 && !e.disabled && !e.closest('[hidden]');
      });
      els.forEach((e, i) => e.setAttribute('data-fb', i));
      return els.length;
    }, scope || null);
    // 滚到正中以后鼠标真点得到它（没被粘住的保存条之类盖住）才验
    const reach = i => p.evaluate(i => {
      const e = document.querySelector(`[data-fb="${i}"]`);
      e.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = e.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight) { return false; }
      const hit = document.elementFromPoint(r.left + r.width * 0.4, r.top + r.height / 2);
      return !!hit && (hit === e || e.contains(hit));
    }, i);
    const snap = i => p.evaluate(i => {
      const e = document.querySelector(`[data-fb="${i}"]`), cs = getComputedStyle(e), bs = getComputedStyle(e, '::before');
      const r = e.getBoundingClientRect();
      const lens = [...document.querySelectorAll('.lg-lens')].some(l => {
        if (!l.parentElement.contains(e) || parseFloat(l.style.getPropertyValue('--a') || 0) < 0.5) { return false; }
        const q = l.getBoundingClientRect();
        const ox = Math.max(0, Math.min(q.right, r.right) - Math.max(q.left, r.left)), oy = Math.max(0, Math.min(q.bottom, r.bottom) - Math.max(q.top, r.top));
        return ox * oy > 0.5 * r.width * r.height;
      });
      // 指尖光：盖着它的透镜里那层光亮着，或者它自己（按钮、胶囊）在写跟着指针走的 --mx
      const glow = [...document.querySelectorAll('.lg-lens')].some(l => {
        const li = l.querySelector('.lg-lens-light');
        if (!li || !l.parentElement.contains(e) || parseFloat(l.style.getPropertyValue('--a') || 0) < 0.5) { return false; }
        const q = l.getBoundingClientRect(), ls = getComputedStyle(li);
        const ox = Math.max(0, Math.min(q.right, r.right) - Math.max(q.left, r.left)), oy = Math.max(0, Math.min(q.bottom, r.bottom) - Math.max(q.top, r.top));
        return ox * oy > 0.5 * r.width * r.height && ls.display !== 'none' && /radial-gradient/.test(ls.backgroundImage);
      }) || !!(e.closest('.lg-btn, .lg-chip, [data-lg-glow]') || e).style.getPropertyValue('--mx');
      return { lens, glow, look: [cs.transform, cs.boxShadow, cs.backgroundImage, cs.backgroundColor, bs.backgroundImage].join('|'),
        label: (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().replace(/\s+/g, ' ').slice(0, 16) };
    }, i);
    let tested = 0;
    for (let i = 0; i < n; i++) {
      await p.mouse.move(1436, 4);
      if (!(await reach(i))) { continue; }
      await p.waitForTimeout(260);
      const before = await snap(i);
      const b = await p.locator(`[data-fb="${i}"]`).boundingBox();
      await p.mouse.move(b.x + b.width * 0.4, b.y + b.height / 2, { steps: 4 });
      // 透镜是流过去的：从鼠标进来时路过的那一项流到这一项要一会儿，无头浏览器帧率又低——等它到了再判断（最多 1.6 秒）
      let after = await snap(i);
      for (let k = 0; k < 8 && !after.glow; k++) { await p.waitForTimeout(200); after = await snap(i); }
      tested++;
      if (!after.lens && after.look === before.look) { failures.push(`一致性（${name}）：「${before.label}」悬停没有任何反馈`); }
      else if (!after.glow) { failures.push(`一致性（${name}）：「${before.label}」悬停没有跟着指针走的指尖光（别的按钮、菜单项都有）`); }
    }
    total += tested;
    await close(o, 'consistency ' + name);
  }
  console.log(`  悬停反馈：${total} 个能点的元素逐个悬停过（都要有反馈，而且都有指尖光）`);

  // 玻璃材质：宿主背景透明；同一类玻璃的玻璃层一样；并排两颗胶囊的底色像素一致
  const o = await open({ mode: 'full' });
  const r = await o.page.evaluate(() => {
    const bad = [], groups = {};
    document.querySelectorAll('.lg-glass').forEach(g => {
      const cs = getComputedStyle(g), bs = getComputedStyle(g, '::before'), as = getComputedStyle(g, '::after');
      const who = (g.id ? '#' + g.id : '.' + [...g.classList].join('.'));
      if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none') { bad.push(who + ' 宿主自己画了背景：' + cs.backgroundColor); }
      if (!/blur/.test(bs.backdropFilter || bs.webkitBackdropFilter || '')) { bad.push(who + ' 的玻璃层没有背景模糊'); }
      if (as.content === 'none' || as.backgroundImage === 'none') { bad.push(who + ' 没有高光环'); }
      const kind = [...g.classList].filter(c => c !== 'lg-glass' && /^lg-/.test(c)).sort().join('.') || 'lg-glass';
      const sig = [bs.backgroundColor, bs.backgroundImage, bs.backdropFilter].join('|');
      (groups[kind] = groups[kind] || new Set()).add(sig);
    });
    Object.keys(groups).forEach(k => { if (groups[k].size > 1) { bad.push('.' + k + ' 这一类玻璃的玻璃层不一样（' + groups[k].size + ' 种）'); } });
    const chips = [...document.querySelectorAll('.lg-head .lg-chip')].map(c => { const b = c.getBoundingClientRect(); return { x: b.x + 5, y: b.y + b.height / 2 - 6, width: 3, height: 12 }; });
    return { bad, chips, count: document.querySelectorAll('.lg-glass').length };
  });
  r.bad.forEach(b => failures.push('一致性（玻璃材质）：' + b));
  const avg = async clip => {
    const buf = await o.page.screenshot({ clip });
    return o.page.evaluate(async src => {
      const i = new Image(); await new Promise(ok => { i.onload = ok; i.src = src; });
      const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0);
      const d = g.getImageData(0, 0, i.width, i.height).data; const m = [0, 0, 0];
      for (let k = 0; k < d.length; k += 4) { m[0] += d[k]; m[1] += d[k + 1]; m[2] += d[k + 2]; }
      return m.map(v => v / (d.length / 4));
    }, 'data:image/png;base64,' + buf.toString('base64'));
  };
  if (r.chips.length >= 2) {
    const [a, b] = [await avg(r.chips[0]), await avg(r.chips[1])];
    const dmax = Math.max(...a.map((v, k) => Math.abs(v - b[k])));
    console.log(`  并排胶囊底色差：${dmax.toFixed(1)}（0–255）`);
    if (dmax > 1.5) { failures.push(`一致性（玻璃材质）：页头两颗胶囊底色差 ${dmax.toFixed(1)}，看得出一深一浅`); }
  }
  console.log(`  玻璃材质：${r.count} 块玻璃，${r.bad.length ? r.bad.length + ' 处不一致' : '全部一致'}`);
  await close(o, 'consistency glass');
}

/** 两张同样大小的截图：中间（四边各缩进 ix / iy 像素）和外圈各有多少像素不同 */
async function regionDiff(a, b, ix, iy) {
  const { ctx, page } = await open();
  const r = await page.evaluate(async ([sa, sb, ix, iy]) => {
    const load = s => new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.src = s; });
    const [ia, ib] = await Promise.all([load(sa), load(sb)]);
    const w = ia.width, h = ia.height;
    const px = img => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, w, h).data; };
    const A = px(ia), B = px(ib);
    let cn = 0, ct = 0, cmax = 0, en = 0, et = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
        if (x >= ix && x < w - ix && y >= iy && y < h - iy) { ct++; if (d > 3) { cn++; } cmax = Math.max(cmax, d); }
        else { et++; if (d > 24) { en++; } }
      }
    }
    return { center: cn / ct, centerMax: cmax, edge: en / et };
  }, ['data:image/png;base64,' + a.toString('base64'), 'data:image/png;base64,' + b.toString('base64'), ix, iy]);
  await ctx.close();
  return r;
}

/**
 * 折射校验（演示页的那颗玻璃）：同一块玻璃、同一条滤镜链，只把折射那一步换成什么都不做，前后各拍一张。两种剖面各验一遍：
 *   · 默认的玻璃板（data-lg-refract="22 10"）：正中（离边超过边宽、离两端超过圆角）必须逐像素一样——中间一个像素都不重采样；
 *     外圈必须有相当一部分像素变了——边上确实在放大、弯折。
 *   · 透镜（data-lg-refract="lens"，演示页现在用的；边宽到中线、平方剖面、最外缘 0.345 × 边宽）：中线 ±4px 肉眼看不出变化
 *     （最大差 ≤ 8；1.3 起没有「位移太小就用原图」的门控，靠的是中线附近位移不到半个像素、最近邻取样落回原像素）；
 *     离边 22–32px 那一圈（玻璃板在这里是平的）也在弯（≥ 5% 的像素变了）——整块连续地弯，没有「外面一圈弯、里面一块平」。
 * 换剖面用 LiquidGlass.init() 整套重来（它会重读 data-lg-refract）。
 */
async function refractCheck() {
  const o = await open({ mode: 'full', dpr: 2 });
  const p = o.page;
  const shoot = async (attr, pos) => {
    await p.evaluate(([a, v]) => {
      const d = document.getElementById('drop');
      d.style.removeProperty('--lg-ref'); d.setAttribute('data-lg-refract', a); d.style.transform = 'translate(' + v + ')';
      window.LiquidGlass.init({});
    }, [attr, pos]);
    await p.locator('#lab').scrollIntoViewIfNeeded();
    await p.waitForTimeout(600);
    const g = await p.evaluate(() => {
      const d = document.getElementById('drop');
      return { on: d.hasAttribute('data-lg-refract-on'), radius: parseFloat(getComputedStyle(d).borderTopLeftRadius) || 0, w: d.offsetWidth, h: d.offsetHeight };
    });
    const clip = await p.locator('#drop').boundingBox();
    const on = await p.screenshot({ clip });
    await p.evaluate(() => document.getElementById('drop').style.setProperty('--lg-ref', 'blur(0px)'));
    await p.waitForTimeout(300);
    return { g, on, off: await p.screenshot({ clip }) };
  };
  let s = await shoot('22 10', '150px,34px');
  if (!s.g.on) { failures.push('折射校验：演示页的玻璃没开折射（完整档、Chromium 下应当开）'); await close(o, 'refract'); return; }
  const r = await regionDiff(s.on, s.off, Math.ceil((s.g.radius + 3) * 2), Math.ceil((22 + 3) * 2));
  console.log(`  折射（玻璃板）：正中 ${(r.center * 100).toFixed(3)}% 的像素不同（最大差 ${r.centerMax}），外圈 ${(r.edge * 100).toFixed(1)}% 在弯`);
  if (r.center > 0.001 || r.centerMax > 6) { failures.push(`折射校验：玻璃正中被重采样了（${(r.center * 100).toFixed(3)}% 的像素和不折射时不同）`); }
  if (r.edge < 0.03) { failures.push(`折射校验：外圈只有 ${(r.edge * 100).toFixed(1)}% 的像素变了，看不出折射`); }
  // 透镜：压在两行字上（横着的笔画才看得出上下方向的弯折）
  s = await shoot('lens', '46px,8px');
  const L = await bandDiff(s.on, s.off, s.g.w, [[s.g.h / 2 + 8, s.g.h / 2 - 4, s.g.w - s.g.h / 2 - 8, s.g.h / 2 + 4, 3],
    [s.g.h / 2 + 8, 22, s.g.w - s.g.h / 2 - 8, 32, 24], [s.g.h / 2 + 8, s.g.h - 32, s.g.w - s.g.h / 2 - 8, s.g.h - 22, 24]]);
  const inner = Math.max(L[1].frac, L[2].frac);
  console.log(`  折射（透镜）：中线 ±4px 最大差 ${L[0].max}；离边 22–32px 那一圈 ${(inner * 100).toFixed(1)}% 在弯（玻璃板在这里是平的）`);
  if (L[0].max > 8) { failures.push(`折射校验：透镜中线附近变化太大（最大差 ${L[0].max}），中间的字会糊`); }
  if (inner < 0.05) { failures.push(`折射校验：透镜离边 22–32px 那一圈只有 ${(inner * 100).toFixed(1)}% 在弯——中间还是一块平的，看着像两个椭圆`); }
  // 浮起的透镜也是边宽到中线的透镜：按住导航条第二项不动，开 / 关折射各拍一张。中线上下 0.12–0.19 倍高那两条带，
  // 1.1 版的透镜（斜面占半高六成）在这里是平的——透镜里一块原样、外圈在弯，就是「两个椭圆套在一起」
  await p.locator('.demo-tabbar').evaluate(e => e.closest('.demo-phone').scrollIntoView({ block: 'center' }));
  await p.waitForTimeout(300);
  const tb = await p.locator('.demo-tabbar > button').nth(1).boundingBox();
  await p.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2); await p.mouse.down(); await p.waitForTimeout(900);
  const lift = p.locator('.demo-tabbar .lg-lift');
  const lg = await lift.evaluate(l => ({ w: l.offsetWidth, h: l.offsetHeight }));
  const lclip = await lift.boundingBox();
  const lon = await p.screenshot({ clip: lclip });
  await p.evaluate(() => { document.querySelector('.demo-tabbar .lg-lift-ref').style.backdropFilter = 'none'; });
  await p.waitForTimeout(200);
  const loff = await p.screenshot({ clip: lclip });
  await p.mouse.up();
  const H = lg.h, x0 = H / 2, x1 = lg.w - H / 2;
  const F = await bandDiff(lon, loff, lg.w, [[x0, H / 2 - 4, x1, H / 2 + 4, 3], [x0, H * 0.31, x1, H * 0.38, 24], [x0, H * 0.62, x1, H * 0.69, 24]]);
  const band = Math.max(F[1].frac, F[2].frac);
  console.log(`  折射（浮起的透镜）：中线附近最大差 ${F[0].max}；中线上下 0.12–0.19 倍高那两条带 ${(band * 100).toFixed(1)}% 在弯`);
  if (F[0].max > 8) { failures.push(`折射校验：浮起的透镜中线附近变化太大（最大差 ${F[0].max}），底下的字会糊`); }
  if (band < 0.03) { failures.push(`折射校验：浮起的透镜中线上下那两条带只有 ${(band * 100).toFixed(1)}% 在弯——中间一块平的，看着像两个椭圆套在一起`); }
  await close(o, 'refract');
}

/** 两张截图在几个区域里比（区域按 CSS 像素给 [x0, y0, x1, y1, 阈值]，cssW 是元素的布局宽度）：每块里差值超过阈值的像素占比、最大差 */
async function bandDiff(a, b, cssW, regions) {
  const { ctx, page } = await open();
  const r = await page.evaluate(async ([sa, sb, cssW, regions]) => {
    const load = s => new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.src = s; });
    const [ia, ib] = await Promise.all([load(sa), load(sb)]);
    const w = ia.width, h = ia.height, k = w / cssW;
    const px = img => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, w, h).data; };
    const A = px(ia), B = px(ib);
    return regions.map(([x0, y0, x1, y1, thr]) => {
      let n = 0, t = 0, max = 0;
      for (let y = Math.round(y0 * k); y < Math.round(y1 * k); y++) {
        for (let x = Math.round(x0 * k); x < Math.round(x1 * k); x++) {
          const i = (y * w + x) * 4, d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
          t++; if (d > thr) { n++; } max = Math.max(max, d);
        }
      }
      return { frac: t ? n / t : 0, max };
    });
  }, ['data:image/png;base64,' + a.toString('base64'), 'data:image/png;base64,' + b.toString('base64'), cssW, regions]);
  await ctx.close();
  return r;
}

/**
 * 分段开关校验（演示页「时间范围」那一组）：按住浮起、只按不动不换选中、拖着换选中（浏览器补的那一下 click 不能把选中点回去）、
 * 甩、拖过两端的橡皮筋、点别的项浮着飞过去、精简档照样能拖但不浮起、选中变粗不挤开旁边的项。
 */
async function segCheck() {
  const SEG = '.lg-seg[aria-label="时间范围"]';
  const fail = m => failures.push('分段开关：' + m);
  const prep = async (mode = 'full') => {
    const o = await open({ mode });
    await o.page.locator(SEG).scrollIntoViewIfNeeded();
    await o.page.waitForTimeout(200);
    return o;
  };
  const sel = p => p.evaluate(s => [...document.querySelectorAll(s + ' > button')].findIndex(x => x.getAttribute('aria-pressed') === 'true'), SEG);
  const at = p => p.evaluate(s => [...document.querySelectorAll(s + ' > button')].map(x => { const r = x.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }), SEG);
  const st = p => p.evaluate(s => {
    const seg = document.querySelector(s), T = seg.__lgT, lift = seg.querySelector('.lg-lift');
    return { up: T.up, fly: T.fly, st: T.st, transform: seg.style.transform, lifted: !!lift && lift.hasAttribute('data-up'),
      ref: lift ? getComputedStyle(lift.querySelector('.lg-lift-ref')).backdropFilter : '', plate: +seg.querySelector('.lg-thumb').style.opacity,
      near: [...seg.children].findIndex(x => x.hasAttribute('data-lg-near')), ink: seg.hasAttribute('data-lg-ink'),
      scale: [...seg.querySelectorAll(':scope > button')].map(x => +(x.style.scale || 1)) };
  }, SEG);

  // 等到某个条件成立（最多 ms 毫秒）。动画的步长有上限，无头浏览器软件渲染折射时一帧 30–110ms，动画在墙钟上就慢下来——
  // 固定等 600ms 有时差一点没到（滑块其实到了，只是晚到）。断言不放宽，只是不按固定时长等
  const until = async (p, fn, arg, ms = 2500) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await p.evaluate(fn, arg)) { return true; } await p.waitForTimeout(40); }
    return false;
  };
  // 浮起来了 / 落定了（不再飞、透镜落下、字的样子交还给页面）
  const lifted = (p, sel) => until(p, s => { const seg = document.querySelector(s), T = seg.__lgT, l = seg.querySelector('.lg-lift');
    return !!l && l.hasAttribute('data-up') && T.up >= 0.9; }, sel);
  const landed = (p, sel) => until(p, s => { const seg = document.querySelector(s), T = seg.__lgT;
    return !T.fly && T.up < 0.002 && !seg.hasAttribute('data-lg-ink') && !seg.hasAttribute('data-lg-drag'); }, sel);
  let o = await prep(), p = o.page, B = await at(p);
  const before = await at(p);
  await p.click(SEG + ' > button:nth-child(3)'); await p.waitForTimeout(800);
  const after = await at(p);
  if (before.some((b, i) => Math.abs(b.x - after[i].x) > 0.6)) { fail('换选中时旁边的项被挤动了（粗体没有预留宽度）'); }
  await p.click(SEG + ' > button:nth-child(1)'); await p.waitForTimeout(800);
  await p.mouse.move(B[0].x, B[0].y); await p.mouse.down(); await lifted(p, SEG);
  let s = await st(p);
  if (!s.lifted || s.up < 0.9 || !/url/.test(s.ref) || s.plate > 0.05) { fail('按住选中项，滑块应当浮起成一块正在折射的透镜：' + JSON.stringify(s)); }
  // 透镜底下的字被放大（iOS 26）：按住的那一项放大，别的项不动
  if (!(s.scale[0] > 1.08 && s.scale.slice(1).every(x => x === 1))) { fail('按住选中项：透镜底下那一项的字应当放大、别的项不动：' + JSON.stringify(s.scale)); }
  await p.mouse.up(); await landed(p, SEG);
  s = await st(p);
  if (s.lifted || await sel(p) !== 0) { fail('只按一下不动：应当落回去、不换选中'); }
  if (s.scale.some(x => x !== 1)) { fail('透镜落下后字应当缩回原样：' + JSON.stringify(s.scale)); }
  await p.mouse.move(B[0].x, B[0].y); await p.mouse.down();
  await p.mouse.move(B[2].x, B[2].y, { steps: 20 }); await p.waitForTimeout(200);
  if ((await st(p)).near !== 2) { fail('拖动中离滑块最近的那一项应当标 data-lg-near'); }
  await p.mouse.up(); await landed(p, SEG);
  s = await st(p);
  if (await sel(p) !== 2) { fail(`拖到第三项松手，应当选中第三项，实际是第 ${await sel(p) + 1} 项`); }
  if (s.lifted || s.fly || s.near !== -1) { fail('拖完落定后透镜应当落下、标记清掉：' + JSON.stringify(s)); }
  await close(o, 'seg drag');

  // 甩：Playwright 的鼠标在无头浏览器里每步间隔几十毫秒，甩不起来；在页面里直接发指针事件，每个之间忙等 3ms
  // （同一个任务里发完，不受机器忙闲影响）：6px / 3ms = 2px/ms，总共只挪 18px——离第一项还最近，能走到第二项全靠「甩」
  o = await prep(); p = o.page;
  await p.evaluate(s => {
    const b = document.querySelector(s + ' > button'), r = b.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    const fire = (type, dx) => b.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 7,
      isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x + dx, clientY: y, pointerType: 'mouse' }));
    const wait = ms => { const t = performance.now(); while (performance.now() - t < ms) { /* 忙等 */ } };
    fire('pointerdown', 0);
    for (const dx of [6, 12, 18]) { wait(3); fire('pointermove', dx); }
    wait(3); fire('pointerup', 18);
  }, SEG);
  await p.waitForTimeout(60);
  s = await st(p);
  if (await sel(p) !== 1) { fail('往右轻甩 18px（离第一项还最近）应当走到下一项'); }
  if (!(Math.abs(s.st) > 0.002 && /scale/.test(s.transform))) { fail('甩出去时整条应当朝甩的方向形变：' + JSON.stringify(s)); }
  if (!await until(p, s => !document.querySelector(s).style.transform, SEG)) { fail('甩完应当回弹到原样'); }
  await close(o, 'seg flick');

  o = await prep(); p = o.page; B = await at(p);
  await p.mouse.move(B[0].x, B[0].y); await p.mouse.down();
  await p.mouse.move(B[0].x - 400, B[0].y, { steps: 16 }); await p.waitForTimeout(150);
  s = await st(p);
  if (!(s.st > 0.01 && s.st <= 0.05 + 1e-6 && /scale/.test(s.transform))) { fail('拖过左端应当整条被拉长、且有上限（≤ 5%）：' + JSON.stringify(s)); }
  await p.mouse.up(); await p.waitForTimeout(1000);
  if ((await st(p)).transform || await sel(p) !== 0) { fail('拖过两端松手：应当弹回原样、选中不变'); }
  // 点最后一项：只有一块玻璃整块滑过去——悬停透镜不出来（它会先到终点，看着像选中「跳」过去），
  // 选中色跟着玻璃走、依次经过中间的项，而不是一点就跳到终点
  await p.evaluate(s => {
    const seg = document.querySelector(s), btns = [...seg.querySelectorAll(':scope > button')];
    window.__trip = { near: [], lens: 0, big: btns.map(() => 1), mid: btns.map(() => false) };
    const tick = () => {
      if (!window.__trip) { return; }
      const n = btns.findIndex(b => b.hasAttribute('data-lg-near')), l = seg.querySelector('.lg-lens'), t = window.__trip;
      if (n >= 0 && t.near[t.near.length - 1] !== n) { t.near.push(n); }
      if (l) { t.lens = Math.max(t.lens, parseFloat(l.style.getPropertyValue('--a') || 0)); }
      // 玻璃路过时字的放大和上色是连续的：记每一项放大到多少、有没有出现过「盖住一半」的中间态
      btns.forEach((b, i) => { t.big[i] = Math.max(t.big[i], +(b.style.scale || 1)); const z = parseFloat(b.style.getPropertyValue('--lg-z')); if (z > 0.15 && z < 0.85) { t.mid[i] = true; } });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, SEG);
  await p.mouse.move(B[3].x, B[3].y); await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(120);
  if (!(await st(p)).fly) { fail('点别的项：滑块应当浮着飞过去'); }
  await landed(p, SEG); await p.waitForTimeout(100);
  const trip = await p.evaluate(() => { const t = window.__trip; window.__trip = null; return t; });
  if (trip.lens > 0.1) { fail(`点别的项：飞的时候悬停透镜不该出来（--a 最高 ${trip.lens.toFixed(2)}），不然它先到终点，看着像选中跳过去`); }
  if (!(trip.near.indexOf(1) >= 0 && trip.near.indexOf(2) >= 0 && trip.near[trip.near.length - 1] === 3)) {
    fail('点别的项：选中色应当跟着玻璃依次经过中间的项，实际经过 ' + JSON.stringify(trip.near));
  }
  if (!(trip.big[1] > 1.02 && trip.big[2] > 1.02 && trip.big[3] > 1.08 && trip.mid[1] && trip.mid[2])) {
    fail('点别的项：玻璃路过的字应当跟着被盖住的比例连续放大、上色（' + JSON.stringify(trip) + '）');
  }
  s = await st(p);
  if (s.fly || s.lifted || await sel(p) !== 3) { fail('点别的项：到了应当落下、选中那一项'); }
  if (s.ink || s.scale.some(x => x !== 1)) { fail('点别的项：落定后字应当复原、data-lg-ink 撤掉：' + JSON.stringify(s)); }
  await close(o, 'seg band');

  // 按住别的项（iOS 26：手指按在哪一项，玻璃就到哪一项底下）：还没松手就浮起、飞到手指下面；松手才交给页面去选
  o = await prep(); p = o.page; B = await at(p);
  await p.mouse.move(B[2].x, B[2].y); await p.mouse.down();
  const under = await until(p, s => { const seg = document.querySelector(s), T = seg.__lgT, b = seg.querySelectorAll(':scope > button')[2];
    return Math.abs((T.l + T.r) / 2 - (b.offsetLeft + b.offsetWidth / 2)) < 2; }, SEG);
  s = await st(p);
  if (!s.lifted || !under) { fail('按住没选中的项：滑块应当浮起、飞到手指下面：' + JSON.stringify({ lifted: s.lifted, under })); }
  if (await sel(p) !== 0) { fail('按住没选中的项、还没松手：不该已经换了选中'); }
  // 接着拖回第二项松手：从别的项起拖也行
  await p.mouse.move(B[1].x, B[1].y, { steps: 12 }); await p.waitForTimeout(200);
  await p.mouse.up(); await landed(p, SEG);
  s = await st(p);
  if (await sel(p) !== 1 || s.lifted) { fail(`从没选中的项拖到第二项松手：应当选中第二项、透镜落下，实际第 ${await sel(p) + 1} 项`); }
  await close(o, 'seg press other');

  // 玻璃导航条：按住第一项拖到第三项，松手选中第三项；拖动中透镜浮起、在折射
  o = await prep(); p = o.page;
  await p.locator('.demo-tabbar').evaluate(e => e.closest('.demo-phone').scrollIntoView({ block: 'center' }));
  await p.waitForTimeout(200);
  const T3 = await p.locator('.demo-tabbar > button').evaluateAll(xs => xs.map(x => { const r = x.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  await p.mouse.move(T3[0].x, T3[0].y); await p.mouse.down();
  await p.mouse.move(T3[2].x, T3[2].y, { steps: 20 }); await p.waitForTimeout(300);
  const tb = await p.evaluate(() => { const l = document.querySelector('.demo-tabbar .lg-lift'); return !!l && l.hasAttribute('data-up') && /url/.test(getComputedStyle(l.querySelector('.lg-lift-ref')).backdropFilter); });
  // 浮起的透镜要压在整条自己的高光环（.lg-glass::after）和 HDR 高光上面：同层的话高光环后画、盖在透镜上，透镜里透出一道整条的边
  const zs = await p.evaluate(() => {
    const bar = document.querySelector('.demo-tabbar'), l = bar.querySelector('.lg-lift'), t = document.createElement('img');
    t.className = 'lg-hdr'; bar.appendChild(t);
    const z = { lift: +getComputedStyle(l).zIndex, rim: +getComputedStyle(bar, '::after').zIndex, hdr: +getComputedStyle(t).zIndex };
    t.remove();
    return z;
  });
  if (!(zs.lift > zs.rim && zs.lift > zs.hdr)) { fail('玻璃导航条：浮起的透镜要压在整条的高光环和 HDR 高光上面（不然透镜里透出整条的边）：' + JSON.stringify(zs)); }
  const tz = await p.evaluate(() => [...document.querySelectorAll('.demo-tabbar > button')].map(x => ({ s: +(x.style.scale || 1), c: getComputedStyle(x).color, w: +getComputedStyle(x).fontWeight })));
  // 松手到落定，逐帧看：页面的 click 还没处理完的那一两帧里，原来那一项不许变回选中的样子（变粗、上色）。
  // 要看「这一帧画出来的样子」：在 window 冒泡阶段的 pointerup 里才开始逐帧记，这样每帧都排在脚本自己那一帧动画后面
  // （画面就是它之后的样子）；rAF 里接 setTimeout 再看不行——替用户点的那一下 click 排在它前面，看到的已经是改好的
  await p.evaluate(() => {
    const bs = [...document.querySelectorAll('.demo-tabbar > button')], bad = window.__tbBad = [];
    const tick = () => { if (window.__tbBad !== bad) { return; } const w = bs.map(b => +getComputedStyle(b).fontWeight); if (w[0] > 560 || w[2] < 600) { bad.push(w); } requestAnimationFrame(tick); };
    window.addEventListener('pointerup', () => requestAnimationFrame(tick), { once: true });
  });
  await p.mouse.up(); await landed(p, '.demo-tabbar');
  const tbad = await p.evaluate(() => { const b = window.__tbBad; window.__tbBad = null; return b; });
  const tsel = await p.evaluate(() => [...document.querySelectorAll('.demo-tabbar > button')].findIndex(x => x.getAttribute('aria-pressed') === 'true'));
  if (!tb || tsel !== 2) { fail('玻璃导航条：按住拖到第三项，透镜应当浮起并折射、松手选中第三项：' + JSON.stringify({ lifted: tb, sel: tsel })); }
  if (!(tz[2].s > 1.12 && tz[2].w >= 600 && tz[2].c !== tz[0].c && tz[0].s === 1 && tz[0].w <= 560)) {
    fail('玻璃导航条：透镜底下那一项应当放大、变粗、换成主色，离开的那一项复原：' + JSON.stringify(tz));
  }
  if (tbad.length) { fail(`玻璃导航条：松手后有 ${tbad.length} 帧字的样子退回了页面的旧选中（粗细 ${JSON.stringify(tbad[0])}），会闪一下`); }
  await close(o, 'tabbar');

  o = await prep('lite'); p = o.page; B = await at(p);
  await p.mouse.move(B[0].x, B[0].y); await p.mouse.down();
  await p.mouse.move(B[1].x, B[1].y, { steps: 12 }); await p.waitForTimeout(200);
  s = await st(p);
  if (s.lifted || s.transform) { fail('精简档：拖的时候不该浮起、不该拉长'); }
  await p.mouse.up(); await p.waitForTimeout(300);
  if (await sel(p) !== 1) { fail('精简档：应当照样能拖着换选中'); }
  await close(o, 'seg lite');
  console.log('  分段开关：按住浮起（字放大）、拖、甩、橡皮筋、点（字跟着玻璃连续变）、按住别的项、玻璃导航条、精简档都过了一遍');
}

/**
 * 滚动容器里的透镜和滑块不许把滚动尺寸撑大：撑大一个像素，滚动条就闪一下（表格最后一行：透镜回弹往下多冲 1px，
 * 竖滚动条一出来又挤出横滚动条）。鼠标在最后两项之间来回划几次，逐帧盯着滚动尺寸。
 */
async function overflowCheck() {
  const o = await open({ mode: 'full' });
  const p = o.page;
  for (const [name, box, items] of [['表格', '.lg-table-wrap', '.lg-table tbody tr'], ['侧栏菜单', '.lg-nav', '.lg-nav-plate:not([hidden]) .lg-nav-item']]) {
    const n = await p.locator(items).count();
    if (n < 2) { continue; }
    await p.locator(box).evaluate(e => e.scrollIntoView({ block: 'center' }));
    await p.waitForTimeout(300);
    await p.evaluate(sel => {
      const w = document.querySelector(sel), m = { h: w.scrollHeight, w: w.scrollWidth, h0: w.scrollHeight, w0: w.scrollWidth };
      const tok = (window.__ov = (window.__ov || 0) + 1);
      const t = () => { if (window.__ov !== tok) { return; } m.h = Math.max(m.h, w.scrollHeight); m.w = Math.max(m.w, w.scrollWidth); requestAnimationFrame(t); };
      window.__ovm = m; requestAnimationFrame(t);
    }, box);
    const a = await p.locator(items).nth(n - 2).boundingBox(), z = await p.locator(items).nth(n - 1).boundingBox();
    for (let k = 0; k < 5; k++) {
      await p.mouse.move(a.x + a.width * 0.4, a.y + a.height / 2, { steps: 3 }); await p.waitForTimeout(220);
      await p.mouse.move(z.x + z.width * 0.4, z.y + z.height / 2, { steps: 3 }); await p.waitForTimeout(320);
    }
    await p.mouse.move(z.x + z.width * 0.4, z.y + z.height + 60, { steps: 3 }); await p.waitForTimeout(500);
    const m = await p.evaluate(() => { window.__ov++; return window.__ovm; });
    if (m.h > m.h0 || m.w > m.w0) { failures.push(`滚动条：鼠标划过${name}最后一项时滚动尺寸被撑大（${m.w0}×${m.h0} → ${m.w}×${m.h}），滚动条会闪一下`); }
  }
  // 内容变短：停在最后一行，再去点筛选只剩两行。透镜（淡出中、淡完了的都算）不能还停在原来第十行那儿撑着。
  // 每帧画完再量（rAF 里接 setTimeout）：同一帧里脚本还没来得及挪透镜的中间态不算
  if (await p.locator('#filter button[data-filter="warn"]').count()) {
    const rows = p.locator('.lg-table tbody tr'), n = await rows.count();
    const last = await rows.nth(n - 1).boundingBox();
    await p.mouse.move(last.x + last.width * 0.4, last.y + last.height / 2, { steps: 3 }); await p.waitForTimeout(500);
    await p.evaluate(() => {
      const w = document.querySelector('.lg-table-wrap'), bad = window.__ovBad = [];
      const tok = (window.__ov = (window.__ov || 0) + 1);
      const t = () => {
        if (window.__ov !== tok) { return; }
        setTimeout(() => { const d = [w.scrollWidth - w.clientWidth, w.scrollHeight - w.clientHeight]; if (d[0] > 0 || d[1] > 0) { bad.push(d); } }, 0);
        requestAnimationFrame(t);
      };
      requestAnimationFrame(t);
    });
    await p.click('#filter button[data-filter="warn"]'); await p.waitForTimeout(600);
    const k = await rows.count();
    for (let i = 0; i < 2 * k; i++) {
      const r = await rows.nth(i % k).boundingBox();
      await p.mouse.move(r.x + r.width * 0.4, r.y + r.height / 2, { steps: 3 }); await p.waitForTimeout(300);
    }
    await p.mouse.move(last.x + 40, 40, { steps: 3 }); await p.waitForTimeout(500);
    const bad = await p.evaluate(() => { window.__ov++; return window.__ovBad; });
    if (bad.length) { failures.push(`滚动条：表格筛完只剩 ${k} 行后有 ${bad.length} 帧被透镜撑出滚动范围（${JSON.stringify(bad[0])}）`); }
    await p.click('#filter button[data-filter=""]'); await p.waitForTimeout(300);
  }
  console.log('  滚动容器：表格、侧栏菜单的最后一项来回划过、表格筛短之后，滚动尺寸都没被撑大');
  await close(o, 'overflow');
}

/**
 * 真滚动条下的滚动条校验（pitfalls.md #36、#38、#41）。上面那一套在默认的无头浏览器里跑：滚动条是隐藏的、不占位置，
 * 缩放 1 倍——亚像素的溢出被舍掉、竖滚动条也挤不出横滚动条，Mac 视网膜屏上「点一下表格最后一行滚动条就闪」在那里看不见。
 * 这里另开一个浏览器：滚动条照常画、占位置（--hide-scrollbars 去掉），真的按 2 倍渲染（--force-device-scale-factor，
 * 不是 deviceScaleFactor 那种模拟）。用 ResizeObserver（排版之后、绘制之前）看外框内容区有没有变窄 / 变矮——变了就是滚动条真的画出来了。
 *   · 表格（全部、筛成两行）：每一行点一下（短按、长按、点在行里不同位置），最后两行之间来回划、点
 *   · 自锁：停在最后一行时让竖滚动条合法地出来（给外框限高），透镜要在同一次排版里跟着变窄，横滚动条一帧都不许出
 *   · 侧栏菜单最后几项来回划
 */
async function scrollbarCheck() {
  let b2;
  try {
    b2 = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--force-device-scale-factor=2'] });
  } catch (e) { console.log('  （真滚动条校验跳过：' + String(e).slice(0, 80) + '）'); return; }
  const fail = m => failures.push('真滚动条（2 倍屏）：' + m), before = failures.length;
  const ctx = await b2.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.addInitScript(k => { try { localStorage.setItem(k, 'full'); } catch (e) {} }, modeKey);
  await p.goto(base);
  await p.waitForTimeout(700);
  const watch = sel => p.evaluate(sel => {
    const w = document.querySelector(sel), ev = window.__sbEv = [], cw = w.clientWidth, ch = w.clientHeight;
    if (window.__sbRo) { window.__sbRo.disconnect(); }
    window.__sbRo = new ResizeObserver(() => { if (w.clientWidth !== cw || w.clientHeight !== ch) { ev.push([w.clientWidth - cw, w.clientHeight - ch]); } });
    window.__sbRo.observe(w);
    return w.scrollWidth > w.clientWidth || w.scrollHeight > w.clientHeight;
  }, sel);
  const seen = () => p.evaluate(() => window.__sbEv.length);
  if (await p.locator('.lg-table-wrap').count()) {
    for (const filter of ['', 'warn']) {
      const fb = p.locator(`#filter button[data-filter="${filter}"]`);
      if (await fb.count()) { await fb.click(); await p.waitForTimeout(400); } else if (filter) { continue; }
      await p.locator('.lg-table-wrap').evaluate(e => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(250);
      if (await watch('.lg-table-wrap')) { fail(`表格（${filter || '全部'}）还没动就有滚动条`); continue; }
      const rows = p.locator('.lg-table tbody tr'), n = await rows.count();
      for (let i = 0; i < n; i++) {
        const r = await rows.nth(i).boundingBox(), fx = [0.1, 0.5, 0.9][i % 3], fy = [0.2, 0.5, 0.85][(i + 1) % 3];
        await p.mouse.move(r.x + r.width * fx, r.y + r.height * fy, { steps: 2 }); await p.waitForTimeout(120);
        await p.mouse.down(); await p.waitForTimeout(i % 2 ? 280 : 50); await p.mouse.up(); await p.waitForTimeout(160);
      }
      const last = await rows.nth(n - 1).boundingBox(), prev = n > 1 ? await rows.nth(n - 2).boundingBox() : last;
      for (let k = 0; k < 3; k++) {
        await p.mouse.move(prev.x + prev.width * 0.3, prev.y + prev.height * 0.5, { steps: 3 }); await p.waitForTimeout(150);
        await p.mouse.move(last.x + last.width * (0.2 + k * 0.3), last.y + last.height * 0.95, { steps: 3 }); await p.waitForTimeout(260);
        await p.mouse.down(); await p.waitForTimeout(90); await p.mouse.up(); await p.waitForTimeout(200);
      }
      await p.mouse.move(last.x + 30, last.y + last.height + 70, { steps: 3 }); await p.waitForTimeout(500);
      const k = await seen();
      if (k) { fail(`表格（${filter || '全部'}）点每一行、在最后两行之间划和点：滚动条闪了 ${k} 次`); }
    }
    const fb = p.locator('#filter button[data-filter=""]');
    if (await fb.count()) { await fb.click(); await p.waitForTimeout(400); }
    const rows = p.locator('.lg-table tbody tr'), n = await rows.count(), last = await rows.nth(n - 1).boundingBox();
    await p.mouse.move(last.x + last.width * 0.6, last.y + last.height * 0.5, { steps: 3 }); await p.waitForTimeout(500);
    const r = await p.evaluate(async () => {
      const w = document.querySelector('.lg-table-wrap'), next = () => new Promise(ok => requestAnimationFrame(ok));
      let h = 0;
      w.style.maxHeight = (w.clientHeight - 20) + 'px';
      for (let i = 0; i < 30; i++) { await next(); if (w.scrollWidth > w.clientWidth) { h++; } }
      w.style.maxHeight = '';
      for (let i = 0; i < 30; i++) { await next(); }
      return { h, after: w.scrollWidth > w.clientWidth || w.scrollHeight > w.clientHeight };
    });
    if (r.h || r.after) { fail(`自锁：竖滚动条合法出现时，透镜有 ${r.h} 帧比表格宽、撑出横滚动条${r.after ? '，拿掉以后滚动条也没退' : ''}`); }
  }
  if (await p.locator('.lg-nav').count()) {
    await watch('.lg-nav');
    const it = p.locator('.lg-nav-plate:not([hidden]) .lg-nav-item'), n = await it.count();
    for (let k = 0; k < 3 && n > 1; k++) {
      for (const i of [n - 2, n - 1]) {
        const r = await it.nth(i).boundingBox();
        await p.mouse.move(r.x + r.width * [0.2, 0.8][k % 2], r.y + r.height * [0.3, 0.9][k % 2], { steps: 3 }); await p.waitForTimeout(200);
      }
    }
    const k = await seen();
    if (k) { fail(`侧栏菜单最后几项来回划：滚动条闪了 ${k} 次`); }
  }
  await ctx.close(); await b2.close();
  if (failures.length === before) { console.log('  真滚动条（2 倍屏）：表格每一行点过、最后两行划过点过、筛短后、竖滚动条合法出现时、侧栏最后几项，滚动条都没闪'); }
}

/**
 * 引入方式（integration.md §1）：别的项目怎么引都要能用、都不会坏。在演示页的地址下换上一段最小的页面（相对路径照样能找到脚本）：
 *   · <head> 里 <link> + <script> 两行、不写内联脚本：用户选过「关闭」的，页面画出来之前档位就已经是 off / l0（不闪）
 *   · 浏览器原生 ES 模块 import liquid-glass.mjs：拿到的就是全局那一个，滑块照样长出来
 *   · <script> 和 import 各引一次：只跑一份（每个分段开关一个滑块）
 *   · init({ presets: false }) 滑块全撤、init({ presets: true }) 长回来；init 返回自己
 */
async function importCheck() {
  if (userUrl) { return; }
  const fail = m => failures.push('引入方式：' + m);
  const page = (head, tail) => `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><link rel="stylesheet" href="../liquid-glass.css">${head}</head>
<body class="lg-page"><script>window.__early = [document.documentElement.getAttribute('data-lg-mode'), document.documentElement.getAttribute('data-lg-tier')];</script>
<div class="lg-seg"><button type="button" aria-pressed="true">今天</button><button type="button" aria-pressed="false">本周</button><button type="button" aria-pressed="false">本月</button></div>
<div class="lg-seg lg-seg--sm"><button type="button" aria-pressed="false">全部</button><button type="button" aria-pressed="true">完成</button></div>${tail}</body></html>`;
  const thumbs = p => p.evaluate(() => [...document.querySelectorAll('.lg-seg')].map(s => s.querySelectorAll(':scope > .lg-thumb').length).join(''));
  // 先打开同源下一个空白地址（演示页目录下不存在的文件），再写进测试页：不能在演示页上 setContent——那一页已经跑着一份 LiquidGlass
  const run = async (name, html, saved, fn) => {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 600 } });
    const p = await ctx.newPage(), errors = [];
    p.on('pageerror', e => errors.push(String(e)));
    await p.goto(new URL('__blank__.html', base).href);
    await p.evaluate(v => { try { if (v) { localStorage.setItem('lg.glass', v); } else { localStorage.removeItem('lg.glass'); } } catch (e) {} }, saved);
    await p.setContent(html, { waitUntil: 'load' });
    await p.waitForTimeout(500);
    await fn(p);
    if (errors.length) { fail(name + '：页面报错 ' + errors.slice(0, 3).join(' | ')); }
    await ctx.close();
  };
  await run('<head> 两行', page('<script src="../liquid-glass.js"></script>', ''), 'off', async p => {
    const r = await p.evaluate(() => ({ early: window.__early, supported: window.LiquidGlass && window.LiquidGlass.supported }));
    if (!r.supported || r.early[0] !== 'off' || r.early[1] !== 'l0') { fail('<head> 里两行：选过「关闭」的，页面画出来之前档位应当已经是 off / l0，实际 ' + JSON.stringify(r)); }
  });
  await run('ES 模块', page('', '<script type="module">import LG from "../liquid-glass.mjs"; window.__esm = LG;</script>'), null, async p => {
    const same = await p.evaluate(() => !!window.__esm && window.__esm === window.LiquidGlass && window.__esm.supported);
    if (!same || await thumbs(p) !== '11') { fail('原生 ES 模块：应当拿到全局那一个、滑块照样长出来，实际 ' + JSON.stringify({ same, thumbs: await thumbs(p) })); }
  });
  await run('引两次', page('<script src="../liquid-glass.js"></script>', '<script type="module">import LG from "../liquid-glass.mjs"; window.__esm = LG;</script>'), null, async p => {
    const t = await thumbs(p), same = await p.evaluate(() => window.__esm === window.LiquidGlass);
    if (t !== '11' || !same) { fail('<script> 和 import 各引一次：应当只跑一份，实际滑块 ' + t + '、同一个 ' + same); }
  });
  await run('init', page('<script src="../liquid-glass.js"></script>', ''), null, async p => {
    const r = await p.evaluate(async () => {
      const fr = () => new Promise(ok => requestAnimationFrame(() => requestAnimationFrame(ok)));
      const L = window.LiquidGlass, n = () => document.querySelectorAll('.lg-seg > .lg-thumb').length;
      const chain = L.init({ presets: false }) === L; await fr(); const off = n();
      L.init({ presets: true }); await fr(); const on = n();
      return { chain, off, on };
    });
    if (!r.chain || r.off !== 0 || r.on !== 2) { fail('init({ presets: false }) 应当撤掉滑块、再 true 长回来，并返回自己，实际 ' + JSON.stringify(r)); }
  });
  console.log('  引入方式：<head> 两行（不闪）、原生 ES 模块、引两次只跑一份、init 换配置都对');
}

if (!checkOnly) { await mkdir(outDir, { recursive: true }); }

/**
 * 三档校验：同一个悬停状态，三档在 DOM 上和像素上都得分得开。
 *   DOM：完整 = 透镜在、带跟手的光；精简 = 实色（l0）、透镜在、没有光；关闭 = 实色、没有透镜、高光环为 none
 *   像素：在透镜所在的那块面板里比，任意两档至少 1% 的像素不同（肉眼能分出来的下限）
 */
async function modeCheck({ target, clip, thumb = false, refract = false, save = false }) {
  const bufs = {};
  for (const mode of ['full', 'lite', 'off']) {
    const o = await open({ mode });
    const sel = target || await o.page.evaluate(() => {
      // 挑没选中的项：落在选中项上的透镜几乎透明，三档差别最小。<html> 上也有 data-lg-lens（脚本写的），所以限定在 body 里
      const c = document.querySelectorAll('.lg-nav-item:not([aria-selected="true"]):not([aria-current="page"]), .lg-seg > button:not([aria-pressed="true"]),'
        + ' .lg-menu-item:not([aria-checked="true"]), .lg-list-item, .lg-item, body [data-lg-lens] > *');
      for (let i = 0; i < c.length; i++) {
        const r = c[i].getBoundingClientRect();
        if (r.width > 8 && r.height > 8 && r.top >= 0 && r.bottom <= innerHeight && !c[i].disabled) { c[i].setAttribute('data-lg-shoot', ''); return '[data-lg-shoot]'; }
      }
      return null;
    });
    if (sel) { await hover(o.page, sel); }
    const st = await o.page.evaluate(() => {
      const lens = document.querySelector('.lg-lens'), light = lens && lens.querySelector('.lg-lens-light');
      const box = lens ? lens.parentElement.getBoundingClientRect() : null;
      return {
        tier: document.documentElement.getAttribute('data-lg-tier'),
        lensAttr: document.documentElement.hasAttribute('data-lg-lens'),
        lens: !!lens,
        thumb: !!document.querySelector('.lg-thumb'),
        light: !!light && getComputedStyle(light).display !== 'none',
        rim: getComputedStyle(document.documentElement).getPropertyValue('--lg-rim').trim(),
        refract: document.querySelectorAll('[data-lg-refract-on]').length,
        box: box && { x: box.x, y: box.y, width: box.width, height: box.height }
      };
    });
    const expect = {
      full: { lensAttr: true, lens: !!sel, light: !!sel },
      lite: { tier: 'l0', lensAttr: true, lens: !!sel, light: false },
      off: { tier: 'l0', lensAttr: false, lens: false, thumb: false }
    }[mode];
    if (mode === 'full' && !/^l[123]$/.test(st.tier || '')) { failures.push(`三档校验 full：材质档应为 l1–l3，实际 ${st.tier}`); }
    if (thumb && mode !== 'off') { expect.thumb = true; }
    for (const k of Object.keys(expect)) {
      if (st[k] !== expect[k]) { failures.push(`三档校验 ${mode}：${k} 应为 ${expect[k]}，实际 ${st[k]}`); }
    }
    if (mode === 'off' && st.rim !== 'none') { failures.push(`三档校验 off：--lg-rim 应为 none，实际 ${st.rim}`); }
    if (refract && mode === 'full' && st.refract < 1) { failures.push('三档校验 full：没有一块玻璃开了折射'); }
    if (mode === 'full' && !clip && st.box) {                     // 在透镜所在的面板周围比
      const vw = o.page.viewportSize();
      const x = Math.max(0, st.box.x - 16), y = Math.max(0, st.box.y - 16);
      clip = { x, y, width: Math.min(vw.width - x, st.box.width + 32), height: Math.min(vw.height - y, st.box.height + 32) };
    }
    bufs[mode] = await o.page.screenshot({ clip: clip || undefined });
    if (save && !checkOnly) { await writeFile(join(outDir, `mode-${mode}.png`), bufs[mode]); }
    delete st.box;
    console.log(`  ${mode.padEnd(4)} ${JSON.stringify(st)}`);
    await close(o, `mode-${mode}`);
  }
  if (!target && !clip) {
    console.log('  没找到能出透镜的项：只比了整屏。用 --hover 指定一个选择器，校验才可靠');
  }
  for (const [a, b] of [['full', 'lite'], ['lite', 'off'], ['full', 'off']]) {
    const r = await diff(bufs[a], bufs[b]);
    console.log(`  像素差 ${a} ↔ ${b}：${(r * 100).toFixed(2)}%`);
    if (r < 0.01) { failures.push(`三档校验：${a} 与 ${b} 只有 ${(r * 100).toFixed(2)}% 的像素不同，肉眼分不出来`); }
  }
  return bufs;
}

if (userUrl) {
  // 你自己的页面：浅 / 深 × 三档，各拍一张全屏；再在一个悬停状态下做三档校验
  for (const theme of ['light', 'dark']) {
    for (const mode of ['full', 'lite', 'off']) {
      const o = await open({ theme, mode });
      await shot(o.page, `${theme}-${mode}.png`);
      await close(o, `${theme}-${mode}`);
    }
  }
  await modeCheck({ target: hoverSel, save: true });
} else {
  const NAV3 = '.lg-nav-item[data-key="3"]';
  // ── 1 三档校验（演示页：悬停侧栏的「报表」，比整条侧栏；演示页里一定有滑块、保存条一定折射） ──
  const bufs = await modeCheck({ target: NAV3, clip: { x: 0, y: 0, width: 280, height: 900 }, thumb: true, refract: true, save: true });

  // ── 1.5 一致性校验 ──
  // 评审里被指出过的两类问题：一是「有的按钮悬停有动效、有的没有」，二是「同一种玻璃这里深那里浅」。
  // 这里把演示页每一个能点的东西都悬停一遍，确认都有反馈（透镜流到它底下，或者它自己浮起 / 变光）；
  // 再核对所有玻璃是同一种材质：宿主背景透明、玻璃层的底色与模糊一样、并排的胶囊像素上看不出差别。
  await consistencyCheck();

  // ── 1.6 折射与分段开关 ──
  await refractCheck();
  await segCheck();
  await overflowCheck();
  await scrollbarCheck();
  await importCheck();

  if (!checkOnly) {
    // ── 2 图集 ──
    const scenes = [
      ['light.png', { theme: 'light' }, async p => { await hover(p, NAV3); }],
      ['dark.png', { theme: 'dark' }, async p => { await hover(p, NAV3); }],
      ['sidebar-hover@2x.png', { dpr: 2 }, async p => { await hover(p, NAV3, 160); }, { x: 0, y: 0, width: 262, height: 520 }],
      ['danger.png', { dpr: 2 }, async p => {
        await p.click('.lg-nav-group--danger'); await p.waitForTimeout(300);
        await p.click('.lg-nav-item--danger'); await p.waitForTimeout(900);
        await p.mouse.move(700, 600); await p.waitForTimeout(800);
      }, { x: 0, y: 0, width: 262, height: 640 }],
      ['rail.png', { dpr: 2 }, async p => {
        await p.click('#sb-toggle'); await p.waitForTimeout(500);
        await hover(p, '.lg-nav-item[data-key="2"]', 900);
      }, { x: 0, y: 0, width: 260, height: 520 }],
      ['menu.png', { dpr: 2 }, async p => {
        await p.click('#ws-chip'); await p.waitForTimeout(600);
        await hover(p, '.lg-menu-item[data-ws="测试"]', 700);
      }, null, async p => { const m = await p.locator('.lg-menu').boundingBox(); return { x: m.x - 24, y: 0, width: 1440 - (m.x - 24), height: m.y + m.height + 28 }; }],
      ['palette.png', {}, async p => {
        await p.keyboard.press('Control+k'); await p.waitForTimeout(400);
        await p.keyboard.press('ArrowDown'); await p.waitForTimeout(80);
        await p.keyboard.press('ArrowDown'); await p.waitForTimeout(700);
      }],
      ['buttons@2x.png', { dpr: 2 }, async p => { await hover(p, '#btn-sample', 700); },
        null, async p => { const b = await p.locator('.lg-actions').first().boundingBox(); return { x: b.x - 10, y: b.y - 14, width: b.width + 20, height: b.height + 28 }; }],
      ['refraction@2x.png', { dpr: 2 }, async p => {
        await p.evaluate(() => { const d = document.getElementById('drop'); d.style.transform = 'translate(150px,34px)'; });
        await p.waitForTimeout(500);
      }, null, async p => { const b = await p.locator('#lab').boundingBox(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }],
      ...['light', 'dark'].map(theme => [theme === 'light' ? 'lift@2x.png' : 'lift-dark@2x.png', { dpr: 2, theme }, async p => {
        // 按住「今天」往右拖到「本周」和「本月」之间：透镜浮起来，边上把底下的字放大、弯折
        const seg = p.locator('.lg-seg[aria-label="时间范围"]');
        await seg.scrollIntoViewIfNeeded();
        const b = await p.locator('.lg-seg[aria-label="时间范围"] > button').evaluateAll(xs => xs.map(x => { const r = x.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
        await p.mouse.move(b[0].x, b[0].y); await p.mouse.down();
        await p.mouse.move((b[1].x + b[2].x) / 2 - 6, b[0].y, { steps: 14 });
        await p.waitForTimeout(500);
      }, null, async p => { const b = await p.locator('.lg-seg[aria-label="时间范围"]').boundingBox(); return { x: b.x - 18, y: b.y - 18, width: b.width + 36, height: b.height + 36 }; }]),
      ...['light', 'dark'].map(theme => [theme === 'light' ? 'tabbar@2x.png' : 'tabbar-dark@2x.png', { dpr: 2, theme }, async p => {
        // 玻璃导航条：内容往上滚一点，按住「概览」往右拖到「交给 AI」上：透镜浮起、把字和图标放大弯折
        await p.locator('.demo-phone').evaluate(e => { e.scrollIntoView({ block: 'center' }); e.scrollTop = 60; });
        await p.waitForTimeout(300);
        const b = await p.locator('.demo-tabbar > button').evaluateAll(xs => xs.map(x => { const r = x.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
        await p.mouse.move(b[0].x, b[0].y); await p.mouse.down();
        await p.mouse.move((b[0].x + b[1].x) / 2 + 30, b[0].y, { steps: 14 });
        await p.waitForTimeout(500);
      }, null, async p => { const b = await p.locator('.demo-phone').boundingBox(); return { x: b.x, y: b.y + b.height - 130, width: b.width, height: 130 }; }]),
      ['login.png', { query: '?view=login' }, async p => { await p.waitForTimeout(300); }],
      ['login-dark.png', { theme: 'dark', query: '?view=login' }, async p => { await p.waitForTimeout(300); }]
    ];
    for (const [file, o, act, clip, clipFn] of scenes) {
      const s = await open(o);
      await act(s.page);
      await shot(s.page, file, clipFn ? await clipFn(s.page) : clip || undefined);
      console.log('  ' + file);
      await close(s, file);
    }

    // ── 3 并排图：三档对比、侧栏分组的演变（给 README 与 design-decisions.md 用） ──
    async function compose(file, cols, w, h) {
      const s = await open({ w: 60 + cols.length * (w + 28), h: h + 80 });
      await s.page.setContent(`<body style="margin:0;background:#e8ecf2;font:600 15px system-ui,sans-serif;color:#17202a">
        <div style="display:flex;gap:28px;padding:22px 28px">${cols.map(c => `
          <figure style="margin:0;text-align:center;width:${w}px"><figcaption style="margin-bottom:10px;white-space:nowrap">${c.label}</figcaption>
          <img style="width:${w}px;display:block;border-radius:8px" src="data:image/png;base64,${c.buf.toString('base64')}"></figure>`).join('')}
        </div></body>`);
      await s.page.waitForTimeout(300);
      await shot(s.page, file, { x: 0, y: 0, width: 56 + cols.length * w + (cols.length - 1) * 28, height: h + 60 });
      console.log('  ' + file);
      await close(s, file);
    }
    await compose('modes.png', ['full', 'lite', 'off'].map((m, i) => ({ label: ['完整 Full', '精简 Lite', '关闭 Off'][i], buf: bufs[m] })), 280, 900);

    // 侧栏分组：改前（粗黑组标题 + 圆形图标底 + 通栏分隔线 + 箭头挂在最右）→ 方案 A（只靠留白）→ 定稿（分组底板）
    const VARIANTS = [
      ['改前', `.lg-nav-plate{background:transparent!important;box-shadow:none!important;padding:0!important}
        .lg-nav-group-title{font-size:12.5px!important;font-weight:700!important;color:var(--lg-ink)!important}
        .lg-nav-group::after{content:"";order:3;flex:1 1 auto;height:1px;background:var(--lg-line);margin-left:8px}
        .lg-nav-group-caret{order:5!important;margin-left:8px!important}
        .lg-nav-icon{width:24px!important;height:24px!important;border-radius:50%;background:var(--lg-well)}
        .lg-nav-icon svg{width:14px!important;height:14px!important}
        .lg-nav-plate+.lg-nav-group{margin-top:10px!important}.lg-nav-group+.lg-nav-plate{margin-top:6px!important}
        .lg-nav-item{height:36px!important}.lg-nav-key{opacity:.5!important}`],
      ['方案 A：只靠留白', `.lg-nav-plate{background:transparent!important;box-shadow:none!important;padding:0!important}
        .lg-nav-item{border-radius:16px!important}.lg-nav-plate+.lg-nav-group{margin-top:20px!important}`],
      ['定稿：分组底板', '']
    ];
    const vbufs = [];
    for (const [label, cssText] of VARIANTS) {
      const o = await open({ dpr: 2 });
      if (cssText) { await o.page.addStyleTag({ content: cssText }); await o.page.waitForTimeout(400); }
      vbufs.push({ label, buf: await o.page.screenshot({ clip: { x: 0, y: 0, width: 262, height: 560 } }) });
      await close(o, 'variant ' + label);
    }
    await compose('sidebar-evolution.png', vbufs, 262, 560);
  }
}

await browser.close();
if (srv) { srv.close(); }
if (failures.length) {
  console.error('\n失败 ' + failures.length + ' 项：\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log(checkOnly ? '\n校验通过' : `\n完成，截图在 ${outDir}`);
