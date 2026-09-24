#!/usr/bin/env python3
"""把 liquid-glass-ui/ 打成一个 .skill 文件（Claude 的 skill 安装包）。只用 Python 标准库。

.skill 就是一个 zip：根下一个与 skill 同名的文件夹，里面是 SKILL.md 和它带的文件——
和 Anthropic 官方 skill-creator 的 package_skill.py 产出的格式一致（同样的校验、同样排除
__pycache__ / node_modules / *.pyc / .DS_Store / 根下的 evals）。

和官方那份的两处不同：
  · 不依赖 PyYAML（GitHub 的运行机上不一定有），frontmatter 用一个够用的小解析器读；
  · 可复现：文件按路径排序、时间戳固定、权限固定，同一个提交打出来的包逐字节相同，校验和可以对得上。

用法：
  python3 tools/package_skill.py liquid-glass-ui dist                         # → dist/liquid-glass-ui.skill（+ .sha256）
  python3 tools/package_skill.py liquid-glass-ui dist --expect-version 1.0.0  # 再核对脚本里的版本号与标签一致
"""
import argparse
import fnmatch
import hashlib
import os
import re
import sys
import time
import zipfile
from pathlib import Path

EXCLUDE_DIRS = {'__pycache__', 'node_modules'}
EXCLUDE_GLOBS = {'*.pyc'}
EXCLUDE_FILES = {'.DS_Store'}
ROOT_EXCLUDE_DIRS = {'evals'}
ALLOWED_KEYS = {'name', 'description', 'license', 'allowed-tools', 'metadata', 'compatibility'}


def excluded(rel):
    """rel 相对于 skill 文件夹的上一级：parts[0] 是 skill 文件夹名，parts[1] 是它下面的第一层。"""
    parts = rel.parts
    if any(p in EXCLUDE_DIRS for p in parts):
        return True
    if len(parts) > 1 and parts[1] in ROOT_EXCLUDE_DIRS:
        return True
    if rel.name in EXCLUDE_FILES:
        return True
    return any(fnmatch.fnmatch(rel.name, g) for g in EXCLUDE_GLOBS)


def frontmatter(text):
    """读 SKILL.md 开头 --- 之间的键值。支持单行值与 >- / | 这类多行块（本仓库只用到这两种）。"""
    m = re.match(r'^---\n(.*?)\n---', text, re.S)
    if not m:
        raise ValueError('SKILL.md 开头没有 --- 包起来的 frontmatter')
    out, key, block, fold = {}, None, [], True
    for line in m.group(1).split('\n'):
        top = re.match(r'^([A-Za-z][\w-]*):\s*(.*)$', line)
        if top:
            if key is not None and block:
                out[key] = (' ' if fold else '\n').join(block).strip()
            key, val, block = top.group(1), top.group(2).strip(), []
            if val in ('>', '>-', '|', '|-'):
                fold = val.startswith('>')
                out[key] = ''
            else:
                out[key] = val.strip('"\'')
                key = key if val == '' else None
        elif key is not None:
            block.append(line.strip())
    if key is not None and block:
        out[key] = (' ' if fold else '\n').join(block).strip()
    return out


def validate(skill):
    md = skill / 'SKILL.md'
    if not md.is_file():
        return 'SKILL.md 不存在'
    extra = [p for p in skill.rglob('SKILL.md') if p != md and not excluded(p.relative_to(skill.parent))]
    if extra:
        return '一个 skill 里只能有一个 SKILL.md，多出来：' + ', '.join(str(p.relative_to(skill)) for p in extra)
    try:
        fm = frontmatter(md.read_text(encoding='utf-8'))
    except ValueError as e:
        return str(e)
    bad = set(fm) - ALLOWED_KEYS
    if bad:
        return 'frontmatter 里有不认识的键：' + ', '.join(sorted(bad))
    name, desc = fm.get('name', ''), fm.get('description', '')
    if not re.match(r'^[a-z0-9]+(-[a-z0-9]+)*$', name) or len(name) > 64:
        return f'name「{name}」要是小写字母、数字、连字符，最长 64'
    if name != skill.name:
        return f'name「{name}」和文件夹名「{skill.name}」不一致'
    if not desc:
        return '缺 description'
    if '<' in desc or '>' in desc:
        return 'description 里不能有尖括号'
    if len(desc) > 1024:
        return f'description 太长（{len(desc)} 字，最多 1024）'
    return None


def script_version(skill):
    js = skill / 'assets' / 'liquid-glass.js'
    m = re.search(r"version:\s*'([^']+)'", js.read_text(encoding='utf-8')) if js.is_file() else None
    return m.group(1) if m else None


def build(skill, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f'{skill.name}.skill'
    # 时间戳：有 SOURCE_DATE_EPOCH（CI 里设成提交时间）就用它，否则固定在 2026-01-01
    epoch = int(os.environ.get('SOURCE_DATE_EPOCH', '1767225600'))
    stamp = time.gmtime(max(epoch, 315532800))[:6]
    files = sorted((p for p in skill.rglob('*') if p.is_file()), key=lambda p: p.relative_to(skill.parent).as_posix())
    added = []
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as z:
        for p in files:
            rel = p.relative_to(skill.parent)
            if excluded(rel):
                continue
            info = zipfile.ZipInfo(rel.as_posix(), date_time=stamp)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o755 if os.access(p, os.X_OK) else 0o644) << 16
            z.writestr(info, p.read_bytes())
            added.append(rel.as_posix())
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    (out_dir / f'{target.name}.sha256').write_text(f'{digest}  {target.name}\n', encoding='utf-8')
    return target, digest, added


def main():
    ap = argparse.ArgumentParser(description='把 skill 文件夹打成 .skill')
    ap.add_argument('skill', help='skill 文件夹（里面有 SKILL.md）')
    ap.add_argument('out', nargs='?', default='dist', help='输出目录，缺省 dist')
    ap.add_argument('--expect-version', help='核对 assets/liquid-glass.js 里的 version 与它一致（比如发布标签去掉 v）')
    a = ap.parse_args()
    skill = Path(a.skill).resolve()
    err = validate(skill)
    if err:
        print('校验失败：' + err, file=sys.stderr)
        return 1
    ver = script_version(skill)
    if a.expect_version and ver != a.expect_version:
        print(f'版本对不上：脚本里是 {ver}，要发布的是 {a.expect_version}。先改 liquid-glass.js 里的 version（以及 CSS / JS 文件头的版本号）', file=sys.stderr)
        return 1
    target, digest, added = build(skill, Path(a.out).resolve())
    for f in added:
        print('  ' + f)
    print(f'\n{target}（{target.stat().st_size} 字节，{len(added)} 个文件，版本 {ver}）\nsha256 {digest}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
