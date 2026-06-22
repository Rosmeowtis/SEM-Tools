# Phase 5a 实施计划：导出系统

## 概要

Phase 5a 目标：导出系统。新增 5 种 Map 操作 + Reduce(analyze) + execute_chain 流式引擎 + ZIP 导出端点 + SchemaForm Inspector。

## 步骤 1：后端 engine.py 完整版

### `backend/engine.py`（~175 行）

```python
import json
import zipfile
from io import BytesIO

import cv2
import numpy as np
from pathlib import Path
from typing import Callable
from PIL import Image


# --- I/O ---

def load_image(path: Path) -> np.ndarray:
    pil = Image.open(path).convert("RGB")
    img = np.array(pil)
    return cv2.cvtColor(img, cv2.COLOR_RGB2BGR)


def save_image(img: np.ndarray, path: Path, quality: int = 85):
    path.parent.mkdir(parents=True, exist_ok=True)
    if img.ndim == 2:
        Image.fromarray(img).save(path, quality=quality)
    else:
        Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB)).save(path, quality=quality)


# --- Map operations ---

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
    elif kind == "blur":
        k = params.get("ksize", 3)
        if k % 2 == 0: k += 1
        return cv2.GaussianBlur(img, (k, k), 0)
    elif kind == "threshold":
        t = params.get("threshold", 127)
        gray = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        _, binary = cv2.threshold(gray, t, 255, cv2.THRESH_BINARY)
        return binary
    elif kind == "morphology_ellipse":
        t = cv2.MORPH_OPEN if params.get("type") == "open" else cv2.MORPH_CLOSE
        k = params.get("ksize", 3)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
        return cv2.morphologyEx(img, t, kernel)
    elif kind == "invert":
        return cv2.bitwise_not(img)
    elif kind == "format":
        return img
    return img


# --- Reduce operations (analyze) ---

def _reduce_init(op: dict) -> dict:
    params = op["params"]
    t = params.get("type", "porosity")
    if t == "porosity":
        return {"total_white": 0.0, "total_pixels": 0, "per_image": []}
    elif t == "statistics":
        return {"values": []}
    elif t == "distribution":
        return {"particle_areas": [], "equiv_diameters": []}
    return {}


def _reduce_accumulate(op: dict, state: dict, img: np.ndarray, rid: str) -> dict:
    params = op["params"]
    t = params.get("type", "porosity")
    gray = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    if t == "porosity":
        _, binary = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY)
        white = np.sum(binary == 255)
        total = binary.size
        state["total_white"] += float(white)
        state["total_pixels"] += int(total)
        state["per_image"].append({"rid": rid, "porosity": float(white / total)})
    elif t == "statistics":
        state["values"].extend(gray.ravel().tolist())
    elif t == "distribution":
        _, binary = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY)
        num_labels, _, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
        areas = stats[1:, cv2.CC_STAT_AREA].tolist()
        state["particle_areas"].extend(areas)
        state["equiv_diameters"].extend([2 * np.sqrt(a / np.pi) for a in areas])
    return state


def _reduce_finalize(op: dict, state: dict) -> dict:
    t = op["params"].get("type", "porosity")
    if t == "porosity":
        overall = state["total_white"] / state["total_pixels"] if state["total_pixels"] else 0
        return {"overall": overall, "per_image": state["per_image"]}
    elif t == "statistics":
        arr = np.array(state["values"]) if state["values"] else np.array([0])
        return {"count": int(len(arr)), "mean": float(arr.mean()),
                "std": float(arr.std()), "min": float(arr.min()), "max": float(arr.max()),
                "p50": float(np.percentile(arr, 50)), "p95": float(np.percentile(arr, 95)),
                "p99": float(np.percentile(arr, 99))}
    elif t == "distribution":
        return {"particle_areas": state["particle_areas"],
                "equiv_diameters": state["equiv_diameters"]}
    return {}


# --- Preview (unchanged) ---

def render_preview(image_path: Path, operations: list[dict], cache_path: Path,
                   on_progress: Callable[[int], None] | None = None):
    img = load_image(image_path)
    map_ops = [op for op in operations if op.get("mode") != "reduce"]
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


# --- Export ---

def execute_chain(resource_paths: list[tuple[str, Path]], operations: list[dict],
                  export_dir: Path, on_progress: Callable[[int], None] | None = None) -> BytesIO:
    map_ops = [op for op in operations if op.get("mode") != "reduce"]
    reduce_ops = [op for op in operations if op.get("mode") == "reduce"]
    total = len(resource_paths)

    # ponytail: format from chain op, not query param
    fmt_op = next((op for op in operations if op["kind"] == "format"), None)
    output_fmt = fmt_op["params"]["type"] if fmt_op else "png"
    quality = fmt_op["params"].get("quality", 85) if fmt_op else 85

    reduce_states = {}
    for i, op in enumerate(reduce_ops):
        reduce_states[i] = _reduce_init(op)

    output_paths: list[Path] = []
    for idx, (rid, rpath) in enumerate(resource_paths):
        img = load_image(rpath)
        for op in map_ops:
            img = apply_map_op(img, op)

        out_path = export_dir / f"{rid}.{output_fmt}"
        save_image(img, out_path, quality=quality)
        output_paths.append(out_path)

        for i, op in enumerate(reduce_ops):
            reduce_states[i] = _reduce_accumulate(op, reduce_states[i], img, rid)

        del img
        if on_progress:
            on_progress(int((idx + 1) / total * 100))

    # ponytail: reduce key = kind-index to avoid overwrite
    results = {}
    for i, op in enumerate(reduce_ops):
        key = f"{op['kind']}-{i}"
        results[key] = _reduce_finalize(op, reduce_states[i])

    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in output_paths:
            zf.write(p, p.name)
        if results:
            zf.writestr("analysis.json", json.dumps(results, indent=2))
    buf.seek(0)
    return buf
```

