#!/usr/bin/env python3
"""Liquid Glass 位移贴图生成器（纯 Python 标准库，不需要 numpy / PIL）。

算法与 liquid-glass.js 里的 corner / texel / tileSet 逐行对应，用来：
  1. 离线看一张贴图长什么样、调参数（边宽 / 最外缘位移）；
  2. 给尺寸固定的元素预先生成一段完整的 SVG 滤镜，贴进页面就能用，不跑脚本；
  3. 自检：python3 displacement_map.py --selftest

模型（照 iOS 26 的玻璃边：放大 + 模糊 + 散射，正中原样）：
  几何：圆角矩形，离边 b（边宽）以内是斜面。
  位移：斜面「往里取样、越靠边位移越大」：D(s) = K·b·(1 − s/b)²，K = 0.45，s 是离边的距离。
        最外缘 D′ = −0.9：边上那一圈被拉开约十倍（放大）；取样位置 s + D(s) 处处单调（D′ > −1），
        不折叠——同一段内容不会被画两遍，边上不会出现镜像。
  凸透镜（--lens，页面上写 data-lg-refract="lens"）：斜面一直到中线（b = 短边 / 2），剖面换成三次
        D(s) = (2K/3)·b·(1 − s/b)³：最外缘同样 D′ = −0.9，但从中线起放大率连同它的变化率都是从 0 平滑长出来的——
        整块是一个连续弯曲的凸透镜，看不出「外面一圈在弯、里面一块是平的」。一般剖面写成 m = (1 − s/b)^p、
        最外缘位移 = (2K/p)·b，p = 2 是默认的玻璃板，p = 3 是凸透镜。
  编码：R / G = 往哪边取样（128 = 不动；feDisplacementMap 取 (x + scale·(R − .5), y + scale·(G − .5))），
        scale = 2 × 最外缘位移；B = 位移大小 m = (1 − s/b)²（0 中间、1 最外缘），滤镜拿它当模糊、散射、
        「用不用折射结果」的权重；A = 形状（圆角外透明）。

上一版用斯涅尔定律 + 凸超椭圆剖面算位移：位移全挤在最外两三个像素里，而且在那儿 D′ < −1、贴图折叠了，
边上的字被画两遍、还有一道镜像。--selftest 现在验的就是「取样位置单调」这一条。

运行时脚本把贴图切成九宫格（四个角 + 四条边，中间不放），尺寸变了只挪这八块；这里的 --selftest 会把九宫格拼回去，
核对和整张贴图逐像素一样。

用法：
  python3 displacement_map.py --w 344 --h 300 --radius 20 --bezel 18 --out map.png
  python3 displacement_map.py --w 220 --h 84 --radius 42 --bezel 22 --svg --id glass-a > filter.svg
  python3 displacement_map.py --w 220 --h 84 --lens --svg --id drop > filter.svg      # 整块凸透镜
"""
import argparse
import base64
import math
import struct
import sys
import zlib

K = 0.45          # 最外缘位移 = K × 边宽（与 liquid-glass.js 的 K 一致，scripts/check.mjs 会核对）
TILE_PX = 2       # 运行时九宫格贴图的像素密度（每 CSS 像素几个贴图像素）


def png_rgba8(w, h, pixels):
    """pixels: bytes，长 w*h*4。写成一张 8 位 RGBA PNG。"""
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    raw = b''.join(b'\x00' + pixels[y * w * 4:(y + 1) * w * 4] for y in range(h))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def js_round(v):
    """JavaScript 的 Math.round（.5 往上）。Python 的 round 是银行家舍入，两边会差一级。"""
    return int(math.floor(v + 0.5))


def corner(x, y, r):
    """左上角那一块里的一点 (x, y)（从元素左上角量）：(离边多远, 朝外的法向 nx, ny)。
    圆角那一格里离的是圆弧（在弧外是负数），其余离的是更近的那条直边。"""
    dx, dy = x - r, y - r
    if dx < 0 and dy < 0:
        l = math.hypot(dx, dy)
        return r - l, (dx / l if l > 1e-6 else 0.0), (dy / l if l > 1e-6 else 0.0)
    if x < y:
        return x, -1.0, 0.0
    return y, 0.0, -1.0


