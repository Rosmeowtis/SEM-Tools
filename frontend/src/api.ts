/** 类型化 API 封装。

所有 API 返回 Promise<T>，非 2xx 响应抛 Error。
上传（uploadResource）使用 XHR 实现可监控的上传进度。
图片 URL（thumbUrl / resourceFullUrl / executeThumbUrl / executeFullUrl）
返回字符串，直接用于 <img src>。
*/
import type { Chain, Operation, Preset, Project, ResourceMeta } from "./types";

export const BASE = "/api";

/** 通用 JSON fetch 封装。非 2xx 状态码抛错。 */
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, init);
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

/** 带上传进度的 XHR 文件上传。 */
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

  /** 上传资源（支持进度回调）。 */
  uploadResource: (pid: string, file: File, onProgress?: (pct: number) => void) =>
    xhrUpload<ResourceMeta>(`/projects/${pid}/resources`, file, onProgress),

  deleteResource: (pid: string, sha1: string) =>
    req<{ deleted: boolean }>(`/projects/${pid}/resources/${sha1}`, { method: "DELETE" }),

  /** 资源缩略图 URL（200px JPEG）。 */
  thumbUrl: (pid: string, sha1: string) =>
    `${BASE}/projects/${pid}/resources/${sha1}/thumb`,

  /** 资源原尺寸图 URL。 */
  resourceFullUrl: (pid: string, sha1: string) =>
    `${BASE}/projects/${pid}/resources/${sha1}/full`,

  listChains: (pid: string) => req<Chain[]>(`/projects/${pid}/chains`),
  createChain: (pid: string, name: string, fromPreset?: string) =>
    req<Chain>(`/projects/${pid}/chains`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, ...(fromPreset ? { from_preset: fromPreset } : {}) }),
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

  /** ZIP 导出下载 URL。 */
  exportUrl: (pid: string, cid: string, rid?: string) =>
    `${BASE}/projects/${pid}/chains/${cid}/export${rid ? `?rid=${rid}` : ""}`,

  /** 全量执行链，返回处理结果缩略图索引 + 分析数据。 */
  executeChain: (pid: string, cid: string) =>
    req<{ images: { filename: string; index: number }[]; analysis: Record<string, unknown> }>(
      `/projects/${pid}/chains/${cid}/execute`, { method: "POST" }),

  /** 执行结果缩略图 URL。 */
  executeThumbUrl: (pid: string, cid: string, idx: number) =>
    `${BASE}/projects/${pid}/chains/${cid}/execute-thumb/${idx}`,

  /** 执行结果全尺寸图 URL。 */
  executeFullUrl: (pid: string, cid: string, idx: number) =>
    `${BASE}/projects/${pid}/chains/${cid}/execute-full/${idx}`,

  listPresets: () =>
    req<Preset[]>("/presets"),

  createPreset: (name: string, operations: Operation[], category: string[] = []) =>
    req<Preset>("/presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, operations, category }),
    }),

  updatePreset: (name: string, data: { operations?: Operation[]; category?: string[] }) =>
    req<Preset>(`/presets/${encodeURIComponent(name)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  deletePreset: (name: string) =>
    req<{ deleted: boolean }>(`/presets/${encodeURIComponent(name)}`, { method: "DELETE" }),
};
