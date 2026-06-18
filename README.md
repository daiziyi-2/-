# 📋 历史粘贴板

> 轻量级剪贴板历史管理器 — 基于 Tauri v2 + Rust 构建

[![Release](https://img.shields.io/badge/release-v1.1.3-blue)](https://github.com/daiziyi-2/-/releases)
[![Size](https://img.shields.io/badge/size-10.1%20MB-green)]()
[![Memory](https://img.shields.io/badge/memory-~29%20MB-lightgrey)]()

---

## ✨ 功能

- **自动记录** — 复制文本/图片自动保存到本地历史
- **全局快捷键** — `Alt+Shift+V` 随时随地唤出面板
- **搜索** — 实时搜索历史记录，高亮匹配内容
- **置顶** — 常用内容置顶，不被自动清理
- **暗色模式** — 自动/浅色/暗色三种主题
- **保留天数** — 0/1/3/5 天自动清理
- **系统托盘** — 最小化到托盘，不占任务栏

## 📦 安装

从 [Releases](https://github.com/daiziyi-2/-/releases) 下载 `clipboard-app.exe`，双击运行即可。

> 仅 **10.1 MB**，无需安装任何依赖（Windows 自带 WebView2）。

## 🛠 技术栈

| 层 | 技术 |
|---|------|
| 框架 | [Tauri v2](https://tauri.app/) |
| 后端 | Rust |
| 前端 | Vanilla JS + CSS |
| 存储 | SQLite (WAL 模式) |
| 快捷键 | tauri-plugin-global-shortcut |

## 🚀 开发

```bash
# 安装 Rust & Tauri CLI
cargo install tauri-cli

# 克隆项目
git clone https://github.com/daiziyi-2/-.git
cd -

# 开发模式
cargo tauri dev

# 构建
cargo tauri build --no-bundle
```

## 📊 对比 Electron 版

| | Electron | Tauri |
|---|---------|-------|
| 安装包 | 150 MB | **10.1 MB** |
| 内存 | ~150 MB | **~29 MB** |
| 启动速度 | 慢 | **快** |

## 📄 License

MIT