def texel(s, nx, ny, b, cov, p=2):
    """一个像素的 RGBA：离边 s、朝外的法向、边宽 b、覆盖率 cov、剖面指数 p。往里取样 = 沿法向的反方向。"""
    if s >= b:
        rgb = (128, 128, 0)
    else:
        m = (1 - max(s, 0.0) / b) ** p
        rgb = (js_round(127.5 - nx * m * 127.5), js_round(127.5 - ny * m * 127.5), js_round(m * 255))
    return rgb + (js_round(cov * 255),)


def arc_coverage(fx, fy, r, sub):
    """左上角坐标系里，一个像素（左上角 fx, fy，边长 sub×4 个子样本的跨度）被圆角盖住多少：4×4 超采样。"""
    hits = 0
    for sy in range(4):
        for sx in range(4):
            ax = fx(sx) - r
            ay = fy(sy) - r
            if ax >= 0 or ay >= 0 or ax * ax + ay * ay <= r * r:
                hits += 1
    return hits / 16


def depth_of(b, p=2):
    """缺省的最外缘位移：(2K/p)·b——最外缘 D′ = −p·(2K/p) = −2K = −0.9，任何剖面指数都放大约十倍、不折叠"""
    return 2 * K / p * b


def full_map(w, h, r, b, p=2):
    """整张贴图（元素尺寸），RGBA bytes。每个像素折到离它最近的那个角的坐标系里算。"""
    lim = min(w, h) / 2
    r = min(max(r, 0.0), lim)
    b = min(max(b, 2.0), max(2.0, lim - 1))
    px = bytearray(w * h * 4)
    for y in range(h):
        for x in range(w):
            cx, cy = x + 0.5, y + 0.5
            rt, bt = cx > w / 2, cy > h / 2
            tx, ty = (w - cx if rt else cx), (h - cy if bt else cy)
            cov = 1.0
            if tx < r and ty < r:
                cov = arc_coverage(lambda s: (w - (x + (s + 0.5) / 4)) if rt else (x + (s + 0.5) / 4),
                                   lambda s: (h - (y + (s + 0.5) / 4)) if bt else (y + (s + 0.5) / 4), r, 1)
            s, nx, ny = corner(tx, ty, r)
            px[(y * w + x) * 4:(y * w + x) * 4 + 4] = bytes(texel(s, -nx if rt else nx, -ny if bt else ny, b, cov, p))
    return bytes(px), r, b


def tiles(c, r, b, density=TILE_PX, p=2):
    """运行时用的九宫格：{部位: (宽, 高, RGBA bytes)}。与 liquid-glass.js 的 tileSet 逐行对应。"""
    n = max(2, math.ceil(c * density))
    u = c / n
    side = {'t': (0, 0), 'b': (0, 1), 'l': (0, 0), 'r': (1, 0), 'tl': (0, 0), 'tr': (1, 0), 'bl': (0, 1), 'br': (1, 1)}
    out = {}
    for k in ('t', 'b', 'l', 'r', 'tl', 'tr', 'bl', 'br'):
        rt, bt = side[k]
        W = 2 if k in ('t', 'b') else n
        H = 2 if k in ('l', 'r') else n
        px = bytearray(W * H * 4)
        for y in range(H):
            for x in range(W):
                lx, ly = (x + 0.5) * u, (y + 0.5) * u
                if k == 't':
                    t = texel(ly, 0, -1, b, 1, p)
                elif k == 'b':
                    t = texel(c - ly, 0, 1, b, 1, p)
                elif k == 'l':
                    t = texel(lx, -1, 0, b, 1, p)
                elif k == 'r':
                    t = texel(c - lx, 1, 0, b, 1, p)
                else:
                    tx, ty = (c - lx if rt else lx), (c - ly if bt else ly)
                    cov = 1.0
                    if tx < r and ty < r:
                        cov = arc_coverage(lambda s: (c - (x + (s + 0.5) / 4) * u) if rt else (x + (s + 0.5) / 4) * u,
                                           lambda s: (c - (y + (s + 0.5) / 4) * u) if bt else (y + (s + 0.5) / 4) * u, r, u)
                    s, nx, ny = corner(tx, ty, r)
                    t = texel(s, -nx if rt else nx, -ny if bt else ny, b, cov, p)
                px[(y * W + x) * 4:(y * W + x) * 4 + 4] = bytes(t)
        out[k] = (W, H, bytes(px))
    return out


