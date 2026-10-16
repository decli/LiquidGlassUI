#!/usr/bin/env node
/**
 * 静态检查：改了 liquid-glass.css / liquid-glass.js（或拷进项目后自己改过的副本）之后跑一遍。不需要浏览器，不需要装任何包。
 *
 *   node scripts/check.mjs                                  检查本套件 assets/ 下的三个文件
 *   node scripts/check.mjs path/to/liquid-glass.css path/to/liquid-glass.js [页面.html ...]
 *
 * 查的都是「改了不报错、只是静静地坏掉」的那一类：
 *   · 脚本只用 ES5（老浏览器上一个语法错误就是整个文件不执行）
 *   · 脚本不增删页面元素的 class（页面脚本按 className 全等判断时会认不出来）
 *   · 样式表括号配对；用到的 var(--x) 都有定义
 *   · 「深色（显式）」与「深色（跟随系统）」两块令牌逐字一致；深色里的令牌浅色里都有
 *   · 脚本插入的元素、预设里的组件类，样式表里都有；样式表认的状态属性，脚本都会写
 *   · 页面里用到的 lg-* 类都在样式表里（拼错一个字母就是一块不起作用的样式）
 *   · 查本套件自己时：脚本里折射的位移曲线常数（K）与 scripts/displacement_map.py 一致；
 *     品牌色推导（LiquidGlass.palette）在默认的蓝上复现样式表里的令牌、换任何颜色字都压得住
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const assets = resolve(here, '..', 'assets');
const argv = process.argv.slice(2);
const cssPath = argv[0] || resolve(assets, 'liquid-glass.css');
const jsPath = argv[1] || resolve(assets, 'liquid-glass.js');
const htmlPaths = argv.length > 2 ? argv.slice(2) : argv.length ? [] : [resolve(assets, 'demo', 'index.html')];

const css = readFileSync(cssPath, 'utf8');
const js = readFileSync(jsPath, 'utf8');
let pass = 0;
const fails = [];
function check(name, problems) {
  if (problems.length) { fails.push(name + '\n    ' + problems.slice(0, 12).join('\n    ')); console.log('✗ ' + name); }
  else { pass++; console.log('✓ ' + name); }
}

/** 去掉 JS 的注释、字符串、正则字面量（换成空白），剩下的才是代码 */
function stripJs(src) {
  let out = '', i = 0, prev = '';
  const regexBefore = /[(,=:[!&|?{};+\-*%<>~^]$/;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') { i++; } continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; out += ' '; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += q === '`' ? '`' : '""'; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') { i++; } i++; }
      i++; prev = '"'; continue;
    }
    if (c === '/' && (regexBefore.test(out.trimEnd()) || /\breturn$/.test(out.trimEnd()) || out.trim() === '')) {
      i++; let cls = false;
      while (i < src.length) {
        const d = src[i];
        if (d === '\\') { i += 2; continue; }
        if (d === '[') { cls = true; } else if (d === ']') { cls = false; } else if (d === '/' && !cls) { break; }
        i++;
      }
      i++; while (/[a-z]/i.test(src[i] || '')) { i++; }
      out += '/re/'; continue;
    }
    out += c; prev = c; i++;
  }
  return out;
}
/** 去掉 CSS 注释（noStr 为真时连字符串也去掉） */
function stripCss(src, noStr) {
  const s = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return noStr ? s.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""') : s;
}

