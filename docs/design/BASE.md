## 1. 设计目标

基于 Python + React + Vite + Tailwind 的技术栈，构建一个**基于项目的、链式操作的、可还原的图像编辑与运算网页 App**。

核心场景：用户创建一个项目 → 导入图片资源 → 在资源上建立一个"处理链"（有序的 Operation 序列，可调整参数）→ 实时预览 → 通过特定算法计算图像参数（如二值化图像孔隙率统计、灰度直方图等） → 导出成品。

---

## 2. 核心实体定义

| 实体 | 说明 |
|------|------|
| **Project** | 资源容器，对应一次编辑任务或主题。含元数据、资源列表、链列表。 |
| **Resource** | 项目内导入的原始图片文件。**永不修改**，以 SHA1 去重存储，但在项目数据文件中记录原始文件名。 |
| **Chain** | 绑定到某个 Resource 的有序图像处理操作序列。链定义本身就是完整的可重现历史。 |
| **Operation** | 单个变换。每类 Operation 有自己的参数 schema。 |
| **Preset** | 可复用的 Chain 模板（无 `resource_id` 绑定），全局共享。 |

### Operation 类型一览

| kind | 参数 | 用途 |
|------|------|------|
| `crop` | `x`, `y`, `w`, `h` | 从图像的 (x, y) 位置开始裁剪出长宽为 w*h 的区域 |
| `resize` | `w`, `h`, `algorithm` | 使用指定的缩放算法，将图像缩放至指定尺寸 |
| `blur` | `ksize` | 以 ksize*ksize 的矩形核对图像进行高斯模糊 |
| `grayscale` | 无 | 将彩色图像转换为灰度图，若已经是灰度图则不做处理 |
| `format` | `type: png\|jpg\|webp`, `quality` | 将图像转换成指定格式以方便保存，这一般是处理链的最后部分 |
| `threshold` | `threshold` | 按一定阈值将灰度图像二值化 |
| `morphology_ellipse` | `type: open\|close`, `ksize` | 使用 ksize 直径的圆形核对图像进行 morphology 开、闭运算 |
| `compute_porosity` | `save_path` | 对二值化图像进行运算，计算白色（灰度255）部分占总像素的比例。并将结果保存至 save_path |
| `invert` | 无 | 反转像素 |

每个 Operation 都会接收一个图像集合，内部对其中的每个图像进行处理，并将处理结果按相同顺序传递给链的下一环。
在 DEBUG 模式下，每个 Operation 都会在 project cache 中保存 `{resource_id}_{step}.png` 缓存文件，方便用户或开发者观察处理的中间结果。但正常运行模式下不保存中间结果。  


## 3. 存储结构

### 文件目录

```
_data/projects/{id}-{slug}/
├── project.json              # 项目元数据（JSON，DB 镜像）
├── resources/
│   ├── original/             # 原始导入图片（只读，永不修改）
│   │   ├── {sha1}.{ext}     # SHA1 去重
│   │   └── manifest.json    # {filename → {sha1, imported_at, tags, size}}
│   └── thumb_cache/          # 缩略图缓存（同全局缓存策略）
├── chains/
│   └── {chain_id}.json       # Chain 定义（有序 Operation 列表）
└── output/                   # 导出成品

_data/
├── studio.db                 # SQLite: projects, chains, exports 元数据
├── presets/                  # 全局 Presets
│   └── {name}.yaml           # operations 列表 + 分类标签
├── thumb_cache/              # 全局缩略图缓存（SHA1 key）
│   └── {sha1}.jpg
└── secrets.json              # 全局凭证（同现有机制）
```

### SQLite 主要表

```sql
-- projects: id, slug, title, note, archived_at, created_at, updated_at
-- chains: id, project_id, name, resource_id, created_at, updated_at
-- exports: id, project_id, chain_id, format, quality, created_at
```

`chains` 表的 operation 列表存储在对应 `chains/{chain_id}.json` 文件中（JSON 全文），以简化版本比较和手动编辑。


## 4. 前端架构

### 技术栈

| 层 | 技术 |
|----|------|
| 框架 | React 18 + TypeScript |
| 构建 | Vite |
| 样式 | Tailwind CSS |
| 路由 | react-router-dom v6 (basename `/studio`) |
| 拖拽 | @dnd-kit |
| 本地化 | i18next |
| API | 类型化 fetch 封装（`api/client.ts`） |
| 实时 | SSE（`useEventStream` hook） |

### 路由表

