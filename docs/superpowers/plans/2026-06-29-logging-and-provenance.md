# 日志与参数溯源系统 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为 SEM-Tools 后端添加 loguru 诊断日志 + 在 ChainState 中集成自动参数溯源（provenance），只改 `auto_threshold` 一个 op。

**架构：** 两个独立机制——loguru 配置 + 边界打点（开发者诊断）；ChainState 扩展 provenance（用户参数溯源）。`_PROVENANCE_OPS` 集合特判路由，13 个 map op 零改动。ChainState 内部维护步计数器，op 函数零感知 step/kind。

**技术栈：** Python 3.13 + FastAPI + loguru + OpenCV；React 19 + TypeScript + Tailwind 4

**规格参考：** `docs/superpowers/specs/2026-06-29-logging-and-provenance-design.md`

---

### 任务 1：添加 loguru 依赖

**文件：**
- 修改：`backend/pyproject.toml`

- [ ] **步骤 1：添加依赖**

```bash
cd backend && uv add loguru
```

- [ ] **步骤 2：验证安装**

```bash
cd backend && uv run python -c "from loguru import logger; print('loguru OK')"
```
预期：输出 `loguru OK`。

- [ ] **步骤 3：Commit**

```bash
git add backend/pyproject.toml backend/uv.lock
git commit -m "chore: add loguru dependency"
```

---

### 任务 2：配置 loguru + 路由层打点

**文件：**
- 修改：`backend/main.py:1-20`（import 区域）、`backend/main.py:87-95`（lifespan）、`backend/main.py:444-477`（exec_chain）、`backend/main.py:393-438`（export_chain）

- [ ] **步骤 1：添加 loguru import 和配置**

在 `backend/main.py` 顶部 `import cv2` 之后，添加：

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

在 `uvicorn.run` 之前（`if __name__ == "__main__":` 块内）添加 console handler：

```python
if __name__ == "__main__":
    import sys

    import uvicorn

    logger.add(sys.stderr, level="DEBUG",
               format="<green>{time:HH:mm:ss}</green> | <level>{level:<7}</level> | <level>{message}</level>")
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
```

- [ ] **步骤 2：exec_chain 路由入口打点**

在 `backend/main.py:445` `def exec_chain` 函数体第一行（`p = db_get_project(pid)` 之前），插入：

```python
    logger.info("execute start chain={}/{}", pid, cid)
```

在 `return execute_and_preview(...)` 之前，插入：

```python
    logger.info("execute done chain={}/{} resources={} ops={}", pid, cid, len(resource_paths), len(operations))
```

- [ ] **步骤 3：export_chain 路由入口打点**

在 `backend/main.py:400` `p = db_get_project(pid)` 之前，插入：

```python
    logger.info("export start chain={}/{}", pid, cid)
```

在 `return StreamingResponse(...)` 之前，插入：

```python
    logger.info("export done chain={}/{} resources={} ops={}", pid, cid, len(resource_paths), len(operations))
```

- [ ] **步骤 4：exec_chain 包 try/except 以捕获引擎异常**

将 `backend/main.py:456-477` 的 exec_chain 主体包装为 try/except。替换从 `operations = body.operations` 到 `return execute_and_preview(...)`：

```python
    operations = body.operations

    resource_ids = json.loads(chain["resource_ids_json"])
    if not resource_ids:
        return {"images": [], "analysis": {}}

    resource_paths = []
    for rid in resource_ids:
        r = db_get_resource(rid, pid)
        if r:
            orig = (
                _project_dir(pid, p["slug"])
                / "resources"
                / "original"
                / f"{rid}.{r['ext']}"
            )
            if orig.exists():
                resource_paths.append((rid, r["filename"], orig))

    prefix = f"execute-{pid}-{cid}"
    try:
        return execute_and_preview(resource_paths, operations, THUMB_CACHE_DIR, prefix)
    except Exception:
        logger.exception("execute failed chain={}/{} resources={} ops={}",
                        pid, cid, len(resource_paths), len(operations))
        raise HTTPException(500, "Execution failed")
```

- [ ] **步骤 5：Commit**

