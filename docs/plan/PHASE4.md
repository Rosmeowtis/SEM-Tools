# Phase 4 实施计划

## 概要

Phase 4 目标：实时预览（SSE）+ 预览缓存。后端新增 SSE 端点 + 异步渲染 + 缓存失效，前端自动预览 + 进度条 + 并发覆盖。

## 步骤 1：后端 engine.py 全部重写

### `backend/engine.py` — I/O 函数 + 执行引擎

```python
import cv2
import numpy as np
from pathlib import Path
from typing import Callable
from PIL import Image


def load_image(path: Path) -> np.ndarray:
    """Load image via PIL (Unicode-safe), convert to OpenCV BGR format."""
    pil = Image.open(path).convert("RGB")
    img = np.array(pil)
    return cv2.cvtColor(img, cv2.COLOR_RGB2BGR)


def save_image(img: np.ndarray, path: Path):
    """Save OpenCV ndarray to file via PIL (Unicode-safe)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if img.ndim == 2:
        Image.fromarray(img).save(path)
    else:
        Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB)).save(path)


def apply_map_op(img: np.ndarray, op: dict) -> np.ndarray:
    kind, params = op["kind"], op["params"]
    if kind == "crop":
        return img[params["y"]:params["y"]+params["h"], params["x"]:params["x"]+params["w"]]
    elif kind == "resize":
        interp = cv2.INTER_NEAREST if params.get("algorithm") == "nearest" else cv2.INTER_LINEAR
        return cv2.resize(img, (params["w"], params["h"]), interpolation=interp)
    elif kind == "grayscale":
        if img.ndim == 3:
            return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        return img
    return img


def render_preview(image_path: Path, operations: list[dict], cache_path: Path,
                   on_progress: Callable[[int], None] | None = None):
    """Apply map operations to a single image, save thumbnail, callback per step."""
    img = load_image(image_path)
    map_ops = [op for op in operations if op.get("mode") == "map"]
    for i, op in enumerate(map_ops):
        img = apply_map_op(img, op)
        if on_progress:
            on_progress(int((i + 1) / len(map_ops) * 100))
    h, w = img.shape[:2]
    scale = 200 / max(h, w) if max(h, w) > 200 else 1.0
    if scale < 1:
        img = cv2.resize(img, (int(w * scale), int(h * scale)))
    save_image(img, cache_path)
    del img
```

## 步骤 2：后端 main.py 改动

### 2a. `_generate_thumbnail` 改用 engine I/O

```python
from engine import load_image, save_image, render_preview

def _generate_thumbnail(src: str | Path, sha1: str):
    img = load_image(Path(src))
    h, w = img.shape[:2]
    scale = 200 / max(h, w) if max(h, w) > 200 else 1.0
    if scale < 1:
        img = cv2.resize(img, (int(w * scale), int(h * scale)))
    save_image(img, THUMB_CACHE_DIR / f"{sha1}.jpg")
```

### 2b. 全局 pub/sub 状态 + 线程安全 publisher

```python
import asyncio

_preview_bus: dict[str, list[asyncio.Queue]] = {}
_preview_gen: dict[str, int] = {}


def _publish(chain_key: str, event: dict):
    """Iterate fresh queue list, drop silently on closed/full queues."""
    for q in list(_preview_bus.get(chain_key, [])):
        try:
            q.put_nowait(event)
        except (asyncio.QueueFull, RuntimeError):
            pass
```

### 2c. POST /preview（替换现有 GET）

```python
@app.post("/api/projects/{pid}/chains/{cid}/preview")
async def trigger_preview(pid: str, cid: str, rid: str | None = None):
    p = db_get_project(pid)
    if not p: raise HTTPException(404, "Project not found")
    chain = db_get_chain(pid, cid)
    if not chain: raise HTTPException(404, "Chain not found")

    cf = _chain_file(pid, p["slug"], cid)
    operations = json.loads(cf.read_text()) if cf.exists() else []

    resource_ids = json.loads(chain["resource_ids_json"])
    if not resource_ids: raise HTTPException(400, "No resources bound to chain")
    target_rid = rid if rid and rid in resource_ids else resource_ids[0]

    resource = db_get_resource(target_rid)
    if not resource: raise HTTPException(404, "Resource not found")

    orig = _project_dir(pid, p["slug"]) / "resources" / "original" / f"{target_rid}.{resource['ext']}"
    if not orig.exists(): raise HTTPException(404, "Original file not found")

    chain_key = f"{cid}-{target_rid}"
    _preview_gen[chain_key] = _preview_gen.get(chain_key, 0) + 1
    gen = _preview_gen[chain_key]

    cache_key = hashlib.sha1(
        (json.dumps(operations, sort_keys=True) + target_rid).encode()
    ).hexdigest()
    cache_path = THUMB_CACHE_DIR / f"preview-{cache_key}.jpg"

    if cache_path.exists():
        _publish(chain_key, {"type": "preview.complete", "thumb_sha1": cache_key, "gen": gen})
        return {"cached": True}

    asyncio.create_task(_run_preview(orig, operations, cache_path, chain_key, gen))
    return {"accepted": True}
```

