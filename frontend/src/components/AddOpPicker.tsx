import type { Operation } from "../types";
import { OP_KINDS } from "../types";
import { useEffect, useRef, useState } from "react";
import Fuse from "fuse.js";

const SORTED_OPS = [...OP_KINDS].sort((a, b) => a.label.localeCompare(b.label));
const fuse = new Fuse(SORTED_OPS, {
  keys: ["label", "kind"],
  threshold: 0.4,
  ignoreLocation: true,
  minMatchCharLength: 1,
});

export function AddOpPicker({ onAdd }: { onAdd: (kind: Operation["kind"]) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const filtered = query.trim()
    ? fuse.search(query).map(r => r.item)
    : SORTED_OPS;

  const close = () => { setOpen(false); setQuery(""); };

  const execute = (kind: Operation["kind"]) => {
    onAdd(kind);
    close();
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className="mt-2 px-3 py-1 text-sm border border-dashed border-gray-300 rounded w-full text-gray-500 hover:border-blue-300">
        + Add Operation
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center" onClick={close}>
          <div className="flex flex-col bg-white rounded-lg shadow-xl w-[460px] h-[400px] overflow-hidden border" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 shrink-0">
              <span className="text-sm font-medium text-gray-700">Add Operation</span>
              <button onClick={close} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
            </div>
            <input ref={inputRef} className="w-full px-4 py-2 text-sm border-b border-gray-200 outline-none shrink-0" placeholder="Search operations..." value={query}
              onChange={e => { setQuery(e.target.value); setSelectedIdx(0); }}
              onKeyDown={e => {
                if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, filtered.length - 1)); }
                if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
                if (e.key === "Enter" && filtered.length > 0) execute(filtered[selectedIdx].kind);
              }} />
            <div className="flex-1 min-h-0 overflow-auto">
              {filtered.length === 0 ? (
                <div className="px-4 py-6 text-gray-400 text-sm text-center">No matches</div>
              ) : (
                filtered.map((op, i) => (
                  <button key={op.kind} className={`block w-full text-left px-4 py-2 text-sm cursor-pointer ${i === selectedIdx ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'}`}
                    onClick={() => execute(op.kind)}>
                    <div>{op.label} <span className="text-gray-400 text-xs">({op.mode})</span></div>
                    <div className="text-gray-400 text-xs truncate mt-0.5">{op.help}</div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}