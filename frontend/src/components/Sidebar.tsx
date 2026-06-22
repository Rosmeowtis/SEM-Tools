import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Chain, Preset, Project } from "../types";

export function Sidebar({
  projects, presets, onDeleteProject, onCreateProject, onCreateChain,
  currentPid, onChainsChanged,
}: {
  projects: Project[];
  presets: Preset[];
  onDeleteProject: (pid: string) => void;
  onCreateProject: (title: string) => void;
  onCreateChain: (pid: string, name: string, fromPreset?: string) => void;
  currentPid?: string;
  onChainsChanged: (chains: Record<string, Chain[]>) => void;
}) {
  const [title, setTitle] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [chains, setChains] = useState<Record<string, Chain[]>>({});
  const [newChainName, setNewChainName] = useState<Record<string, string>>({});
  const [newChainPreset, setNewChainPreset] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(288);
  const sidebarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sidebarRef.current;
    if (!el) return;
    let dragging = false;
    const onDown = (e: MouseEvent) => {
      e.preventDefault(); dragging = true;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    };
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      setSidebarWidth(Math.max(240, Math.min(500, e.clientX)));
    };
    const onUp = () => {
      dragging = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    el.addEventListener("mousedown", onDown);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      el.removeEventListener("mousedown", onDown);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  const filtered = projects.filter(p => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return p.title.toLowerCase().includes(q);
  });

  const fetchChains = useCallback((pid: string) => {
    api.listChains(pid).then((list) => {
      setChains((prev) => {
        const next = { ...prev, [pid]: list };
        onChainsChanged(next);
        return next;
      });
    });
  }, [onChainsChanged]);

  const handleToggleExpand = (pid: string) => {
    setExpanded((prev) => {
      const next = !prev[pid];
      if (next) fetchChains(pid);
      return { ...prev, [pid]: next };
    });
  };

  const handleCreateChain = (pid: string) => {
    const name = newChainName[pid]?.trim();
    if (!name) return;
    onCreateChain(pid, name, newChainPreset[pid] || undefined);
    setNewChainName(prev => ({ ...prev, [pid]: "" }));
    setNewChainPreset(prev => ({ ...prev, [pid]: "" }));
    fetchChains(pid);
  };

  const handleDeleteChain = (pid: string, cid: string) => {
    api.deleteChain(pid, cid).then(() => fetchChains(pid));
  };

  return (
    <div className="bg-gray-100 h-screen flex flex-col border-r border-gray-200 shrink-0 relative" style={{ width: sidebarWidth }}>
      <div className="p-3 font-semibold text-gray-800 border-b border-gray-200">SEM-Tools</div>
      <input
        className="mx-2 mt-2 mb-1 px-2 py-1 border border-gray-300 rounded text-sm"
        placeholder="Search..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      <form className="p-2 flex gap-1" onSubmit={(e) => { e.preventDefault(); if (title.trim()) { onCreateProject(title.trim()); setTitle(""); } }}>
        <input className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm" placeholder="New project..." value={title} onChange={e => setTitle(e.target.value)} />
        <button type="submit" className="px-2 py-1 bg-blue-500 text-white rounded text-sm">+</button>
      </form>
      <div className="flex-1 overflow-auto">
        {filtered.map((p) => (
          <div key={p.id}>
            <div className={`flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-200 ${p.id === currentPid && !expanded[p.id] ? "bg-blue-100" : ""}`}>
              <div className="flex items-center gap-1 min-w-0 flex-1">
                <button className="text-gray-400 hover:text-gray-600 shrink-0" onClick={() => handleToggleExpand(p.id)}>{expanded[p.id] ? "▼" : "▶"}</button>
                <Link to={`/projects/${p.id}`} className="truncate hover:underline">{p.title}</Link>
              </div>
              <button className="text-red-400 hover:text-red-600 ml-1 shrink-0" onClick={(e) => { e.preventDefault(); onDeleteProject(p.id); }} title="Delete">x</button>
            </div>
            {expanded[p.id] && (
              <div className="pl-7 border-l border-gray-200 ml-3">
                {(chains[p.id] || []).map((c) => (
                  <Link key={c.id} to={`/projects/${p.id}/chains/${c.id}`} className="flex items-center justify-between px-2 py-1 text-sm hover:bg-gray-200">
                    <span className="truncate text-gray-700">{c.name}</span>
                    <button className="text-red-400 hover:text-red-600 shrink-0 text-xs" onClick={(e) => { e.preventDefault(); handleDeleteChain(p.id, c.id); }}>x</button>
                  </Link>
                ))}
                <form className="px-2 py-1 flex gap-1" onSubmit={(e) => { e.preventDefault(); handleCreateChain(p.id); }}>
                  <select className="w-12 px-1 border border-gray-300 rounded text-xs" value={newChainPreset[p.id] || ""} onChange={e => setNewChainPreset(prev => ({ ...prev, [p.id]: e.target.value }))}>
                    <option value="">--</option>
                    {presets.map(pr => <option key={pr.name} value={pr.name}>{pr.name}</option>)}
                  </select>
                  <input className="flex-1 px-1 py-0.5 border border-gray-300 rounded text-xs" placeholder="New chain..." value={newChainName[p.id] || ""} onChange={e => setNewChainName(prev => ({ ...prev, [p.id]: e.target.value }))} />
                  <button type="submit" className="px-1.5 py-0.5 bg-blue-500 text-white rounded text-xs">+</button>
                </form>
              </div>
            )}
          </div>
        ))}
      </div>
      <Link to="/tools/presets" className="block px-3 py-2 text-sm text-gray-500 border-t border-gray-200 hover:bg-gray-200">Presets</Link>
      <div ref={sidebarRef} className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-blue-300" />
    </div>
  );
}