### 2d. 异步渲染（线程安全 + 错误发布）

```python
async def _run_preview(orig: Path, operations: list, cache_path: Path, chain_key: str, gen: int):
    try:
        loop = asyncio.get_running_loop()

        def on_progress(pct: int):
            loop.call_soon_threadsafe(
                _publish, chain_key,
                {"type": "preview.progress", "progress": pct, "gen": gen}
            )

        await loop.run_in_executor(None, render_preview, orig, operations, cache_path, on_progress)

        cache_key = cache_path.stem
        loop.call_soon_threadsafe(
            _publish, chain_key,
            {"type": "preview.complete", "thumb_sha1": cache_key, "gen": gen}
        )
    except Exception as e:
        _publish(chain_key, {"type": "preview.error", "message": str(e), "gen": gen})
```

### 2e. SSE 端点 /api/events

```python
@app.get("/api/events")
async def event_stream(chain_id: str | None = None):
    queue: asyncio.Queue = asyncio.Queue()
    if chain_id:
        _preview_bus.setdefault(chain_id, []).append(queue)

    async def gen():
        try:
            while True:
                event = await queue.get()
                yield f"event: {event['type']}\ndata: {json.dumps(event)}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            if chain_id:
                buses = _preview_bus.get(chain_id, [])
                if queue in buses:
                    buses.remove(queue)
                if not buses:
                    _preview_bus.pop(chain_id, None)

    return StreamingResponse(gen(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
```

### 2f. PATCH chain 时清预览缓存

在 `patch_chain` 函数末尾追加（删文件名前缀 `preview-*` 的缓存，不影响资源缩略图）：

```python
for f in THUMB_CACHE_DIR.glob("preview-*.jpg"):
    f.unlink()
```

## 步骤 3：前端类型

### `frontend/src/types.ts` 新增

```typescript
export type StudioEvent =
  | { type: "preview.progress"; progress: number; gen: number }
  | { type: "preview.complete"; thumb_sha1: string; gen: number }
  | { type: "preview.error"; message: string; gen: number };
```

## 步骤 4：前端 API

### `frontend/src/api.ts` 新增

```typescript
requestPreview: (pid: string, cid: string, rid?: string) =>
  req<{ accepted?: boolean; cached?: boolean }>(`/projects/${pid}/chains/${cid}/preview${rid ? `?rid=${rid}` : ""}`, { method: "POST" }),
```

## 步骤 5：前端 App 组件

### 5a. useEventStream hook

```typescript
function useEventStream(chainId: string | null, onEvent: (e: StudioEvent) => void) {
  useEffect(() => {
    if (!chainId) return;
    const es = new EventSource(`${BASE}/events?chain_id=${chainId}`);
    const handler = (e: MessageEvent) => onEvent(JSON.parse(e.data));
    es.addEventListener("preview.progress", handler);
    es.addEventListener("preview.complete", handler);
    es.addEventListener("preview.error", handler);
    return () => es.close();
  }, [chainId]);
}
```

### 5b. ChainEditorPage 新增状态 + 自动预览

