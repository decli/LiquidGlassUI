/*!
 * Liquid Glass UI —— ES 模块入口
 *
 *   import LiquidGlass from 'liquid-glass-ui';          // 打包工具（npm i github:decli/LiquidGlassUI）
 *   import LiquidGlass from './liquid-glass.mjs';       // 浏览器原生 <script type="module">
 *   LiquidGlass.init({ storageKey: 'myapp.glass' });    // 可选：换配置
 *
 * 真正的代码在 liquid-glass.js（通用模块，<script> 直接引入也是它）。这里只是把它跑起来、再把全局的 LiquidGlass 交出去：
 * 浏览器里是真的那一个；服务端渲染时是一个什么都不做的替身，照常调用不会报错。
 */
import './liquid-glass.js';

export default globalThis.LiquidGlass;
