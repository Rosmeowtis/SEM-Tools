/** 资源管理页面。

显示项目下所有已上传图片，支持拖拽/多选批量上传、删除。
上传使用 FormData + XHR，支持进度条展示。
*/
import { useEffect, useRef, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { ResourceMeta } from "../types";

export function ResourcesPage() {
  const { pid } = useParams<{ pid: string }>();
  const [resources, setResources] = useState<ResourceMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [currentFile, setCurrentFile] = useState("");
  const [fileProgress, setFileProgress] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchResources = () => {
    if (!pid) return;
    setLoading(true);
    api.listResources(pid).then(setResources).finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(fetchResources, [pid]);

  if (!pid) return <Navigate to="/" />;

  const uploadFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setUploading(true);
    setTotalCount(arr.length);
    setDoneCount(0);

    for (const file of arr) {
      setCurrentFile(file.name);
      setFileProgress(0);
      try {
        await api.uploadResource(pid, file, (pct) => setFileProgress(pct));
      } catch (e) {
        console.error(e);
      }
      setDoneCount(c => c + 1);
    }
    setUploading(false);
    setCurrentFile("");
    setFileProgress(0);
    setModalOpen(false);
    fetchResources();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) uploadFiles(e.target.files);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
  };

  const handleDelete = (sha1: string) => {
    api.deleteResource(pid, sha1).then(fetchResources);
  };

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center gap-3">
        <button
          className="px-3 py-1 bg-blue-500 text-white rounded text-sm"
          onClick={() => setModalOpen(true)}>
          Upload Image
        </button>
        {resources.length > 0 && (
          <span className="text-xs text-gray-500">{resources.length} resource{resources.length !== 1 ? "s" : ""}</span>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center"
          onClick={() => { if (!uploading) setModalOpen(false); }}>
          <div className="bg-white rounded-lg shadow-xl w-[440px] overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <span className="font-semibold text-sm">Upload Images</span>
              <button className="text-gray-400 hover:text-gray-600 text-lg leading-none"
                onClick={() => { if (!uploading) setModalOpen(false); }}>&times;</button>
            </div>

            {uploading ? (
              <div className="p-6">
                <div className="text-sm text-gray-600 mb-2">
                  {currentFile}
                </div>
                <div className="h-2 bg-gray-200 rounded overflow-hidden mb-2">
                  <div className="h-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${fileProgress}%` }} />
                </div>
                <div className="text-xs text-gray-500">
                  {doneCount} / {totalCount} done
                </div>
              </div>
            ) : (
              <div
                className={`m-4 border-2 border-dashed rounded-lg p-10 text-center transition-colors ${
                  dragOver ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-gray-400"
                }`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
              >
                <div className="text-gray-400 text-4xl mb-2">+</div>
                <p className="text-sm text-gray-500 mb-1">Drag and drop images here</p>
                <p className="text-xs text-gray-400">or click to browse files</p>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>
            )}
          </div>
        </div>
      )}

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
                  onClick={() => handleDelete(r.sha1)}>
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
