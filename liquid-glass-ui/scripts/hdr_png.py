#!/usr/bin/env python3
"""HDR 高光贴片生成器（纯 Python 标准库）。

HDR 屏能显示比「页面白」更亮的颜色。网页上能稳定用到这部分亮度余量的办法是图片：
一张 16 位 RGBA PNG，带 cICP 块 09 10 00 01（原色 BT.2020、传递函数 PQ、矩阵 0、全范围）——
这是 PNG 第三版标准里标记 HDR 的方式。颜色按 PQ（SMPTE ST 2084）曲线编码到「参考白 203 尼特 × 倍数」；
alpha 是普通的直通 alpha（不要预乘，否则 HDR 屏上边缘发黑）。
普通屏上浏览器把它压成白色，和普通高光没区别；HDR 屏上它比页面最白的白还亮。

liquid-glass.js 里内嵌的那张就是缺省参数（96×12，3 倍）生成的：
  python3 hdr_png.py streak.png --base64      # 打印可以贴进 HDR_PNG 的 data URL
  python3 hdr_png.py --verify ../assets/liquid-glass.js   # 核对脚本里内嵌的那张和这里生成的一致
"""
import argparse
import base64
import re
import struct
import sys
import zlib

M1, M2 = 2610 / 16384, 2523 / 4096 * 128
C1, C2, C3 = 3424 / 4096, 2413 / 4096 * 32, 2392 / 4096 * 32


def pq(nits):
    """尼特 → PQ 编码值（0–1）。"""
    y = max(nits, 0) / 10000
    return ((C1 + C2 * y ** M1) / (1 + C3 * y ** M1)) ** M2


def chunk(t, d):
    return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)


def streak(w, h):
    """贴着上沿的一道细长高光：中间最亮，两头与上下软化。"""
    def alpha(x, y):
        u = (x + .5) / w * 2 - 1
        v = (y + .5) / h * 2 - 1
        return max(0, 1 - u * u) ** 1.6 * max(0, 1 - abs(v)) ** 2.2
    return alpha


def make(w=96, h=12, mult=3.0):
    v = pq(203 * mult)
    alpha = streak(w, h)
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):
            a = max(0.0, min(1.0, alpha(x, y)))
            raw += struct.pack('>4H', *(round(c * 65535) for c in (v, v, v, a)))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 16, 6, 0, 0, 0))
            + chunk(b'cICP', bytes([9, 16, 0, 1])) + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b''))


def main():
    ap = argparse.ArgumentParser(description='HDR 高光贴片生成器')
    ap.add_argument('out', nargs='?', help='输出的 PNG 路径')
    ap.add_argument('--w', type=int, default=96)
    ap.add_argument('--h', type=int, default=12)
    ap.add_argument('--mult', type=float, default=3.0, help='亮度是参考白 203 尼特的几倍，缺省 3（≈609 尼特）')
    ap.add_argument('--base64', action='store_true', help='打印 data URL')
    ap.add_argument('--verify', metavar='JS', help='核对 JS 文件里 HDR_PNG 内嵌的图与缺省参数生成的一致')
    a = ap.parse_args()
    png = make(a.w, a.h, a.mult)
    if a.verify:
        m = re.search(r"HDR_PNG = 'data:image/png;base64,([A-Za-z0-9+/=]+)'", open(a.verify, encoding='utf-8').read())
        same = bool(m) and base64.b64decode(m.group(1)) == make()
        print('一致' if same else '不一致：重新生成后替换 HDR_PNG')
        return 0 if same else 1
    if a.out:
        with open(a.out, 'wb') as f:
            f.write(png)
        print('写好了 %s：%d×%d，16 位，cICP 9/16/0/1，%.0f 尼特（PQ 编码值 %.3f）'
              % (a.out, a.w, a.h, 203 * a.mult, pq(203 * a.mult)), file=sys.stderr)
    if a.base64:
        print('data:image/png;base64,' + base64.b64encode(png).decode('ascii'))
    if not a.out and not a.base64:
        ap.print_help()
    return 0


if __name__ == '__main__':
    sys.exit(main())