```
/                              → ProjectsPage
/projects/:pid                 → ProjectLayout（Context provider）
  index                        → ProjectOverview（资源+链总览）
  resources                    → ResourcesPage（上传/浏览/删除）
  chains/:cid                  → ChainEditorPage（核心三栏编辑区）
  chains/new                   → ChainCreatePage（选资源，选/不选 Preset）
  export                       → ExportPage（批量导出设置）
/tools/presets                 → PresetsPage（Preset CRUD + SchemaForm）
/tools/settings                → SettingsDrawer（懒加载，右侧滑出面板）
```


### 布局结构

```
┌─────────┬─────────────────────────────────────────────────────┐
│ Sidebar │  Topbar (面包屑 + 导出按钮 + SSE 状态指示)          │
│         ├─────────────────────────────────────────────────────┤
│ 项目列表│  三栏编辑器                                          │
│ 资源面板│  ┌──────────┬────────────────────┬──────────────┐   │
│ 链列表   │  │Resource  │   Chain Canvas     │  Inspector   │   │
│         │  │Picker    │   ┌──────────────┐ │  选中某      │   │
│         │  │(缩略图   │   │  Operation 1  │ │  Operation   │   │
│         │  │ 网格)    │   │  Operation 2  │ │  的参数编辑  │   │
│         │  │点击选中  │   │  Operation 3  │ │  表单        │   │
│         │  │当前资源  │   │  ...          │ │             │   │
│         │  │高亮      │   │  ──────────   │ │  ────────   │   │
│         │  │          │   │  预览图区域    │ │  (Schema    │   │
│         │  │          │   └──────────────┘ │ │   Form)    │   │
│         │  │          │   (拖拽排序 +      │ │             │   │
│         │  │          │    实时预览)        │ │             │   │
│         │  └──────────┴────────────────────┴──────────────┘   │
│         │  (链选择 tabs，单个 Project 可有多条链)              │
└─────────┴─────────────────────────────────────────────────────┘
```

## 5. 前后端通信

### REST API

```
# 项目
GET    /api/projects                          # 列表 ?archived=1&q=
POST   /api/projects                          # 创建 {title, note}
GET    /api/projects/:pid                     # 详情
PATCH  /api/projects/:pid                     # 更新 {title, note}
DELETE /api/projects/:pid                     # 软删除（archived_at）

# 资源
GET    /api/projects/:pid/resources           # 列表 ?q=
POST   /api/projects/:pid/resources           # 上传 (multipart, 支持单文件/ZIP)
GET    /api/projects/:pid/resources/:sha1     # 元数据
GET    /api/projects/:pid/resources/:sha1/thumb  # 缩略图 ?size=
DELETE /api/projects/:pid/resources/:sha1     # 删除

# 链
GET    /api/projects/:pid/chains              # 列表（含 operation 摘要）
POST   /api/projects/:pid/chains              # 创建 {name, resource_id, operations?, from_preset?}
GET    /api/projects/:pid/chains/:cid         # 详情（含完整 operation 列表）
PATCH  /api/projects/:pid/chains/:cid         # 更新 {operations, name}
DELETE /api/projects/:pid/chains/:cid         # 删除

# 预览
POST   /api/projects/:pid/chains/:cid/preview  # 触发后台渲染，返回 thumb_sha1
PUT    /api/projects/:pid/chains/:cid/preview   # 全量渲染（非缓存）

# 导出
POST   /api/projects/:pid/chains/:cid/export    # 导出单链 {format, quality}
POST   /api/projects/:pid/export-batch          # 批量导出 {resource_ids?, chains_ids?, format}

# 预设
GET    /api/presets                           # 列表 ?category=
POST   /api/presets                           # 创建 {name, operations, category}
PATCH  /api/presets/:name                     # 更新
DELETE /api/presets/:name                     # 删除
POST   /api/presets/:name/instantiate/:pid    # 从 Preset 创建链

# SSE
GET    /api/events                            # 实时事件流
```

### SSE 事件类型

```typescript
type Event =
  | { type: 'preview.progress';  chain_id: string; progress: number; status: 'processing' | 'done' | 'error' }
  | { type: 'preview.complete';  chain_id: string; thumb_sha1: string }
  | { type: 'export.progress';   export_id: string; progress: number }
  | { type: 'export.complete';   export_id: string; file_path: string }
  | { type: 'import.progress';   resource_count: number; complete: number }
  | { type: 'import.done';       project_id: string; imported: number }
```

### 通信模式（与 AnimaLoraStudio 完全一致）

