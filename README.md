# SEM-Tools

基于项目的链式图像编辑与运算 Web 应用。用户创建项目 → 导入图片 → 建立处理链（有序 Map/Reduce 操作序列）→ 实时预览 → 导出结果。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 + TypeScript + Vite + Tailwind CSS |
| 后端 | Python 3.13 + FastAPI + SQLite + OpenCV |
| 包管理 | bun（前端）/ uv（后端） |

## 快速开始

```bash
# 终端 1：后端
cd backend && uv run uvicorn main:app --reload

# 终端 2：前端
cd frontend && bun run dev
```

打开 `http://localhost:5173/studio/`，创建项目 → 上传图片 → 管理资源。

## 项目结构

```
backend/             # FastAPI 服务（main.py + database.py + studio/）
frontend/            # React 前端（App.tsx 内联所有页面，无独立 page 文件）
docs/design/         # 系统设计文档
docs/plan/           # 阶段实施计划
_data/               # 运行时数据（SQLite + 上传文件 + 缩略图缓存）
```

## 设计要点

- **线性 Chain，不建 Node Graph** — 线性排序覆盖 90% 场景，DAG 编辑器复杂度翻 3 倍
- **资源只读 SHA1 存储** — 永不修改保证历史可重现，同名冲突靠哈希消除
- **链即历史** — Chain JSON 就是完整操作历史，回滚 = 修改 JSON，分支 = 复制 Chain
- **Map/Reduce 两阶段执行** — 逐图流式 + 同步累计，内存 O(1 张图)
- **无 services 层** — 函数直接放在 router 文件，不创建多余的抽象

详细设计见 `docs/design/BASE.md`。

## 开发阶段

- [x] Phase 1 — 项目 CRUD + 资源上传/浏览 + 基础布局 + 缩略图系统
- [x] Phase 2 — Chain 定义 CRUD + 三栏链编辑器 + 拖拽排序
- [x] Phase 3 — Operation 参数表单 + 服务端管道渲染
- [x] Phase 4 — 链执行 + 结果缩略图/全尺寸预览（Execute 按钮模式，非 SSE）
- [x] Phase 5 — 导出（单文件 + 批量）+ Preset 系统
- [-] Phase 6 — 标签管理、搜索、CommandPalette（搜索/CommandPalette 已实现，标签管理已放弃）
- [x] Phase 7 — 绿色打包分发（embedded Python + 单目录便携版）
