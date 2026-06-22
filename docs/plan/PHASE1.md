# Phase 1 实施计划

## 环境

- bun 1.3.14（前端包管理 + 项目创建）
- uv 0.10.7（Python 包管理 + 项目创建）
- Python 3.13.11

## 步骤 1：脚手架（工具生成）

| 动作 | 命令 |
|------|------|
| 创建前端 | `bun create vite frontend --template react-ts` |
| 安装运行时依赖 | `bun add react-router-dom` |
| 安装 DevDep | `bun add -D tailwindcss @tailwindcss/vite` |
| 创建后端 | `uv init backend --app --name studio-backend --no-readme` |
| 安装后端依赖 | `uv add fastapi uvicorn pydantic opencv-python python-multipart` |

**说明**：
- `python-multipart` 是 FastAPI 处理文件上传的必备依赖
- 缩略图用 opencv 直接生成，不依赖 pillow
- slug 用 3 行 stdlib 正则，不装 `python-slugify`
- 只装用得上的依赖

## 步骤 2：修改工具生成的文件

| 文件 | 改动 |
|------|------|
| `frontend/vite.config.ts` | 添加 Tailwind Vite 插件 + `/api` 代理到 `localhost:8000` + `base: "/studio"` |
| `frontend/src/index.css` | 替换为 `@import "tailwindcss"` |
| `.gitignore` | 追加 `_data/`、`*.db`、`__pycache__/` |

`.python-version` 不忽略，用于锁定版本和分发打包。

## 步骤 3：后端手写文件

```
backend/
├── main.py               # FastAPI app + CORS + router 挂载
├── database.py           # SQLite 初始化 + 所有 SQL 查询
├── studio/
│   ├── __init__.py
│   ├── config.py         # _data 路径定位
│   └── models.py         # Pydantic: Project, ResourceMeta
```

**关键细节**：
- `config.py` 通过 `__file__` 向上定位项目根，`_data/` 始终在根目录
- 缩略图上传时同步生成（opencv resize 到 200px），存入 `_data/thumb_cache/{sha1}.jpg`
- 项目路径 `{id}-{slug}`，slug 用 stdlib `re.sub` 从 title 生成
- SQLite 仅建 `projects` 表（id, slug, title, note, created_at, updated_at）
- 资源上传、删除、缩略图、列表等 handler 全放 `main.py`
- ZIP 上传延后到 Phase 2
- `.python-version` 锁定 3.13，分发时 `uv sync --python` 自动下载 embedded Python

## 步骤 4：前端手写文件

```
frontend/src/
├── types.ts              # Project, Resource 接口
├── api.ts                # req<T>() + xhrUpload + 所有 endpoint
└── App.tsx               # 路由 + 全部 page 组件 + layout（内联）
```

**说明**：
- 不做独立 Page/Layout 文件——每个页面 20-40 行，App.tsx 内联
- `useEventStream.ts` 不建，Phase 4 再加

## 步骤 5：验证

```bash
# terminal 1: 后端
cd backend && uv run uvicorn main:app --reload

# terminal 2: 前端
cd frontend && bun run dev
```

验证路径：`http://localhost:5173/studio/` → 创建项目 → 上传图片 → 列表显示缩略图 → 删除资源。

## 关键设计决策

- **不拆 services 层**：每个 service 只用在一个 router，函数直接放 router 文件
- **不写 manifest.json**：SQLite 已有全部信息，多一份 JSON 就多一份不一致
- **软删除 YAGNI**：用户没提恢复功能，直接 DELETE
- **不做独立 ProjectOverview 页**：`/projects/:pid` 直接跳转到 resources 页面
- **路由 basename**：前后端统一 `/studio` 前缀
