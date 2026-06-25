/** 项目 */
export interface Project {
  id: string;
  slug: string;
  title: string;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface ResourceMeta {
  id: number;
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
  | { offset: number; algorithm: "left_peak" | "right_peak" | "otsu" }
  | { type: "open" | "close"; ksize: number; iterations: number }
  | { type: "png" | "jpg" | "webp"; quality: number }
  | { distance_type: "L1" | "L2" | "C"; mask_size: number }
  | { seed_thresh: number; bg_iterations: number; bg_ksize: number }
  | { cross_size: number; cross_thickness: number };

export type Operation = {
  kind: "crop" | "resize" | "grayscale" | "analyze" | "blur" |
        "threshold" | "auto_threshold" | "morphology_ellipse" | "invert" | "format" | "tophat" | "distance_transform" | "watershed" | "centroid_markers";
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
  options?: readonly (string | number)[];
  default: number | string;
  help?: string;
  min?: number;
  max?: number;
  step?: number;
  odd?: boolean;
}

export const OP_KINDS = [
  { kind: "crop" as const,      mode: "map" as const,    params: { x:0, y:0, w:100, h:100 }, label: "Crop",
    help: "从图像中裁剪矩形区域",
    fields: [
      { key:"x", label:"X", type:"number", default:0, help:"裁剪矩形左上角 X 坐标" },
      { key:"y", label:"Y", type:"number", default:0, help:"裁剪矩形左上角 Y 坐标" },
      { key:"w", label:"Width", type:"number", default:100, help:"裁剪区域宽度（像素）" },
      { key:"h", label:"Height", type:"number", default:100, help:"裁剪区域高度（像素）" },
    ] as FieldDef[] },
  { kind: "resize" as const,    mode: "map" as const,    params: { w:256, h:256, algorithm:"bilinear" }, label: "Resize",
    help: "将图像缩放至指定尺寸",
    fields: [
      { key:"w", label:"Width", type:"number", default:256, help:"目标宽度（像素）" },
      { key:"h", label:"Height", type:"number", default:256, help:"目标高度（像素）" },
      { key:"algorithm", label:"Algorithm", type:"select", options:["nearest","bilinear"], default:"bilinear", help:"插值算法：nearest=快速锯齿，bilinear=平滑" },
    ] as FieldDef[] },
  { kind: "grayscale" as const, mode: "map" as const,    params: {} as Record<string,never>, label: "Grayscale",
    help: "将彩色图像转为灰度图，已是灰度图则原样通过",
    fields: [] as FieldDef[] },
  { kind: "blur" as const,      mode: "map" as const,    params: { ksize:3 }, label: "Blur",
    help: "高斯模糊降噪，平滑细节",
    fields: [{ key:"ksize", label:"Kernel Size", type:"number", default:3, help:"高斯核大小，越大模糊越强（自动取奇数）" }] as FieldDef[] },
  { kind: "threshold" as const, mode: "map" as const,    params: { threshold:127 }, label: "Threshold",
    help: "固定阈值二值化，高于阈值的像素变白（255），低于变黑（0）",
    fields: [{ key:"threshold", label:"Threshold", type:"number", default:127, min:0, max:255, step:1, help:"二值化阈值（0-255）" }] as FieldDef[] },
  { kind: "auto_threshold" as const, mode: "map" as const, params: { algorithm:"left_peak" as const, offset:0 }, label: "Auto Threshold",
    help: "自动二值化：单峰左/右最大距离点 + 大津法",
    fields: [
      { key:"algorithm", label:"Algorithm", type:"select", options:["left_peak","right_peak","otsu"], default:"left_peak", help:"left_peak=主峰左侧最大距离, right_peak=主峰右侧最大距离, otsu=大津法" },
      { key:"offset", label:"Offset", type:"number", default:0, min:-255, max:255, step:1, help:"对自动检测的阈值进行偏移修正" },
    ] as FieldDef[] },
  { kind: "morphology_ellipse" as const, mode: "map" as const, params: { type:"open" as const, ksize:3, iterations:1 }, label: "Morphology",
    help: "椭圆结构元素的形态学开/闭运算",
    fields: [
      { key:"type", label:"Type", type:"select", options:["open","close"], default:"open", help:"open=消除亮噪点，close=填充暗孔洞" },
      { key:"ksize", label:"Kernel Size", type:"number", default:3, help:"核直径，越大效果越强" },
      { key:"iterations", label:"Iterations", type:"number", default:1, help:"重复运算次数" },
    ] as FieldDef[] },
  { kind: "invert" as const,    mode: "map" as const,    params: {} as Record<string,never>, label: "Invert",
    help: "按位取反，白变黑、黑变白",
    fields: [] as FieldDef[] },
  { kind: "tophat" as const,   mode: "map" as const,    params: { ksize:81 }, label: "Tophat",
    help: "顶帽变换消除不均匀光照：大核开运算提取背景，原图减背景保留细节",
    fields: [{ key:"ksize", label:"Kernel Size", type:"number", default:81, help:"结构元素直径，越大背景估计越平滑" }] as FieldDef[] },
  { kind: "centroid_markers" as const, mode: "map" as const, params: { cross_size:5, cross_thickness:1 }, label: "Centroids",
    help: "计算各颗粒质心并用白色十字标注在纯黑背景图上",
    fields: [
      { key:"cross_size", label:"Cross Size", type:"number", default:5, min:1, max:100, step:1, help:"十字半臂长度（像素）" },
      { key:"cross_thickness", label:"Thickness", type:"number", default:1, min:1, max:100, step:1, help:"十字线条粗细" },
    ] as FieldDef[] },
  { kind: "watershed" as const, mode: "map" as const, params: { seed_thresh:0.5, bg_iterations:3, bg_ksize:3 }, label: "Watershed",
    help: "分水岭分离重叠颗粒：距离变换+种子标记+分水岭",
    fields: [
      { key:"seed_thresh", label:"Seed Thr.", type:"number", default:0.5, min:0, max:1, step:0.01, help:"种子检测阈值（距离×max 的比例）" },
      { key:"bg_iterations", label:"BG Iters", type:"number", default:3, help:"背景膨胀迭代次数" },
      { key:"bg_ksize", label:"BG Kernel", type:"number", default:3, help:"背景膨胀核直径" },
    ] as FieldDef[] },
  { kind: "distance_transform" as const, mode: "map" as const, params: { distance_type:"L2" as const, mask_size:3 }, label: "Distance",
    help: "距离变换：每个前景像素到最近背景像素的距离",
    fields: [
      { key:"distance_type", label:"Distance", type:"select", options:["L1","L2","C"], default:"L2", help:"L1=曼哈顿, L2=欧氏, C=棋盘" },
      { key:"mask_size", label:"Mask", type:"select", options:[3,5], default:3, help:"距离掩码大小（3 或 5），越大越精确" },
    ] as FieldDef[] },
  { kind: "format" as const,    mode: "map" as const,    params: { type:"png" as const, quality:85 }, label: "Format",
    help: "输出格式标记，不改变像素数据",
    fields: [
      { key:"type", label:"Type", type:"select", options:["png","jpg","webp"], default:"png", help:"png=无损，jpg=有损压缩，webp=现代格式" },
      { key:"quality", label:"Quality", type:"number", default:85, min:1, max:100, step:1, help:"压缩质量（1-100），仅 jpg/webp 有效" },
    ] as FieldDef[] },
  { kind: "analyze" as const,   mode: "reduce" as const, params: { type:"porosity" as const }, label: "Analyze",
    help: "跨图聚合统计分析：孔隙率 / 像素统计 / 粒径分布",
    fields: [{ key:"type", label:"Type", type:"select", options:["porosity","statistics","distribution"], default:"porosity", help:"porosity=白色像素占比，statistics=灰度统计量，distribution=连通域粒径分布" }] as FieldDef[] },
];

export interface Preset {
  name: string;
  category: string[];
  operations: Operation[];
}

