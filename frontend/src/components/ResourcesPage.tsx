import { useEffect, useRef, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { ResourceMeta } from "../types";

export function ResourcesPage() {
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

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(fetchResources, [pid]);

  if (!pid) return <Navigate to="/" />;

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setProgress(0);
    api
      .uploadResource(pid, file, setProgress)
      .then(() => { fetchResources(); })
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
