## 1. 设计目标

基于 Python + React + Vite + Tailwind 的技术栈，构建一个**基于项目的、链式操作的、可还原的图像编辑与运算网页 App**。

核心场景：用户创建一个项目 → 导入图片资源 → 在资源上建立一个"处理链"（有序的 Operation 序列，可调整参数）→ 实时预览 → 通过特定算法计算图像参数（如二值化图像孔隙率统计、灰度直方图等） → 导出成品。

---

## 2. 核心实体定义

| 实体 | 说明 |
|------|------|
| **Project** | 资源容器，对应一次编辑任务或主题。含元数据、资源列表、链列表。 |
| **Resource** | 项目内导入的原始图片文件。**永不修改**，以 SHA1 去重存储，但在项目数据文件中记录原始文件名。 |
| **Chain** | 有序图像处理操作序列，绑定到一个或多个 Resource（`resource_ids`）。单资源用于预览，多资源用于批处理。链定义本身就是完整的可重现历史。 |
| **Operation** | 单个变换，分为 Map（逐图独立变换）和 Reduce（跨图聚合）两类。每类 Operation 有自己的参数 schema。 |
| **Preset** | 可复用的 Chain 模板（无 `resource_id` 绑定），全局共享。 |

### Operation 类型一览

每个 Operation 有 `mode: "map" | "reduce"` 属性：

- **Map 操作**：逐图像独立变换，输出与输入等量的图像。支持流式执行——同一时刻只 hold 一张图的像素在内存中。
- **Reduce 操作**：跨图像聚合分析，接收每张图像的像素数据，累积内部状态，最后输出一份汇总结果。不产生中间图像。

#### Map 操作（逐图变换）

| kind | 参数 | 用途 |
|------|------|------|
| `crop` | `x`, `y`, `w`, `h` | 从图像的 (x, y) 位置开始裁剪出长宽为 w*h 的区域 |
| `resize` | `w`, `h`, `algorithm` | 使用指定的缩放算法，将图像缩放至指定尺寸 |
| `blur` | `ksize` | 以 ksize*ksize 的矩形核对图像进行高斯模糊 |
| `grayscale` | 无 | 将彩色图像转换为灰度图，若已经是灰度图则不做处理 |
| `format` | `type: png\|jpg\|webp`, `quality` | 将图像转换成指定格式以方便保存，这一般是处理链的最后部分 |
| `threshold` | `threshold` | 按一定阈值将灰度图像二值化 |
| `morphology_ellipse` | `type: open\|close`, `ksize` | 使用 ksize 直径的圆形核对图像进行 morphology 开、闭运算 |
| `invert` | 无 | 反转像素 |

#### Reduce 操作（跨图聚合）

| kind | 参数 | 用途 |
|------|------|------|
| `analyze` | `type`, `save_path`, `options?` | 对图像进行聚合分析。`type` 决定分析类型（porosity / statistics / distribution），结果保存至 `save_path`（JSON/CSV）。 |

Reduce 操作遵循两阶段协议：`accumulate()` 逐图更新内部状态，`finalize()` 输出最终汇总。不持有像素引用，只持有标量状态。

当前支持的 `analyze.type`：

| type | 输出 | 用途 |
|------|------|------|
| `porosity` | `{ overall: float, per_image: [{file, porosity}] }` | 二值化图像中白色像素占比 |
| `statistics` | `{ count, mean, std, min, max, p50, p95, p99 }` | 灰度图像基本统计量 |
| `distribution` | `{ particle_areas: [], equiv_diameters: [] }` | 二值图连通域分析，输出等效粒径分布 |

### 执行规则

1. **混合排列**：Map 和 Reduce 操作可按任意顺序出现在同一条 Chain 中。执行引擎先扫描 Chain 分离两类操作，运行时第一遍遍历资源列表执行所有 Map 操作，Reduce 操作在流式通过时同步累计状态。
2. **流式内存**：整条 Chain 执行过程中，内存中最多只有一张图像的 ndarray，处理完后立即释放。
3. **DEBUG 模式**：Map 操作在 project cache 中保存 `{resource_id}_{step}.png` 缓存文件；Reduce 操作不保存中间图像。正常运行模式下均不保存。


## 3. 存储结构

### 文件目录

```
_data/
├── studio.db                 # SQLite: projects, resources, chains
├── projects/{id}-{slug}/
│   ├── resources/original/   # 原始导入图片（只读，SHA1 去重）
│   │   └── {sha1}.{ext}
│   ├── chains/               # Chain 定义（有序 Operation 列表，JSON）
│   │   └── {chain_id}.json
│   └── output/               # 导出成品（临时）
├── presets/                  # 全局 Presets
│   └── {name}.json           # operations + category
└── thumb_cache/              # 全局缩略图缓存
    ├── {sha1}.jpg            # 资源缩略图
    ├── execute-*.jpg         # 执行结果缩略图
    └── execfull-*.jpg        # 执行结果全尺寸图
```