def svg_filter(fid, w, h, png, depth, disp=0.08, blur=None, scatter=0.05, bezel=16):
    """一段能直接贴进页面的滤镜（与 liquid-glass.js 的 newFilter 同一条链，只是位移图是一整张）。"""
    url = 'data:image/png;base64,' + base64.b64encode(png).decode('ascii')
    s = 2 * depth
    blur = max(0.5, bezel * 0.06) if blur is None else blur
    one = lambda c: {'R': '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', 'G': '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
                     'B': '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0'}[c]
    if disp:
        lens = ''.join(
            f'    <feDisplacementMap in="SourceGraphic" in2="map" scale="{s * f:.2f}" xChannelSelector="R" yChannelSelector="G" result="d{c}"/>\n'
            f'    <feColorMatrix in="d{c}" type="matrix" values="{one(c)}" result="c{c}"/>\n'
            for c, f in (('R', 1 + disp), ('G', 1), ('B', 1 - disp)))
        lens += ('    <feComposite in="cR" in2="cG" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="rg"/>\n'
                 '    <feComposite in="rg" in2="cB" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="sharp"/>\n')
    else:
        lens = f'    <feDisplacementMap in="SourceGraphic" in2="map" scale="{s:.2f}" xChannelSelector="R" yChannelSelector="G" result="sharp"/>\n'
    return (
        '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">\n'
        f'  <filter id="{fid}" color-interpolation-filters="sRGB">\n'
        f'    <feImage x="0" y="0" width="{w}" height="{h}" preserveAspectRatio="none" result="map" href="{url}"/>\n'
        + lens +
        '    <feColorMatrix in="map" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0" result="m"/>\n'
        f'    <feGaussianBlur in="sharp" stdDeviation="{blur:.2f}" result="soft"/>\n'
        '    <feComponentTransfer in="m" result="bw"><feFuncA type="gamma" amplitude="1" exponent="1.6" offset="0"/></feComponentTransfer>\n'
        '    <feComposite in="soft" in2="bw" operator="in" result="softIn"/>\n'
        '    <feMerge result="lensed"><feMergeNode in="sharp"/><feMergeNode in="softIn"/></feMerge>\n'
        '    <feFlood flood-color="#ffffff" style="flood-color: var(--lg-scatter, #ffffff)" result="white"/>\n'
        f'    <feComponentTransfer in="m" result="vw"><feFuncA type="linear" slope="{scatter}" intercept="0"/></feComponentTransfer>\n'
        '    <feComposite in="white" in2="vw" operator="in" result="veil"/>\n'
        '    <feMerge result="glowed"><feMergeNode in="lensed"/><feMergeNode in="veil"/></feMerge>\n'
        '    <feComponentTransfer in="m" result="rw"><feFuncA type="linear" slope="12" intercept="0"/></feComponentTransfer>\n'
        '    <feComposite in="glowed" in2="rw" operator="in" result="rim"/>\n'
        '    <feComposite in="rim" in2="map" operator="in" result="shaped"/>\n'
        '    <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="shaped"/></feMerge>\n'
        '  </filter>\n'
        '</svg>\n'
        f'<!-- 用法（只在 Chromium 上有效；元素必须正好 {w}×{h}px）：\n'
        f'     backdrop-filter: blur(14px) url(#{fid}) saturate(1.8); -->\n')


