#!/usr/bin/env python3
"""Liquid Glass 位移贴图生成器（纯 Python 标准库，不需要 numpy / PIL）。

算法与 liquid-glass.js 里的 makeMap 逐行对应，用来：
  1. 离线看一张贴图长什么样、调参数（边宽 / 隆起 / 厚度）；
  2. 给尺寸固定的元素预先生成一段 SVG 滤镜，贴进页面就能用，不跑脚本；
  3. 自检：python3 displacement_map.py --selftest

几何：圆角矩形的有符号距离（Inigo Quilez 的公式），离边缘 bezel 像素以内是一圈凸起的「玻璃边」，中间是平的。
      边的剖面用凸超椭圆 h(u) = (1-(1-u)^4)^(1/4)，u=0 最外沿，u=1 进入平面——在 u=1 处斜率平滑地降到 0，
      边和面接得上（圆弧剖面在接缝处有一道折痕，折射出来中间有一条亮线）。
光学：视线垂直向下，在斜面上按斯涅尔定律折射（空气 → 玻璃，n=1.5），穿过恒定厚度 thick 的玻璃，
      横向偏移 = thick·tan(θ−θt)。边缘偏得最多、往里单调减小，方向指向玻璃内部（凸透镜把光往中间收）。
      用恒定厚度而不用「该点的高度」：后者让偏移在斜面中段出现一个峰，贴图「折叠」，中间一道亮缝。
编码：R = x 偏移、G = y 偏移，128 = 不动；B 恒 128、A 恒 255；feDisplacementMap 的 scale = 2 × 最大偏移。

用法：
  python3 displacement_map.py --w 344 --h 300 --radius 20 --bezel 18 --height 16 --thick 8 --out map.png
  python3 displacement_map.py --w 220 --h 84 --radius 42 --bezel 22 --height 20 --thick 10 --svg --id glass-a > filter.svg
"""
import argparse
import base64
import math
import struct
import sys
import zlib


def png_rgba8(w, h, pixels):
    """pixels: bytes，长 w*h*4。写成一张 8 位 RGBA PNG。"""
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    raw = b''.join(b'\x00' + pixels[y * w * 4:(y + 1) * w * 4] for y in range(h))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def sdf(px, py, hw, hh, r):
    """圆角矩形的有符号距离（里面为负）与外法线方向。"""
    qx, qy = abs(px) - (hw - r), abs(py) - (hh - r)
    ox, oy = max(qx, 0.0), max(qy, 0.0)
    d = math.hypot(ox, oy) + min(max(qx, qy), 0.0) - r
    if qx > 0 and qy > 0:
        l = math.hypot(qx, qy) or 1.0
        nx, ny = qx / l, qy / l
    elif qx > qy:
        nx, ny = 1.0, 0.0
    else:
        nx, ny = 0.0, 1.0
    return d, (-nx if px < 0 else nx), (-ny if py < 0 else ny)


def build(w, h, r, bezel, height, thick, ior=1.5):
    """返回 (dx, dy, maxd)：每个像素的横 / 纵偏移（像素），与最大偏移。"""
    hw, hh = w / 2.0, h / 2.0
    r = min(max(r, 0.0), hw, hh)
    bezel = min(max(bezel, 2.0), hw, hh)
    eta = 1.0 / ior
    dx = [0.0] * (w * h)
    dy = [0.0] * (w * h)
    maxd = 1e-6
    for y in range(h):
        for x in range(w):
            d, _, _ = sdf(x + 0.5 - hw, y + 0.5 - hh, hw, hh, r)
            if -d >= bezel + 1 or d > 1:            # 平面或外面：不动
                continue
            ax = ay = 0.0
            for sy in range(2):                      # 2×2 超采样，只在斜面上算
                for sx in range(2):
                    d, nx, ny = sdf(x + (sx + 0.5) / 2 - hw, y + (sy + 0.5) / 2 - hh, hw, hh, r)
                    t = -d
                    if t <= 0 or t >= bezel:
                        continue
                    u = max(t / bezel, 1e-4)
                    a = 1 - (1 - u) ** 4
                    dh = (1 - u) ** 3 * a ** -0.75                 # h'(u)
                    theta = math.atan(height / bezel * dh)          # 法线偏离竖直的角度
                    tt = math.asin(eta * math.sin(theta))           # 折射角
                    travel = thick * math.tan(theta - tt)
                    ax -= nx * travel
                    ay -= ny * travel
            ax /= 4
            ay /= 4
            dx[y * w + x], dy[y * w + x] = ax, ay
            maxd = max(maxd, abs(ax), abs(ay))
    return dx, dy, maxd


