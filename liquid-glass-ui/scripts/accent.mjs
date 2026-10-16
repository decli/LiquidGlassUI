#!/usr/bin/env node
/**
 * 换品牌色：给一个颜色，打印一段贴在 liquid-glass.css 后面的 CSS（浅色、显式深色、跟随系统的深色三块）。
 * 不需要浏览器，不需要装任何包。
 *
 *   node scripts/accent.mjs '#7c3aed'                 打印 CSS
 *   node scripts/accent.mjs '#7c3aed' >> my-theme.css 存进自己的样式表（放在 liquid-glass.css 后面引入）
 *   node scripts/accent.mjs '#7c3aed' --report        另外在标准错误上列出对比度（字在卡片上、按钮上的字）
 *
 * 算法在 liquid-glass.js 里（LiquidGlass.palette，页面里 LiquidGlass.setAccent 用的是同一个），这里只是在 Node 里调它：
 * 在 OKLCH 里保留品牌色的色相，明度、彩度照默认的蓝和各个令牌的关系推；字压不住就压暗 / 提亮，
 * 白字在按钮上不够就换深色字。原理见 references/principles.md §11。
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const LiquidGlass = createRequire(import.meta.url)(resolve(here, '..', 'assets', 'liquid-glass.js'));
const args = process.argv.slice(2);
const color = args.find(a => !a.startsWith('--'));

if (!color || args.includes('--help') || args.includes('-h')) {
  console.error('用法：node scripts/accent.mjs <颜色> [--report]\n颜色写成 #7c3aed、#73e 或 rgb(124, 58, 237)');
  process.exit(color ? 0 : 2);
}
const p = LiquidGlass.palette(color);
if (!p) {
  console.error(`认不出这个颜色：${color}（写成 #7c3aed、#73e 或 rgb(124, 58, 237)）`);
  process.exit(2);
}

process.stdout.write(`/* Liquid Glass UI 品牌色：${p.color}（scripts/accent.mjs 生成，放在 liquid-glass.css 后面引入） */\n${p.css}`);

if (args.includes('--report')) {
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const rgb = s => /^#/.test(s) ? [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16)) : s.match(/[\d.]+/g).slice(0, 3).map(Number);
  const lum = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const cr = (a, b) => { const x = lum(rgb(a)), y = lum(rgb(b)); return ((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2); };
  for (const [name, t, surf] of [['浅色', p.light, '#ffffff'], ['深色', p.dark, '#1a1f26']]) {
    const mid = t['--lg-pro-glow'];
    console.error(`${name}：字 ${t['--lg-accent']} 在卡片上 ${cr(t['--lg-accent'], surf)}:1；` +
      `按钮 ${t['--lg-pro-top']} → ${t['--lg-pro-bot']}，上面的字 ${t['--lg-on-accent']} ${cr(t['--lg-on-accent'], mid)}:1`);
  }
}