```bash
git add backend/main.py
git commit -m "feat: add loguru config and route-level diagnostic logging"
```

---

### 任务 3：引擎层诊断日志

**文件：**
- 修改：`backend/engine.py`

- [ ] **步骤 1：添加 loguru import 和 run_pipeline try/except**

在 `backend/engine.py` 顶部 import 区域添加：

```python
from loguru import logger
```

在 `run_pipeline` 函数体内（`for idx, (rid, filename, rpath) in enumerate(resource_paths):` 之前），添加入口日志并包 try/except。当前 `run_pipeline:121-146` 的循环体用以下代码替换：

```python
    total = len(resource_paths)
    for idx, (rid, filename, rpath) in enumerate(resource_paths):
        try:
            img = load_image(rpath)
            for i, op in enumerate(operations):
                if op.mode == "reduce":
                    op: ReduceOpBase = cast(ReduceOpBase, op)
                    state.accumulate(i, op, img, rid, filename)
                else:
                    img = apply_map_op(img, op)
            per_resource(idx, rid, filename, img)
            del img
            if on_progress:
                on_progress(int((idx + 1) / total * 100))
        except Exception:
            logger.exception("pipeline failed resource={} ({})", rid, filename)
            raise
```

- [ ] **步骤 2：execute_and_preview 入口/出口打点**

在 `execute_and_preview:213` `state = ChainState(operations)` 之前，插入：

```python
    logger.info("execute_and_preview start resources={} ops={}", len(resource_paths), len(operations))
```

在 `return {"images": images, "analysis": results, "text": state.text}` 之前，替换为：

```python
    logger.info("execute_and_preview done images={}", len(images))
    return {"images": images, "analysis": results, "text": state.text}
```

- [ ] **步骤 3：execute_chain 入口/出口打点**

在 `execute_chain:172` `state = ChainState(operations)` 之前，插入：

```python
    logger.info("execute_chain start resources={} ops={}", len(resource_paths), len(operations))
```

在 `return buf` 之前，插入：

```python
    logger.info("execute_chain done output_files={}", len(output_paths))
```

- [ ] **步骤 4：Commit**

```bash
git add backend/engine.py
git commit -m "feat: add diagnostic logging to engine pipeline"
```

---

### 任务 4：ChainState 扩展 provenance

**文件：**
- 修改：`backend/engine.py:60-111`（ChainState 类）

- [ ] **步骤 1：扩展 ChainState 构造函数和字段**

将 `ChainState.__init__` 从当前 `engine.py:69-76` 替换为：

```python
    def __init__(self, operations: "list[OpBase]"):
        self._ops = operations
        self._acc: dict[int, dict] = {}
        self._text_lines: list[str] = []
        self._provenance: list[dict] = []
        self._cur_prov: list[dict] | None = None
        self._cur_rid: str = ""
        self._cur_fn: str = ""
        self._cur_step: int = 0
        self._cur_kind: str = ""
        for i, op in enumerate(operations):
            if op.mode == "reduce":
                op: ReduceOpBase = cast(ReduceOpBase, op)
                self._acc[i] = reduce_init(op)
```

- [ ] **步骤 2：添加 begin_resource / set_map_context / add_provenance / end_resource / provenance**

在 `ChainState.accumulate` 方法之后、`ChainState.finalize` 之前插入以下方法：

```python
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

- [ ] **步骤 3：验证 import 正常**

```bash
cd backend && uv run python -c "from engine import ChainState; print('ChainState import OK')"
```
预期：输出 `ChainState import OK`。

- [ ] **步骤 4：Commit**

```bash
git add backend/engine.py
git commit -m "feat: extend ChainState with provenance tracking"
```

---

### 任务 5：run_pipeline 对接 ChainState provenance

**文件：**
- 修改：`backend/engine.py:135-146`（run_pipeline 内循环）

- [ ] **步骤 1：更新 run_pipeline 循环调用 begin/end_resource 和 set_map_context**

将 `engine.py:135-142` 的 `for idx, (rid, filename, rpath) ...` 循环体替换为：

```python
        try:
            img = load_image(rpath)
            state.begin_resource(rid, filename)
            for i, op in enumerate(operations):
                if op.mode == "reduce":
                    op: ReduceOpBase = cast(ReduceOpBase, op)
                    state.accumulate(i, op, img, rid, filename)
                else:
                    state.set_map_context(i, op.kind)
                    img = apply_map_op(img, op, state)
            state.end_resource()
            per_resource(idx, rid, filename, img)
            del img
            if on_progress:
                on_progress(int((idx + 1) / total * 100))
        except Exception:
            logger.exception("pipeline failed resource={} ({})", rid, filename)
            raise
