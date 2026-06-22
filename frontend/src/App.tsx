import { useEffect, useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api } from "./api";
import type { Chain, Preset, Project } from "./types";
import { Sidebar } from "./components/Sidebar";
import { HomePage } from "./components/HomePage";
import { ResourcesPage } from "./components/ResourcesPage";
import { ChainEditorPage } from "./components/ChainEditorPage";
import { PresetsPage } from "./components/PresetsPage";
import { CommandPalette } from "./components/CommandPalette";

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [globalChains, setGlobalChains] = useState<Record<string, Chain[]>>({});
  const navigate = useNavigate();
  const location = useLocation();
  const currentPid = location.pathname.split("/")[2];

  const fetchProjects = () => { api.listProjects().then(setProjects).catch(console.error); };
  useEffect(fetchProjects, []);
  useEffect(() => { api.listPresets().then(setPresets); }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen(prev => !prev);
      }
      if (e.key === "Escape" && paletteOpen) setPaletteOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [paletteOpen]);

  const handleCreateProject = (title: string) => {
    api.createProject(title).then((p) => { fetchProjects(); navigate(`/projects/${p.id}`); });
  };

  const handleDeleteProject = (pid: string) => {
    api.deleteProject(pid).then(() => { fetchProjects(); if (currentPid === pid) navigate("/"); });
  };

  const handleCreateChain = (pid: string, name: string, fromPreset?: string) => {
    return api.createChain(pid, name, fromPreset).then((c) => { navigate(`/projects/${pid}/chains/${c.id}`); });
  };

  return (
    <div className="flex h-screen">
      <Sidebar
        projects={projects}
        presets={presets}
        onDeleteProject={handleDeleteProject}
        onCreateProject={handleCreateProject}
        onCreateChain={handleCreateChain}
        currentPid={currentPid}
        onChainsChanged={setGlobalChains}
      />
      <div className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/projects/:pid" element={<ResourcesPage />} />
          <Route path="/projects/:pid/chains/:cid" element={<ChainEditorPage />} />
          <Route path="/tools/presets" element={<PresetsPage />} />
        </Routes>
      </div>
      {paletteOpen && (
        <CommandPalette
          projects={projects}
          presets={presets}
          chains={globalChains}
          onCreateProject={handleCreateProject}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}
