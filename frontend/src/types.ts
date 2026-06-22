export interface Project {
  id: string;
  slug: string;
  title: string;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface ResourceMeta {
  sha1: string;
  project_id: string;
  filename: string;
  ext: string;
  size: number;
  imported_at: string;
}

export type OperationParams =
  | { x: number; y: number; w: number; h: number }
  | { w: number; h: number; algorithm: "nearest" | "bilinear" }
  | Record<string, never>
  | { type: "porosity" | "statistics" | "distribution" };

export type Operation = {
  kind: "crop" | "resize" | "grayscale" | "analyze";
  mode: "map" | "reduce";
  params: OperationParams;
};

export interface Chain {
  id: string;
  project_id: string;
  name: string;
  resource_ids: string[];
  operations: Operation[];
  created_at: string;
  updated_at: string;
}

export const OP_KINDS = [
  { kind: "crop" as const,      mode: "map" as const, params: { x: 0, y: 0, w: 100, h: 100 },          label: "Crop" },
  { kind: "resize" as const,    mode: "map" as const, params: { w: 256, h: 256, algorithm: "bilinear" }, label: "Resize" },
  { kind: "grayscale" as const, mode: "map" as const, params: {} as Record<string, never>,              label: "Grayscale" },
  { kind: "analyze" as const,   mode: "reduce" as const, params: { type: "porosity" },                  label: "Analyze" },
] as const;

export type StudioEvent =
  | { type: "preview.progress"; progress: number; gen: number }
  | { type: "preview.complete"; thumb_sha1: string; gen: number }
  | { type: "preview.error"; message: string; gen: number };
