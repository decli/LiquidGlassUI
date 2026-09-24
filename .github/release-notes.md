把网页界面做成 Apple Liquid Glass（液态玻璃）风格的 Claude skill（版本 {{VERSION}}）：零依赖的 CSS + ES5 脚本（边缘折射、流动透镜、液态滑块、指尖光、玻璃提示、HDR 高光、完整 / 精简 / 关闭三档与自动降级），外加设计规范、技术原理、踩坑清单与校验脚本。

### 下载

| 文件 | 说明 |
|---|---|
| `liquid-glass-ui.skill` | skill 安装包（zip 格式，里面是 `liquid-glass-ui/` 文件夹） |
| `liquid-glass-ui.skill.sha256` | 校验和：`{{SHA256}}` |

### 安装

- **Claude Code**：`unzip liquid-glass-ui.skill -d ~/.claude/skills/`（只给某一个项目用，就解到 `项目/.claude/skills/`）
- **claude.ai / Claude 桌面版**：在技能设置里上传这个 `.skill` 文件
- **只要网页样式、不用 Claude**：解压后拿 `liquid-glass-ui/assets/` 里的 `liquid-glass.css` 与 `liquid-glass.js`，照 `assets/demo/index.html` 的写法用

装好后对 Claude 说「把这个后台改成液态玻璃风格」「做一个苹果风的分组侧栏」这类话就会用上它。

### 核对下载的文件

```bash
sha256sum -c liquid-glass-ui.skill.sha256          # macOS：shasum -a 256 -c liquid-glass-ui.skill.sha256
certutil -hashfile liquid-glass-ui.skill SHA256    # Windows
```

这个包由 GitHub Actions 从本标签对应的提交自动打出：打包前跑过静态检查、算法自检和真浏览器三档校验；同一个提交打出来的包逐字节相同。许可：MIT。
