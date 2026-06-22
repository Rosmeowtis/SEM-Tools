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
| 安装后端依赖 | `uv add fastapi uvicorn pydantic opencv-python python-multipart python-slugify` |

**说明**：
- `python-multipart` 是 FastAPI 处理文件上传的必备依赖
- `python-slugify` 从项目标题生成 URL 友好的 slug
- `pillow` 和 `aiofiles` 暂不安装，Phase 3 才用得上
- 缩略图用 opencv 直接生成，不依赖 pillow

## 步骤 2：修改工具生成的文件

| 文件 | 改动 |
|------|------|
| `frontend/vite.config.ts` | 添加 Tailwind Vite 插件 + `/api` 代理到 `localhost:8000` + `base: "/studio"` |
| `frontend/src/index.css` | 替换为 `@import "tailwindcss"` |
| `.gitignore` | 追加 `_data/`、`*.db`、`__pycache__/`（`.python-version` 不忽略，用于锁定版本和分发打包） |

`vite.config.ts` 的 `base: "/studio"` 与设计文档路由 `basename /studio` 对齐。

## 步骤 3：后端手写文件

```
backend/
├── main.py                          # FastAPI app、CORS、挂载 routers
├── studio/
│   ├── __init__.py
│   ├── config.py                    # _data 路径定位、DB 路径
│   ├── database.py                  # SQLite 初始化、CREATE TABLE
│   ├── models.py                    # Pydantic: Project, ResourceMeta
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── projects.py              # 项目 CRUD
│   │   └── resources.py             # 上传、列表、缩略图、删除
│   └── services/
│       ├── __init__.py
│       ├── resources.py             # SHA1 去重存储、manifest 管理
│       └── thumbnail.py             # opencv 生成缩略图
```

**关键细节**：

- `config.py` 通过 `__file__` 向上定位项目根目录，`_data/` 始终在项目根而非 `backend/` 下
- 缩略图在文件上传时**同步生成**（opencv resize 到 200px，毫秒级），存入 `_data/thumb_cache/{sha1}.jpg`
- ZIP 上传暂不实现，Phase 2 再补
- 项目路径使用 `{id}-{slug}`，slug 由 `python-slugify` 从 title 生成
- SQLite 仅建 `projects` 表（id, slug, title, note, archived_at, created_at, updated_at）
- Python 版本由 `uv init` 生成的 `.python-version` 锁定为 3.13，**不写入 `.gitignore`**（确保分发时版本一致，也方便 `uv sync --python` 自动下载 embedded Python）

## 步骤 4：前端手写文件

```
frontend/src/
├── types.ts                          # TypeScript: Project, ResourceMeta 接口
├── api/
│   └── client.ts                     # 类型化 req<T>() 封装 + xhrUpload 进度
├── components/
│   └── layout/
│       ├── Sidebar.tsx               # 项目列表侧栏
│       ├── Topbar.tsx                # 面包屑 + 操作按钮
│       └── ProjectLayout.tsx         # Outlet 容器 + ProjectContext
├── pages/
│   ├── ProjectsPage.tsx              # 项目创建/列表主页
│   ├── ProjectOverview.tsx           # 项目详情概览
│   └── ResourcesPage.tsx             # 资源上传/浏览/删除（缩略图网格）
└── App.tsx                           # react-router 路由表 (basename /studio)
```

**说明**：

- `types.ts` 放 Project / ResourceMeta / API response 类型，Phase 2+ 的 Chain / Operation 也往这里加
- `useEventStream.ts` 不建，Phase 4 再加
- 路由 `basename="/studio"` 对齐设计文档

## 步骤 5：验证

```bash
# terminal 1: 后端
cd backend && uv run uvicorn main:app --reload

# terminal 2: 前端
cd frontend && bun run dev
```

验证路径：`http://localhost:5173/studio/` → 创建项目 → 上传图片 → 列表显示缩略图 → 删除资源。

## 关键设计决策

- **resource_id 用 SHA1**：上传时计算文件 SHA1，去重存储
- **manifest.json + SQLite**：资源名 → SHA1 映射存项目目录 manifest，SQLite 存元数据索引。manifest 在文件系统中可读，SQLite 做快速查询
- **缩略图上传时同步生成**：不惰性生成，避免用户首次进入资源页时等待渲染
- **ZIP 上传延后**：Phase 1 只支持单文件上传，ZIP 批量导入 Phase 2 补
- **前端 API 封装**：`req<T>()` 类型化 fetch + `xhrUpload` 带进度回调
- **路由 basename**：前后端统一 `/studio` 前缀，部署时可以在 nginx/Caddy 下直接反代子路径