```

- [ ] **步骤 2：Commit**

```bash
git add backend/engine.py
git commit -m "feat: connect run_pipeline to ChainState provenance"
```

---

### 任务 6：apply_map_op + op_auto_threshold 溯源

**文件：**
- 修改：`backend/studio/operations.py:667-697`（_MAP_OPS + apply_map_op）、`backend/studio/operations.py:337-397`（op_auto_threshold）

- [ ] **步骤 1：添加 _PROVENANCE_OPS 和更新 apply_map_op**

在 `backend/studio/operations.py:667` `_MAP_OPS` 之前，插入：

```python
_PROVENANCE_OPS = {"auto_threshold"}   # 未来扩展加 "watershed" 等
```

替换 `apply_map_op`（当前 `operations.py:685-697`）为：

```python
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

- [ ] **步骤 2：重构 op_auto_threshold 统一 effective 变量 + 溯源**

替换 `op_auto_threshold`（当前 `operations.py:337-397`）为：

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
        if algorithm == "right_peak":
            right = 255
            for i in range(255, peak, -1):
                if hist[i] > 0:
                    right = i
                    break
            max_dist = -1.0
            best_thresh = right
            for i in range(peak + 1, right + 1):
                dist = abs(
                    (right - peak) * (hist[i] - hist[peak])
                    - (i - peak) * (hist[right] - hist[peak])
                )
                if dist > max_dist:
                    max_dist = dist
                    best_thresh = i
        else:
            left = 0
            for i in range(peak):
                if hist[i] > 0:
                    left = i
                    break
            max_dist = -1.0
            best_thresh = left
            for i in range(left, peak):
                dist = abs(
                    (peak - left) * (hist[i] - hist[left])
                    - (i - left) * (hist[peak] - hist[left])
                )
                if dist > max_dist:
                    max_dist = dist
                    best_thresh = i
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

- [ ] **步骤 3：验证 import 正常**

```bash
cd backend && uv run python -c "from engine import run_pipeline, ChainState; print('engine import OK')"
```
预期：输出 `engine import OK`。

- [ ] **步骤 4：Commit**

```bash
git add backend/studio/operations.py
git commit -m "feat: add provenance routing to apply_map_op and auto_threshold"
```

---

### 任务 7：execute 响应 + 导出 ZIP 输出 provenance

**文件：**
- 修改：`backend/engine.py:196-234`（execute_chain + execute_and_preview）
- 修改：`backend/main.py:456-477`（exec_chain 响应）

- [ ] **步骤 1：添加 _format_provenance_text 辅助函数**

在 `backend/engine.py` 的 `execute_chain` 之前插入：

```python
def _format_provenance_text(provenance: list[dict]) -> str:
    """将 provenance 列表格式化为 TAB 分隔的人可读表格。"""
    lines = ["# provenance"]
    all_keys: list[str] = []
    for item in provenance:
        for entry in item.get("entries", []):
            for key in entry.get("params", {}):
                if key not in all_keys:
                    all_keys.append(key)
    header = "resource_id\tfilename\tstep\tkind\t" + "\t".join(all_keys)
    lines.append(header)
    for item in provenance:
        rid = item.get("resource_id", "")[:8]
        fn = item.get("filename", "")
        for entry in item.get("entries", []):
            params = entry.get("params", {})
            vals = "\t".join(str(params.get(k, "")) for k in all_keys)
            lines.append(f"{rid}\t{fn}\t{entry['step']}\t{entry['kind']}\t{vals}")
    return "\n".join(lines)
```

- [ ] **步骤 2：更新 execute_and_preview 返回值**

将 `backend/engine.py:234` 的 return 语句替换为：

