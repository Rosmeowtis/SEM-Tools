# 日志与参数溯源系统设计

**日期**：2026-06-29
**分支**：feat/logging-and-provenance
**状态**：待审查

## 1. 背景与目标

### 1.1 现状痛点

SEM-Tools 后端当前**零日志**：无 `logging`、无 `print`、无 `try/except`。`main.py` 中 30 处错误全是裸 `raise HTTPException`，`engine.py` 的 `run_pipeline` / `execute_and_preview` / `execute_chain` 完全静默。当 execute 因坏图、越界参数、磁盘满崩溃时，只产生 uvicorn 默认 500 堆栈，无业务上下文（哪个项目、哪条链、哪个资源、哪个 operation、什么参数），难以复现修复。

同时，`op_auto_threshold` 这类自动决策操作算出阈值后**直接丢弃**：`op_auto_threshold` 计算 `final_thresh`（或 otsu 的 `ret`）后只返回二值图，推算参数无任何记录。用户无法让未使用此工具的同事复现结果——"这个阈值是怎么来的"无法回答。

### 1.2 两个维度

| 维度 | 消费者 | 生命周期 | 格式 |
|---|---|---|---|
| 开发者诊断 | 开发者 | 临时日志文件轮转 | log 行 + 堆栈 |
| 自动参数溯源 | 用户 + 同事 | 随 execute 响应 / 导出 ZIP 持久化 | 结构化 JSON + 可读文本 |

两者消费者、生命周期、格式均不同，故采用**两套独立机制**，各归各位，不强行统一。

### 1.3 目标

1. **诊断日志**：execute/export 崩溃时留下带业务上下文的诊断记录，方便开发者复现修复。
2. **参数溯源**：记录 `auto_threshold` 等自动决策操作推算出的参数，让用户和未使用本工具的同事能复现结果。

### 1.4 非目标

- 不做审计轨迹（谁在何时删除了什么）。
- 不做缓存可观测性日志（ADR 0001 按步缓存尚未实现，YAGNI）。
- 不把诊断日志做成用户可见的运行报告。
- 本次只改 `auto_threshold`，`watershed`/`distance_transform` 等其他含自动决策的 op 留作后续按需扩展。
- 不引入日志聚合、远程上报、结构化日志中间件。

## 2. 方案选型

### 2.1 诊断日志框架：loguru

采用 **loguru**（新增依赖），而非 stdlib `logging`。理由：用户指定；loguru 配置更简洁、输出更美观、默认格式更友好。

### 2.2 参数溯源容器：并入 ChainState

参数溯源并入 **ChainState**，而非独立的 `ctx` 侧信道。理由：ChainState 本就是"链执行的副作用容器"，provenance 正是副作用之一，内聚更自然。

### 2.3 步计数器归属：ChainState 内部维护

ChainState 内部维护步计数器，op 函数无脑调 `add_provenance(auto_dict)`，零感知 step/kind，完全解耦。run_pipeline 在每个 map op 前调 `set_map_context(i, op.kind)` 注入当前位置。

### 2.4 溯源 op 路由：`_PROVENANCE_OPS` 集合特判

只有产生自动参数的 op 改签名，其余 13 个 map op 零改动。靠 `_PROVENANCE_OPS` 集合特判路由，未来扩展只加字符串。

### 2.5 否决的方案

- **统一"执行账本"**：一个结构同时装诊断日志和溯源。混合了开发者关注点和用户关注点，日志的生命周期（临时文件轮转）与溯源（必须进导出 ZIP）冲突，强行统一反而复杂。
- **纯 logging**：只加 stdlib logging，把自动阈值作为 INFO 行。最简单，但日志是开发者视角的临时文件，到不了用户手里、进不了导出 ZIP，无法满足"让同事复现"的核心需求。

## 3. 设计详述

### 3.1 开发者诊断日志（loguru）

#### 依赖

`uv add loguru`（`backend/pyproject.toml` +1 行）。

