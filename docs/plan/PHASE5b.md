# Phase 5b 实施计划：Preset 系统

## 概要

Phase 5b 目标：Preset 系统（JSON 文件存储，CRUD + 实例化）。预设管理页面 + 创建链时可选预设。

## 步骤 1：后端 models.py 新增

### `backend/studio/models.py` 追加

```python
class PresetCreate(BaseModel):
    name: str
    operations: list[Any] = []
    category: list[str] = []

class PresetUpdate(BaseModel):
    operations: list[Any] | None = None
    category: list[str] | None = None
```

### ChainCreate 追加 from_preset

```python
class ChainCreate(BaseModel):
    name: str
    resource_ids: list[str] = []
    from_preset: str | None = None
```

## 步骤 2：后端 main.py 新增 Preset 路由

### 追加到 `backend/main.py`

```python
from studio.models import ... PresetCreate, PresetUpdate

PRESETS_DIR = DATA_DIR / "presets"


def _preset_path(name: str) -> Path:
    return PRESETS_DIR / f"{name}.json"


@app.get("/api/presets")
def list_presets(category: str | None = None):
    PRESETS_DIR.mkdir(parents=True, exist_ok=True)
    presets = []
    for f in PRESETS_DIR.glob("*.json"):
        data = json.loads(f.read_text())
        data["name"] = f.stem
        if category and category not in data.get("category", []):
            continue
        presets.append(data)
    return presets


@app.post("/api/presets")
def create_preset(data: PresetCreate):
    PRESETS_DIR.mkdir(parents=True, exist_ok=True)
    path = _preset_path(data.name)
    if path.exists():
        raise HTTPException(409, "Preset already exists")
    path.write_text(json.dumps({
        "operations": data.operations,
        "category": data.category,
    }, indent=2))
    return {"name": data.name, "operations": data.operations, "category": data.category}


@app.patch("/api/presets/{name}")
def update_preset(name: str, data: PresetUpdate):
    path = _preset_path(name)
    if not path.exists():
        raise HTTPException(404, "Preset not found")
    existing = json.loads(path.read_text())
    if data.operations is not None:
        existing["operations"] = data.operations
    if data.category is not None:
        existing["category"] = data.category
    path.write_text(json.dumps(existing, indent=2))
    return {"name": name, **existing}


@app.delete("/api/presets/{name}")
def delete_preset(name: str):
    path = _preset_path(name)
    if not path.exists():
        raise HTTPException(404, "Preset not found")
    path.unlink()
    return {"deleted": True}
```

## 步骤 3：后端 create_chain 支持 from_preset

### 修改 `main.py` 中 `create_chain` 路由

```python
@app.post("/api/projects/{pid}/chains")
def create_chain(pid: str, data: ChainCreate):
    p = db_get_project(pid)
    if not p:
        raise HTTPException(404, "Project not found")
    cid = new_id()
    ts = now()
    chain = db_create_chain(pid, cid, data.name, data.resource_ids, ts)
    (DATA_DIR / "projects" / f"{pid}-{p['slug']}" / "chains").mkdir(parents=True, exist_ok=True)

    if data.from_preset:
        preset_path = PRESETS_DIR / f"{data.from_preset}.json"
        if preset_path.exists():
            preset = json.loads(preset_path.read_text())
            ops = preset.get("operations", [])
            _chain_file(pid, p["slug"], cid).write_text(json.dumps(ops))
            chain["operations"] = ops
            return chain

    _chain_file(pid, p["slug"], cid).write_text("[]")
    chain["operations"] = []
    return chain
```

## 步骤 4：前端 types.ts 新增

```typescript
export interface Preset {
  name: string;
  category: string[];
  operations: Operation[];
}
```

## 步骤 5：前端 api.ts 新增

```typescript
// createChain 追加 from_preset 参数
createChain: (pid: string, name: string, fromPreset?: string) =>
  req<Chain>(`/projects/${pid}/chains`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, ...(fromPreset ? { from_preset: fromPreset } : {}) }),
  }),

listPresets: (category?: string) =>
  req<Preset[]>(`/presets${category ? `?category=${category}` : ""}`),

createPreset: (name: string, operations: Operation[], category: string[] = []) =>
  req<Preset>("/presets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, operations, category }),
  }),

updatePreset: (name: string, data: { operations?: Operation[]; category?: string[] }) =>
  req<Preset>(`/presets/${encodeURIComponent(name)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }),

deletePreset: (name: string) =>
  req<{ deleted: boolean }>(`/presets/${encodeURIComponent(name)}`, { method: "DELETE" }),