```python
    return {"images": images, "analysis": results, "text": state.text,
            "provenance": state.provenance}
```

- [ ] **步骤 3：更新 execute_chain 导出 ZIP 写入 provenance**

在 `execute_chain` 函数中，将 `if state.text:` 和 `zf.writestr("analysis.txt", state.text)` 部分（当前 `engine.py:188-191`）替换为：

```python
        text_parts = []
        if state.text:
            text_parts.append(state.text)
        if state.provenance:
            zf.writestr("provenance.json", json.dumps(state.provenance, indent=2))
            text_parts.append(_format_provenance_text(state.provenance))
        if text_parts:
            zf.writestr("analysis.txt", "\n\n".join(text_parts))
```

- [ ] **步骤 4：Commit**

```bash
git add backend/engine.py
git commit -m "feat: output provenance in execute response and export ZIP"
```

---

### 任务 8：引擎自检（engine.py __main__）

**文件：**
- 修改：`backend/engine.py` 末尾（+约 40 行）

- [ ] **步骤 1：编写自检**

在 `backend/engine.py` 文件末尾追加：

```python
if __name__ == "__main__":
    """自检：验证 ChainState provenance 在 run_pipeline 中正确收集。"""
    import numpy as np
    from studio.models import BlurOp, AutoThresholdOp

    img = (np.random.rand(64, 64) * 255).astype(np.uint8)
    import tempfile, os
    with tempfile.TemporaryDirectory() as td:
        tdir = Path(td)
        img_path = tdir / "test.png"
        import cv2 as _cv2
        _cv2.imwrite(str(img_path), img)

        ops = [AutoThresholdOp(params=AutoThresholdOp.__annotations__["params"](algorithm="left_peak", offset=0))]
        state = ChainState(ops)
        thumb = tdir / "thumbs"
        thumb.mkdir()

        run_pipeline([("r1", "test.png", img_path)], ops, state,
                     lambda i, r, f, img2: None)

        prov = state.provenance
        assert len(prov) == 1, f"expected 1 provenance item, got {len(prov)}"
        item = prov[0]
        assert item["resource_id"] == "r1"
        assert len(item["entries"]) == 1
        entry = item["entries"][0]
        assert entry["step"] == 0
        assert entry["kind"] == "auto_threshold"
        assert "params" in entry
        assert "threshold" in entry["params"]
        assert 0 <= entry["params"]["threshold"] <= 255
        print(f"SELF-CHECK PASSED: threshold={entry['params']['threshold']}, algorithm={entry['params']['algorithm']}")
```

- [ ] **步骤 2：运行自检验证通过**

```bash
cd backend && uv run python engine.py
```
预期：输出 `SELF-CHECK PASSED: threshold=xxx, algorithm=left_peak`。

- [ ] **步骤 3：Commit**

```bash
git add backend/engine.py
git commit -m "feat: add engine self-check for provenance tracking"
```

---

### 任务 9：前端类型定义

**文件：**
- 修改：`frontend/src/types.ts`（+约 10 行）
- 修改：`frontend/src/api.ts:111`（+约 8 行）

- [ ] **步骤 1：添加 Provenance 类型**

在 `frontend/src/types.ts:150` `OP_KINDS` 数组之后、`Preset` 接口之前，插入：

```typescript
/** 自动推算参数溯源条目 — 每个自动决策 op 一条。 */
export type ProvenanceEntry = {
  step: number;
  kind: string;
  params: Record<string, unknown>;
};

/** 每资源一条的溯源包装。 */
export type ProvenanceItem = {
  resource_id: string;
  filename: string;
  entries: ProvenanceEntry[];
};
```

- [ ] **步骤 2：更新 api.ts executeChain 返回类型**

`frontend/src/api.ts:111`，更新 `executeChain` 的返回类型：

```typescript
  executeChain: (pid: string, cid: string, operations: Operation[]) =>
    req<{ images: { filename: string; index: number }[]; analysis: Record<string, unknown>; provenance?: ProvenanceItem[] }>(
```

并在 `api.ts:8` 的 import 中新增 `ProvenanceItem`：