#### 配置

`backend/main.py` 顶部（+约 8 行）：

```python
from loguru import logger
from studio.config import DATA_DIR

logger.add(
    DATA_DIR / "logs" / "app.log",
    rotation="1 MB",
    retention=3,
    level="INFO",
    format="{time:YYYY-MM-DD HH:mm:ss} | {level:<7} | {message}",
)
```

dev 模式（`__main__` 块）追加彩色 console handler（`sys.stderr`）。

`_data/logs/` 目录由 loguru 首次写入时自动创建，无需预建。`_data/` 已在 `.gitignore` 中。

#### 打点位置

仅边界打点，不侵入 op 函数内部：

| 位置 | 级别 | 内容 |
|---|---|---|
| `engine.run_pipeline` 外层 `try/except` | ERROR | 异常时记录 `{rid, filename, op_index, op_kind, params}` 后 re-raise |
| `engine.execute_and_preview` 入口/出口 | INFO | `"execute chain={cid} resources={n} ops={m}"` / `"done in {ms}ms"` |
| `engine.execute_chain` 入口/出口 | INFO | 同上 |
| `main.py` execute/export 路由 | INFO | 记录 pid/cid 入口 |
| `main.py` 500 路径 | ERROR | 补充业务上下文 |

404 不打点（FastAPI 已记录访问日志），只在 500 路径留业务上下文。

**影响文件**：`main.py`（配置+打点）、`engine.py`（try/except + INFO）。**不碰 operations.py 的诊断日志。**

### 3.2 参数溯源并入 ChainState

#### ChainState 扩展（`engine.py`，+约 22 行）

新增字段与方法：

```python
class ChainState:
    def __init__(self, operations):
        # ... 原有不变 ...
        self._provenance: list[dict] = []
        self._cur_prov: list[dict] | None = None
        self._cur_rid = ""
        self._cur_fn = ""
        self._cur_step = 0
        self._cur_kind = ""

    def begin_resource(self, rid: str, filename: str):
        """标记开始处理一张新资源，重置溯源缓冲。"""
        self._cur_prov = []
        self._cur_rid, self._cur_fn = rid, filename

    def set_map_context(self, step: int, kind: str):
        """run_pipeline 在每个 map op 前调用，告知当前步号与 kind。"""
        self._cur_step, self._cur_kind = step, kind

    def add_provenance(self, auto: dict):
        """op 函数调用，记录自动推算的参数。step/kind 由 state 内部提供。"""
        if self._cur_prov is not None:
            self._cur_prov.append(
                {"step": self._cur_step, "kind": self._cur_kind, **auto}
            )

    def end_resource(self):
        """结束当前资源，若有溯源条目则归档。"""
        if self._cur_prov:
            self._provenance.append(
                {
                    "resource_id": self._cur_rid,
                    "filename": self._cur_fn,
                    "entries": self._cur_prov,
                }
            )
        self._cur_prov = None

    @property
    def provenance(self) -> list[dict]:
        """每资源一条的自动参数溯源记录。"""
        return self._provenance
```

#### run_pipeline（`engine.py`，+4 行）

```python
def run_pipeline(resource_paths, operations, state, per_resource, on_progress=None):
    total = len(resource_paths)
    for idx, (rid, filename, rpath) in enumerate(resource_paths):
        img = load_image(rpath)
        state.begin_resource(rid, filename)          # 新增
        for i, op in enumerate(operations):
            if op.mode == "reduce":
                op = cast(ReduceOpBase, op)
                state.accumulate(i, op, img, rid, filename)
            else:
                state.set_map_context(i, op.kind)    # 新增
                img = apply_map_op(img, op, state)
        state.end_resource()                         # 新增
        per_resource(idx, rid, filename, img)
        del img
        if on_progress:
            on_progress(int((idx + 1) / total * 100))
```

#### apply_map_op（`operations.py`，+5 行）