## 步骤 2：后端 models.py 扩展

### `backend/studio/models.py` 新增 5 个 Op 模型 + 更新 Union

```python
class BlurParams(BaseModel):
    ksize: int = 3

class ThresholdParams(BaseModel):
    threshold: int = 127

class MorphologyParams(BaseModel):
    type: Literal["open", "close"] = "open"
    ksize: int = 3

class InvertParams(BaseModel):
    pass

class FormatParams(BaseModel):
    type: Literal["png", "jpg", "webp"] = "png"
    quality: int = 85

class BlurOp(BaseModel):
    kind: Literal["blur"] = "blur"
    mode: Literal["map"] = "map"
    params: BlurParams = Field(default_factory=BlurParams)

class ThresholdOp(BaseModel):
    kind: Literal["threshold"] = "threshold"
    mode: Literal["map"] = "map"
    params: ThresholdParams = Field(default_factory=ThresholdParams)

class MorphologyOp(BaseModel):
    kind: Literal["morphology_ellipse"] = "morphology_ellipse"
    mode: Literal["map"] = "map"
    params: MorphologyParams = Field(default_factory=MorphologyParams)

class InvertOp(BaseModel):
    kind: Literal["invert"] = "invert"
    mode: Literal["map"] = "map"
    params: InvertParams = Field(default_factory=InvertParams)

class FormatOp(BaseModel):
    kind: Literal["format"] = "format"
    mode: Literal["map"] = "map"
    params: FormatParams = Field(default_factory=FormatParams)

Operation = Annotated[
    Union[CropOp, ResizeOp, GrayscaleOp, BlurOp, ThresholdOp,
          MorphologyOp, InvertOp, FormatOp, AnalyzeOp],
    Field(discriminator="kind")
]
```

## 步骤 3：后端 main.py 新增导出路由

### 追加到 `backend/main.py`

```python
@app.post("/api/projects/{pid}/chains/{cid}/export")
async def export_chain(pid: str, cid: str, rid: str | None = None):
    p = db_get_project(pid)
    if not p:
        raise HTTPException(404, "Project not found")
    chain = db_get_chain(pid, cid)
    if not chain:
        raise HTTPException(404, "Chain not found")

    cf = _chain_file(pid, p["slug"], cid)
    operations = json.loads(cf.read_text()) if cf.exists() else []

    resource_ids = json.loads(chain["resource_ids_json"])
    targets = [rid] if rid and rid in resource_ids else resource_ids

    resource_paths = []
    for rid in targets:
        r = db_get_resource(rid)
        if r:
            orig = _project_dir(pid, p["slug"]) / "resources" / "original" / f"{rid}.{r['ext']}"
            if orig.exists():
                resource_paths.append((rid, orig))

    if not resource_paths:
        raise HTTPException(400, "No resources found")

    export_dir = _project_dir(pid, p["slug"]) / "output"
    buf = execute_chain(resource_paths, operations, export_dir)

    name = chain.get("name", "export")
    return StreamingResponse(buf, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{name}.zip"'})
```