```

## 步骤 6：前端 App.tsx 改动

### 6a. App 顶层加载 presets

```typescript
export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const navigate = useNavigate();
  const location = useLocation();
  const currentPid = location.pathname.split("/")[2];

  const fetchProjects = () => { api.listProjects().then(setProjects).catch(console.error); };
  useEffect(fetchProjects, []);
  useEffect(() => { api.listPresets().then(setPresets); }, []);

  const handleCreateChain = (pid: string, name: string, fromPreset?: string) => {
    api.createChain(pid, name, fromPreset).then((c) => {
      navigate(`/projects/${pid}/chains/${c.id}`);
    });
  };
  // ...
  return (
    <div className="flex h-screen">
      <Sidebar
        projects={projects}
        presets={presets}
        // ...
        onCreateChain={handleCreateChain}
        currentPid={currentPid}
      />
      {/* ... */}
    </div>
  );
}
```

### 6b. Sidebar 扩展（预设下拉 + Presets 链接）

```typescript
function Sidebar({ projects, presets, onDeleteProject, onCreateProject, onCreateChain, currentPid }: {
  projects: Project[];
  presets: Preset[];
  onDeleteProject: (pid: string) => void;
  onCreateProject: (title: string) => void;
  onCreateChain: (pid: string, name: string, fromPreset?: string) => void;
  currentPid?: string;
}) {
  // ...
  const [newChainPreset, setNewChainPreset] = useState<Record<string, string>>({});

  const handleCreateChain = (pid: string) => {
    const name = newChainName[pid]?.trim();
    if (!name) return;
    onCreateChain(pid, name, newChainPreset[pid] || undefined);
    setNewChainName(prev => ({ ...prev, [pid]: "" }));
    setNewChainPreset(prev => ({ ...prev, [pid]: "" }));
  };

  return (
    <div className="w-56 bg-gray-100 h-screen flex flex-col border-r border-gray-200 shrink-0">
      {/* ... 标题 + 新建项目 + 项目列表 + 链子项 ... */}
      {/* 创建链行追加预设下拉 */}
      <form className="px-2 py-1 flex gap-1" onSubmit={(e) => { e.preventDefault(); handleCreateChain(p.id); }}>
        <select className="w-12 px-1 border border-gray-300 rounded text-xs"
          value={newChainPreset[p.id] || ""}
          onChange={e => setNewChainPreset(prev => ({...prev, [p.id]: e.target.value}))}>
          <option value="">--</option>
          {presets.map(pr => <option key={pr.name} value={pr.name}>{pr.name}</option>)}
        </select>
        <input className="flex-1 px-1 py-0.5 border border-gray-300 rounded text-xs"
          placeholder="New chain..." value={newChainName[p.id] || ""}
          onChange={e => setNewChainName(prev => ({...prev, [p.id]: e.target.value}))} />
      </form>

      {/* Sidebar 底部 */}
      <Link to="/tools/presets"
        className="block px-3 py-2 text-sm text-gray-500 border-t border-gray-200 hover:bg-gray-200">
        Presets
      </Link>
    </div>
  );
}
```

### 6c. 新路由

```tsx
<Route path="/tools/presets" element={<PresetsPage />} />
```

### 6d. PresetsPage 组件

```typescript
function PresetsPage() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [editOps, setEditOps] = useState<Operation[]>([]);
  const [editCategory, setEditCategory] = useState("");
  const nextId = useRef(0);
  const [opIds, setOpIds] = useState<string[]>([]);
  const [selectedOpIdx, setSelectedOpIdx] = useState<number | null>(null);

  const fetchPresets = () => { api.listPresets().then(setPresets); };
  useEffect(fetchPresets, []);

  const handleSave = () => {
    if (!editing) return;
    const category = editCategory.split(",").map(s => s.trim()).filter(Boolean);
    if (presets.some(p => p.name === editing)) {
      api.updatePreset(editing, { operations: editOps, category }).then(fetchPresets);
    } else {
      api.createPreset(editing, editOps, category).then(fetchPresets);
    }
    setEditing(null);
  };

  const handleDelete = (name: string) => {
    api.deletePreset(name).then(fetchPresets);
  };

  const handleEdit = (preset: Preset) => {
    setEditing(preset.name);
    setEditOps(preset.operations);
    setEditCategory(preset.category.join(", "));
    nextId.current = 0;
    setOpIds(preset.operations.map(() => `op-${nextId.current++}`));
    setSelectedOpIdx(null);
  };

  const handleCreate = () => {
    if (!newName.trim()) return;
    setEditing(newName.trim());
    setEditOps([]);
    setEditCategory("");
    setOpIds([]);
    setSelectedOpIdx(null);
    setNewName("");
  };

  if (editing) return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 border-b border-gray-200 flex items-center gap-2">
        <span className="font-semibold">{presets.some(p => p.name === editing) ? `Edit: ${editing}` : `New: ${editing}`}</span>
        <button onClick={handleSave} className="px-3 py-1 bg-blue-500 text-white rounded text-sm ml-auto">Save</button>
        <button onClick={() => setEditing(null)} className="px-3 py-1 border border-gray-300 rounded text-sm">Cancel</button>
      </div>
      <div className="px-4 py-2 border-b border-gray-200 text-sm flex gap-2">
        <span className="text-gray-500">Category:</span>
        <input className="flex-1 border border-gray-300 rounded px-2 py-0.5 text-sm"
          placeholder="comma,separated,tags" value={editCategory}
          onChange={e => setEditCategory(e.target.value)} />
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto p-4">
          {editOps.length === 0 ? (
            <div className="text-gray-400 text-center mt-8">No operations yet. Add one below.</div>
          ) : (
            <DndContext
              collisionDetection={closestCenter}
              onDragEnd={(e: DragEndEvent) => {
                const { active, over } = e;
                if (!over || active.id === over.id) return;
                const oldIdx = opIds.indexOf(active.id as string);
                const newIdx = opIds.indexOf(over.id as string);
                if (oldIdx < 0 || newIdx < 0) return;
                const nextOps = [...editOps];
                const [moved] = nextOps.splice(oldIdx, 1);
                nextOps.splice(newIdx, 0, moved);
                const nextIds = [...opIds];
                const [movedId] = nextIds.splice(oldIdx, 1);
                nextIds.splice(newIdx, 0, movedId);
                setEditOps(nextOps);
                setOpIds(nextIds);
              }}
            >
              <SortableContext items={opIds} strategy={verticalListSortingStrategy}>
                {editOps.map((op, i) => (
                  <SortableOpItem key={opIds[i]} id={opIds[i]} op={op}
                    isSelected={selectedOpIdx === i}
                    onSelect={() => setSelectedOpIdx(i)}
                    onDelete={() => {
                      setEditOps(editOps.filter((_, j) => j !== i));
                      setOpIds(opIds.filter((_, j) => j !== i));
                      if (selectedOpIdx === i) setSelectedOpIdx(null);
                    }} />
                ))}
              </SortableContext>
            </DndContext>
          )}
          <AddOpDropdown onAdd={(kind) => {
            const template = OP_KINDS.find(k => k.kind === kind);
            if (!template) return;
            const newOp: Operation = { kind, mode: template.mode, params: template.params as OperationParams };
            setEditOps([...editOps, newOp]);
            setOpIds([...opIds, `op-${nextId.current++}`]);
          }} />
        </div>
        <SchemaForm op={selectedOpIdx !== null ? editOps[selectedOpIdx] : null}
          onChange={(params) => {
            if (selectedOpIdx === null) return;
            setEditOps(editOps.map((op, i) => i === selectedOpIdx ? { ...op, params } : op) as Operation[]);
          }} />
      </div>
    </div>
  );

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-4">
        <h1 className="text-lg font-semibold">Presets</h1>
        <div className="flex gap-1 ml-auto">
          <input className="px-2 py-1 border border-gray-300 rounded text-sm w-40"
            placeholder="New preset name..." value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }} />
          <button onClick={handleCreate}
            className="px-3 py-1 bg-blue-500 text-white rounded text-sm">
            New
          </button>
        </div>
      </div>
      {presets.length === 0 ? (
        <p className="text-gray-400">No presets yet.</p>
      ) : (
        <div className="grid gap-2">
          {presets.map(p => (
            <div key={p.name} className="flex items-center border border-gray-200 rounded p-3 hover:bg-gray-50 cursor-pointer"
              onClick={() => handleEdit(p)}>
              <div className="flex-1">
                <div className="font-mono text-sm">{p.name}</div>
                <div className="text-xs text-gray-500">
                  {p.operations.length} ops
                  {p.category.length > 0 && ` | ${p.category.join(", ")}`}
                </div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); handleDelete(p.name); }}
                className="text-red-400 hover:text-red-600 text-xs">delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

## 步骤 7：验证

```bash
# terminal 1: 后端
cd backend && uv run uvicorn main:app --reload

# terminal 2: 前端
cd frontend && bun run dev
```

验证路径：
1. Sidebar 底部点击 Presets → /tools/presets 页面
2. 输入名称 → New → 编辑 operations（添加、拖拽、删除）
3. Save → 列表出现新预设
4. 进入项目 → 展开 → 创建链的下拉框有预设可选
5. 选预设 + 输入名称 → 回车 → 进入链编辑器（operations 已预填）
6. PresetsPage 中编辑/删除已有预设

## 变更清单

| 层 | 文件 | 改动 | 行数 |
|---|------|------|------|
| 后端 | `studio/models.py` | +PresetCreate/PresetUpdate + ChainCreate.from_preset | ~15 |
| 后端 | `main.py` | +5 preset routes + PRESETS_DIR + create_chain 支持 from_preset | ~85 |
| 前端 | `types.ts` | +Preset 类型 | ~4 |
| 前端 | `api.ts` | +4 preset 方法 + createChain 追加 fromPreset | ~25 |
| 前端 | `App.tsx` | Sidebar 预设下拉 + Presets 链接 + PresetsPage 组件 + 路由 + 全局 preset fetch | ~160 |

## 关键设计决策

| 决策 | 理由 |
|------|------|
| Preset JSON 非 YAML | 零新依赖，与 chain JSON 格式一致 |
| name 作主键 | JSON 文件名即标识，无 UUID |
| PATCH 不支持改名 | 删旧建新，与路由参数一致 |
| `from_preset` | ChainCreate 可选字段，创建时一次性拷贝 operations |
| 全局 presets 在 App 层 fetch | PresetsPage 和 Sidebar 共享，避免重复请求 |
| SchemaForm 复用 | 9 种 Operation 的 SchemaForm 零新 UI |
