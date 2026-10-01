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
 *   · 查本套件自己时：脚本里折射的位移曲线常数（K）与 scripts/displacement_map.py 一致
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const writtenByPage = ['data-lg-mode-switch', 'data-lg-tip', 'data-lg-lens', 'data-lg-refract', 'data-lg-slider', 'data-lg-hdr'];
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

// 位移曲线 D(s) = K·b·(1 − s/b)² 的常数：脚本与离线生成器各写一份，改了一边忘了另一边，静态滤镜就和运行时对不上
if (!argv.length) {
  const py = readFileSync(resolve(here, 'displacement_map.py'), 'utf8');
  const kj = /\bvar K = ([\d.]+)/.exec(js), kp = /^K = ([\d.]+)/m.exec(py);
  check('折射的位移曲线常数与 displacement_map.py 一致',
    !kj || !kp ? ['找不到 K（liquid-glass.js 里的 var K = …，或 displacement_map.py 里的 K = …）']
      : kj[1] !== kp[1] ? [`liquid-glass.js 是 ${kj[1]}，displacement_map.py 是 ${kp[1]}`] : []);
}

console.log(`\n${pass} 项通过，${fails.length} 项失败`);
if (fails.length) { console.error('\n' + fails.join('\n\n')); process.exit(1); }
