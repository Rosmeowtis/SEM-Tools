/** 全局命令面板（Ctrl+K）。搜索项目/链/预设并快速导航。 */
import type { Project, Preset, Chain } from "../types";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

export function CommandPalette({ projects, presets, chains, onCreateProject, onClose }: {
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
    ...projects.map(p => ({ label: `Project: ${p.title}`, type: "route" as const, path: `/projects/${p.id}`, keywords: p.title })),
    ...Object.entries(chains).flatMap(([pid, cs]) => cs.map(c => ({ label: `Chain: ${c.name}`, type: "route" as const, path: `/projects/${pid}/chains/${c.id}`, keywords: c.name }))),
    ...presets.map(p => ({ label: `Preset: ${p.name}`, type: "route" as const, path: "/tools/presets", keywords: p.name + " " + p.category.join(" ") })),
  ];

  const filtered = commands.filter(c => c.label.toLowerCase().includes(query.toLowerCase()) || c.keywords.toLowerCase().includes(query.toLowerCase())).slice(0, 12);

  const execute = (cmd: typeof filtered[0]) => {
    if (!cmd) return;
    if (cmd.type === "route") navigate(cmd.path);
    if (cmd.type === "action") onCreateProject("Untitled");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-2xl w-[500px] max-h-[400px] overflow-hidden border" onClick={e => e.stopPropagation()}>
        <input ref={inputRef} className="w-full px-4 py-3 text-lg border-b border-gray-200 outline-none" placeholder="Type a command or search..." value={query} onChange={e => { setQuery(e.target.value); setSelectedIdx(0); }}
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
              <div key={i} className={`px-4 py-2 text-sm cursor-pointer flex items-center gap-2 ${i === selectedIdx ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'}`} onClick={() => execute(c)}>
                <span className="text-gray-400 text-xs w-4">{c.type === "action" ? "+" : c.label.startsWith("Project") ? "P" : c.label.startsWith("Preset") ? "R" : "C"}</span>
                {c.label}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
