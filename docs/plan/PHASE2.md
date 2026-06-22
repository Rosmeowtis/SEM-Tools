# Phase 2 实施计划

## 概要

Phase 2 目标：Chain CRUD + 链编辑器 + 拖拽排序。后端新增 chain 数据模型和 API 路由，前端侧边栏扩展链列表 + 链编辑器页面（两栏布局 + 紧凑资源绑定）。

## 步骤 1：后端模型

### `backend/studio/models.py` 新增

```python
from typing import Annotated, Union, Literal
from pydantic import BaseModel, Field


# --- Params ---

class CropParams(BaseModel):
    x: int = 0
    y: int = 0
    w: int = 100
    h: int = 100

class ResizeParams(BaseModel):
    w: int = 256
    h: int = 256
    algorithm: Literal["nearest", "bilinear"] = "bilinear"

class GrayscaleParams(BaseModel):
    pass

class AnalyzeParams(BaseModel):
    type: Literal["porosity", "statistics", "distribution"] = "porosity"


# --- Discriminated union ---

class CropOp(BaseModel):
    kind: Literal["crop"] = "crop"
    mode: Literal["map"] = "map"
    params: CropParams = Field(default_factory=CropParams)

class ResizeOp(BaseModel):
    kind: Literal["resize"] = "resize"
    mode: Literal["map"] = "map"
    params: ResizeParams = Field(default_factory=ResizeParams)

class GrayscaleOp(BaseModel):
    kind: Literal["grayscale"] = "grayscale"
    mode: Literal["map"] = "map"
    params: GrayscaleParams = Field(default_factory=GrayscaleParams)

class AnalyzeOp(BaseModel):
    kind: Literal["analyze"] = "analyze"
    mode: Literal["reduce"] = "reduce"
    params: AnalyzeParams = Field(default_factory=AnalyzeParams)

Operation = Annotated[
    Union[CropOp, ResizeOp, GrayscaleOp, AnalyzeOp],
    Field(discriminator="kind")
]


class ChainCreate(BaseModel):
    name: str
    resource_ids: list[str] = []

class ChainUpdate(BaseModel):
    name: str | None = None
    operations: list[Operation] | None = None
    resource_ids: list[str] | None = None

## 步骤 2：数据库迁移

### `backend/database.py` 新增

```python
def get_chain(pid: str, cid: str) -> dict | None:
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM chains WHERE id = ? AND project_id = ?", (cid, pid)
    ).fetchone()
    conn.close()
    return dict(row) if row else None

def list_chains(pid: str) -> list[dict]:
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM chains WHERE project_id = ? ORDER BY created_at DESC", (pid,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def create_chain(pid: str, cid: str, name: str, resource_ids: list[str], ts: str) -> dict:
    conn = get_db()
    conn.execute(
        "INSERT INTO chains (id, project_id, name, resource_ids_json, created_at, updated_at) VALUES (?,?,?,?,?,?)",
        (cid, pid, name, json.dumps(resource_ids), ts, ts),
    )
    conn.commit()
    conn.close()
    return {"id": cid, "project_id": pid, "name": name, "resource_ids": resource_ids, "created_at": ts, "updated_at": ts}

def update_chain(cid: str, name: str | None, resource_ids_json: str | None, ts: str) -> dict | None:
    conn = get_db()
    existing = conn.execute("SELECT * FROM chains WHERE id = ?", (cid,)).fetchone()
    if not existing:
        conn.close()
        return None
    new_name = name if name is not None else existing["name"]
    new_rids = resource_ids_json if resource_ids_json is not None else existing["resource_ids_json"]
    conn.execute(
        "UPDATE chains SET name=?, resource_ids_json=?, updated_at=? WHERE id=?",
        (new_name, new_rids, ts, cid),
    )
    conn.commit()
    conn.close()
    return {**dict(existing), "name": new_name, "resource_ids": json.loads(new_rids), "updated_at": ts}

def delete_chain(pid: str, cid: str) -> bool:
    conn = get_db()
    cur = conn.execute("DELETE FROM chains WHERE id = ? AND project_id = ?", (cid, pid))
    conn.commit()
    conn.close()
    return cur.rowcount > 0
