/**
 * Liquid Glass UI —— 类型声明。
 * 页面里只要给元素套上 liquid-glass.css 的组件类（或写 data-lg-* 属性），脚本自己跑；这里的接口都是可选的。
 */

/** 用户选的档：auto = 没选过（自动降级） */
export type LiquidGlassMode = 'auto' | 'full' | 'lite' | 'off';
/** 实际的材质档：l0 实色 / l1 模糊 / l2 模糊 + 折射 / l3 再加 HDR 高光 */
export type LiquidGlassTier = 'l0' | 'l1' | 'l2' | 'l3';

/** 透镜预设：鼠标经过时流到 items 底下的那颗清玻璃 */
export interface LensPreset {
  sel: string;
  items: string;
  /** 透镜比项大一圈（px） */
  pad?: number;
  /** 被盖住的项放大多少（0.025 = 2.5%） */
  mag?: number;
  /** 透镜圆角（px），不写照项自己的 */
  rad?: number;
  /** 表格一类整行：垫底的亮板，不放大、不折射 */
  under?: boolean;
}
/** 滑块预设：选中项底下的液态滑块；kind 为 seg 的还能按住拖 */
export interface SliderPreset {
  sel: string;
  items: string;
  kind: 'seg' | 'nav' | 'cursor';
}
/** 折射预设：玻璃边的放大、模糊、散射 */
export interface RefractPreset {
  sel: string;
  /** 边宽（px） */
  bezel?: number;
  /** 最外缘位移（px），缺省 0.45 × bezel */
  depth?: number;
  /** 色散，缺省 0.08 */
  disp?: number;
  /** 边上乳白的浓度，缺省 0.05 */
  scatter?: number;
  /** 剖面：2 = 玻璃板（缺省，边上弯、正中平）；3 = 凸透镜那种三次剖面（配合 bezel = 短边 / 2，整块连续地弯） */
  power?: 2 | 3;
}
/** HDR 高光预设 */
export interface HdrPreset {
  sel: string;
  /** 'top' | 'bottom' | 'top bottom' */
  spots: string;
}

/** 配置：window.LiquidGlassConfig（加载前写）或 LiquidGlass.init()（加载后调）同一套 */
export interface LiquidGlassOptions {
  /** 档位存在 localStorage 的键，缺省 'lg.glass' */
  storageKey?: string;
  /** 提示文案的语言，缺省看 <html lang> */
  lang?: string;
  /** 逐条覆盖提示文案 */
  messages?: Record<string, string>;
  /** 换档时的提示：false 不弹；给函数则交给页面自己的提示组件 */
  notify?: boolean | ((text: string) => void);
  /** 页面自己用哪些选择器标「选中」（aria-* 与 .is-cursor / .is-active 之外的），如 '.on, .active' */
  on?: string;
  /** false：不认组件类，只认 data 属性 */
  presets?: boolean;
  lens?: LensPreset[];
  slider?: SliderPreset[];
  refract?: RefractPreset[];
  hdr?: HdrPreset[];
  /** 哪些 title 换成玻璃提示（整串替换） */
  tips?: string;
  /** 哪些元素写指尖光的 --mx / --my（整串替换） */
  glow?: string;
}

export interface LiquidGlassApi {
  readonly version: string;
  /** true：真的在跑；false：服务端渲染、太老的浏览器拿到的替身（方法都在，什么都不做） */
  readonly supported: boolean;
  /** 换配置（只覆盖给了的项）；已经跑起来了就按新配置整套重来一遍。返回自己，可以链式调用 */
  init(options?: LiquidGlassOptions): LiquidGlassApi;
  mode(): LiquidGlassMode;
  tier(): LiquidGlassTier;
  /** 换档（'auto' 回到自动）；announce 为 true 时弹一句提示 */
  setMode(mode: LiquidGlassMode, announce?: boolean): void;
  /** 页面结构大改、又没有 DOM 变化时手动对一遍（平时 MutationObserver 会自己发现） */
  refresh(): void;
  /** 这一档的说明文字 */
  describe(): string;
  /** 弹一句玻璃浮动提示 */
  notify(text: string): void;
}

declare const LiquidGlass: LiquidGlassApi;
export default LiquidGlass;

declare global {
  interface Window {
    LiquidGlass: LiquidGlassApi;
    LiquidGlassConfig?: LiquidGlassOptions;
  }
  interface DocumentEventMap {
    'lg:modechange': CustomEvent<{ mode: LiquidGlassMode; tier: LiquidGlassTier }>;
  }
}