```typescript
// 类型化 fetch 封装
async function req<T>(path: string, init?: RequestInit): Promise<T> { ... }
async function xhrUpload<T>(url: string, body: FormData, onProgress?): Promise<T> { ... }

// 共享 SSE 单连接
function useEventStream(onEvent: (evt: StudioEvent) => void): void { ... }

// API 导出
export const api = {
  listProjects: () => req<Project[]>('/api/projects'),
  uploadResource: (pid, fd, onProgress) => xhrUpload(...),
  updateChain: (pid, cid, ops) => req<Chain>(`/api/...`, { method: 'PATCH', body: ops }),
  requestPreview: (pid, cid) => req<{ thumb_sha1: string }>(`/api/.../preview`, { method: 'POST' }),
  // ...
}
```

### 实时预览流程

```
用户拖拽排序 / 修改 Operation 参数
  ↓ (debounce 300ms)
PATCH /api/projects/:pid/chains/:cid   → 保存完整 Chain 定义
  ↓
POST /api/.../chains/:cid/preview      → 后台触发渲染（异步）
  ↓
SSE: { type: 'preview.progress', progress: 0..100 }
  ↓
SSE: { type: 'preview.complete', thumb_sha1: 'abc123' }
  ↓
GET /api/.../resources/:hash/thumb     → 显示预览图
```

---

## 6. 后端设计

### 技术栈

| 层 | 技术 |
|----|------|
| Web 框架 | FastAPI |
| ASGI 服务器 | uvicorn |
| 数据验证 | Pydantic v2 |
| 数据库 | SQLite |
| 图像处理 | Pillow + opencv-python |

图像处理主要使用 opencv，Pillow 仅用于图像的读取和保存（opencv 对非 ASCII 路径支持不好）

### 图像处理管道（链式执行）

```python
def make_chain(images: Images, operations: list[Operation]) -> Images:
    for seq, op in enumerate(operations):
        match op.kind:
            case 'crop': images = crop(images, op.x, op.y, op.w, op.h)
            # other operations
        if DEBUG:
            debug_save(images, seq)

    return images
```

Images 是一个懒加载的 像素矩阵 列表(为 Opencv 的 ndarray 包装，在处理时按需加载)，各 Operation 都对 ndarray 进行。

### 实时预览缓存

- 每个 Chain 渲染结果缓存到 `resources/thumb_cache/{sha1_of_ops_json}.jpg`
- 缓存的 key = SHA1(chain.operations JSON + resource.sha1)
- 只在 `POST preview` 时刷新，`PATCH chain` 时失效

---

## 7. 关键设计决策（为什么这样做）

| 决策 | 理由 |
|------|------|
| **线性 Chain，不建 Node Graph** | 线性排序覆盖 90% 场景（图层→滤镜→导出）。DAG 编辑器复杂度翻 3 倍，没必要。 |
| **Operation 存 JSON 文件而非 DB** | 链编辑本质是读/写整个 operation 数组，JSON 文件方便版本 diff、手动修复、git 管理。 |
| **资源只读 SHA1 存储** | 同名冲突靠哈希消除，永不修改保证历史可重现。还原任意步骤只需改 Chain JSON 重新 apply。 |
| **预览走服务端渲染** | 保证 1:1 匹配导出结果，前后端无差异。比 Canvas 预览靠谱且省前端 CPU。 |
| **不回滚历史，链即历史** | Chain 的 JSON 就是完整的操作历史。回滚 = 修改 JSON；分支 = 复制 Chain 再改。不需要 undo 栈。 |
| **SettingsDrawer 懒加载** | 设置不是高频入口，同现有模式。 |

### 当需要扩展时

- 当前 `Operation` 列表是平坦数组，如果未来需要条件分支或并行处理 → 升级为 **DAG**，数据模型从 `[op]` 变为 `{nodes: [], edges: []}`，前端从 @dnd-kit 列表升级为节点图编辑器。
- 当前 `preview` 是单图渲染，如果未来需要实时滤镜拖拽 VFX 级体验 → 走 WebGL Canvas 前端实时渲染 + 服务端做 final render 保证一致。
- 当前 `color` / `filter` 参数是基础版，缺高级参数 → 在 `Operation` 的 Union 类型中新增 `kind: 'curves'`, `kind: 'levels'` 等。

---

## 8. 实施路线

| 阶段 | 内容 |
|------|------|
| Phase 1 | 项目 CRUD + 资源上传/浏览 + 基础布局（Sidebar + Topbar + 路由）+ 缩略图系统 |
| Phase 2 | Chain 定义 CRUD + 链编辑器三栏布局 + 拖拽排序 |
| Phase 3 | Operation 参数表单（Inspector）+ 服务端管道渲染 |
| Phase 4 | 实时预览（SSE）+ 预览缓存 |
| Phase 5 | 导出（单文件 + 批量）+ Preset 系统 |
| Phase 6 | 标签管理、搜索、CommandPalette |
