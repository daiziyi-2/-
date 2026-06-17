# 历史粘贴板 - AI 助手指引

## 项目概述
Windows 桌面剪切板历史管理工具，Electron + React + TypeScript 构建。

## 文档索引
- **开发需求**: `./docs/requirements.md`
- **技术规范**: `./docs/tech-spec.md`
- **设计规范**: `./docs/design-spec.md`
- **开发计划**: `./docs/development-plan.md`
- **开发日志**: `./dev-logs/` (按日期命名，格式 YYYY-MM-DD.md)

## 工作规范
1. 每次修改代码前，先阅读相关文档了解上下文
2. 修改完成后，更新 `./dev-logs/` 中当天的日志文件
3. 阶段完成后，更新 `./docs/development-plan.md` 中的进度
4. 保持代码风格一致：使用 TypeScript 严格模式，React 函数组件 + Hooks
5. 所有 UI 文案使用简体中文

## 项目结构
```
src/
├── main/           # Electron 主进程（Node.js 环境）
│   ├── index.ts    # 入口：窗口管理、应用生命周期
│   └── preload.ts  # 预加载脚本：contextBridge API 暴露
├── renderer/       # React 前端（浏览器环境）
│   ├── main.tsx    # React 入口
│   ├── App.tsx     # 根组件
│   ├── components/ # UI 组件
│   └── styles/     # 样式文件
└── shared/         # 共享类型定义
    └── types.ts
```

## 技术栈
- Electron 33 (桌面框架)
- React 18 + TypeScript (前端)
- TailwindCSS 4 (样式)
- Vite 6 (构建)
- better-sqlite3 (本地数据库)
- electron-store (设置持久化)

## 开发命令
```bash
npm run dev            # 开发模式（Vite + Electron 并行启动）
npm run build          # 构建
npm run pack           # 打包 Windows .exe
```
