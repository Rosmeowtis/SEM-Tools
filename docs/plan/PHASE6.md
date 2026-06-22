# Phase 6 实施计划：标签管理 + 搜索 + CommandPalette

## 概要

Phase 6 目标：标签管理（项目 tags）+ Sidebar 搜索 + CommandPalette（Ctrl+K 全局导航）。三个功能合并实现，后端增 tags 列 + 前端 Sidebar 搜索/标签编辑 + CommandPalette。

## 步骤 1：后端 database.py

### `backend/database.py` 改动

`init_db()` 中 projects 表定义追加 `tags TEXT DEFAULT ''`：

```sql
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    note TEXT DEFAULT '',
    tags TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

`update_project` 函数扩签名：

```python
def update_project(pid: str, title: str | None, note: str | None,
                   tags: str | None, ts: str) -> dict | None:
    conn = get_db()
    existing = conn.execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone()
    if not existing:
        conn.close()
        return None
    new_title = title if title is not None else existing["title"]
    new_note = note if note is not None else existing["note"]
    new_tags = tags if tags is not None else existing.get("tags", "")
    new_slug = existing["slug"]
    if title is not None:
        from studio.models import slugify
        new_slug = slugify(new_title)
    conn.execute(
        "UPDATE projects SET title=?, note=?, slug=?, tags=?, updated_at=? WHERE id=?",
        (new_title, new_note, new_slug, new_tags, ts, pid),
    )
    conn.commit()
    conn.close()
    return {"id": pid, "slug": new_slug, "title": new_title, "note": new_note,
            "tags": new_tags, "created_at": existing["created_at"], "updated_at": ts}
```

## 步骤 2：后端 studio/models.py

### `backend/studio/models.py` 改动

```python
class ProjectUpdate(BaseModel):
    title: str | None = None
    note: str | None = None
    tags: str | None = None

class Project(BaseModel):
    id: str
    slug: str
    title: str
    note: str
    tags: str = ""
    created_at: str
    updated_at: str
```

## 步骤 3：后端 main.py

### `backend/main.py`——patch_project 传入 tags

```python
@app.patch("/api/projects/{pid}")
def patch_project(pid: str, data: ProjectUpdate):
    p = db_update_project(pid, data.title, data.note, data.tags, now())
    if not p:
        raise HTTPException(404, "Project not found")
    return p
