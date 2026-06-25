# SEM-Tools 新手指南

SEM-Tools 是一个基于项目的链式图像编辑与运算 Web 应用，面向扫描电子显微镜（SEM）图像的后处理场景。

## 项目状态

```
Phases 1-5 (项目/资源/链/执行/导出):  已完成
Phase 6 (CommandPalette):              已完成
Phase 6 (标签管理):                     已放弃
Phase 7 (便携打包):                     待开始
```

## 一句话概括

用户创建项目 → 导入图片 → 在链编辑器中编排操作（裁剪/模糊/二值化/分析…）→ 点 Execute 全量执行 → 预览结果或导出 ZIP。

## 技术栈速览

| 层 | 技术 | 包管理 |
|---|---|---|
| 前端 | React 19 + TypeScript + Vite 8 + Tailwind 4 | `bun` |
| 后端 | Python 3.13 + FastAPI + SQLite + OpenCV/Pillow | `uv` |
| 数据 | SQLite + 文件系统 | — |

**无** 测试框架、CI、ORM、services 层。所有函数直接放在 router 文件中。

## 目录结构

```
backend/
  main.py          — FastAPI 应用（全部路由）
  database.py      — SQLite CRUD（短连接模式）
  engine.py        — 链式执行引擎（map/reduce 管道）
  studio/
    operations.py  — 所有图像处理操作实现
    models.py      — Pydantic 数据模型（含 operation 判别联合）
    config.py      — 路径配置

frontend/
  src/
    App.tsx        — 根组件（路由+全局状态）
    api.ts         — 类型化 fetch/XHR 封装
    types.ts       — TS 类型 + OP_KINDS 操作定义数组
    components/
      HomePage.tsx         — 首页
      ResourcesPage.tsx    — 资源上传/浏览
      ChainEditorPage.tsx  — 核心链编辑器
      SchemaForm.tsx       — 动态参数表单
      SortableOpItem.tsx   — 拖拽操作项
      AddOpPicker.tsx      — 模糊搜索操作选择器
      Sidebar.tsx           — 侧边栏
      ChainTitle.tsx       — 链标题编辑
      PresetsPage.tsx      — Preset 管理
      CommandPalette.tsx   — Ctrl+K 命令面板

_data/             — 运行时数据（gitignored）
  studio.db
  projects/{id}-{slug}/
  presets/
  thumb_cache/

docs/
  design/BASE.md   — 完整系统设计文档
  plan/            — 分阶段实施计划
  README.md        ← 你在这里

scripts/
  build_portable.py — 便携版打包脚本
```

## 核心理念

### 1. 线性 Chain，不是 DAG

Operation 按顺序排列，无分支无并行。JSON 文件就是完整处理历史。回滚 = 编辑 JSON，分支 = 复制 JSON。

### 2. Map/Reduce 两阶段

- **Map**：变换图像（如 blur、threshold），逐图处理，O(1) 内存。
- **Reduce**：跨图采集状态（如分析孔隙率），不修改图像，管道末尾输出汇总。

### 3. SHA1 资源去重

上传时计算 SHA1 作为文件名，同名冲突靠哈希消除。无其他项目引用时才能删除磁盘文件。

### 4. 链即历史

Chain 的 operations JSON = 完整可重现的处理步骤。不需要 undo 栈。

## 如何添加新操作

如果需要新增一个图像处理操作（如 `op_erode`）：

1. **`backend/studio/operations.py`**: 实现函数，注册到 `_MAP_OPS`
2. **`backend/studio/models.py`**: 添加参数 Pydantic 模型 + Operation 变体
3. **`frontend/src/types.ts`**: 在 `OP_KINDS` 添加条目（kind + fields 定义）
4. **`frontend/src/types.ts`**: 更新 `OperationParams` 和 `Operation` 类型

如果是新的 reduce 分析类型：
1. 实现 `reduce_xxx_init/accumulate/finalize/format` 四个函数
2. 注册到 `_REDUCE_TYPES` 字典
3. Pydantic 侧只需在 `AnalyzeParams.type` 增加 Literal 选项

## 常见开发任务

```bash
# 启动后端（端口 8000）
cd backend && uv run uvicorn main:app --reload

# 启动前端（Vite dev server，代理 /api → :8000）
cd frontend && bun run dev

# 前端构建（tsc -b + vite build）
cd frontend && bun run build

# 前端 lint
cd frontend && bun run lint
```

### 更新前端依赖

```bash
cd frontend && bun add <package>
```

### 更新后端依赖

```bash
cd backend && uv add <package>
```

## 数据流

```
用户操作
  ↓
React Router → 页面组件 → api.ts(fetch)
  ↓
FastAPI → database.py(SQLite) / 文件系统
  ↓
Execute:
  engine.run_pipeline → operations.py(逐图处理)
  → thumb_cache/ (预览图)
  → ZIP 流 (导出)
```

## 前端路由

| 路径 | 组件 | 说明 |
|---|---|---|
| `/` | HomePage | 项目总览 |
| `/projects/:pid` | ResourcesPage | 资源管理（上传/浏览） |
| `/projects/:pid/chains/:cid` | ChainEditorPage | 核心编辑 + 执行 + 导出 |
| `/tools/presets` | PresetsPage | Preset 管理 |

## 后端 API（全部 `/api`）

全量 API 清单见 `docs/design/BASE.md` 第 5 节，或直接阅读 `backend/main.py`。

| 前缀 | 功能 |
|---|---|
| `/projects` | 项目 CRUD |
| `/projects/:pid/resources` | 资源上传/浏览/删除（SHA1 去重） |
| `/projects/:pid/chains` | 链 CRUD（operations 存 JSON 文件） |
| `/projects/:pid/chains/:cid/execute` | 全量执行，返回图片索引 + 分析 |
| `/projects/:pid/chains/:cid/export` | ZIP 导出 |
| `/presets` | Preset CRUD |

### 执行流程

```
PATCH chain (debounce 200ms) → 写 JSON 文件
  ↓ 用户点 Execute
POST execute → run_pipeline → 写 thumb_cache/
  ↓ 返回 {images, analysis, text}
前端加载 execute-thumb/:idx / execute-full/:idx
```

## 关于现有 docs/

| 目录 | 说明 |
|---|---|
| `docs/adr/` | 架构决策记录 |
| `docs/design/BASE.md` | 完整系统设计（核心参考） |
| `docs/plan/PHASE*.md` | 分阶段实施计划 |
| `docs/todo/todo.md` | 开发待办 |

## 技能框架

项目配置了 `.claude/skills/`（20 个中文技能），遵循：

1. 收到任务先检查匹配 skill
2. 功能需求先 brainstorming
3. TDD 先于实现
4. 完成前必须验证

详情见 `AGENTS.md`。
