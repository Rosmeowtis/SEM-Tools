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