```python
_PROVENANCE_OPS = {"auto_threshold"}   # 未来扩展加 "watershed" 等

def apply_map_op(img: np.ndarray, op: "OpBase", state=None) -> np.ndarray:
    """通过 op.kind 查找对应的 map 操作函数并执行。

    Args:
        img: 输入图像。
        op: Map 类 Operation 实例。
        state: 可选的 ChainState，用于自动决策 op 记录溯源参数。

    Returns:
        处理后的图像。
    """
    fn = _MAP_OPS.get(op.kind)
    if fn is None:
        return img
    if op.kind in _PROVENANCE_OPS and state is not None:
        return fn(img, op.params.model_dump(), state)
    return fn(img, op.params.model_dump())
```

#### op_auto_threshold（`operations.py`，重构 +6 行）

统一 `effective` 变量并在末尾记录溯源：

```python
def op_auto_threshold(img: np.ndarray, params: dict, state=None) -> np.ndarray:
    """自动阈值二值化：单峰左/右最大距离点 + 大津法。

    Args:
        img: 输入图像。
        params: {"algorithm", "offset"} — 阈值算法 + 偏移修正。
        state: 可选的 ChainState，用于记录推算阈值。

    Returns:
        二值图像（0 / 255）。
    """
    gray = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    algorithm = params.get("algorithm", "left_peak")
    offset = params.get("offset", 0)

    if algorithm == "otsu":
        ret, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
        effective = max(0, min(255, ret + offset))
        if offset:
            _, binary = cv2.threshold(gray, effective, 255, cv2.THRESH_BINARY)
    else:
        hist = cv2.calcHist([gray], [0], None, [256], [0, 256]).flatten().astype(np.float32)
        peak = int(np.argmax(hist))
        # ... 原 peak 逻辑设 best_thresh ...
        effective = max(0, min(255, best_thresh + offset))
        _, binary = cv2.threshold(gray, effective, 255, cv2.THRESH_BINARY)

    if state is not None:
        state.add_provenance({
            "params": {
                "threshold": int(effective),
                "algorithm": algorithm,
                "offset": int(offset),
            }
        })
    return binary
```

### 3.3 溯源数据 schema

#### 条目级（每个自动决策 op 一条）

```json
{
  "step": 2,
  "kind": "auto_threshold",
  "params": {
    "threshold": 142,
    "algorithm": "left_peak",
    "offset": 0
  }
}
```

- `step`：operation 在链中的索引（0-based）。
- `kind`：operation 类型字符串。
- `params`：自动推算的参数载荷。`auto_threshold` 为 `{threshold, algorithm, offset}`；未来 `watershed` 等按各自字段填充，结构一致前向兼容。

#### per-resource 包装

```json
{
  "resource_id": "a1b2c3...",
  "filename": "sample_001.png",
  "entries": [
    {"step": 2, "kind": "auto_threshold", "params": {"threshold": 142, "algorithm": "left_peak", "offset": 0}}
  ]
}
```

#### 完整 provenance 数组

`state.provenance` 返回 `list[dict]`，每个元素是一个 per-resource 包装。只有产生过溯源条目的资源才出现在数组中（无自动决策的资源不出现）。

### 3.4 输出整合

#### execute 响应（`main.py` exec_chain 路由 + `engine.execute_and_preview` 返回值）

```python
return {
    "images": images,
    "analysis": results,
    "text": state.text,
    "provenance": state.provenance,   # 新增
}
```

前端 `api.ts:executeChain` 返回类型同步更新。

#### 导出 ZIP（`engine.execute_chain`，+5 行）

```python
# 替换原 `if state.text: zf.writestr("analysis.txt", state.text)` 逻辑
text_parts = []
if state.text:
    text_parts.append(state.text)
if state.provenance:
    zf.writestr("provenance.json", json.dumps(state.provenance, indent=2))
    text_parts.append(_format_provenance_text(state.provenance))
if text_parts:
    zf.writestr("analysis.txt", "\n\n".join(text_parts))
```

