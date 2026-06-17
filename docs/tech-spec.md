# 技术规范

## 技术栈

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 桌面框架 | Electron | 33+ | 跨平台桌面应用框架 |
| 前端 | React | 18 | 声明式 UI 组件库 |
| 语言 | TypeScript | 5 | 类型安全 |
| 样式 | TailwindCSS | 4 | 原子化 CSS 框架 |
| 构建 | Vite | 6 | 前端构建工具 |
| 数据库 | better-sqlite3 | 11 | 同步 SQLite 绑定 |
| 配置存储 | electron-store | 10 | 设置持久化 |
| 打包 | electron-builder | 25 | Windows 安装包生成 |

## 架构

### 进程模型
- **主进程 (Main Process)**: Node.js 环境，负责剪切板监控、系统托盘、快捷键、数据库操作
- **渲染进程 (Renderer Process)**: 浏览器环境，React UI，通过 IPC 与主进程通信

### IPC 通道

| 通道名 | 方向 | 功能 |
|--------|------|------|
| get-records | Renderer→Main | 获取全部历史记录 |
| search-records | Renderer→Main | 搜索历史记录 |
| copy-to-clipboard | Renderer→Main | 写入剪切板+粘贴 |
| delete-record | Renderer→Main | 删除记录 |
| toggle-pin | Renderer→Main | 切换置顶状态 |
| get-settings | Renderer→Main | 读取设置 |
| save-settings | Renderer→Main | 保存设置 |
| minimize-window | Renderer→Main | 最小化窗口 |
| close-window | Renderer→Main | 关闭窗口 |
| new-record | Main→Renderer | 通知有新记录 |

## 数据存储

### 数据库位置
`%APPDATA%/clipboard-app/data.db`

### 图片存储
`%APPDATA%/clipboard-app/images/`

### 设置存储
`%APPDATA%/clipboard-app/settings.json`

## 剪切板监控
- 轮询间隔：500ms
- 检测方式：比较剪切板内容哈希，变化时记录
- 文本格式：CF_UNICODETEXT
- 图片格式：CF_DIB, CF_BITMAP
