# 历史粘贴板

一个运行在 Windows 上的轻量级剪贴板管理器，Apple 风格扁平化设计。

## 功能

- 📋 自动记录复制内容（文字 + 图片）
- 🌓 暗色/浅色主题，根据时间自动切换
- 📌 置顶、删除历史记录
- 🔍 全文搜索
- ⏱ 存储期限设置（1/3/5 天）
- 🚀 开机自启开关
- ⌨ 全局快捷键 `Alt+Shift+V`

## 下载安装

👉 [最新版本下载](../../releases/latest)

下载 `历史粘贴板 Setup x.x.x.exe`，双击安装即可。

> 首次运行 Windows SmartScreen 可能会提示，点"更多信息" → "仍要运行"。

## 开发

```bash
npm install
npm start        # 开发运行
npm run pack     # 打包安装包
```

## 技术栈

- Electron
- 纯 HTML/CSS/JS
- JSON 文件存储
