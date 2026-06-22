import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { DndContext, type DragEndEvent, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { api } from "../api";
import type { Chain, Operation, OperationParams } from "../types";
import { OP_KINDS } from "../types";
import { ChainTitle } from "./ChainTitle";
import { SortableOpItem } from "./SortableOpItem";
import { SchemaForm } from "./SchemaForm";
import { AddOpDropdown } from "./AddOpDropdown";
import { ResultsHandle } from "./ResultsHandle";

export function ChainEditorPage() {
  const { pid, cid } = useParams<{ pid: string; cid: string }>();
  const [chain, setChain] = useState<Chain | null>(null);
  const nextId = useRef(0);
  const [opIds, setOpIds] = useState<string[]>([]);
  const [selectedOpIdx, setSelectedOpIdx] = useState<number | null>(null);
  const [execResult, setExecResult] = useState<{ images: { filename: string; index: number }[]; analysis: Record<string, unknown> } | null>(null);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [resultsHeight, setResultsHeight] = useState(300);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  const fetchChain = useCallback(() => { if (pid && cid) api.getChain(pid, cid).then(setChain); }, [pid, cid]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchChain(); setExecResult(null); setResultsOpen(false); }, [fetchChain]);
  useEffect(() => { if (chain) { const ids = chain.operations.map(() => `op-${nextId.current++}`); setOpIds(ids); } }, [chain?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  useEffect(() => {
    if (chain && pid) {
      api.listResources(pid).then(res => {
        const ids = res.map(r => r.sha1);
        const sortedNew = [...ids].sort();
        const sortedCur = [...chain.resource_ids].sort();
        if (sortedNew.length > 0 && JSON.stringify(sortedNew) !== JSON.stringify(sortedCur)) {
          api.updateChain(pid, chain.id, { resource_ids: ids }).then(setChain);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain?.id, pid]);

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
      <div className="flex items-center px-4 py-2 border-b border-gray-200">
        <ChainTitle chain={chain} onRename={(name) => { if (pid && cid) api.updateChain(pid, cid, { name }).then(setChain); }} />
        <div className="flex gap-2 ml-auto">
          <button className="px-4 py-1.5 bg-blue-500 text-white rounded text-sm font-medium hover:bg-blue-600"
            onClick={() => { if (pid && cid) api.executeChain(pid, cid).then(r => { setExecResult(r); setResultsOpen(true); }); }}>
            Execute
          </button>
          <button className="px-4 py-1.5 bg-green-500 text-white rounded text-sm font-medium hover:bg-green-600"
            onClick={() => {
              fetch(api.exportUrl(pid!, cid!), { method: "POST" }).then(r => r.blob()).then(blob => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url; a.download = `${chain.name}-export.zip`;
                a.click(); URL.revokeObjectURL(url);
              });
            }}>
            Export
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto p-4">
          {ops.length === 0 ? (
            <div className="text-gray-400 text-center mt-8">No operations yet. Add one below.</div>
          ) : (
            <DndContext collisionDetection={closestCenter} onDragEnd={(e: DragEndEvent) => {
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
            }}>
              <SortableContext items={opIds} strategy={verticalListSortingStrategy}>
                {ops.map((op, i) => (
                  <SortableOpItem key={opIds[i]} id={opIds[i]} op={op} isSelected={selectedOpIdx === i} onSelect={() => setSelectedOpIdx(i)}
                    onDelete={() => {
                      const next = ops.filter((_, j) => j !== i);
                      const nextIds = opIds.filter((_, j) => j !== i);
                      setChain({ ...chain, operations: next });
                      setOpIds(nextIds);
                      saveOps(next);
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
            const nextOps = [...ops, newOp];
            setChain({ ...chain, operations: nextOps });
            setOpIds([...opIds, `op-${nextId.current++}`]);
            saveOps(nextOps);
          }} />
        </div>

        <SchemaForm op={selectedOpIdx !== null ? ops[selectedOpIdx] : null} onChange={(params) => {
          if (selectedOpIdx === null) return;
          const nextOps = ops.map((op, i) => i === selectedOpIdx ? { ...op, params } : op) as Operation[];
          setChain({ ...chain, operations: nextOps });
          saveOps(nextOps);
        }} />
      </div>

      {execResult && (
        <div className="border-t border-gray-200 shrink-0">
          <button className="w-full flex items-center gap-1 px-4 py-1.5 text-xs text-gray-500 hover:bg-gray-50" onClick={() => setResultsOpen(o => !o)}>
            <span>{resultsOpen ? "▼" : "▶"}</span> Results ({execResult.images.length})
          </button>
          {resultsOpen && (
            <div className="bg-gray-50 border-t border-gray-100" style={{ height: resultsHeight }}>
              <ResultsHandle onResize={setResultsHeight} />
              <div className="px-4 py-2 overflow-auto" style={{ height: resultsHeight - 6 }}>
                {execResult.analysis && Object.keys(execResult.analysis).length > 0 && (
                  <div className="mb-2">
                    <div className="text-xs font-semibold text-gray-600 mb-1">Analysis</div>
                    <pre className="text-xs text-gray-700 whitespace-pre-wrap">{JSON.stringify(execResult.analysis, null, 2)}</pre>
                  </div>
                )}
                <div className="flex gap-2 overflow-x-auto">
                  {execResult.images.map(img => (
                    <div key={img.index} className="shrink-0">
                      <img src={api.executeThumbUrl(pid!, cid!, img.index)} className="h-24 w-auto border rounded bg-white cursor-pointer hover:ring-2 hover:ring-blue-400"
                        alt={img.filename} onClick={() => setLightboxIdx(img.index)} />
                      <div className="text-xs text-gray-500 truncate w-20">{img.filename}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {lightboxIdx !== null && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center" onClick={() => setLightboxIdx(null)}>
          <img src={api.executeFullUrl(pid!, cid!, lightboxIdx)} className="max-w-[90vw] max-h-[90vh] object-contain" onClick={e => e.stopPropagation()} alt="Full" />
        </div>
      )}
    </div>
  );
}
