import type { Chain, Operation, Project, ResourceMeta } from "./types";

export const BASE = "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, init);
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

function xhrUpload<T>(
  path: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}${path}`);
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error(`${xhr.status}: ${xhr.responseText}`));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  });
}

export const api = {
  listProjects: () => req<Project[]>("/projects"),

  createProject: (title: string) =>
    req<Project>("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }),

  deleteProject: (pid: string) =>
    req<{ deleted: boolean }>(`/projects/${pid}`, { method: "DELETE" }),

  listResources: (pid: string) =>
    req<ResourceMeta[]>(`/projects/${pid}/resources`),

  uploadResource: (pid: string, file: File, onProgress?: (pct: number) => void) =>
    xhrUpload<ResourceMeta>(`/projects/${pid}/resources`, file, onProgress),

  deleteResource: (pid: string, sha1: string) =>
    req<{ deleted: boolean }>(`/projects/${pid}/resources/${sha1}`, { method: "DELETE" }),

  thumbUrl: (pid: string, sha1: string) =>
    `${BASE}/projects/${pid}/resources/${sha1}/thumb`,

  listChains: (pid: string) => req<Chain[]>(`/projects/${pid}/chains`),
  createChain: (pid: string, name: string) =>
    req<Chain>(`/projects/${pid}/chains`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  getChain: (pid: string, cid: string) => req<Chain>(`/projects/${pid}/chains/${cid}`),
  updateChain: (pid: string, cid: string, data: { name?: string; operations?: Operation[]; resource_ids?: string[] }) =>
    req<Chain>(`/projects/${pid}/chains/${cid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  deleteChain: (pid: string, cid: string) =>
    req<{ deleted: boolean }>(`/projects/${pid}/chains/${cid}`, { method: "DELETE" }),

  previewUrl: (pid: string, cid: string, rid?: string) =>
    `${BASE}/projects/${pid}/chains/${cid}/preview${rid ? `?rid=${rid}` : ""}`,

  requestPreview: (pid: string, cid: string, rid?: string) =>
    req<{ accepted?: boolean; cached?: boolean }>(`/projects/${pid}/chains/${cid}/preview${rid ? `?rid=${rid}` : ""}`, { method: "POST" }),

  exportUrl: (pid: string, cid: string, rid?: string) =>
    `${BASE}/projects/${pid}/chains/${cid}/export${rid ? `?rid=${rid}` : ""}`,
};
