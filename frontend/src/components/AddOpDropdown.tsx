import type { Operation } from "../types";
import { OP_KINDS } from "../types";
import { useState } from "react";

const SORTED_OPS = [...OP_KINDS].sort((a, b) => a.label.localeCompare(b.label));

export function AddOpDropdown({ onAdd }: { onAdd: (kind: Operation["kind"]) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative mt-2">
      <button onClick={() => setOpen(!open)} className="px-3 py-1 text-sm border border-dashed border-gray-300 rounded w-full text-gray-500 hover:border-blue-300">
        + Add Operation
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 bg-white border border-gray-200 rounded shadow-lg z-10">
          {SORTED_OPS.map(({ kind, mode, label }) => (
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
