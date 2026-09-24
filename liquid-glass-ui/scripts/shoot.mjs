#!/usr/bin/env node
/**
 * 用真浏览器把演示页（或你自己的页面）拍下来，并验三档是不是真的分得开。
 *
 *   node scripts/shoot.mjs                     拍演示页的整套截图到 ./shots/，并做三档校验与一致性校验
 *                                              （每个能点的元素悬停都有反馈；所有玻璃同一种材质、并排的胶囊不一深一浅）
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

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
function serve(dir) {
  return new Promise(ok => {
    const srv = createServer(async (req, res) => {
      const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const f = resolve(dir, '.' + u + (u.endsWith('/') ? 'index.html' : ''));
      if (!f.startsWith(dir + sep)) { res.writeHead(403).end(); return; }
      try { res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }).end(await readFile(f)); }
      catch (e) { res.writeHead(404).end(); }
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
    const n = await p.evaluate(sc => {
      const root = sc ? document.querySelector(sc) : document;
      const els = [...root.querySelectorAll('button, a[href], [role="option"], [role="menuitem"], [role="menuitemradio"], tbody tr')].filter(e => {
        const r = e.getBoundingClientRect();
        if (!(r.width > 4 && r.height > 4 && r.top >= 0 && r.bottom <= innerHeight) || e.disabled || e.closest('[hidden]')) { return false; }
        const hit = document.elementFromPoint(r.left + r.width * 0.4, r.top + r.height / 2);   // 鼠标真点得到它（没被粘住的保存条之类盖住）
        return !!hit && (hit === e || e.contains(hit));
      });
      els.forEach((e, i) => e.setAttribute('data-fb', i));
      return els.length;
    }, scope || null);
    const snap = i => p.evaluate(i => {
      const e = document.querySelector(`[data-fb="${i}"]`), cs = getComputedStyle(e), bs = getComputedStyle(e, '::before');
      const r = e.getBoundingClientRect();
      const lens = [...document.querySelectorAll('.lg-lens')].some(l => {
        if (!l.parentElement.contains(e) || parseFloat(l.style.getPropertyValue('--a') || 0) < 0.5) { return false; }
        const q = l.getBoundingClientRect();
        const ox = Math.max(0, Math.min(q.right, r.right) - Math.max(q.left, r.left)), oy = Math.max(0, Math.min(q.bottom, r.bottom) - Math.max(q.top, r.top));
        return ox * oy > 0.5 * r.width * r.height;
      });
      return { lens, look: [cs.transform, cs.boxShadow, cs.backgroundImage, cs.backgroundColor, bs.backgroundImage].join('|'),
        label: (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().replace(/\s+/g, ' ').slice(0, 16) };
    }, i);
    for (let i = 0; i < n; i++) {
      await p.mouse.move(1436, 4); await p.waitForTimeout(260);
      const before = await snap(i);
      const b = await p.locator(`[data-fb="${i}"]`).boundingBox();
      await p.mouse.move(b.x + b.width * 0.4, b.y + b.height / 2, { steps: 4 });
      await p.waitForTimeout(450);
      const after = await snap(i);
      if (!after.lens && after.look === before.look) { failures.push(`一致性（${name}）：「${before.label}」悬停没有任何反馈`); }
    }
    total += n;
    await close(o, 'consistency ' + name);
  }
  console.log(`  悬停反馈：${total} 个能点的元素逐个悬停过`);

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
