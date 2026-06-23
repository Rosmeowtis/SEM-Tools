/** Chain 编辑器。

核心页面：居中显示执行结果图片，右侧边栏显示操作列表（拖拽排序）和参数编辑表单。

- 管道式执行：map 变换图像 / reduce 采集状态到 ChainState
- 结果图片通过 execute-thumb/full URL 加载，使用 execRev 缓存破坏防止浏览器缓存
- 灯箱模式支持单图、左右对照、半透明叠层三种查看方式
*/
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

export function ChainEditorPage() {
  const { pid, cid } = useParams<{ pid: string; cid: string }>();
  const [chain, setChain] = useState<Chain | null>(null);
  const nextId = useRef(0);
  const [opIds, setOpIds] = useState<string[]>([]);
  const [selectedOpIdx, setSelectedOpIdx] = useState<number | null>(null);
  const [execResult, setExecResult] = useState<{ images: { filename: string; index: number }[]; analysis: Record<string, unknown> } | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [compareMode, setCompareMode] = useState<"off" | "side" | "overlay">("overlay");
  const [overlayOpacity, setOverlayOpacity] = useState(50);
  const debounceRef = useRef<number | undefined>(undefined);
  const origRef = useRef<HTMLImageElement>(null);
  const [origSize, setOrigSize] = useState<{ w: number; h: number } | null>(null);
  const [rightWidth, setRightWidth] = useState(320);
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const [execRev, setExecRev] = useState(0);

  const fetchChain = useCallback(() => { if (pid && cid) api.getChain(pid, cid).then(setChain); }, [pid, cid]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchChain(); setExecResult(null); }, [fetchChain]);
  useEffect(() => { if (chain) { const ids = chain.operations.map(() => `op-${nextId.current++}`); setOpIds(ids); } }, [chain?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(debounceRef.current), []);
  useEffect(() => { setOrigSize(null); }, [lightboxIdx]); // eslint-disable-line react-hooks/set-state-in-effect

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

  const ops = chain?.operations ?? []; // eslint-disable-line react-hooks/exhaustive-deps

  const resourceSHA = lightboxIdx !== null && chain ? chain.resource_ids[lightboxIdx] : "";

  const cropPct = useMemo(() => {
    if (!origSize || !chain) return null;
    const firstMap = ops.find(op => op.mode === "map");
    if (!firstMap || firstMap.kind !== "crop") return null;
    const p = firstMap.params as { x: number; y: number; w: number; h: number };
    const left = Math.max(0, Math.min(100, p.x / origSize.w * 100));
    const top = Math.max(0, Math.min(100, p.y / origSize.h * 100));
    return {
      left,
      top,
      width: Math.max(0, Math.min(100 - left, p.w / origSize.w * 100)),
      height: Math.max(0, Math.min(100 - top, p.h / origSize.h * 100)),
    };
  }, [origSize, chain, ops]);

  if (!pid || !cid) return <Navigate to="/" />;
  if (!chain) return <p className="p-4 text-gray-400">Loading...</p>;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center px-4 py-2 border-b border-gray-200">
        <ChainTitle chain={chain} onRename={(name) => { if (pid && cid) api.updateChain(pid, cid, { name }).then(setChain); }} />
        <div className="flex gap-2 ml-auto">
          <button className="px-4 py-1.5 bg-blue-500 text-white rounded text-sm font-medium hover:bg-blue-600"
            onClick={() => { if (pid && cid) api.executeChain(pid, cid).then(r => { setExecResult(r); setExecRev(v => v + 1); }); }}>
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
        <div className="flex-1 overflow-auto p-4 bg-gray-50">
          {execResult ? (
            <>
              {execResult.analysis && Object.keys(execResult.analysis).length > 0 && (
                <div className="mb-4">
                  <div className="text-xs font-semibold text-gray-600 mb-1">Analysis</div>
                   <pre className="text-xs text-gray-700 whitespace-pre-wrap max-h-48 overflow-y-auto">{JSON.stringify(execResult.analysis, null, 2)}</pre>
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                {execResult.images.map(img => (
                  <div key={img.index} className="shrink-0">
                    <img src={api.executeThumbUrl(pid!, cid!, img.index) + (execRev ? `?v=${execRev}` : '')} className="h-28 w-auto border rounded bg-white cursor-pointer hover:ring-2 hover:ring-blue-400"
                      alt={img.filename} title={img.filename} onClick={() => setLightboxIdx(img.index)} />
                    <div className="text-xs text-gray-500 truncate mt-0.5" title={img.filename} style={{ maxWidth: 112 }}>{img.filename}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">No results yet. Click <span className="font-medium text-blue-500 mx-1">Execute</span> to process images.</div>
          )}
        </div>

        <div ref={rightPanelRef} className="border-l border-gray-200 shrink-0 flex overflow-hidden" style={{ width: rightWidth }}>
          <div className="w-1.5 shrink-0 cursor-col-resize bg-gray-100 hover:bg-blue-300 transition-colors"
            onMouseDown={e => {
              e.preventDefault();
              const startX = e.clientX;
              const startW = rightWidth;
              const onMove = (ev: MouseEvent) => {
                setRightWidth(Math.max(240, Math.min(500, startW - (ev.clientX - startX))));
              };
              const onUp = () => {
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                document.body.style.cursor = "";
                document.body.style.userSelect = "";
              };
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
              document.addEventListener("mousemove", onMove);
              document.addEventListener("mouseup", onUp);
            }} />
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-auto p-2">
              {ops.length === 0 ? (
                <div className="text-gray-400 text-xs text-center mt-4">No operations yet.</div>
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

            <div className="border-t border-gray-200 p-2 shrink-0">
              <SchemaForm op={selectedOpIdx !== null ? ops[selectedOpIdx] : null} onChange={(params) => {
                if (selectedOpIdx === null) return;
                const nextOps = ops.map((op, i) => i === selectedOpIdx ? { ...op, params } : op) as Operation[];
                setChain({ ...chain, operations: nextOps });
                saveOps(nextOps);
              }} />
            </div>
          </div>
        </div>
      </div>

      {lightboxIdx !== null && (
        <div className="fixed inset-0 z-50 bg-black/70 flex flex-col items-center justify-center" onClick={() => { setLightboxIdx(null); setCompareMode("overlay"); }}>
          <div className="flex-1 flex items-center justify-center min-h-0 min-w-0" onClick={e => e.stopPropagation()}>
            {compareMode === "off" && (
              <img src={api.executeFullUrl(pid!, cid!, lightboxIdx) + `?v=${execRev}`} className="max-w-[90vw] max-h-[90vh] object-contain" alt="Result" />
            )}
            {compareMode === "side" && (
              <div className="flex gap-4 items-center max-w-[90vw] max-h-[90vh]">
                <img src={api.resourceFullUrl(pid!, resourceSHA)} className="max-w-[calc(45vw-1rem)] max-h-[90vh] object-contain" alt="Original" />
                <img src={api.executeFullUrl(pid!, cid!, lightboxIdx) + `?v=${execRev}`} className="max-w-[calc(45vw-1rem)] max-h-[90vh] object-contain" alt="Processed" />
              </div>
            )}
            {compareMode === "overlay" && (
              <div className="relative inline-block">
                <img ref={origRef} src={api.resourceFullUrl(pid!, resourceSHA)}
                  onLoad={() => { if (origRef.current) setOrigSize({ w: origRef.current.naturalWidth, h: origRef.current.naturalHeight }); }}
                  className="max-w-[90vw] max-h-[90vh] object-contain block" alt="Original" />
                <img src={api.executeFullUrl(pid!, cid!, lightboxIdx) + `?v=${execRev}`}
                  className="absolute object-contain"
                  style={{
                    left: cropPct ? `${cropPct.left}%` : '50%',
                    top: cropPct ? `${cropPct.top}%` : '50%',
                    width: cropPct ? `${cropPct.width}%` : 'auto',
                    height: cropPct ? `${cropPct.height}%` : 'auto',
                    maxWidth: cropPct ? '100%' : '90vw',
                    maxHeight: cropPct ? '100%' : '90vh',
                    opacity: overlayOpacity / 100,
                    transform: cropPct ? 'none' : 'translate(-50%, -50%)',
                  }}
                  alt="Processed" />
              </div>
            )}
          </div>
          <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-black/50 text-white text-sm" onClick={e => e.stopPropagation()}>
            <button onClick={() => setCompareMode("off")} className={`px-3 py-1 rounded ${compareMode === "off" ? "bg-white/20" : "hover:bg-white/10 transition-colors"}`}>Result</button>
            <button onClick={() => setCompareMode("side")} className={`px-3 py-1 rounded ${compareMode === "side" ? "bg-white/20" : "hover:bg-white/10 transition-colors"}`}>Side by Side</button>
            <button onClick={() => setCompareMode("overlay")} className={`px-3 py-1 rounded ${compareMode === "overlay" ? "bg-white/20" : "hover:bg-white/10 transition-colors"}`}>Overlay</button>
            {compareMode === "overlay" && (
              <div className="flex items-center gap-2 ml-2">
                <input type="range" min={0} max={100} value={overlayOpacity} onChange={e => setOverlayOpacity(Number(e.target.value))} className="w-24 accent-white" />
                <span className="text-xs w-8 tabular-nums">{overlayOpacity}%</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