def encode(w, h, dx, dy, maxd):
    scale = 2 * maxd
    px = bytearray(w * h * 4)
    for i in range(w * h):
        px[i * 4] = max(0, min(255, int(round(255 * (0.5 + dx[i] / scale)))))
        px[i * 4 + 1] = max(0, min(255, int(round(255 * (0.5 + dy[i] / scale)))))
        px[i * 4 + 2] = 128
        px[i * 4 + 3] = 255
    return png_rgba8(w, h, bytes(px)), scale


def svg_filter(fid, w, h, png, scale):
    """一段能直接贴进页面的滤镜：底下先铺 128 灰（缺贴图时不位移），sRGB 插值，缺省滤镜区域。"""
    url = 'data:image/png;base64,' + base64.b64encode(png).decode('ascii')
    return (
        '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">\n'
        f'  <filter id="{fid}" color-interpolation-filters="sRGB">\n'
        '    <feFlood flood-color="rgb(128,128,128)" result="flat"/>\n'
        f'    <feImage x="0" y="0" width="{w}" height="{h}" preserveAspectRatio="none" result="m0" href="{url}"/>\n'
        '    <feComposite in="m0" in2="flat" operator="over" result="map"/>\n'
        f'    <feDisplacementMap in="SourceGraphic" in2="map" scale="{scale:.2f}" xChannelSelector="R" yChannelSelector="G"/>\n'
        '  </filter>\n'
        '</svg>\n'
        f'<!-- 用法（只在 Chromium 上有效；元素必须正好 {w}×{h}px）：\n'
        f'     backdrop-filter: blur(14px) url(#{fid}) saturate(1.8); -->\n')


def selftest():
    w, h, r, bez = 120, 48, 24, 12
    dx, dy, maxd = build(w, h, r, bez, bez - 2, bez * 0.42)
    png, scale = encode(w, h, dx, dy, maxd)
    problems = []
    if abs(dx[(h // 2) * w + w // 2]) > 1e-9 or abs(dy[(h // 2) * w + w // 2]) > 1e-9:
        problems.append('正中不该位移')
    row = [dx[(h // 2) * w + x] for x in range(w // 2)]           # 从左边缘往里
    if not all(v >= 0 for v in row):
        problems.append('左边的偏移应当指向里面（x 为正）')
    inner = row[1:bez]                                           # 从最外一像素往里应当单调不增（不折叠）
    if any(inner[i + 1] > inner[i] + 1e-6 for i in range(len(inner) - 1)):
        problems.append('偏移没有从边缘往里单调减小：贴图折叠了')
    for x in range(w):                                           # 左右对称
        if abs(dx[(h // 2) * w + x] + dx[(h // 2) * w + (w - 1 - x)]) > 1e-6:
            problems.append('左右不对称')
            break
    if not png.startswith(b'\x89PNG') or scale <= 0:
        problems.append('PNG 或 scale 不对')
    print('最大偏移 %.2fpx，scale %.2f' % (maxd, scale))
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
    ap.add_argument('--height', type=float, default=None, help='边隆起的高度，缺省 = 边宽 − 2')
    ap.add_argument('--thick', type=float, default=None, help='玻璃厚度，缺省 = 边宽 × 0.45')
    ap.add_argument('--ior', type=float, default=1.5, help='折射率，缺省 1.5')
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
    bezel = a.bezel if a.bezel is not None else max(10, min(24, round(min(a.w, a.h) * 0.2)))
    bezel = min(bezel, a.h / 2 - 1)
    height = a.height if a.height is not None else bezel - 2
    thick = a.thick if a.thick is not None else round(bezel * 0.45)
    dx, dy, maxd = build(a.w, a.h, r, bezel, height, thick, a.ior)
    png, scale = encode(a.w, a.h, dx, dy, maxd)
    if a.out:
        with open(a.out, 'wb') as f:
            f.write(png)
        print('写好了 %s：%d×%d，边宽 %.1f，最大偏移 %.2fpx，feDisplacementMap scale=%.2f'
              % (a.out, a.w, a.h, bezel, maxd, scale), file=sys.stderr)
    if a.svg:
        sys.stdout.write(svg_filter(a.id, a.w, a.h, png, scale))
    if not a.out and not a.svg:
        print('scale=%.2f（加 --out 写 PNG，或 --svg 打印滤镜）' % scale)
    return 0


if __name__ == '__main__':
    sys.exit(main())
