/** 预设管理页面。创建/编辑/删除可复用的操作链模板。

编辑器布局与 ChainEditorPage 一致：左列表 + 右侧 SchemaForm 参数编辑，
支持拖拽排序、添加/删除操作、保存到服务器。
*/
import { useEffect, useRef, useState } from "react";
import { DndContext, type DragEndEvent, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { api } from "../api";
import type { Operation, OperationParams, Preset } from "../types";
import { OP_KINDS } from "../types";
import { SortableOpItem } from "./SortableOpItem";
import { SchemaForm } from "./SchemaForm";
import { AddOpPicker } from "./AddOpPicker";

export function PresetsPage({ onPresetsChange }: { onPresetsChange?: () => void }) {
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
    const save = presets.some(p => p.name === editing)
      ? api.updatePreset(editing, { operations: editOps, category })
      : api.createPreset(editing, editOps, category);
    save
      .then(() => { fetchPresets(); onPresetsChange?.(); setEditing(null); })
      .catch((e: Error) => alert("Save failed: " + e.message));
  };

  const handleDelete = (name: string) => {
    api.deletePreset(name).then(() => { fetchPresets(); onPresetsChange?.(); });
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
        <input className="flex-1 border border-gray-300 rounded px-2 py-0.5 text-sm" placeholder="comma,separated,tags" value={editCategory} onChange={e => setEditCategory(e.target.value)} />
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto p-4">
          {editOps.length === 0 ? (
            <div className="text-gray-400 text-center mt-8">No operations yet. Add one below.</div>
          ) : (
            <DndContext collisionDetection={closestCenter} onDragEnd={(e: DragEndEvent) => {
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
            }}>
              <SortableContext items={opIds} strategy={verticalListSortingStrategy}>
                {editOps.map((op, i) => (
                  <SortableOpItem key={opIds[i]} id={opIds[i]} op={op} isSelected={selectedOpIdx === i} onSelect={() => setSelectedOpIdx(i)}
                    onDelete={() => { setEditOps(editOps.filter((_, j) => j !== i)); setOpIds(opIds.filter((_, j) => j !== i)); if (selectedOpIdx === i) setSelectedOpIdx(null); }} />
                ))}
              </SortableContext>
            </DndContext>
          )}
          <AddOpPicker onAdd={(kind) => {
            const template = OP_KINDS.find(k => k.kind === kind);
            if (!template) return;
            const newOp: Operation = { kind, mode: template.mode, params: template.params as OperationParams, enabled: true };
            setEditOps([...editOps, newOp]);
            setOpIds([...opIds, `op-${nextId.current++}`]);
          }} />
        </div>
        <SchemaForm op={selectedOpIdx !== null ? editOps[selectedOpIdx] : null} onChange={(params) => {
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
          <input className="px-2 py-1 border border-gray-300 rounded text-sm w-40" placeholder="New preset name..." value={newName}
            onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }} />
          <button onClick={handleCreate} className="px-3 py-1 bg-blue-500 text-white rounded text-sm">New</button>
        </div>
      </div>
      {presets.length === 0 ? (
        <p className="text-gray-400">No presets yet.</p>
      ) : (
        <div className="grid gap-2">
          {presets.map(p => (
            <div key={p.name} className="flex items-center border border-gray-200 rounded p-3 hover:bg-gray-50 cursor-pointer" onClick={() => handleEdit(p)}>
              <div className="flex-1">
                <div className="font-mono text-sm">{p.name}</div>
                <div className="text-xs text-gray-500">{p.operations.length} ops{p.category.length > 0 && ` | ${p.category.join(", ")}`}</div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); handleDelete(p.name); }} className="text-red-400 hover:text-red-600 text-xs">delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
