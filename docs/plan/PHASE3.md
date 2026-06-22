# Phase 3 实施计划

## 概要

Phase 3 目标：Operation 参数表单 + 服务端管道渲染。后端新增执行引擎 + 预览端点，前端 Inspector 升级为交互式参数编辑 + Canvas 增加手动预览按钮。

## 步骤 1：后端执行引擎

### 新文件 `backend/engine.py`

```python
import cv2
import numpy as np
from pathlib import Path


def apply_map_op(img: np.ndarray, op: dict) -> np.ndarray:
    kind = op["kind"]
    params = op["params"]
    if kind == "crop":
        x, y, w, h = params["x"], params["y"], params["w"], params["h"]
        return img[y:y+h, x:x+w]
    elif kind == "resize":
        interp = cv2.INTER_NEAREST if params.get("algorithm") == "nearest" else cv2.INTER_LINEAR
        return cv2.resize(img, (params["w"], params["h"]), interpolation=interp)
    elif kind == "grayscale":
        if len(img.shape) == 3:
            return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        return img
    return img


def render_preview(image_path: Path, operations: list[dict], cache_path: Path):
    """Apply map operations to a single image and save a thumbnail."""
    img = cv2.imread(str(image_path))
    if img is None:
        raise ValueError(f"Cannot load {image_path}")
    for op in operations:
        if op.get("mode") == "map":
            img = apply_map_op(img, op)
    h, w = img.shape[:2]
    scale = 200 / max(h, w) if max(h, w) > 200 else 1.0
    if scale < 1:
        img = cv2.resize(img, (int(w * scale), int(h * scale)))
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(cache_path), img)
    del img
```

## 步骤 2：后端预览路由

### `backend/main.py` 新增

```python
from engine import render_preview


@app.get("/api/projects/{pid}/chains/{cid}/preview")
def preview_chain(pid: str, cid: str, rid: str | None = None):
    p = db_get_project(pid)
    if not p:
        raise HTTPException(404, "Project not found")
    chain = db_get_chain(pid, cid)
    if not chain:
        raise HTTPException(404, "Chain not found")

    cf = _chain_file(pid, p["slug"], cid)
    operations = json.loads(cf.read_text()) if cf.exists() else []

    resource_ids = json.loads(chain["resource_ids_json"])
    if not resource_ids:
        raise HTTPException(400, "No resources bound to chain")

    target_rid = rid if rid and rid in resource_ids else resource_ids[0]
    resource = db_get_resource(target_rid)
    if not resource:
        raise HTTPException(404, "Resource not found")

    orig_dir = _project_dir(pid, p["slug"]) / "resources" / "original"
    orig = orig_dir / f"{target_rid}.{resource['ext']}"
    if not orig.exists():
        raise HTTPException(404, "Original file not found")

    cache_path = THUMB_CACHE_DIR / f"preview-{pid}-{cid}-{target_rid}.jpg"
    render_preview(orig, operations, cache_path)
    return FileResponse(cache_path, media_type="image/jpeg")
```

**说明**：`GET /preview?rid=` 直接返回 JPEG（`<img src>` 零 fetch），无缓存层。

## 步骤 3：前端类型

### `frontend/src/types.ts` 不变

`OP_KINDS` 保持 Phase 2 定义，无需追加 `FieldDef` 或 `fields` 元数据。

## 步骤 4：前端 API

### `frontend/src/api.ts` 新增

```typescript
previewUrl: (pid: string, cid: string, rid?: string) =>
  `${BASE}/projects/${pid}/chains/${cid}/preview${rid ? `?rid=${rid}` : ""}`,
```

## 步骤 5：前端 App 组件

### 5a. Inspector 替换为内联参数表单（~50 行）

