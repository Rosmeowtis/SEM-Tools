import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { DndContext, type DragEndEvent, closestCenter } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { api, BASE } from "./api";
import type { Chain, Operation, OperationParams, Preset, Project, ResourceMeta, StudioEvent } from "./types";
import { OP_KINDS } from "./types";

function useEventStream(chainId: string | null, onEvent: (e: StudioEvent) => void) {
  useEffect(() => {
    if (!chainId) return;
    const es = new EventSource(`${BASE}/events?chain_id=${chainId}`);
    const handler = (e: MessageEvent) => onEvent(JSON.parse(e.data));
    es.addEventListener("preview.progress", handler);
    es.addEventListener("preview.complete", handler);
    es.addEventListener("preview.error", handler);
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId]);
}

function Sidebar({
  projects,
  presets,
  onDeleteProject,
  onCreateProject,
  onCreateChain,
  currentPid,
  onProjectsChanged,
  onChainsChanged,
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
  const [title, setTitle] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [chains, setChains] = useState<Record<string, Chain[]>>({});
  const [newChainName, setNewChainName] = useState<Record<string, string>>({});
  const [newChainPreset, setNewChainPreset] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [editingTags, setEditingTags] = useState<Record<string, string>>({});

  const filtered = projects.filter(p => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return p.title.toLowerCase().includes(q) || p.tags.toLowerCase().includes(q);
  });

  const fetchChains = useCallback((pid: string) => {
    api.listChains(pid).then((list) => {
      setChains((prev) => {
        const next = { ...prev, [pid]: list };
        onChainsChanged(next);
        return next;
      });
    });
  }, [onChainsChanged]);

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
    onCreateChain(pid, name, newChainPreset[pid] || undefined);
    setNewChainName(prev => ({ ...prev, [pid]: "" }));
    setNewChainPreset(prev => ({ ...prev, [pid]: "" }));
  };

  const handleDeleteChain = (pid: string, cid: string) => {
    api.deleteChain(pid, cid).then(() => fetchChains(pid));
  };

  return (
    <div className="w-56 bg-gray-100 h-screen flex flex-col border-r border-gray-200 shrink-0">
      <div className="p-3 font-semibold text-gray-800 border-b border-gray-200">
        SEM-Tools
      </div>
      <input
        className="mx-2 mt-2 mb-1 px-2 py-1 border border-gray-300 rounded text-sm"
        placeholder="Search..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
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
        {filtered.map((p) => (
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
                <div className="px-2 py-1">
                  <input
                    className="w-full px-1 py-0.5 border border-gray-200 rounded text-xs text-gray-500"
                    placeholder="tags: sem, porosity, ..."
                    value={editingTags[p.id] ?? p.tags}
                    onChange={e => {
                      setEditingTags(prev => ({ ...prev, [p.id]: e.target.value }));
                    }}
                    onBlur={e => {
                      const raw = e.target.value;
                      const normalized = raw.split(",").map(s => s.trim()).filter(Boolean).join(", ");
                      api.updateProject(p.id, { tags: normalized }).then(() => {
                        setEditingTags(prev => { const next = { ...prev }; delete next[p.id]; return next; });
                        onProjectsChanged();
                      }).catch(() => onProjectsChanged());
                    }}
                    onKeyDown={e => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                  />
                </div>
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
                  <select
                    className="w-12 px-1 border border-gray-300 rounded text-xs"
                    value={newChainPreset[p.id] || ""}
                    onChange={e => setNewChainPreset(prev => ({ ...prev, [p.id]: e.target.value }))}>
                    <option value="">--</option>
                    {presets.map(pr => <option key={pr.name} value={pr.name}>{pr.name}</option>)}
                  </select>
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
      <Link to="/tools/presets"
        className="block px-3 py-2 text-sm text-gray-500 border-t border-gray-200 hover:bg-gray-200">
        Presets
      </Link>
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

function ResourceChips({ resources, boundIds, selectedRid, onToggle, onSelect }: {
  resources: ResourceMeta[]; boundIds: string[]; selectedRid: string | null;
  onToggle: (sha1: string) => void;
  onSelect: (sha1: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 px-4 py-1 border-b border-gray-200 text-sm">
      <span className="text-gray-500 mr-1">Resources:</span>
      {resources.filter(r => boundIds.includes(r.sha1)).map(r => (
        <span key={r.sha1}
          onClick={() => onSelect(r.sha1)}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs cursor-pointer ${
            selectedRid === r.sha1 ? 'bg-blue-200 text-blue-800 ring-2 ring-blue-400' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
          }`}>
          {r.filename}
          <button onClick={(e) => { e.stopPropagation(); onToggle(r.sha1); }} className="hover:text-red-500">×</button>
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

function SchemaForm({ op, onChange }: {
  op: Operation | null;
  onChange: (params: Record<string, unknown>) => void;
}) {
  if (!op) return <div className="w-64 border-l border-gray-200 p-4 text-gray-400 text-sm">Select an operation</div>;
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
  const [previewTarget, setPreviewTarget] = useState<string | null>(null);
  const [previewGen, setPreviewGen] = useState(0);
  const [previewProgress, setPreviewProgress] = useState<number | null>(null);
  const [previewThumb, setPreviewThumb] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewDebounce = useRef<number | undefined>(undefined);
  const debounceRef = useRef<number | undefined>(undefined);

  const fetchChain = useCallback(() => { if (pid && cid) api.getChain(pid, cid).then(setChain); }, [pid, cid]);
  const fetchResources = useCallback(() => { if (pid) api.listResources(pid).then(setResources); }, [pid]);
  useEffect(() => { fetchChain(); fetchResources(); }, [fetchChain, fetchResources]);
  useEffect(() => { if (chain) { const ids = chain.operations.map(() => `op-${nextId.current++}`); setOpIds(ids); } }, [chain?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const saveAndPreview = useCallback((ops: Operation[]) => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (pid && cid) api.updateChain(pid, cid, { operations: ops }).then(setChain);
    }, 200);
    clearTimeout(previewDebounce.current);
    previewDebounce.current = setTimeout(() => {
      if (pid && cid && previewTarget) {
        setPreviewError(null);
        setPreviewGen(g => g + 1);
        api.requestPreview(pid, cid, previewTarget);
      }
    }, 300);
  }, [pid, cid, previewTarget]);

  useEventStream(cid ?? null, (e: StudioEvent) => {
    if (e.gen !== previewGen) return;
    if (e.type === "preview.progress") setPreviewProgress(e.progress);
    if (e.type === "preview.complete") { setPreviewProgress(null); setPreviewThumb(e.thumb_sha1); }
    if (e.type === "preview.error") { setPreviewProgress(null); setPreviewError(e.message); }
  });

  useEffect(() => { if (previewTarget) { clearTimeout(previewDebounce.current); previewDebounce.current = setTimeout(() => { if (pid && cid) { setPreviewError(null); setPreviewGen(g => g + 1); api.requestPreview(pid, cid, previewTarget); } }, 300); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewTarget]);

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
        selectedRid={previewTarget}
        onToggle={(sha1) => {
          const next = chain.resource_ids.includes(sha1)
            ? chain.resource_ids.filter(id => id !== sha1)
            : [...chain.resource_ids, sha1];
          api.updateChain(pid, cid, { resource_ids: next }).then(setChain);
        }}
        onSelect={(sha1) => setPreviewTarget(sha1)}
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
                saveAndPreview(nextOps);
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
                      saveAndPreview(next);
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
              params: template.params as OperationParams,
            };
            const nextOps = [...ops, newOp];
            setChain({ ...chain, operations: nextOps });
            setOpIds([...opIds, `op-${nextId.current++}`]);
            saveAndPreview(nextOps);
          }} />

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
        </div>

        <SchemaForm op={selectedOpIdx !== null ? ops[selectedOpIdx] : null}
          onChange={(params) => {
            if (selectedOpIdx === null) return;
            const nextOps = ops.map((op, i) =>
              i === selectedOpIdx ? { ...op, params } : op
            ) as Operation[];
            setChain({ ...chain, operations: nextOps });
            saveAndPreview(nextOps);
          }} />
      </div>
    </div>
  );
}

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

function CommandPalette({ projects, presets, chains, onCreateProject, onClose }: {
  projects: Project[];
  presets: Preset[];
  chains: Record<string, Chain[]>;
  onCreateProject: (title: string) => void;
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
    if (cmd.type === "action") onCreateProject("Untitled");
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

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [globalChains, setGlobalChains] = useState<Record<string, Chain[]>>({});
  const navigate = useNavigate();
  const location = useLocation();
  const currentPid = location.pathname.split("/")[2];

  const fetchProjects = () => {
    api.listProjects().then(setProjects).catch(console.error);
  };

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

  const handleCreateChain = (pid: string, name: string, fromPreset?: string) => {
    api.createChain(pid, name, fromPreset).then((c) => {
      navigate(`/projects/${pid}/chains/${c.id}`);
    });
  };

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
          <Route path="/" element={<HomePage />} />
          <Route path="/projects/:pid" element={<ResourcesPage />} />
          <Route path="/projects/:pid/chains/:cid" element={<ChainEditorPage />} />
          <Route path="/tools/presets" element={<PresetsPage />} />
        </Routes>
      </div>
      {paletteOpen && (
        <CommandPalette
          projects={projects}
          presets={presets}
          chains={globalChains}
          onCreateProject={handleCreateProject}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}