### SQLite 主要表

```sql
-- projects: id, slug, title, note, created_at, updated_at
-- resources: id (PK), sha1, project_id (FK), filename, ext, size, imported_at
-- chains: id (PK), project_id (FK), name, resource_ids_json (JSON array), created_at, updated_at
```

`chains` 表的 operation 列表存储在对应 `chains/{chain_id}.json` 文件中（JSON 全文），以简化版本比较和手动编辑。


## 4. 前端架构

### 技术栈

| 层 | 技术 |
|----|------|
| 框架 | React 19 + TypeScript |
| 构建 | Vite 8 |
| 样式 | Tailwind CSS 4 |
| 路由 | react-router-dom v7 (basename `/studio`) |
| 拖拽 | @dnd-kit |
| API | 类型化 fetch 封装（`api.ts`） |

### 路由表

```
/                              → HomePage（项目总览）
/projects/:pid                 → ResourcesPage（资源上传/浏览/删除）
/projects/:pid/chains/:cid     → ChainEditorPage（核心编辑器 + 执行/导出）
/tools/presets                 → PresetsPage（Preset CRUD + SchemaForm）
```


### 布局结构

+ root (2 col)
    + sidebar (left): list projects and chains, with create project/chain button
    + main (right) (2 row)
        + topbar (up): execute + export button on right, one line height
        + editor (down) (2 col)
            + preview area (left): preview images and analysis text, bigger than operation area
            + operation area (right) (2 row)
                + operation list (up): list operations in using, with add operation button
                + operation params (down): edit parameters of choosen operation

## 5. 前后端通信

### REST API

```
# 项目
GET    /api/projects                          # 列表
POST   /api/projects                          # 创建 {title}
DELETE /api/projects/:pid                     # 删除（含磁盘目录）

# 资源
GET    /api/projects/:pid/resources           # 列表
POST   /api/projects/:pid/resources           # 上传 (multipart, SHA1 去重)
GET    /api/projects/:pid/resources/:sha1     # 元数据
GET    /api/projects/:pid/resources/:sha1/thumb  # 缩略图 (200px JPEG)
GET    /api/projects/:pid/resources/:sha1/full   # 原尺寸图
DELETE /api/projects/:pid/resources/:sha1     # 删除（引用计数为 0 时删磁盘文件）

# 链
GET    /api/projects/:pid/chains              # 列表（含 operations）
POST   /api/projects/:pid/chains              # 创建 {name, resource_ids, from_preset?}
GET    /api/projects/:pid/chains/:cid         # 详情（含完整 operations、resource_ids）
PATCH  /api/projects/:pid/chains/:cid         # 更新 {operations, name, resource_ids}，清预览缓存
DELETE /api/projects/:pid/chains/:cid         # 删除

# 执行（替代预览）
POST   /api/projects/:pid/chains/:cid/execute  # 全量执行，返回图像索引 + 分析结果
GET    /api/projects/:pid/chains/:cid/execute-thumb/:idx  # 执行结果缩略图
GET    /api/projects/:pid/chains/:cid/execute-full/:idx   # 执行结果全尺寸图

# 导出
POST   /api/projects/:pid/chains/:cid/export  # 导出 ZIP ?rid={sha1}（不传 rid 则全量）

# 预设
GET    /api/presets                           # 列表
POST   /api/presets                           # 创建 {name, operations, category}
PATCH  /api/presets/:name                     # 更新
DELETE /api/presets/:name                     # 删除
```

### 执行流程

```
用户编辑 Chain 操作序列
  ↓ (debounce 200ms)
PATCH /api/projects/:pid/chains/:cid   → 保存 operations JSON 文件
  ↓ 用户点击 Execute 按钮
POST /api/projects/:pid/chains/:cid/execute  → 全量执行所有资源
  ↓
返回 {images: [{filename, index}], analysis: {...}, text: "..."}
  ↓
前端通过 execute-thumb/:idx / execute-full/:idx 加载图片
```

执行始终全量处理所有绑定的资源，无 SSE 自动推送。

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

### 图像处理管道（流式执行）

核心设计：每条 Chain 执行时，Map 操作逐图流式处理 + Reduce 操作同步累计。**同一时刻内存中最多驻留一张图像的 ndarray**。

#### Reduce 操作基类