```

## 步骤 4：前端 types.ts

### `frontend/src/types.ts`——Project 追加 tags

```typescript
export interface Project {
  id: string;
  slug: string;
  title: string;
  note: string;
  tags: string;
  created_at: string;
  updated_at: string;
}
```

## 步骤 5：前端 api.ts

### `frontend/src/api.ts`——updateProject 支持 tags

```typescript
updateProject: (pid: string, data: { title?: string; note?: string; tags?: string }) =>
  req<Project>(`/projects/${pid}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }),
```

## 步骤 6：前端 App.tsx

### 6a. Sidebar——搜索框 + 标签编辑 + 链数据返回

**修改 Sidebar 的 props 签名**，追加 `onProjectsChanged` 和 `onChainsChanged`：

```typescript
function Sidebar({
  projects, presets, onDeleteProject, onCreateProject, onCreateChain, currentPid,
  onProjectsChanged, onChannelsChanged,
}: {
  projects: Project[];
  presets: Preset[];
  onDeleteProject: (pid: string) => void;
  onCreateProject: (title: string) => void;
  onCreateChain: (pid: string, name: string, fromPreset?: string) => void;
  currentPid?: string;
  onProjectsChanged: () => void;
  onChainsChanged: (chains: Record<string, Chain[]>) => void;
}) {
  const [search, setSearch] = useState("");
  const [allChains, setAllChains] = useState<Record<string, Chain[]>>({});

  // 同步链数据到 App
  useEffect(() => { onChainsChanged(allChains); }, [allChains]);

  const filtered = projects.filter(p => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return p.title.toLowerCase().includes(q) || p.tags.toLowerCase().includes(q);
  });
```

**SEM-Tools 标题下加搜索框**：

```tsx
<div className="p-3 font-semibold text-gray-800 border-b border-gray-200">SEM-Tools</div>

<input
  className="mx-2 mt-2 mb-1 px-2 py-1 border border-gray-300 rounded text-sm"
  placeholder="Search..."
  value={search}
  onChange={e => setSearch(e.target.value)}
/>
```

**项目展开区内加标签编辑**（链子项上方）：

```tsx
{expanded[p.id] && (
  <div className="pl-7 border-l border-gray-200 ml-3">
    <div className="px-2 py-1">
      <input
        className="w-full px-1 py-0.5 border border-gray-200 rounded text-xs text-gray-500"
        placeholder="tags: sem, porosity, ..."
        value={p.tags}
        onChange={e => {
          setProjects(prev => prev.map(pr =>
            pr.id === p.id ? { ...pr, tags: e.target.value } : pr
          ));
        }}
        onBlur={e => {
          const normalized = e.target.value.split(",").map(s => s.trim()).filter(Boolean).join(", ");
          api.updateProject(p.id, { tags: normalized })
            .then(() => onProjectsChanged())
            .catch(() => onProjectsChanged());
        }}
        onKeyDown={e => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
    {/* ... 链子项 + 创建链表单（不变） ... */}
  </div>
)}
```

### 6b. CommandPalette 组件

```typescript
function CommandPalette({ projects, presets, chains, onClose }: {
  projects: Project[];
  presets: Preset[];
  chains: Record<string, Chain[]>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const commands = [
    { label: "Create Project", type: "action" as const, keywords: "new project" },
    { label: "Presets", type: "route" as const, path: "/tools/presets", keywords: "presets manage" },
    ...projects.map(p => ({
      label: `Project: ${p.title}`, type: "route" as const,
      path: `/projects/${p.id}`, keywords: p.title + " " + p.tags,
    })),
    ...Object.entries(chains).flatMap(([pid, cs]) =>
      cs.map(c => ({
        label: `Chain: ${c.name}`, type: "route" as const,
        path: `/projects/${pid}/chains/${c.id}`, keywords: c.name,
      }))
    ),
    ...presets.map(p => ({
      label: `Preset: ${p.name}`, type: "route" as const,
      path: "/tools/presets", keywords: p.name + " " + p.category.join(" "),
    })),
  ];

  const filtered = commands
    .filter(c => c.label.toLowerCase().includes(query.toLowerCase()) ||
                 c.keywords.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 12);

  const execute = (cmd: typeof filtered[0]) => {
    if (!cmd) return;
    if (cmd.type === "route") navigate(cmd.path);
    if (cmd.type === "action") {
      api.createProject("Untitled").then(p => navigate(`/projects/${p.id}`));
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center pt-[15vh]"
      onClick={onClose}>
      <div className="bg-white rounded-lg shadow-2xl w-[500px] max-h-[400px] overflow-hidden border"
        onClick={e => e.stopPropagation()}>
        <input ref={inputRef}
          className="w-full px-4 py-3 text-lg border-b border-gray-200 outline-none"
          placeholder="Type a command or search..."
          value={query}
          onChange={e => { setQuery(e.target.value); setSelectedIdx(0); }}
          onKeyDown={e => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, filtered.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
            if (e.key === "Enter") execute(filtered[selectedIdx]);
          }} />
        <div className="overflow-auto max-h-[300px]">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-gray-400 text-sm text-center">No results</div>
          ) : (
            filtered.map((c, i) => (
              <div key={i}
                className={`px-4 py-2 text-sm cursor-pointer flex items-center gap-2 ${
                  i === selectedIdx ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'
                }`}
                onClick={() => execute(c)}>
                <span className="text-gray-400 text-xs w-4">
                  {c.type === "action" ? "+" : c.label.startsWith("Project") ? "P" : c.label.startsWith("Preset") ? "R" : "C"}
                </span>
                {c.label}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
```

### 6c. App 组件——键盘事件 + 状态传递

```typescript
export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [globalChains, setGlobalChains] = useState<Record<string, Chain[]>>({});
  const navigate = useNavigate();
  const location = useLocation();
  const currentPid = location.pathname.split("/")[2];

  const fetchProjects = () => { api.listProjects().then(setProjects).catch(console.error); };
  useEffect(fetchProjects, []);
  useEffect(() => { api.listPresets().then(setPresets); }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen(prev => !prev);
      }
      if (e.key === "Escape" && paletteOpen) setPaletteOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [paletteOpen]);

  // ...

  return (
    <div className="flex h-screen">
      <Sidebar
        projects={projects}
        presets={presets}
        onDeleteProject={handleDeleteProject}
        onCreateProject={handleCreateProject}
        onCreateChain={handleCreateChain}
        currentPid={currentPid}
        onProjectsChanged={fetchProjects}
        onChainsChanged={setGlobalChains}
      />
      <div className="flex-1 overflow-auto">
        <Routes>
          {/* ... 现有路由 ... */}
        </Routes>
      </div>
      {paletteOpen && (
        <CommandPalette
          projects={projects}
          presets={presets}
          chains={globalChains}
          onClose={() => setPaletteOpen(false)}
        />
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
1. 进入项目 → 展开 → 看到 tags 输入框
2. 输入 "sem, porosity" → Enter/失去焦点 → tags 保存
3. Sidebar 搜索框输入 "porosity" → 过滤出包含该标签的项目
4. Ctrl+K → CommandPalette 弹出
5. 输入项目名/链名/预设名 → 过滤并选中 → Enter 导航
6. 方向键上下移动 → 选中项高亮
7. Escape 关闭 CP

## 变更清单

| 层 | 文件 | 改动 | 行数 |
|---|------|------|------|
| 后端 | `database.py` | projects 表 +tags + update_project 扩签名 | ~12 |
| 后端 | `studio/models.py` | ProjectUpdate.tags + Project.tags | ~4 |
| 后端 | `main.py` | patch_project 传入 data.tags | ~2 |
| 前端 | `types.ts` | Project.tags | ~1 |
| 前端 | `api.ts` | updateProject 支持 tags | ~4 |
| 前端 | `App.tsx` | Sidebar 搜索+标签编辑 + CommandPalette + App 键盘+链数据 | ~150 |

## 关键设计决策

| 决策 | 理由 |
|------|------|
| tags 逗号分隔 TEXT | 对标 Preset.category，SQLite TEXT 列无额外表 |
| 搜索全前端过滤 | 项目数 <100，`.filter()` 即时 |
| CP 自导航 useNavigate() | 零 prop 传递，组件内部直接导引 |
| 链数据提升到 App | CP 需要全局链数据，Sidebar 返回 chains |
| Enter → blur → onBlur 保存 | 规范化流程：Enter 触发 blur，blur 时 trim+保存+回滚 |