```

### `init_db()` 追加 chains 表

```python
CREATE TABLE IF NOT EXISTS chains (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    resource_ids_json TEXT DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

## 步骤 3：后端路由

### `backend/main.py` 新增

```python
from studio.models import (
    ...
    ChainCreate, ChainUpdate,
    new_id,
)

def _chain_file(pid: str, slug: str, cid: str) -> Path:
    return DATA_DIR / "projects" / f"{pid}-{slug}" / "chains" / f"{cid}.json"


@app.get("/api/projects/{pid}/chains")
def list_chains(pid: str):
    p = db_get_project(pid)
    if not p:
        raise HTTPException(404, "Project not found")
    chains = db_list_chains(pid)
    for c in chains:
        cf = _chain_file(pid, p["slug"], c["id"])
        if cf.exists():
            c["operations"] = json.loads(cf.read_text())
        else:
            c["operations"] = []
        c["resource_ids"] = json.loads(c["resource_ids_json"])
        del c["resource_ids_json"]
    return chains


@app.post("/api/projects/{pid}/chains")
def create_chain(pid: str, data: ChainCreate):
    p = db_get_project(pid)
    if not p:
        raise HTTPException(404, "Project not found")
    cid = new_id()
    ts = now()
    chain = db_create_chain(pid, cid, data.name, data.resource_ids, ts)
    # 写入空 operations 文件
    (DATA_DIR / "projects" / f"{pid}-{p['slug']}" / "chains").mkdir(parents=True, exist_ok=True)
    _chain_file(pid, p["slug"], cid).write_text("[]")
    chain["operations"] = []
    return chain


@app.get("/api/projects/{pid}/chains/{cid}")
def get_chain(pid: str, cid: str):
    p = db_get_project(pid)
    if not p:
        raise HTTPException(404, "Project not found")
    chain = db_get_chain(pid, cid)
    if not chain:
        raise HTTPException(404, "Chain not found")
    cf = _chain_file(pid, p["slug"], cid)
    operations = json.loads(cf.read_text()) if cf.exists() else []
    chain["resource_ids"] = json.loads(chain["resource_ids_json"])
    del chain["resource_ids_json"]
    chain["operations"] = operations
    return chain


@app.patch("/api/projects/{pid}/chains/{cid}")
def patch_chain(pid: str, cid: str, data: ChainUpdate):
    p = db_get_project(pid)
    if not p:
        raise HTTPException(404, "Project not found")
    rids_json = json.dumps(data.resource_ids) if data.resource_ids is not None else None
    chain = db_update_chain(cid, data.name, rids_json, now())
    if not chain:
        raise HTTPException(404, "Chain not found")
    if data.operations is not None:
        _chain_file(pid, p["slug"], cid).write_text(
            json.dumps([op.model_dump(mode="json") for op in data.operations])
        )
    cf = _chain_file(pid, p["slug"], cid)
    operations = json.loads(cf.read_text()) if cf.exists() else []
    chain["operations"] = operations
    return chain


@app.delete("/api/projects/{pid}/chains/{cid}")
def delete_chain(pid: str, cid: str):
    p = db_get_project(pid)
    if not p:
        raise HTTPException(404, "Project not found")
    chain = db_get_chain(pid, cid)
    if not chain:
        raise HTTPException(404, "Chain not found")
    ok = db_delete_chain(pid, cid)
    cf = _chain_file(pid, p["slug"], cid)
    if cf.exists():
        cf.unlink()
    return {"deleted": ok}
```

## 步骤 4：前端类型

### `frontend/src/types.ts` 新增

```typescript
export type OperationParams =
  | { x: number; y: number; w: number; h: number }
  | { w: number; h: number; algorithm: "nearest" | "bilinear" }
  | Record<string, never>
  | { type: "porosity" | "statistics" | "distribution" };

export type Operation = {
  kind: "crop" | "resize" | "grayscale" | "analyze";
  mode: "map" | "reduce";
  params: OperationParams;
};

export interface Chain {
  id: string;
  project_id: string;
  name: string;
  resource_ids: string[];
  operations: Operation[];
  created_at: string;
  updated_at: string;
}

export const OP_KINDS = [
  { kind: "crop" as const,      mode: "map" as const, params: { x: 0, y: 0, w: 100, h: 100 },          label: "Crop" },
  { kind: "resize" as const,    mode: "map" as const, params: { w: 256, h: 256, algorithm: "bilinear" }, label: "Resize" },
  { kind: "grayscale" as const, mode: "map" as const, params: {} as Record<string, never>,              label: "Grayscale" },
  { kind: "analyze" as const,   mode: "reduce" as const, params: { type: "porosity" },                  label: "Analyze" },
] as const;
```

## 步骤 5：前端 API

### `frontend/src/api.ts` 新增

```typescript
// 追加 import（并到已有 import { Project, ResourceMeta } from "./types"）:
import type { Chain, Operation } from "./types";

// 追加到现有 api 对象:
listChains: (pid: string) => req<Chain[]>(`/projects/${pid}/chains`),
createChain: (pid: string, name: string) =>
  req<Chain>(`/projects/${pid}/chains`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  }),
getChain: (pid: string, cid: string) => req<Chain>(`/projects/${pid}/chains/${cid}`),
updateChain: (pid: string, cid: string, data: { name?: string; operations?: Operation[]; resource_ids?: string[] }) =>
  req<Chain>(`/projects/${pid}/chains/${cid}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }),