`_format_provenance_text` 辅助函数生成人类可读的 TAB 分隔表格，同事打开 ZIP 即见。格式示例：

```
# provenance
resource	filename	step	kind	threshold	algorithm	offset
a1b2c3	sample_001.png	2	auto_threshold	142	left_peak	0
a1b2c3	sample_002.png	2	auto_threshold	138	left_peak	0
```

#### 前端展示（`frontend/src/api.ts` + `ChainEditorPage.tsx`）

`api.ts` 类型扩展：

```typescript
type ProvenanceEntry = {
  step: number;
  kind: string;
  params: Record<string, unknown>;
};
type ProvenanceItem = {
  resource_id: string;
  filename: string;
  entries: ProvenanceEntry[];
};
// executeChain 返回类型 +provenance?: ProvenanceItem[]
```

`ChainEditorPage.tsx` 预览区加折叠表格组件：
- 有 provenance 时显示，无则隐藏。
- 按资源分组，展开显示该资源所有溯源条目。
- 表格列：step / kind / params（展开为 threshold/algorithm/offset 等字段）。

## 4. 影响面汇总

| 文件 | 净增行 | 改动性质 |
|---|---|---|
| `backend/pyproject.toml` | +1 | 加 loguru 依赖 |
| `backend/main.py` | ~15 | loguru 配置 + execute 路由打点 + 响应加 provenance |
| `backend/engine.py` | ~30 | ChainState +provenance，run_pipeline +begin/end/set_context，execute_* 透传，`_format_provenance_text` |
| `backend/studio/operations.py` | ~10 | apply_map_op +state 参数，`_PROVENANCE_OPS`，op_auto_threshold 重构+溯源 |
| `frontend/src/api.ts` | ~8 | ProvenanceEntry/ProvenanceItem 类型 + execute 返回类型 |
| `frontend/src/components/ChainEditorPage.tsx` | ~25 | 预览区溯源折叠表格 |

**净增约 90 行，只改 1 个 op 函数，13 个 map op 零改动。**

## 5. 向后兼容性

- `apply_map_op` 的 `state` 参数默认 `None`，旧调用方（无 state）行为不变。
- `op_auto_threshold` 的 `state` 参数默认 `None`，旧调用方行为不变。
- execute 响应新增 `provenance` 字段，前端旧代码忽略未声明字段即可（TS 类型加为可选）。
- 导出 ZIP 新增 `provenance.json`，旧解压工具忽略未知文件即可。
- 无自动决策 op 的链，`state.provenance` 为空数组，execute 响应 `provenance: []`，ZIP 不写 `provenance.json`。

## 6. 验证计划

### 6.1 后端自检

`engine.py` 末尾加 `__main__` 自检（ponytail 惯例：非平凡逻辑留一个可运行检查）：

- 构造一张合成图 + 含 `auto_threshold` 的 operations，跑 `run_pipeline`。
- 断言 `state.provenance` 非空、条目含 `step/kind/params`、`params.threshold` 在 0-255 范围。

### 6.2 诊断日志验证

- 手动触发一次 execute（含错误资源），确认 `_data/logs/app.log` 有 ERROR 行且含业务上下文。
- 确认正常 execute 有 INFO 入口/出口行。

### 6.3 前端 lint + typecheck

- `bun run lint` 通过。
- `bun run build`（含 `tsc -b`）通过。

## 7. 未来扩展

- 新增自动决策 op（如 `watershed` 的 `seed_t`/`num_labels`）：在 `_PROVENANCE_OPS` 加字符串，op 函数末尾调 `state.add_provenance({"params": {...}})`，零其余改动。
- ADR 0001 按步缓存实现后，可在缓存命中/未命中处加 loguru INFO 打点，复用同一日志配置。
- 若 provenance 需要随链 JSON 持久化（而非仅 execute 响应），可在 `chains/{cid}.json` 中加 `provenance` 字段——本次不做，YAGNI。