```tsx
function Inspector({ op, onChange }: {
  op: Operation | null;
  onChange: (params: Record<string, unknown>) => void;
}) {
  if (!op) return (
    <div className="w-64 border-l border-gray-200 p-4 text-gray-400 text-sm">
      Select an operation
    </div>
  );
  const label = OP_KINDS.find(k => k.kind === op.kind)?.label ?? op.kind;

  if (op.kind === "crop") return (
    <div className="w-64 border-l border-gray-200 p-4 text-sm">
      <div className="font-semibold mb-3">{label}</div>
      {(["x","y","w","h"] as const).map(key => (
        <div key={key} className="mb-2">
          <label className="text-xs text-gray-500 block">{key.toUpperCase()}</label>
          <input type="number" className="w-full border border-gray-300 rounded px-2 py-0.5 text-sm"
            value={(op.params as any)[key]} onChange={e => onChange({ ...op.params, [key]: Number(e.target.value) })} />
        </div>
      ))}
    </div>
  );

  if (op.kind === "resize") return (
    <div className="w-64 border-l border-gray-200 p-4 text-sm">
      <div className="font-semibold mb-3">{label}</div>
      {(["w","h"] as const).map(key => (
        <div key={key} className="mb-2">
          <label className="text-xs text-gray-500 block">{key === "w" ? "Width" : "Height"}</label>
          <input type="number" className="w-full border border-gray-300 rounded px-2 py-0.5 text-sm"
            value={(op.params as any)[key]} onChange={e => onChange({ ...op.params, [key]: Number(e.target.value) })} />
        </div>
      ))}
      <div className="mb-2">
        <label className="text-xs text-gray-500 block">Algorithm</label>
        <select className="w-full border border-gray-300 rounded px-2 py-0.5 text-sm"
          value={(op.params as any).algorithm} onChange={e => onChange({ ...op.params, algorithm: e.target.value })}>
          <option value="nearest">nearest</option>
          <option value="bilinear">bilinear</option>
        </select>
      </div>
    </div>
  );

  if (op.kind === "grayscale") return (
    <div className="w-64 border-l border-gray-200 p-4 text-sm">
      <div className="font-semibold mb-2">{label}</div>
      <div className="text-gray-400">No parameters</div>
    </div>
  );

  if (op.kind === "analyze") return (
    <div className="w-64 border-l border-gray-200 p-4 text-sm">
      <div className="font-semibold mb-3">{label}</div>
      <div className="mb-2">
        <label className="text-xs text-gray-500 block">Type</label>
        <select className="w-full border border-gray-300 rounded px-2 py-0.5 text-sm"
          value={(op.params as any).type} onChange={e => onChange({ ...op.params, type: e.target.value })}>
          <option value="porosity">porosity</option>
          <option value="statistics">statistics</option>
          <option value="distribution">distribution</option>
        </select>
      </div>
    </div>
  );

  return null;
}
```

**说明**：手写 4 种 kind 的分支表单，无泛型 SchemaForm 抽象。

### 5b. ChainEditorPage 改动

**删除**原有只读 `Inspector`，替换为带 `onChange` 的版本：

```tsx
<Inspector op={selectedOp} onChange={(params) => {
  if (selectedOpIdx === null) return;
  const nextOps = ops.map((op, i) =>
    i === selectedOpIdx ? { ...op, params } : op
  ) as Operation[];
  setChain({ ...chain, operations: nextOps });
  saveOps(nextOps);
}} />
```

参数变更直接走已有 `saveOps`（200ms debounce PATCH 保存）。

### 5c. Canvas 底部加 Preview 按钮

```tsx
{ops.length > 0 && chain.resource_ids.length > 0 && (
  <div className="mt-4 pt-4 border-t border-gray-200">
    <button className="px-3 py-1 bg-blue-500 text-white rounded text-sm"
      onClick={() => setPreviewRid(chain.resource_ids[0])}>
      Preview
    </button>
    {previewRid && (
      <img src={api.previewUrl(pid!, cid!, previewRid)}
        className="mt-2 max-w-full h-48 object-contain border rounded"
        alt="Preview" />
    )}
  </div>
)}
```

`ChainEditorPage` 新增 state：`const [previewRid, setPreviewRid] = useState<string | null>(null);`

## 步骤 6：验证

```bash
# terminal 1: 后端
cd backend && uv run uvicorn main:app --reload

# terminal 2: 前端
cd frontend && bun run dev
```

验证路径：
1. `http://localhost:5173/studio/` → 进入项目 → 展开链 → 进入链编辑器
2. 点击操作 → Inspector 显示参数编辑表单（数字框/下拉）
3. 修改参数 → 200ms 后自动保存
4. 绑定资源 → 点 Preview → 下方显示渲染结果缩略图
5. 修改参数后再点 Preview → 缩略图更新
6. 浏览器直接访问 `/api/projects/{pid}/chains/{cid}/preview?rid={sha1}` → 返回 JPEG

## 关键设计决策

| 决策 | 理由 |
|------|------|
| **GET 直接返回图片** | `<img src>` 零 fetch，不经过 resource 表校验 |
| **预览无缓存** | 手动按钮低频，Phase 4 加自动预览时补 |
| **render_preview 只做 Map** | 单图 Reduce 无跨图累加价值 |
| **手写 4 种表单** | 4 种 kind 无泛型抽象必要，内联 ~50 行更直观 |
| **无 SSE** | 同步 GET 返回图片，Phase 4 升级为 SSE 流式 |