**注意**：在 `main.py` 顶端追加 `from engine import execute_chain`。

## 步骤 4：前端 types.ts 完整升级

```typescript
export type OperationParams =
  | { x: number; y: number; w: number; h: number }
  | { w: number; h: number; algorithm: "nearest" | "bilinear" }
  | Record<string, never>
  | { type: "porosity" | "statistics" | "distribution" }
  | { ksize: number }
  | { threshold: number }
  | { type: "open" | "close"; ksize: number }
  | { type: "png" | "jpg" | "webp"; quality: number };

export type Operation = {
  kind: "crop" | "resize" | "grayscale" | "analyze" | "blur" |
        "threshold" | "morphology_ellipse" | "invert" | "format";
  mode: "map" | "reduce";
  params: OperationParams;
};

export interface FieldDef {
  key: string;
  label: string;
  type: "number" | "select";
  options?: readonly string[];
  default: number | string;
}

export const OP_KINDS = [
  { kind: "crop" as const,      mode: "map" as const,    params: { x:0, y:0, w:100, h:100 }, label: "Crop",
    fields: [
      { key:"x", label:"X", type:"number", default:0 },
      { key:"y", label:"Y", type:"number", default:0 },
      { key:"w", label:"Width", type:"number", default:100 },
      { key:"h", label:"Height", type:"number", default:100 },
    ] as FieldDef[] },
  { kind: "resize" as const,    mode: "map" as const,    params: { w:256, h:256, algorithm:"bilinear" }, label: "Resize",
    fields: [
      { key:"w", label:"Width", type:"number", default:256 },
      { key:"h", label:"Height", type:"number", default:256 },
      { key:"algorithm", label:"Algorithm", type:"select", options:["nearest","bilinear"], default:"bilinear" },
    ] as FieldDef[] },
  { kind: "grayscale" as const, mode: "map" as const,    params: {} as Record<string,never>, label: "Grayscale", fields: [] as FieldDef[] },
  { kind: "blur" as const,      mode: "map" as const,    params: { ksize:3 }, label: "Blur",
    fields: [{ key:"ksize", label:"Kernel Size", type:"number", default:3 }] as FieldDef[] },
  { kind: "threshold" as const, mode: "map" as const,    params: { threshold:127 }, label: "Threshold",
    fields: [{ key:"threshold", label:"Threshold", type:"number", default:127 }] as FieldDef[] },
  { kind: "morphology_ellipse" as const, mode: "map" as const, params: { type:"open" as const, ksize:3 }, label: "Morphology",
    fields: [
      { key:"type", label:"Type", type:"select", options:["open","close"], default:"open" },
      { key:"ksize", label:"Kernel Size", type:"number", default:3 },
    ] as FieldDef[] },
  { kind: "invert" as const,    mode: "map" as const,    params: {} as Record<string,never>, label: "Invert", fields: [] as FieldDef[] },
  { kind: "format" as const,    mode: "map" as const,    params: { type:"png" as const, quality:85 }, label: "Format",
    fields: [
      { key:"type", label:"Type", type:"select", options:["png","jpg","webp"], default:"png" },
      { key:"quality", label:"Quality", type:"number", default:85 },
    ] as FieldDef[] },
  { kind: "analyze" as const,   mode: "reduce" as const, params: { type:"porosity" as const }, label: "Analyze",
    fields: [{ key:"type", label:"Type", type:"select", options:["porosity","statistics","distribution"], default:"porosity" }] as FieldDef[] },
];
```

## 步骤 5：前端 api.ts 新增 exportUrl

```typescript
exportUrl: (pid: string, cid: string, rid?: string) =>
  `${BASE}/projects/${pid}/chains/${cid}/export${rid ? `?rid=${rid}` : ""}`,
```

## 步骤 6：前端 App.tsx 改动

### 6a. SchemaForm（替换手写 Inspector 组件）

