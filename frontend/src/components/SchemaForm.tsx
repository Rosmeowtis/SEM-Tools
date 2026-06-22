import type { Operation } from "../types";
import { OP_KINDS } from "../types";

export function SchemaForm({ op, onChange }: {
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