```python
class ReduceOperation:
    mode = "reduce"

    def __init__(self, **params):
        self.params = params

    def init_state(self) -> dict:
        """为当前批处理创建一个初始累加状态"""
        return {}

    def accumulate(self, state: dict, img: ndarray, meta: dict) -> dict:
        """处理单张图像，将结果合并到 state 中。不持有 img 引用。"""
        raise NotImplementedError

    def finalize(self, state: dict) -> Any:
        """所有图像处理完毕后，将累加状态输出为最终结果。"""
        raise NotImplementedError
```

#### 流式执行引擎

核心概念：
- **管道式执行**：operations 严格按用户定义顺序执行。
- **map**：变换图像，输出传给下一个操作。
- **reduce**：在当前位置"采集"图像状态，写入 ChainState 副作用容器，
  图像本身继续向后流动（不阻塞管道）。
- **ChainState**：管理所有 reduce 累加器 + TextBuffer（人类可读的分析报告）。
- **run_pipeline**：统一管道函数，execute_chain 和 execute_and_preview
  共享此核心，仅通过 per_resource 回调区分保存逻辑。

**注意**：`load_image` 是 I/O 边界操作，引擎层在遍历 `resource_ids` 时支持按批次提交（当前批的图像处理 + 下一批的 I/O 预热）以利用异步 I/O，但业务语义不变——一次只 hold 一张像素矩阵。

### 执行缓存

- 执行结果缓存为 `thumb_cache/execute-{pid}-{cid}-{idx}.jpg`（缩略图）和 `execfull-execute-{pid}-{cid}-{idx}.jpg`（全尺寸）
- `PATCH chain` 时清空 `preview-*.jpg` 缓存文件
- 导出不走缓存，逐资源流式处理后直接打包 ZIP

---

## 7. 关键设计决策（为什么这样做）

| 决策 | 理由 |
|------|------|
| **线性 Chain，不建 Node Graph** | 线性排序覆盖 90% 场景（图层→滤镜→导出）。DAG 编辑器复杂度翻 3 倍，没必要。 |
| **Operation 存 JSON 文件而非 DB** | 链编辑本质是读/写整个 operation 数组，JSON 文件方便版本 diff、手动修复、git 管理。 |
| **资源只读 SHA1 存储** | 同名冲突靠哈希消除，永不修改保证历史可重现。还原任意步骤只需改 Chain JSON 重新 apply。 |
| **不走 SSE，Execute 按钮触发全量处理** | 简化架构：减少异步状态管理，用户显式点击 Execute 触发处理，结果通过 thumb/full URL 加载。无自动推送。 |
| **不回滚历史，链即历史** | Chain 的 JSON 就是完整的操作历史。回滚 = 修改 JSON；分支 = 复制 Chain 再改。不需要 undo 栈。 |
| **Map/Reduce 两阶段执行** | 不拆分则批处理时要么内存爆炸（全载入），要么无法跨图聚合。Map 流式 + Reduce 累计，内存 O(1张图) 同时保持链语义。 |
| **analyze 统一 kind** | 不独立成 `compute_porosity` / `compute_statistics` / `compute_distribution`，而用 `analyze.type` 区分。避免 kind 膨胀，新增分析类型不破坏 Chain 结构。 |

### 当需要扩展时

- 当前 `Operation` 列表是平坦数组，如果未来需要条件分支或并行处理 → 升级为 **DAG**，数据模型从 `[op]` 变为 `{nodes: [], edges: []}`，前端从 @dnd-kit 列表升级为节点图编辑器。
- 当前通过 Execute 按钮触发全量处理，如果未来需要实时滤镜拖拽 VFX 级体验 → 走 WebGL Canvas 前端实时渲染 + 服务端做 final render 保证一致。
- 当前 `color` / `filter` 参数是基础版，缺高级参数 → 在 `Operation` 的 Union 类型中新增 `kind: 'curves'`, `kind: 'levels'` 等。
- 当前 `analyze.type` 支持 porosity / statistics / distribution 三种，如果未来需要更多分析类型（如纹理分析、FFT）→ 在 `AnalyzeOperation` 中新增对应 `type` 值。

---

## 8. 实施路线

| 阶段 | 内容 |
|------|------|
| Phase 1 | 项目 CRUD + 资源上传/浏览 + 基础布局（Sidebar + Topbar + 路由）+ 缩略图系统 |
| Phase 2 | Chain 定义 CRUD + 链编辑器三栏布局 + 拖拽排序 |
| Phase 3 | Operation 参数表单（Inspector）+ 服务端管道渲染 |
| Phase 4 | 链执行引擎 + 结果缩略图/全尺寸预览（Execute 按钮模式） |
| Phase 5 | 导出（单文件 + 批量）+ Preset 系统 |
| Phase 6 | 标签管理、搜索、CommandPalette |
| Phase 7 | 绿色打包分发：embedded Python 3.13 + `uv sync` 修剪依赖 + Vite build 产物 + 启动脚本，输出单目录便携版 |