const code = stripJs(js);
const lines = code.split('\n');
const es6 = [];
const rules = [[/=>/, '箭头函数'], [/\blet\s/, 'let'], [/\bconst\s/, 'const'], [/`/, '模板字符串'], [/\bclass\s+[A-Za-z_$]/, 'class'],
  [/\.\.\.[A-Za-z_$[]/, '展开语法'], [/\basync\s+function\b|\bawait\s/, 'async / await'], [/\bfor\s*\([^)]*\bof\b/, 'for…of']];
lines.forEach((l, n) => { for (const [re, what] of rules) { if (re.test(l)) { es6.push(`第 ${n + 1} 行：${what}：${l.trim().slice(0, 80)}`); } } });
check('脚本只用 ES5', es6);

const cls = [];
lines.forEach((l, n) => {
  if (/classList\s*\.\s*(add|remove|toggle|replace)\b/.test(l)) { cls.push(`第 ${n + 1} 行改了 classList：${l.trim().slice(0, 80)}`); }
});
js.split('\n').forEach((l, n) => {
  const m = /\.className\s*=(?!=)\s*(.*)$/.exec(l);
  if (m && !/^['"]lg-/.test(m[1].trim())) { cls.push(`第 ${n + 1} 行给不是自己插入的元素写了 className：${l.trim().slice(0, 80)}`); }
});
check('脚本不增删页面元素的 class（只给自己插入的元素写 lg-* 类）', cls);

const plain = stripCss(css, true), noComments = stripCss(css, false);
let depth = 0, bad = [];
plain.split('\n').forEach((l, n) => {
  for (const ch of l) { if (ch === '{') { depth++; } else if (ch === '}') { depth--; if (depth < 0) { bad.push(`第 ${n + 1} 行多了一个 }`); depth = 0; } } }
});
if (depth) { bad.push(`文件结束时还有 ${depth} 个 { 没有配对`); }
check('样式表括号配对', bad);

const defined = new Set([...plain.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
const LOCAL = ['--lg-t', '--lg-b', '--lg-s', '--lg-rw', '--lg-ref', '--mx', '--my', '--m', '--a', '--p', '--lg-z'];
const used = [...plain.matchAll(/var\(\s*(--[\w-]+)/g)].map(m => m[1]);
check('用到的 var(--x) 都有定义（或是约定的局部变量）',
  [...new Set(used)].filter(v => !defined.has(v) && !LOCAL.includes(v)).map(v => `${v} 没有定义`));

function block(sel) {
  const at = noComments.indexOf(sel);
  if (at < 0) { return null; }
  const s = noComments.indexOf('{', at), e = noComments.indexOf('}', s);
  return noComments.slice(s + 1, e);
}
function decls(body) {
  const map = new Map();
  for (const d of body.split(';')) { const i = d.indexOf(':'); if (i > 0) { map.set(d.slice(0, i).trim(), d.slice(i + 1).replace(/\s+/g, ' ').trim()); } }
  return map;
}
const light = block(':root {'), dark = block(':root[data-theme="dark"]'), auto = block(':root:not([data-theme="light"]):not([data-theme="dark"])');
const tk = [];
if (!light || !dark || !auto) { tk.push('找不到 :root / :root[data-theme="dark"] / 跟随系统 三块令牌之一'); }
else {
  const L = decls(light), D = decls(dark), A = decls(auto);
  for (const [k, v] of D) { if (A.get(k) !== v) { tk.push(`${k}：显式深色是「${v}」，跟随系统是「${A.get(k)}」`); } }
  for (const k of A.keys()) { if (!D.has(k)) { tk.push(`${k} 只在跟随系统那块里有`); } }
  for (const k of D.keys()) { if (!L.has(k)) { tk.push(`${k} 在深色里有、浅色 :root 里没有`); } }
}
check('深色令牌两块一致，且都在浅色里有', tk);

const classesInCss = new Set([...plain.matchAll(/\.(lg-[\w-]+)/g)].map(m => m[1]));
const jsClasses = [...js.matchAll(/className\s*=\s*'([^']+)'/g)].flatMap(m => m[1].split(/\s+/)).filter(c => /^lg-/.test(c) && !/-$/.test(c));
jsClasses.push('lg-thumb-seg', 'lg-thumb-nav', 'lg-thumb-cursor', 'lg-lens-sh', 'lg-lens-glass', 'lg-lens-ref', 'lg-lens-light', 'lg-lens-under');
const presetClasses = [...js.matchAll(/sel:\s*'([^']+)'/g)].flatMap(m => [...m[1].matchAll(/\.(lg-[\w-]+)/g)].map(x => x[1]));
check('脚本插入的元素、预设里的组件类，样式表里都有',
  [...new Set([...jsClasses, ...presetClasses])].filter(c => c !== 'lg-defs' && !classesInCss.has(c)).map(c => `.${c} 在样式表里没有`));

const stateAttrs = [...new Set([...plain.matchAll(/\[(data-(?:lg-[\w-]+|settled|onsel|danger|side|up))/g)].map(m => m[1]))];
const writtenByPage = ['data-lg-mode-switch', 'data-lg-tip', 'data-lg-lens', 'data-lg-refract', 'data-lg-slider', 'data-lg-hdr', 'data-lg-solid'];
check('样式表认的状态属性，脚本都会写', stateAttrs
  .filter(a => !js.includes(`'${a}'`) && !writtenByPage.includes(a) && !(a === 'data-lg-lens' && js.includes("'data-lg-lens'")))
  .map(a => `${a}：样式表里用了，脚本里没写`));

for (const p of htmlPaths) {
  const html = readFileSync(p, 'utf8');
  const inPage = new Set([...html.matchAll(/class="([^"]*)"/g)].flatMap(m => m[1].split(/\s+/)).filter(c => /^lg-[\w-]*\w$/.test(c)));
  const inPageJs = [...html.matchAll(/'(lg-[\w-]+)/g)].map(m => m[1]).filter(c => !/-$/.test(c));
  const pageCss = new Set([...html.matchAll(/\.(lg-[\w-]+)/g)].map(m => m[1]));
  check(`页面里用到的 lg-* 类都在样式表里（${p.split(/[\\/]/).slice(-2).join('/')}）`,
    [...new Set([...inPage, ...inPageJs])].filter(c => !classesInCss.has(c) && !pageCss.has(c) && c !== 'lg-toast--').map(c => `.${c}`));
}

// 位移曲线 D(s) = depth·(1 − s/b)² 的常数（面板 K、透镜 LENS_K、分几段 PASSES）：脚本与离线生成器各写一份，
// 改了一边忘了另一边，静态滤镜就和运行时对不上
if (!argv.length) {
  const py = readFileSync(resolve(here, 'displacement_map.py'), 'utf8');
  const pairs = [['K', /\bvar K = ([\d.]+)/, /^K = ([\d.]+)/m], ['LENS_K', /\bLENS_K = ([\d.]+)/, /^LENS_K = ([\d.]+)/m], ['PASSES', /\bPASSES = (\d+)/, /^PASSES = (\d+)/m]];
  check('折射的位移曲线常数（K、LENS_K、PASSES）与 displacement_map.py 一致', pairs.flatMap(([name, rj, rp]) => {
    const a = rj.exec(js), b = rp.exec(py);
    return !a || !b ? [`找不到 ${name}（liquid-glass.js 里的 ${name} = …，或 displacement_map.py 里的 ${name} = …）`]
      : a[1] !== b[1] ? [`${name}：liquid-glass.js 是 ${a[1]}，displacement_map.py 是 ${b[1]}`] : [];
  }));
  // 滤镜链里不许再有「按位移大小决定用不用折射结果」的门控、按 m 加权的模糊层和乳白：Mac 上 Chrome 的 Skia Graphite
  // 把那道门控画成透镜里离边约 20px 的一圈硬接缝（pitfalls.md #45）；模糊和乳白真机上并排比过没有更好看。
  // 位移结果只按形状裁（in2="map"）、垫在原图上
  const gate = [/result: 'rw'/, /result: 'bw'/, /result: 'vw'/, /feGaussianBlur/, /lg-scatter/].filter(r => r.test(js)).map(r => String(r));
  check('折射滤镜链里没有门控、模糊层、乳白（Graphite 的接缝，pitfalls #45）', gate.map(g => `liquid-glass.js 里还有 ${g}`));
}

// 版本号写在好几处：脚本文件头、脚本里的 version（真的那一份和替身那一份）、样式表文件头、仓库根的 package.json。
// 发布时 CI 按脚本里的 version 打标签，其余几处对不上，装上的包就和标签对不上
if (!argv.length) {
  const vs = [];
  const head = /v(\d+\.\d+\.\d+)/.exec(js.slice(0, 200)), chead = /v(\d+\.\d+\.\d+)/.exec(css.slice(0, 200));
  vs.push(['liquid-glass.js 文件头', head && head[1]], ['liquid-glass.css 文件头', chead && chead[1]]);
  for (const m of js.matchAll(/version:\s*'([^']+)'/g)) { vs.push(['liquid-glass.js 里的 version', m[1]]); }
  try { vs.push(['package.json', JSON.parse(readFileSync(resolve(here, '..', '..', 'package.json'), 'utf8')).version]); } catch (e) { /* 拷进别的项目、没有 package.json */ }
  const want = vs[2] && vs[2][1];
  check('版本号各处一致（脚本、样式表、package.json）',
    vs.length < 4 ? ['脚本里至少要有两处 version（真的一份、替身一份）'] : vs.filter(v => v[1] !== want).map(v => `${v[0]} 是 ${v[1]}，脚本里是 ${want}`));
}

// 服务端渲染：Node 里没有 window / document，require 与 import 都不能报错，拿到的是替身（supported: false，方法都在）
if (!argv.length) {
  const bad = [];
  try {
    const { createRequire } = await import('node:module');
    const L = createRequire(import.meta.url)(resolve(assets, 'liquid-glass.js'));
    if (!L || L.supported !== false || typeof L.init !== 'function' || L.init({}) !== L || L.mode() !== 'off') { bad.push('require 拿到的不是替身：' + JSON.stringify(L)); }
    const M = (await import(pathToFileURL(resolve(assets, 'liquid-glass.mjs')).href)).default;
    if (M !== L) { bad.push('import liquid-glass.mjs 拿到的和 require 的不是同一个'); }
  } catch (e) { bad.push('报错：' + String(e).slice(0, 160)); }
  check('服务端渲染时 require / import 不报错，拿到替身', bad);
}

// 品牌色推导（LiquidGlass.palette，页面里的 setAccent 和 scripts/accent.mjs 用的都是它）：
//   · 默认的蓝推出来的就是样式表里那一套（OKLab 距离 ≤ 0.03，透明度一样）——数是照它量的，量偏了这里先报；
//   · 一圈色相加上黑、白、灰、亮黄：字在卡片上 ≥ 4.5:1，按钮上的字白字 ≥ 默认蓝的水平（浅 4.2、深 3.5）、深色字 ≥ 4.5，
//     颜色都在 sRGB 里；生成的 CSS 里两块深色一样；认不出的颜色返回 null
if (!argv.length) {
  const bad = [];
  try {
    const { createRequire } = await import('node:module');
    const L = createRequire(import.meta.url)(resolve(assets, 'liquid-glass.js'));
    const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const parse = v => {
      const h = /^#([0-9a-f]{6})$/i.exec(v);
      if (h) { return [0, 2, 4].map(i => parseInt(h[1].slice(i, i + 2), 16)).concat(1); }
      const m = /^rgba\((\d+), (\d+), (\d+), (\.\d+|1|0)\)$/.exec(v);
      return m ? [+m[1], +m[2], +m[3], +m[4]] : null;
    };
    const lab = c => {
      const [r, g, b] = c.slice(0, 3).map(lin);
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
        s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
      return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
    };
    const lum = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
    const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const Lt = decls(light), Dt = decls(dark);
    const base = L.palette(Lt.get('--lg-accent'));
    for (const [name, got, want] of [['浅色', base && base.light, Lt], ['深色', base && base.dark, Dt]]) {
      if (!got) { bad.push('palette() 认不出样式表里的 --lg-accent'); break; }
      for (const k of Object.keys(got)) {
        const a = parse(got[k]), b = parse(want.get(k) || '');
        if (!a || !b) { bad.push(`${name} ${k}：推出来是「${got[k]}」，样式表里是「${want.get(k)}」，没法比`); continue; }
        const d = Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
        if (d > 0.03 || a[3] !== b[3]) { bad.push(`${name} ${k}：推出来是 ${got[k]}，样式表里是 ${want.get(k)}（OKLab 距离 ${d.toFixed(3)}）`); }
      }
    }
    const surf = { light: parse(Lt.get('--lg-surface')), dark: parse(Dt.get('--lg-surface')) };
    const colors = ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#16a34a', '#10b981', '#14b8a6', '#06b6d4',
      '#0ea5e9', '#3b82f6', '#6366f1', '#7c3aed', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#000000', '#ffffff', '#6b7280',
      '#ffd400', '#1e2a5a', '#ff0000', '#00ff00', '#0000ff', '#0a7d5a', 'rgb(124, 58, 237)', '#73e'];
    for (const c of colors) {
      const p = L.palette(c);
      if (!p) { bad.push(`${c}：palette() 返回 null`); continue; }
      for (const th of ['light', 'dark']) {
        const t = p[th], vals = Object.values(t).map(parse);
        if (vals.some(v => !v || v.slice(0, 3).some(x => x < 0 || x > 255 || x !== Math.round(x)))) { bad.push(`${c} ${th}：有写不成 #rrggbb / rgba() 的值`); }
        const a = parse(t['--lg-accent']), on = parse(t['--lg-on-accent']), mid = parse(t['--lg-pro-glow']);
        if (cr(a, surf[th]) < 4.5) { bad.push(`${c} ${th}：字 ${t['--lg-accent']} 在卡片上只有 ${cr(a, surf[th]).toFixed(2)}:1`); }
        const white = on.slice(0, 3).every(v => v === 255), need = white ? (th === 'dark' ? 3.5 : 4.2) : 4.5;
        if (cr(on, mid) < need - 0.01) { bad.push(`${c} ${th}：按钮上的字 ${t['--lg-on-accent']} 只有 ${cr(on, mid).toFixed(2)}:1（要 ${need}）`); }
      }
      const blocks = [...p.css.matchAll(/\{([^{}]*)\}/g)].map(m => m[1].replace(/\s+/g, ' ').trim());
      if (blocks.length !== 3 || blocks[1] !== blocks[2]) { bad.push(`${c}：生成的 CSS 不是三块，或两块深色不一样`); }
    }
    for (const c of ['', 'blue', '#12', 'rgb(1,2)', null, undefined, '#ggg']) { if (L.palette(c) !== null) { bad.push(`${JSON.stringify(c)} 应该认不出（返回 null）`); } }
  } catch (e) { bad.push('报错：' + String(e.stack || e).slice(0, 300)); }
  check('品牌色推导：默认蓝复现样式表、各色相对比度达标、都在色域内（LiquidGlass.palette）', bad);
}

console.log(`\n${pass} 项通过，${fails.length} 项失败`);
if (fails.length) { console.error('\n' + fails.join('\n\n')); process.exit(1); }
