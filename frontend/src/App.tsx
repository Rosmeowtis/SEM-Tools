import { useEffect, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "./api";
import type { Project, ResourceMeta } from "./types";

function Sidebar({
  projects,
  onDeleteProject,
  onCreateProject,
  currentPid,
}: {
  projects: Project[];
  onDeleteProject: (pid: string) => void;
  onCreateProject: (title: string) => void;
  currentPid?: string;
}) {
  const [title, setTitle] = useState("");

  return (
    <div className="w-56 bg-gray-100 h-screen flex flex-col border-r border-gray-200 shrink-0">
      <div className="p-3 font-semibold text-gray-800 border-b border-gray-200">
        SEM-Tools
      </div>
      <form
        className="p-2 flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) {
            onCreateProject(title.trim());
            setTitle("");
          }
        }}
      >
        <input
          className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
          placeholder="New project..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button
          type="submit"
          className="px-2 py-1 bg-blue-500 text-white rounded text-sm"
        >
          +
        </button>
      </form>
      <div className="flex-1 overflow-auto">
        {projects.map((p) => (
          <Link
            key={p.id}
            to={`/projects/${p.id}`}
            className={`flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-200 ${
              p.id === currentPid ? "bg-blue-100" : ""
            }`}
          >
            <span className="truncate">{p.title}</span>
            <button
              className="text-red-400 hover:text-red-600 ml-1 shrink-0"
              onClick={(e) => {
                e.preventDefault();
                onDeleteProject(p.id);
              }}
              title="Delete"
            >
              x
            </button>
          </Link>
        ))}
      </div>
    </div>
  );
}

function HomePage() {
  return (
    <div className="flex items-center justify-center h-full text-gray-400">
      Select a project or create a new one
    </div>
  );
}

function ResourcesPage() {
  const { pid } = useParams<{ pid: string }>();
  const [resources, setResources] = useState<ResourceMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchResources = () => {
    if (!pid) return;
    setLoading(true);
    api
      .listResources(pid)
      .then(setResources)
      .finally(() => setLoading(false));
  };

  useEffect(fetchResources, [pid]);

  if (!pid) return <Navigate to="/" />;

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setProgress(0);
    api
      .uploadResource(pid, file, setProgress)
      .then(() => {
        fetchResources();
      })
      .catch(console.error)
      .finally(() => {
        setUploading(false);
        setProgress(0);
        e.target.value = "";
      });
  };

  const handleDelete = (sha1: string) => {
    api.deleteResource(pid, sha1).then(fetchResources);
  };

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center gap-3">
        <button
          className="px-3 py-1 bg-blue-500 text-white rounded text-sm"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? `Uploading ${progress}%` : "Upload Image"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleUpload}
        />
        {uploading && (
          <div className="h-2 flex-1 max-w-xs bg-gray-200 rounded overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-gray-400">Loading...</p>
      ) : resources.length === 0 ? (
        <p className="text-gray-400">No resources yet. Upload an image.</p>
      ) : (
        <div className="grid grid-cols-4 gap-3">
          {resources.map((r) => (
            <div key={r.sha1} className="border border-gray-200 rounded overflow-hidden group">
              <img
                src={api.thumbUrl(pid, r.sha1)}
                alt={r.filename}
                className="w-full h-32 object-cover bg-gray-100"
              />
              <div className="p-2 text-xs text-gray-600 flex justify-between items-center">
                <span className="truncate">{r.filename}</span>
                <button
                  className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => handleDelete(r.sha1)}
                >
                  del
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const navigate = useNavigate();
  const location = useLocation();
  const currentPid = location.pathname.split("/")[2];

  const fetchProjects = () => {
    api.listProjects().then(setProjects).catch(console.error);
  };

  useEffect(fetchProjects, []);

  const handleCreateProject = (title: string) => {
    api.createProject(title).then((p) => {
      fetchProjects();
      navigate(`/projects/${p.id}`);
    });
  };

  const handleDeleteProject = (pid: string) => {
    api.deleteProject(pid).then(() => {
      fetchProjects();
      if (currentPid === pid) navigate("/");
    });
  };

  return (
    <div className="flex h-screen">
      <Sidebar
        projects={projects}
        onDeleteProject={handleDeleteProject}
        onCreateProject={handleCreateProject}
        currentPid={currentPid}
      />
      <div className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/projects/:pid" element={<ResourcesPage />} />
        </Routes>
      </div>
    </div>
  );
}
