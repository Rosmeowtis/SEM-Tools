/** 操作参数编辑表单。根据 OP_KINDS 定义动态渲染数字/选择字段。 */
import type { Operation, FieldDef } from "../types";
import { OP_KINDS } from "../types";

function HelpIcon({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-gray-300 text-white text-[10px] leading-none cursor-help ml-1" title={text}>?</span>
  );
}

function SliderInput({ field, value, onChange }: {
  field: FieldDef;
  value: number;
  onChange: (v: number) => void;
}) {
  const min = field.min!;
  const max = field.max!;
  const step = field.step ?? (max - min) / 100;

  function set(v: number) {
    if (isNaN(v)) v = min;
    if (field.odd && v % 2 === 0) v = v >= max ? v - 1 : v + 1;
    onChange(Math.min(max, Math.max(min, v)));
  }

  return (
    <div className="flex items-center gap-2">
      <input type="range" className="flex-1" min={min} max={max} step={step}
        value={value} onChange={e => set(Number(e.target.value))} />
      <input type="number" className="w-16 border border-gray-300 rounded px-2 py-0.5 text-sm"
        min={min} max={max} step={step}
        value={value} onChange={e => set(Number(e.target.value))} />
    </div>
  );
}

export function SchemaForm({ op, onChange }: {
  op: Operation | null;
  onChange: (params: Record<string, unknown>) => void;
}) {
  if (!op) return <div className="p-4 text-gray-400 text-sm">Select an operation</div>;
  const kindDef = OP_KINDS.find(k => k.kind === op.kind);
  if (!kindDef) return null;
  return (
    <div className="p-4 text-sm">
      <div className="font-semibold mb-3">{kindDef.label}<HelpIcon text={kindDef.help} /></div>
      {kindDef.fields.length === 0 && <div className="text-gray-400">No parameters</div>}
      {kindDef.fields.map(f => (
        <div key={f.key} className="mb-2">
          <label className="text-xs text-gray-500 block">{f.label}<HelpIcon text={f.help} /></label>
          {f.type === "number" && f.min !== undefined && f.max !== undefined ? (
            <SliderInput field={f} value={(op.params as Record<string, unknown>)[f.key] as number ?? f.default}
              onChange={v => onChange({ ...op.params, [f.key]: v })} />
          ) : f.type === "number" ? (
            <input type="number" className="w-full border border-gray-300 rounded px-2 py-0.5 text-sm"
              value={(op.params as Record<string, unknown>)[f.key] as number ?? f.default}
              onChange={e => onChange({ ...op.params, [f.key]: Number(e.target.value) })} />
          ) : (
            <select className="w-full border border-gray-300 rounded px-2 py-0.5 text-sm"
              value={String((op.params as Record<string, unknown>)[f.key] ?? f.default)}
              onChange={e => {
                const val = f.options?.some(o => typeof o === "number") ? Number(e.target.value) : e.target.value;
                onChange({ ...op.params, [f.key]: val });
              }}>
              {f.options?.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
        </div>
      ))}
    </div>
  );
}