```typescript
import type { Chain, Operation, Preset, Project, ProvenanceItem, ResourceMeta } from "./types";
```

- [ ] **步骤 3：验证 TypeScript 编译**

```bash
cd frontend && bun run build
```
预期：tsc 编译通过。

- [ ] **步骤 4：Commit**

```bash
git add frontend/src/types.ts frontend/src/api.ts
git commit -m "feat: add frontend types for provenance data"
```

---

### 任务 10：ChainEditorPage provenance 展示

**文件：**
- 修改：`frontend/src/components/ChainEditorPage.tsx:27`（execResult state 类型）、`frontend/src/components/ChainEditorPage.tsx:142-156`（预览区）

- [ ] **步骤 1：更新 execResult state 类型**

`ChainEditorPage.tsx:27`，将 `useState` 类型从：

```typescript
  const [execResult, setExecResult] = useState<{
    images: { filename: string; index: number }[];
    analysis: Record<string, unknown>;
  } | null>(null);
```

改为：

```typescript
  const [execResult, setExecResult] = useState<{
    images: { filename: string; index: number }[];
    analysis: Record<string, unknown>;
    provenance?: import("../types").ProvenanceItem[];
  } | null>(null);
```

- [ ] **步骤 2：在预览区添加 provenance 折叠表格**

在 `ChainEditorPage.tsx:142-147`（分析 JSON 面板）之后、`execResult.images.map(...)` 之前（第 147 行后），插入 provenance 展示组件：

```tsx
                  {execResult.provenance && execResult.provenance.length > 0 && (
                    <details className="mb-3">
                      <summary className="text-sm font-medium text-gray-600 cursor-pointer select-none">
                        执行参数溯源 ({execResult.provenance.length} 条)
                      </summary>
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr className="bg-gray-100 text-gray-600">
                              <th className="border px-2 py-1 text-left">文件</th>
                              <th className="border px-2 py-1 text-left">步骤</th>
                              <th className="border px-2 py-1 text-left">操作</th>
                              <th className="border px-2 py-1 text-left">参数</th>
                            </tr>
                          </thead>
                          <tbody>
                            {execResult.provenance.map((item) =>
                              item.entries.map((entry, ei) => (
                                <tr key={`${item.resource_id}-${ei}`} className="hover:bg-gray-50">
                                  <td className="border px-2 py-1 text-gray-500">{item.filename}</td>
                                  <td className="border px-2 py-1">{entry.step}</td>
                                  <td className="border px-2 py-1">{entry.kind}</td>
                                  <td className="border px-2 py-1 font-mono text-gray-500">
                                    {JSON.stringify(entry.params)}
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  )}
```

- [ ] **步骤 3：运行 lint + build 验证**

```bash
cd frontend && bun run lint
cd frontend && bun run build
```
预期：lint 零错误，tsc + vite build 通过。

- [ ] **步骤 4：Commit**

```bash
git add frontend/src/components/ChainEditorPage.tsx
git commit -m "feat: add provenance collapsible table in preview area"
```

---

### 任务 11：最终验证

**文件：** 全部

- [ ] **步骤 1：后端 import 全链路验证**

```bash
cd backend && uv run python -c "
from engine import ChainState, run_pipeline, _format_provenance_text
from studio.operations import _PROVENANCE_OPS, apply_map_op
from main import app
print('All backend imports OK')
"
```
预期：输出 `All backend imports OK`。

- [ ] **步骤 2：前端完整构建**

```bash
cd frontend && bun run build
```
预期：`tsc -b` 和 `vite build` 均通过。

- [ ] **步骤 3：自检再运行**

```bash
cd backend && uv run python engine.py
```
预期：输出 `SELF-CHECK PASSED: ...`。

- [ ] **步骤 4：验证诊断日志写入**

```bash
# 手动启动后端模拟一次 execute 后检查日志文件
ls _data/logs/app.log 2>/dev/null && echo "log file exists" || echo "log file will be created on first run"
```

（此步骤在应用第一次运行时自动验证——loguru 自动创建目录和文件。）

- [ ] **步骤 5：Commit**

```bash
git add -A
git commit -m "chore: final verification of logging and provenance"
```
