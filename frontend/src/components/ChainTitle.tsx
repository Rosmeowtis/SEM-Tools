/** 可点击编辑的链名称。点击进入内联编辑，失焦或回车保存。 */
import type { Chain } from "../types";
import { useEffect, useState } from "react";

export function ChainTitle({ chain, onRename }: {
  chain: Chain; onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(chain.name);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setName(chain.name); }, [chain.name]);

  if (editing) return (
    <input
      className="text-lg font-semibold outline-none flex-1"
      value={name} autoFocus
      onChange={e => setName(e.target.value)}
      onBlur={() => { onRename(name); setEditing(false); }}
      onKeyDown={e => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }} />
  );
  return (
    <div className="text-lg font-semibold cursor-pointer flex-1"
      onClick={() => setEditing(true)}>
      {chain.name}
    </div>
  );
}
