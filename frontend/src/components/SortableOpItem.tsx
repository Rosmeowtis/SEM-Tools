/** 可拖拽排序的操作项。显示操作名 + 模式 + 参数摘要 + 删除按钮。 */
import type { Operation } from "../types";
import { OP_KINDS } from "../types";
import { useSortable } from "@dnd-kit/sortable";

export function SortableOpItem({ id, op, isSelected, onSelect, onDelete, onToggle }: {
  id: string; op: Operation; isSelected: boolean;
  onSelect: () => void; onDelete: () => void; onToggle?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style: React.CSSProperties = transform
    ? { transform: `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0) scaleX(${transform.scaleX}) scaleY(${transform.scaleY})`, transition }
    : { transition };
  const kindDef = OP_KINDS.find(k => k.kind === op.kind);
  return (
    <div
      ref={setNodeRef} style={style}
      className={`flex items-center gap-2 p-2 border rounded mb-1 cursor-pointer transition-opacity ${isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200'} ${op.enabled !== false ? '' : 'opacity-50'}`}
      onClick={onSelect}
    >
      <button className="cursor-grab text-gray-400" {...attributes} {...listeners}>☰</button>
      {onToggle && (
        <button onClick={(e) => { e.stopPropagation(); onToggle(); }} className="text-xs w-4 text-center"
          title={op.enabled !== false ? "禁用此操作" : "启用此操作"}>
          {op.enabled !== false ? "👁" : "👁‍🗨"}
        </button>
      )}
      <span className="font-mono text-sm">{op.kind}</span>
      {kindDef?.help && (
        <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-gray-300 text-white text-[10px] leading-none cursor-help" title={kindDef.help}>?</span>
      )}
      <span className="text-xs text-gray-400">{op.mode}</span>
      <span className="text-xs text-gray-500 truncate flex-1">{JSON.stringify(op.params)}</span>
      <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="text-red-400 text-xs">×</button>
    </div>
  );
}