```typescript
function SchemaForm({ op, onChange }: {
  op: Operation | null;
  onChange: (params: Record<string, unknown>) => void;
}) {
  if (!op) return (
    <div className="w-64 border-l border-gray-200 p-4 text-gray-400 text-sm">
      Select an operation
    </div>
  );
  const kindDef = OP_KINDS.find(k => k.kind === op.kind);
  if (!kindDef) return null;
  return (
    <div className="w-64 border-l border-gray-200 p-4 text-sm">
      <div className="font-semibold mb-3">{kindDef.label}</div>
      {kindDef.fields.length === 0 && <div className="text-gray-400">No parameters</div>}
      {kindDef.fields.map(f => (
        <div key={f.key} className="mb-2">
          <label className="text-xs text-gray-500 block">{f.label}</label>
          {f.type === "number" ? (
            <input type="number" className="w-full border border-gray-300 rounded px-2 py-0.5 text-sm"
              value={(op.params as Record<string, unknown>)[f.key] as number ?? f.default}
              onChange={e => onChange({ ...op.params, [f.key]: Number(e.target.value) })} />
          ) : (
            <select className="w-full border border-gray-300 rounded px-2 py-0.5 text-sm"
              value={(op.params as Record<string, unknown>)[f.key] as string ?? f.default}
              onChange={e => onChange({ ...op.params, [f.key]: e.target.value })}>
              {f.options?.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
        </div>
      ))}
    </div>
  );
}
```

**替换**：ChainEditorPage 中删除原有 8 分支 `Inspector` 组件，改为 `<SchemaForm op={...} onChange={...} />`。

### 6b. Export 按钮（Preview 区域，fetch 下载）

```typescript
const handleExport = useCallback(() => {
  if (!pid || !cid) return;
  fetch(api.exportUrl(pid, cid, previewTarget ?? undefined), { method: "POST" })
    .then(r => r.blob())
    .then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${chain?.name ?? "export"}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    });
}, [pid, cid, previewTarget, chain]);
```

Canvas 底部预览区域中追加 Export 按钮：

```tsx
{previewTarget && (
  <div className="mt-4 pt-4 border-t border-gray-200">
    {/* ... 现有预览区域（进度条/缩略图/错误） ... */}
    <div className="flex items-center justify-end mt-2">
      <button onClick={handleExport}
        className="px-3 py-1 bg-green-500 text-white rounded text-sm">
        Export ZIP
      </button>
    </div>
  </div>
)}
```

## 步骤 7：验证

```bash
# terminal 1: 后端
cd backend && uv run uvicorn main:app --reload

# terminal 2: 前端
cd frontend && bun run dev
```

验证路径：
1. 链编辑器 → 新增 blur/threshold/morphology/invert/format 操作 → Inspector 显示对应表单
2. 修改参数 → 自动保存并预览
3. 绑定资源 → 点击 Export ZIP → 下载 ZIP 文件
4. ZIP 内包含处理后的图片 + 若含 analyze 则包含 `analysis.json`
5. GIT 对比：后端 Operation Union 9 种，前端 OP_KINDS 9 种

## 变更清单

| 层 | 文件 | 改动 | 行数 |
|---|------|------|------|
| 后端 | `backend/engine.py` | +5 Map ops + Reduce(analyze) + execute_chain + ZIP | ~175 |
| 后端 | `backend/studio/models.py` | +5 Params + 5 Op + Union 更新(9 种) | ~55 |
| 后端 | `backend/main.py` | +POST export 路由 (ZIP StreamingResponse) | ~35 |
| 前端 | `types.ts` | OperationParams/Operation/OP_KINDS 扩展 9 种 + FieldDef | ~55 |
| 前端 | `api.ts` | +exportUrl | ~2 |
| 前端 | `App.tsx` | Inspecter→SchemaForm + Export fetch 按钮 | ~60 / -80 |

## 关键设计决策

| 决策 | 理由 |
|------|------|
| **5 Map ops 全加** | 每项 ~3-5 行 OpenCV，模型 ~5-8 行，无架构新增 |
| **SchemaForm** | 9 种 kind 超过手写收益阈值，FieldDef 元数据驱动 |
| **execute_chain 返回 BytesIO** | ZIP 打包后直接 `StreamingResponse`，零文件残留 |
| **format op 决定输出格式** | 移除 `?format=` 查询参数，单一数据源 |
| **Reduce key = kind-index** | 避免同名 analyze 结果覆盖 |
| **Export 无 SSE** | 导出事件延到 Phase 5b 与 Preset 同步 |

解除只读模式后写入 `docs/plan/PHASE5a.md`。