```typescript
const [previewTarget, setPreviewTarget] = useState<string | null>(null);
const [previewGen, setPreviewGen] = useState(0);
const [previewProgress, setPreviewProgress] = useState<number | null>(null);
const [previewThumb, setPreviewThumb] = useState<string | null>(null);
const [previewError, setPreviewError] = useState<string | null>(null);
const previewDebounce = useRef<ReturnType<typeof setTimeout>>();

// SSE 监听
useEventStream(cid ?? null, (e) => {
  if (e.gen !== previewGen) return;  // 丢弃旧 gen 事件
  if (e.type === "preview.progress") setPreviewProgress(e.progress);
  if (e.type === "preview.complete") { setPreviewProgress(null); setPreviewThumb(e.thumb_sha1); }
  if (e.type === "preview.error") { setPreviewProgress(null); setPreviewError(e.message); }
});

// 触发预览（300ms debounce）
const triggerPreview = useCallback(() => {
  clearTimeout(previewDebounce.current);
  previewDebounce.current = setTimeout(() => {
    if (pid && cid && previewTarget) {
      setPreviewError(null);
      setPreviewGen(g => g + 1);
      api.requestPreview(pid, cid, previewTarget);
    }
  }, 300);
}, [pid, cid, previewTarget]);

// 选中 chip 即触发首次预览
useEffect(() => { if (previewTarget) triggerPreview(); }, [previewTarget]);

// saveAndPreview：保存 + 触发自动预览
const saveAndPreview = (ops: Operation[]) => {
  clearTimeout(debounceRef.current);
  debounceRef.current = setTimeout(() => {
    if (pid && cid) api.updateChain(pid, cid, { operations: ops }).then(setChain);
  }, 200);
  triggerPreview();
};
```

### 5c. Canvas 底部预览区域

```tsx
{previewTarget && (
  <div className="mt-4 pt-4 border-t border-gray-200">
    {previewError ? (
      <p className="text-red-500 text-sm">{previewError}</p>
    ) : previewProgress !== null ? (
      <div className="h-2 bg-gray-200 rounded overflow-hidden">
        <div className="h-full bg-blue-500 transition-all duration-100"
          style={{ width: `${previewProgress}%` }} />
      </div>
    ) : previewThumb ? (
      <img src={api.thumbUrl(pid!, previewThumb)}
        className="max-w-full h-48 object-contain border rounded bg-gray-50" alt="Preview" />
    ) : (
      <p className="text-gray-400 text-sm">Click a resource chip to preview</p>
    )}
  </div>
)}
```

### 5d. ResourceChips 增加 onSelect

扩展 ResourceChips props，点击 chip 时回调 `onSelect(sha1)` → `setPreviewTarget(sha1)`。在 chip 上增加选中态样式（蓝色边框 / 背景高亮）。

## 步骤 6：验证

```bash
# terminal 1: 后端
cd backend && uv run uvicorn main:app --reload

# terminal 2: 前端
cd frontend && bun run dev
```

验证路径：
1. 进入链编辑器 → SSE 连接 `/api/events?chain_id=...` 已建立
2. 点击资源 chip → 自动触发 POST preview → 进度条闪动 → 缩略图显示
3. 修改 Inspector 参数 → 自动保存 → 自动预览 → 缩略图更新
4. 快速连调参数 → 仅最后一次预览生效（gen 覆盖）
5. 后端预览缓存 → 重复预览直接返回 cached: true
6. PATCH 保存后 `preview-*.jpg` 缓存被清理

## 变更清单

| 层 | 文件 | 改动 | 行数 |
|---|------|------|------|
| 后端 | `backend/engine.py` | load_image + save_image + render_preview(with on_progress) | ~60 |
| 后端 | `backend/main.py` | POST preview + /api/events SSE + pub/sub(线程安全) + 缓存失效 + 缩略图重构 | ~95 |
| 前端 | `types.ts` | +StudioEvent | ~4 |
| 前端 | `api.ts` | +requestPreview | ~3 |
| 前端 | `App.tsx` | useEventStream + 自动预览(300ms) + gen 覆盖 + 进度条/错误 + chip 选中预览 | ~95 |

## 关键设计决策

| 决策 | 理由 |
|------|------|
| PIL `convert("RGB")` | 处理 RGBA/CMYK/P/1 等模式统一转 3 通道 |
| `load_image/save_image` 独立函数 | 缩略图生成和预览渲染共用，一处修改两处生效 |
| `run_in_executor` + `call_soon_threadsafe` | 线程安全 pub/sub，`_publish` 始终在事件循环线程执行 |
| `gen` 并发覆盖计数器 | 连续连调参数不会出现旧结果覆盖新结果 |
| gen 前端过滤 | 即使后端 publish 延迟/乱序也安全 |
| `list(queues)` 惰性拷贝 | 避免事件循环和 SSE 清理并发修改列表 |
| `preview-*.jpg` 前缀 | 与资源缩略图 `{sha1}.jpg` 文件名隔离，PATCH 清缓存安全 |
