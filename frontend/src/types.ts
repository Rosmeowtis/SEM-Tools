export interface Project {
  id: string;
  slug: string;
  title: string;
  note: string;
  tags: string;
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
  | { type: "porosity" | "statistics" | "distribution" }
  | { ksize: number }
  | { threshold: number }
  | { type: "open" | "close"; ksize: number }
  | { type: "png" | "jpg" | "webp"; quality: number };

export type Operation = {
  kind: "crop" | "resize" | "grayscale" | "analyze" | "blur" |
        "threshold" | "morphology_ellipse" | "invert" | "format";
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

export interface FieldDef {
  key: string;
  label: string;
  type: "number" | "select";
  options?: readonly string[];
  default: number | string;
}

export const OP_KINDS = [
  { kind: "crop" as const,      mode: "map" as const,    params: { x:0, y:0, w:100, h:100 }, label: "Crop",
    fields: [
      { key:"x", label:"X", type:"number", default:0 },
      { key:"y", label:"Y", type:"number", default:0 },
      { key:"w", label:"Width", type:"number", default:100 },
      { key:"h", label:"Height", type:"number", default:100 },
    ] as FieldDef[] },
  { kind: "resize" as const,    mode: "map" as const,    params: { w:256, h:256, algorithm:"bilinear" }, label: "Resize",
    fields: [
      { key:"w", label:"Width", type:"number", default:256 },
      { key:"h", label:"Height", type:"number", default:256 },
      { key:"algorithm", label:"Algorithm", type:"select", options:["nearest","bilinear"], default:"bilinear" },
    ] as FieldDef[] },
  { kind: "grayscale" as const, mode: "map" as const,    params: {} as Record<string,never>, label: "Grayscale", fields: [] as FieldDef[] },
  { kind: "blur" as const,      mode: "map" as const,    params: { ksize:3 }, label: "Blur",
    fields: [{ key:"ksize", label:"Kernel Size", type:"number", default:3 }] as FieldDef[] },
  { kind: "threshold" as const, mode: "map" as const,    params: { threshold:127 }, label: "Threshold",
    fields: [{ key:"threshold", label:"Threshold", type:"number", default:127 }] as FieldDef[] },
  { kind: "morphology_ellipse" as const, mode: "map" as const, params: { type:"open" as const, ksize:3 }, label: "Morphology",
    fields: [
      { key:"type", label:"Type", type:"select", options:["open","close"], default:"open" },
      { key:"ksize", label:"Kernel Size", type:"number", default:3 },
    ] as FieldDef[] },
  { kind: "invert" as const,    mode: "map" as const,    params: {} as Record<string,never>, label: "Invert", fields: [] as FieldDef[] },
  { kind: "format" as const,    mode: "map" as const,    params: { type:"png" as const, quality:85 }, label: "Format",
    fields: [
      { key:"type", label:"Type", type:"select", options:["png","jpg","webp"], default:"png" },
      { key:"quality", label:"Quality", type:"number", default:85 },
    ] as FieldDef[] },
  { kind: "analyze" as const,   mode: "reduce" as const, params: { type:"porosity" as const }, label: "Analyze",
    fields: [{ key:"type", label:"Type", type:"select", options:["porosity","statistics","distribution"], default:"porosity" }] as FieldDef[] },
];

export interface Preset {
  name: string;
  category: string[];
  operations: Operation[];
}

export type StudioEvent =
  | { type: "preview.progress"; progress: number; gen: number }
  | { type: "preview.complete"; thumb_sha1: string; gen: number }
  | { type: "preview.error"; message: string; gen: number };