deleteChain: (pid: string, cid: string) =>
  req<{ deleted: boolean }>(`/projects/${pid}/chains/${cid}`, { method: "DELETE" }),
```

## 步骤 6：前端 App 组件

### `frontend/src/App.tsx` 改动

#### 6a. Sidebar 扩展（展开链列表 + 内联创建）

```
改动点:
├── 项目列表项 Link 旁加展开按钮 ▼/▶
├── 展开时渲染:
│   ├── chain 子项 (Link to /projects/:pid/chains/:cid + 删除按钮)
│   └── "New chain" 内联输入框 (onSubmit → api.createChain → navigate)
```

关键逻辑：
- 每个 Sidebar 项目维护 `expanded` 状态（`useState<Record<string, boolean>>`）
- 展开时 fetch `api.listChains(pid)` 获取链列表
- "New chain" 输入框回车 → 创建 → `navigate(/projects/:pid/chains/${cid})`
- 链删除 → `api.deleteChain` → 刷新列表

#### 6b. 新增路由

```tsx
<Route path="/projects/:pid/chains/:cid" element={<ChainEditorPage />} />
```

#### 6c. ChainEditorPage 组件 (~180 行)

布局框架:

```tsx
function ChainEditorPage() {
  const { pid, cid } = useParams();
  const [chain, setChain] = useState<Chain | null>(null);
  const [resources, setResources] = useState<ResourceMeta[]>([]);
  const nextId = useRef(0);
  const [opIds, setOpIds] = useState<string[]>([]);
  const [selectedOpIdx, setSelectedOpIdx] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchChain = () => { if (pid && cid) api.getChain(pid, cid).then(setChain); };
  const fetchResources = () => { if (pid) api.listResources(pid).then(setResources); };
  useEffect(() => { fetchChain(); fetchResources(); }, [pid, cid]);
  useEffect(() => { if (chain) setOpIds(chain.operations.map(() => `op-${nextId.current++}`)); }, [chain?.id]);
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const saveOps = (ops: Operation[]) => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (pid && cid) api.updateChain(pid, cid, { operations: ops }).then(setChain);
    }, 200);
  };

  if (!chain) return <p>Loading...</p>;

  // 构建操作列表
  const ops = chain.operations;
  const selectedOp = selectedOpIdx !== null ? ops[selectedOpIdx] : null;

  return (
    <div className="flex flex-col h-full">
      {/* 链名称标题行 (可编辑) */}
      <ChainTitle chain={chain} onRename={(name) => {
        if (pid && cid) api.updateChain(pid, cid, { name }).then(setChain);
      }} />

      {/* 资源绑定 chips 行 */}
      <ResourceChips
        resources={resources}
        boundIds={chain.resource_ids}
        onToggle={(sha1) => {
          const next = chain.resource_ids.includes(sha1)
            ? chain.resource_ids.filter(id => id !== sha1)
            : [...chain.resource_ids, sha1];
          if (pid && cid) api.updateChain(pid, cid, { resource_ids: next }).then(setChain);
        }}
      />

      {/* 主区域: Canvas + Inspector */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左: Chain Canvas */}
        <div className="flex-1 overflow-auto p-4">
          {ops.length === 0 ? (
            <div className="text-gray-400 text-center mt-8">
              No operations yet. Add one below.
            </div>
          ) : (
            <DndContext onDragEnd={(e) => {
              const { active, over } = e;
              if (!over || active.id === over.id) return;
              const oldIdx = opIds.indexOf(active.id as string);
              const newIdx = opIds.indexOf(over.id as string);
              const nextOps = [...ops];
              const [moved] = nextOps.splice(oldIdx, 1);
              nextOps.splice(newIdx, 0, moved);
              const nextIds = [...opIds];
              const [movedId] = nextIds.splice(oldIdx, 1);
              nextIds.splice(newIdx, 0, movedId);
              setChain({ ...chain, operations: nextOps });
              setOpIds(nextIds);
              saveOps(nextOps);
            }}>
              <SortableContext items={opIds} strategy={verticalListSortingStrategy}>
                {ops.map((op, i) => (
                  <SortableOpItem
                    key={opIds[i]}
                    id={opIds[i]}
                    op={op}
                    isSelected={selectedOpIdx === i}
                    onSelect={() => setSelectedOpIdx(i)}
                    onDelete={() => {
                      const next = ops.filter((_, j) => j !== i);
                      const nextIds = opIds.filter((_, j) => j !== i);
                      setChain({ ...chain, operations: next });
                      setOpIds(nextIds);
                      saveOps(next);
                      if (selectedOpIdx === i) setSelectedOpIdx(null);
                    }}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}

          {/* Add Operation 下拉 */}
          <AddOpDropdown onAdd={(kind) => {
            const template = OP_KINDS.find(k => k.kind === kind)!;
            const newOp: Operation = {
              kind,
              mode: template.mode,
              params: template.params,
            };
            setOpIds([...opIds, `op-${nextId.current++}`]);
            saveOps([...ops, newOp]);
          }} />
        </div>

        {/* 右: Inspector */}
        <Inspector op={selectedOp} />
      </div>
    </div>
  );
}
```

---

#### 子组件说明

**SortableOpItem** — 单个 operation 行，支持拖拽手柄、选中、删除：

```tsx
function SortableOpItem({ id, op, isSelected, onSelect, onDelete }: {
  id: string; op: Operation; isSelected: boolean;
  onSelect: () => void; onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style: React.CSSProperties = transform
    ? { transform: `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0) scaleX(${transform.scaleX}) scaleY(${transform.scaleY})`, transition }
    : { transition };
  return (
    <div
      ref={setNodeRef} style={style}
      className={`flex items-center gap-2 p-2 border rounded mb-1 cursor-pointer ${isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}
      onClick={onSelect}
    >
      <button className="cursor-grab text-gray-400" {...attributes} {...listeners}>☰</button>
      <span className="font-mono text-sm">{op.kind}</span>
      <span className="text-xs text-gray-400">{op.mode}</span>
      <span className="text-xs text-gray-500 truncate flex-1">{JSON.stringify(op.params)}</span>
      <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="text-red-400 text-xs">×</button>
    </div>
  );
}
```

**Inspector** — 选中 op 的只读信息展示：

```tsx
function Inspector({ op }: { op: Operation | null }) {
  if (!op) return (
    <div className="w-64 border-l border-gray-200 p-4 text-gray-400 text-sm">
      Select an operation
    </div>
  );
  return (
    <div className="w-64 border-l border-gray-200 p-4 text-sm">
      <div className="font-semibold mb-2">Operation</div>
      <div><span className="text-gray-500">kind:</span> {op.kind}</div>
      <div><span className="text-gray-500">mode:</span> {op.mode}</div>
      <div className="mt-2 font-semibold">Params</div>
      <pre className="text-xs bg-gray-50 p-2 rounded mt-1 overflow-auto">
        {JSON.stringify(op.params, null, 2)}
      </pre>
    </div>
  );
}
```

**AddOpDropdown** — 底部下拉菜单：

```tsx
function AddOpDropdown({ onAdd }: { onAdd: (kind: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative mt-2">
      <button onClick={() => setOpen(!open)} className="px-3 py-1 text-sm border border-dashed border-gray-300 rounded w-full text-gray-500 hover:border-blue-300">
        + Add Operation
      </button>
      {open && (
        <div className="absolute bottom-full mb-1 left-0 bg-white border border-gray-200 rounded shadow-lg">
          {OP_KINDS.map(({ kind, mode, label }) => (
            <button key={kind} className="block w-full text-left px-3 py-1 text-sm hover:bg-gray-100"
              onClick={() => { onAdd(kind); setOpen(false); }}>
              {label} ({mode})
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

**ResourceChips** — 紧凑资源绑定行：

```tsx
function ResourceChips({ resources, boundIds, onToggle }: {
  resources: ResourceMeta[]; boundIds: string[];
  onToggle: (sha1: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 px-4 py-1 border-b border-gray-200 text-sm">
      <span className="text-gray-500 mr-1">Resources:</span>
      {resources.filter(r => boundIds.includes(r.sha1)).map(r => (
        <span key={r.sha1} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs">
          {r.filename}
          <button onClick={() => onToggle(r.sha1)} className="hover:text-red-500">×</button>
        </span>
      ))}
      <select className="text-xs border border-gray-200 rounded px-1" value=""
        onChange={(e) => { if (e.target.value) onToggle(e.target.value); }}>
        <option value="">+ Bind</option>
        {resources.filter(r => !boundIds.includes(r.sha1)).map(r => (
          <option key={r.sha1} value={r.sha1}>{r.filename}</option>
        ))}
      </select>
    </div>
  );
}
```

**ChainTitle** — 可编辑名称：

```tsx
function ChainTitle({ chain, onRename }: {
  chain: Chain; onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(chain.name);
  useEffect(() => { setName(chain.name); }, [chain.name]);

  if (editing) return (
    <input className="px-4 py-2 text-lg font-semibold border-b border-gray-200 outline-none"
      value={name} autoFocus
      onChange={e => setName(e.target.value)}
      onBlur={() => { onRename(name); setEditing(false); }}
      onKeyDown={e => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }} />
  );
  return (
    <div className="px-4 py-2 text-lg font-semibold border-b border-gray-200 cursor-pointer"
      onClick={() => setEditing(true)}>
      {chain.name}
    </div>
  );
}
```

## 步骤 7：安装依赖

```bash
cd frontend && bun add @dnd-kit/core @dnd-kit/sortable
```

## 步骤 8：验证

```bash
# terminal 1: 后端
cd backend && uv run uvicorn main:app --reload

# terminal 2: 前端
cd frontend && bun run dev
```

验证路径：
1. `http://localhost:5173/studio/` → 进入项目 → 侧边栏展开显示链列表
2. 侧边栏输入 "New chain" → 回车 → 跳转到链编辑器
3. 编辑器显示空链提示 → 下拉添加操作 → 操作出现在列表中
4. 拖拽操作行 → 排序变化
5. 点击操作 → Inspector 显示只读信息
6. 点击链标题 → 重命名 → blur 时保存
7. 绑定资源 chips → 选择/取消资源

## 关键设计决策

| 决策 | 理由 |
|------|------|
| **Operation 判别联合** | 类型安全，每种操作只暴露自己的参数，Phase 3 直接复用 |
| **operations 存 JSON 文件** | 方便版本 diff、手动编辑，与 BASE.md 一致 |
| **两栏布局 + 资源 chips** | Phase 2 无预览，ResourcePicker 面板浪费屏幕，折叠为芯片行 |
| **拖拽 200ms debounce** | 连续排序合并为一次 PATCH，避免多余写操作 |
| **内联链名称编辑** | 不引入独立设置面板，点击即改，操作最轻 |
| **`CSS.Transform` 内联** | 不依赖 `@dnd-kit/utilities`，transform 字符串直接拼接 |