def selftest_one(p, w, h, r, bez):
    problems = []
    px, r, bez = full_map(w, h, r, bez, p)
    depth = depth_of(bez, p)
    scale = 2 * depth
    at = lambda x, y: px[(y * w + x) * 4:(y * w + x) * 4 + 4]
    disp_x = lambda x, y: (at(x, y)[0] / 255 - 0.5) * scale
    ib = int(bez)

    mid = at(w // 2, h // 2)
    if mid[3] != 255 or abs(mid[0] - 128) > 1 or abs(mid[1] - 128) > 1 or mid[2] > 1:
        problems.append(f'正中应当是「不动、m = 0、不透明」(128,128,0,255)，实际 {tuple(mid)}')

    # 竖直正中那一行：从左边缘往里，偏移指向里面（x 为正）、m 单调变小、取样位置单调变大（不折叠）
    y = h // 2
    row = [disp_x(x, y) for x in range(w // 2)]
    if not all(v >= -1e-9 for v in row[:ib]):
        problems.append('左边的偏移应当指向里面（x 为正）')
    ms = [at(x, y)[2] for x in range(min(ib + 2, w // 2))]
    if any(ms[i + 1] > ms[i] for i in range(len(ms) - 1)) or ms[0] < 200 or (ib + 1 < w // 2 and ms[ib + 1] != 0):
        problems.append(f'B 通道（位移大小）应当从边缘往里单调变小、斜面外为 0：{ms}')
    n = min(ib + 2, w // 2)
    pos = [x + 0.5 + row[x] for x in range(n)]
    if any(pos[i + 1] <= pos[i] for i in range(len(pos) - 1)):
        problems.append('取样位置没有从边缘往里单调变大：贴图折叠了（边上的内容会被画两遍）')

    # 解析式：D(s) = (2K/p)·b·t^p，1 + D′(s) = 1 − 2K·t^(p−1)：处处 > 0，最外缘约 0.1（放大约十倍）；
    # 斜面里头那一端（t → 0）放大率和它的变化率都要平滑地从 1 / 0 长出来（p = 2 时变化率是一个定值起步，p = 3 时从 0 起步）
    dmin = min(1 - 2 * K * (1 - s_ / bez) ** (p - 1) for s_ in [i / 100 * bez for i in range(101)])
    if not 0.05 < dmin < 0.2:
        problems.append(f'最外缘的 1 + D′ 应当约为 0.1（放大约十倍、不折叠），实际 {dmin:.3f}')

    for x in range(w):                                           # 左右对称
        if abs(disp_x(x, y) + disp_x(w - 1 - x, y)) > scale / 255 * 1.01:
            problems.append(f'左右不对称（x={x}）')
            break
    if at(0, 0)[3] != 0 or at(w // 2, 0)[3] != 255:
        problems.append('A 通道应当是形状：圆角外透明、里面不透明')

    # 九宫格拼回去，和整张逐像素一样（运行时脚本就是这么摆的：四条边各往角下面多伸 1px，角盖在上面）
    c = max(r, bez)
    T = tiles(c, r, bez, density=1, p=p)
    comp = bytearray(w * h * 4)
    def paste(k, x0, y0, ww, hh):
        tw, th, data = T[k]
        for yy in range(max(0, y0), min(h, y0 + hh)):
            for xx in range(max(0, x0), min(w, x0 + ww)):
                sx = min(tw - 1, int((xx - x0) * tw / ww)) if tw != 2 else 0
                sy = min(th - 1, int((yy - y0) * th / hh)) if th != 2 else 0
                comp[(yy * w + xx) * 4:(yy * w + xx) * 4 + 4] = data[(sy * tw + sx) * 4:(sy * tw + sx) * 4 + 4]
    c = int(c)
    for k, box in (('t', (c - 1, 0, w - 2 * c + 2, c)), ('b', (c - 1, h - c, w - 2 * c + 2, c)),
                   ('l', (0, c - 1, c, h - 2 * c + 2)), ('r', (w - c, c - 1, c, h - 2 * c + 2)),
                   ('tl', (0, 0, c, c)), ('tr', (w - c, 0, c, c)), ('bl', (0, h - c, c, c)), ('br', (w - c, h - c, c, c))):
        paste(k, *box)
    bad = 0
    for yy in range(h):
        for xx in range(w):
            a = px[(yy * w + xx) * 4:(yy * w + xx) * 4 + 4]
            b = comp[(yy * w + xx) * 4:(yy * w + xx) * 4 + 4]
            if b[3] == 0 and a[2] == 0:                          # 九宫格中间不放（透明 = 用原图），整张里是 m = 0
                continue
            if a != b:
                bad += 1
    if bad:
        problems.append(f'九宫格拼回去和整张有 {bad} 个像素不一样')

    png = png_rgba8(w, h, px)
    if not png.startswith(b'\x89PNG'):
        problems.append('PNG 不对')
    print('剖面 p=%d：边宽 %.1f，最外缘位移 %.2fpx，scale %.2f，最外缘放大约 %.0f 倍' % (p, bez, depth, scale, 1 / dmin))
    return problems


def selftest():
    problems = selftest_one(2, 120, 48, 24, 14)                  # 默认的玻璃板：边上弯、正中平
    problems += ['凸透镜：' + x for x in selftest_one(3, 120, 48, 24, 24)]   # 凸透镜：斜面到中线（脚本里会夹到短边一半减 1）
    if problems:
        print('失败：' + '；'.join(problems))
        return 1
    print('自检通过')
    return 0


def main():
    ap = argparse.ArgumentParser(description='Liquid Glass 位移贴图生成器')
    ap.add_argument('--w', type=int, help='宽（px，等于元素的布局宽度）')
    ap.add_argument('--h', type=int, help='高（px）')
    ap.add_argument('--radius', type=float, default=None, help='圆角（px），缺省 = 高的一半（胶囊）')
    ap.add_argument('--bezel', type=float, default=None, help='玻璃边宽（px），缺省 = 短边 × 0.2，夹在 10–24')
    ap.add_argument('--depth', type=float, default=None, help='最外缘位移（px），缺省 = 边宽 × 0.45（凸透镜 × 0.3）')
    ap.add_argument('--lens', action='store_true', help='凸透镜：斜面一直到中线、三次剖面（页面上的 data-lg-refract="lens"）')
    ap.add_argument('--thick', type=float, default=None, help=argparse.SUPPRESS)   # 老参数：当 --depth 用
    ap.add_argument('--height', type=float, default=None, help=argparse.SUPPRESS)  # 老参数：不再用
    ap.add_argument('--disp', type=float, default=0.08, help='色散（红多折、蓝少折的比例），缺省 0.08；0 关掉')
    ap.add_argument('--scatter', type=float, default=0.05, help='边上乳白的浓度，缺省 0.05')
    ap.add_argument('--out', help='把贴图写成 PNG')
    ap.add_argument('--svg', action='store_true', help='在标准输出打印一段可直接贴进页面的 SVG 滤镜')
    ap.add_argument('--id', default='lg-static', help='--svg 时滤镜的 id')
    ap.add_argument('--selftest', action='store_true', help='跑自检')
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if not a.w or not a.h:
        ap.error('需要 --w 与 --h')
    r = a.h / 2 if a.radius is None else a.radius
    p = 3 if a.lens else 2
    if a.lens:
        bezel = min(a.w, a.h) / 2                                 # full_map 里会夹到短边一半减 1，和脚本一样
    else:
        bezel = a.bezel if a.bezel is not None else max(10, min(24, round(min(a.w, a.h) * 0.2)))
    px, r, bezel = full_map(a.w, a.h, r, bezel, p)
    depth = a.depth if a.depth is not None else a.thick if a.thick is not None else depth_of(bezel, p)
    png = png_rgba8(a.w, a.h, px)
    if a.out:
        with open(a.out, 'wb') as f:
            f.write(png)
        print('写好了 %s：%d×%d，边宽 %.1f，最外缘位移 %.2fpx，feDisplacementMap scale=%.2f'
              % (a.out, a.w, a.h, bezel, depth, 2 * depth), file=sys.stderr)
    if a.svg:
        sys.stdout.write(svg_filter(a.id, a.w, a.h, png, depth, a.disp, None, a.scatter, bezel))
    if not a.out and not a.svg:
        print('scale=%.2f（加 --out 写 PNG，或 --svg 打印滤镜）' % (2 * depth))
    return 0


if __name__ == '__main__':
    sys.exit(main())
