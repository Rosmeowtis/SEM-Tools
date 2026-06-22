import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { DndContext, type DragEndEvent, closestCenter } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { api } from "./api";
import type { Chain, Operation, Project, ResourceMeta } from "./types";
import { OP_KINDS } from "./types";

function Sidebar({
  projects,
  onDeleteProject,
  onCreateProject,
  currentPid,
}: {
  projects: Project[];
  onDeleteProject: (pid: string) => void;
  onCreateProject: (title: string) => void;
  currentPid?: string;
}) {
  const [title, setTitle] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [chains, setChains] = useState<Record<string, Chain[]>>({});
  const [newChainName, setNewChainName] = useState<Record<string, string>>({});
  const navigate = useNavigate();

  const fetchChains = useCallback((pid: string) => {
    api.listChains(pid).then((list) => setChains((prev) => ({ ...prev, [pid]: list })));
  }, []);

  const handleToggleExpand = (pid: string) => {
    setExpanded((prev) => {
      const next = !prev[pid];
      if (next) fetchChains(pid);
      return { ...prev, [pid]: next };
    });
  };

  const handleCreateChain = (pid: string) => {
    const name = newChainName[pid]?.trim();
    if (!name) return;
    api.createChain(pid, name).then((chain) => {
      setNewChainName((prev) => ({ ...prev, [pid]: "" }));
      fetchChains(pid);
      navigate(`/projects/${pid}/chains/${chain.id}`);
    });
  };

  const handleDeleteChain = (pid: string, cid: string) => {
    api.deleteChain(pid, cid).then(() => fetchChains(pid));
  };

  return (
    <div className="w-56 bg-gray-100 h-screen flex flex-col border-r border-gray-200 shrink-0">
      <div className="p-3 font-semibold text-gray-800 border-b border-gray-200">
        SEM-Tools
      </div>
      <form
        className="p-2 flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) {
            onCreateProject(title.trim());
            setTitle("");
          }
        }}
      >
        <input
          className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
          placeholder="New project..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button
          type="submit"
          className="px-2 py-1 bg-blue-500 text-white rounded text-sm"
        >
          +
        </button>
      </form>
      <div className="flex-1 overflow-auto">
        {projects.map((p) => (
          <div key={p.id}>
            <div
              className={`flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-200 ${
                p.id === currentPid && !expanded[p.id] ? "bg-blue-100" : ""
              }`}
            >
              <div className="flex items-center gap-1 min-w-0 flex-1">
                <button
                  className="text-gray-400 hover:text-gray-600 shrink-0"
                  onClick={() => handleToggleExpand(p.id)}
                >
                  {expanded[p.id] ? "▼" : "▶"}
                </button>
                <Link
                  to={`/projects/${p.id}`}
                  className="truncate hover:underline"
                >
                  {p.title}
                </Link>
              </div>
              <button
                className="text-red-400 hover:text-red-600 ml-1 shrink-0"
                onClick={(e) => {
                  e.preventDefault();
                  onDeleteProject(p.id);
                }}
                title="Delete"
              >
                x
              </button>
            </div>
            {expanded[p.id] && (
              <div className="pl-7 border-l border-gray-200 ml-3">
                {(chains[p.id] || []).map((c) => (
                  <Link
                    key={c.id}
                    to={`/projects/${p.id}/chains/${c.id}`}
                    className="flex items-center justify-between px-2 py-1 text-sm hover:bg-gray-200"
                  >
                    <span className="truncate text-gray-700">{c.name}</span>
                    <button
                      className="text-red-400 hover:text-red-600 shrink-0 text-xs"
                      onClick={(e) => {
                        e.preventDefault();
                        handleDeleteChain(p.id, c.id);
                      }}
                    >
                      x
                    </button>
                  </Link>
                ))}
                <form
                  className="px-2 py-1 flex gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleCreateChain(p.id);
                  }}
                >
                  <input
                    className="flex-1 px-1 py-0.5 border border-gray-300 rounded text-xs"
                    placeholder="New chain..."
                    value={newChainName[p.id] || ""}
                    onChange={(e) =>
                      setNewChainName((prev) => ({ ...prev, [p.id]: e.target.value }))
                    }
                  />
                </form>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function HomePage() {
  return (
    <div className="flex items-center justify-center h-full text-gray-400">
      Select a project or create a new one
    </div>
  );
}

function ResourcesPage() {
  const { pid } = useParams<{ pid: string }>();
  const [resources, setResources] = useState<ResourceMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchResources = () => {
    if (!pid) return;
    setLoading(true);
    api
      .listResources(pid)
      .then(setResources)
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(fetchResources, [pid]);

  if (!pid) return <Navigate to="/" />;

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setProgress(0);
    api
      .uploadResource(pid, file, setProgress)
      .then(() => {
        fetchResources();
      })
      .catch(console.error)
      .finally(() => {
        setUploading(false);
        setProgress(0);
        e.target.value = "";
      });
  };

  const handleDelete = (sha1: string) => {
    api.deleteResource(pid, sha1).then(fetchResources);
  };

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center gap-3">
        <button
          className="px-3 py-1 bg-blue-500 text-white rounded text-sm"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? `Uploading ${progress}%` : "Upload Image"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleUpload}
        />
        {uploading && (
          <div className="h-2 flex-1 max-w-xs bg-gray-200 rounded overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-gray-400">Loading...</p>
      ) : resources.length === 0 ? (
        <p className="text-gray-400">No resources yet. Upload an image.</p>
      ) : (
        <div className="grid grid-cols-4 gap-3">
          {resources.map((r) => (
            <div key={r.sha1} className="border border-gray-200 rounded overflow-hidden group">
              <img
                src={api.thumbUrl(pid, r.sha1)}
                alt={r.filename}
                className="w-full h-32 object-cover bg-gray-100"
              />
              <div className="p-2 text-xs text-gray-600 flex justify-between items-center">
                <span className="truncate">{r.filename}</span>
                <button
                  className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => handleDelete(r.sha1)}
                >
                  del
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChainTitle({ chain, onRename }: {
  chain: Chain; onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(chain.name);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setName(chain.name); }, [chain.name]);

  if (editing) return (
    <input
      className="px-4 py-2 text-lg font-semibold border-b border-gray-200 outline-none"
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
        onChange={(e) => { if (e.target.value) { onToggle(e.target.value); e.target.value = ""; } }}>
        <option value="">+ Bind</option>
        {resources.filter(r => !boundIds.includes(r.sha1)).map(r => (
          <option key={r.sha1} value={r.sha1}>{r.filename}</option>
        ))}
      </select>
    </div>
  );
}

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
            value={(op.params as Record<string, unknown>)[key] as number} onChange={e => onChange({ ...op.params, [key]: Number(e.target.value) })} />
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
            value={(op.params as Record<string, unknown>)[key] as number} onChange={e => onChange({ ...op.params, [key]: Number(e.target.value) })} />
        </div>
      ))}
      <div className="mb-2">
        <label className="text-xs text-gray-500 block">Algorithm</label>
        <select className="w-full border border-gray-300 rounded px-2 py-0.5 text-sm"
          value={(op.params as Record<string, unknown>).algorithm as string} onChange={e => onChange({ ...op.params, algorithm: e.target.value })}>
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
          value={(op.params as Record<string, unknown>).type as string} onChange={e => onChange({ ...op.params, type: e.target.value })}>
          <option value="porosity">porosity</option>
          <option value="statistics">statistics</option>
          <option value="distribution">distribution</option>
        </select>
      </div>
    </div>
  );

  return null;
}

function AddOpDropdown({ onAdd }: { onAdd: (kind: Operation["kind"]) => void }) {
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

function ChainEditorPage() {
  const { pid, cid } = useParams<{ pid: string; cid: string }>();
  const [chain, setChain] = useState<Chain | null>(null);
  const [resources, setResources] = useState<ResourceMeta[]>([]);
  const nextId = useRef(0);
  const [opIds, setOpIds] = useState<string[]>([]);
  const [selectedOpIdx, setSelectedOpIdx] = useState<number | null>(null);
  const [previewRid, setPreviewRid] = useState<string | null>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  const fetchChain = useCallback(() => { if (pid && cid) api.getChain(pid, cid).then(setChain); }, [pid, cid]);
  const fetchResources = useCallback(() => { if (pid) api.listResources(pid).then(setResources); }, [pid]);
  useEffect(() => { fetchChain(); fetchResources(); }, [fetchChain, fetchResources]);
  useEffect(() => { if (chain) { const ids = chain.operations.map(() => `op-${nextId.current++}`); setOpIds(ids); } }, [chain?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const saveOps = useCallback((ops: Operation[]) => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (pid && cid) api.updateChain(pid, cid, { operations: ops }).then(setChain);
    }, 200);
  }, [pid, cid]);

  if (!pid || !cid) return <Navigate to="/" />;
  if (!chain) return <p className="p-4 text-gray-400">Loading...</p>;

  const ops = chain.operations;

  return (
    <div className="flex flex-col h-full">
      <ChainTitle chain={chain} onRename={(name) => {
        if (pid && cid) api.updateChain(pid, cid, { name }).then(setChain);
      }} />

      <ResourceChips
        resources={resources}
        boundIds={chain.resource_ids}
        onToggle={(sha1) => {
          const next = chain.resource_ids.includes(sha1)
            ? chain.resource_ids.filter(id => id !== sha1)
            : [...chain.resource_ids, sha1];
          api.updateChain(pid, cid, { resource_ids: next }).then(setChain);
        }}
      />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto p-4">
          {ops.length === 0 ? (
            <div className="text-gray-400 text-center mt-8">
              No operations yet. Add one below.
            </div>
          ) : (
            <DndContext
              collisionDetection={closestCenter}
              onDragEnd={(e: DragEndEvent) => {
                const { active, over } = e;
                if (!over || active.id === over.id) return;
                const oldIdx = opIds.indexOf(active.id as string);
                const newIdx = opIds.indexOf(over.id as string);
                if (oldIdx < 0 || newIdx < 0) return;
                const nextOps = [...ops];
                const [moved] = nextOps.splice(oldIdx, 1);
                nextOps.splice(newIdx, 0, moved);
                const nextIds = [...opIds];
                const [movedId] = nextIds.splice(oldIdx, 1);
                nextIds.splice(newIdx, 0, movedId);
                setChain({ ...chain, operations: nextOps });
                setOpIds(nextIds);
                saveOps(nextOps);
              }}
            >
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

          <AddOpDropdown onAdd={(kind) => {
            const template = OP_KINDS.find(k => k.kind === kind);
            if (!template) return;
            const newOp: Operation = {
              kind,
              mode: template.mode,
              params: template.params,
            };
            const nextOps = [...ops, newOp];
            setChain({ ...chain, operations: nextOps });
            setOpIds([...opIds, `op-${nextId.current++}`]);
            saveOps(nextOps);
          }} />

          {ops.length > 0 && chain.resource_ids.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <button className="px-3 py-1 bg-blue-500 text-white rounded text-sm"
                onClick={() => setPreviewRid(chain.resource_ids[0])}>
                Preview
              </button>
              {previewRid && (
                <img src={api.previewUrl(pid, cid, previewRid)}
                  className="mt-2 max-w-full h-48 object-contain border rounded bg-gray-50"
                  alt="Preview" />
              )}
            </div>
          )}
        </div>

        <Inspector op={selectedOpIdx !== null ? ops[selectedOpIdx] : null}
          onChange={(params) => {
            if (selectedOpIdx === null) return;
            const nextOps = ops.map((op, i) =>
              i === selectedOpIdx ? { ...op, params } : op
            ) as Operation[];
            setChain({ ...chain, operations: nextOps });
            saveOps(nextOps);
          }} />
      </div>
    </div>
  );
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const navigate = useNavigate();
  const location = useLocation();
  const currentPid = location.pathname.split("/")[2];

  const fetchProjects = () => {
    api.listProjects().then(setProjects).catch(console.error);
  };

  useEffect(fetchProjects, []);

  const handleCreateProject = (title: string) => {
    api.createProject(title).then((p) => {
      fetchProjects();
      navigate(`/projects/${p.id}`);
    });
  };

  const handleDeleteProject = (pid: string) => {
    api.deleteProject(pid).then(() => {
      fetchProjects();
      if (currentPid === pid) navigate("/");
    });
  };

  return (
    <div className="flex h-screen">
      <Sidebar
        projects={projects}
        onDeleteProject={handleDeleteProject}
        onCreateProject={handleCreateProject}
        currentPid={currentPid}
      />
      <div className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/projects/:pid" element={<ResourcesPage />} />
          <Route path="/projects/:pid/chains/:cid" element={<ChainEditorPage />} />
        </Routes>
      </div>
    </div>
  );
}
