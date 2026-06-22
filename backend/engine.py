"""链式图像处理执行引擎。

核心概念：
- **管道式执行**：operations 严格按用户定义顺序执行。
- **map**：变换图像，输出传给下一个操作。
- **reduce**：在当前位置"采集"图像状态，写入 ChainState 副作用容器，
  图像本身继续向后流动（不阻塞管道）。
- **ChainState**：管理所有 reduce 累加器 + TextBuffer（人类可读的分析报告）。
- **run_pipeline**：统一管道函数，execute_chain 和 execute_and_preview
  共享此核心，仅通过 per_resource 回调区分保存逻辑。
"""

import json
import zipfile
from io import BytesIO

import cv2
import numpy as np
from pathlib import Path
from typing import Callable
from PIL import Image

from studio.operations import (
    apply_map_op,
    reduce_init,
    reduce_accumulate,
    reduce_finalize,
    reduce_format,
)


def load_image(path: Path) -> np.ndarray:
    """以 OpenCV BGR 格式加载图像（内部用 Pillow 处理非 ASCII 路径）。"""
    pil = Image.open(path).convert("RGB")
    img = np.array(pil)
    return cv2.cvtColor(img, cv2.COLOR_RGB2BGR)


def save_image(img: np.ndarray, path: Path, quality: int = 85):
    """保存图像到磁盘（内部用 Pillow，支持非 ASCII 路径）。

    Args:
        img: BGR 或灰度图像。
        path: 保存路径。
        quality: JPEG/WebP 压缩质量（PNG 忽略）。
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    if img.ndim == 2:
        Image.fromarray(img).save(path, quality=quality)
    else:
        Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB)).save(
            path, quality=quality
        )


class TextBuffer:
    """文本累加器，用于收集 reduce 操作的人类可读分析报告。

    reduce ops 通过 ChainState 在 finalize 时将格式化文本写入此对象，
    导出时在 ZIP 中生成 analysis.txt。
    """

    def __init__(self):
        self._lines: list[str] = []

    def append(self, text: str):
        """追加一段文本（末尾自动换行分隔）。"""
        self._lines.append(text)

    def content(self) -> str:
        """获取全部已收集的文本内容。"""
        return "\n".join(self._lines)


class ChainState:
    """链执行副作用状态容器。

    - 预初始化所有 reduce 操作的累加器。
    - accumulate(idx, op, img, rid, filename)：reduce 操作采集当前图像状态。
    - finalize()：全部资源处理完毕后，完成聚合，写入 TextBuffer。
    - text：获取人类可读的分析报告文本。
    """

    def __init__(self, operations: list[dict]):
        self._ops = operations
        self._acc: dict[int, dict] = {}
        self._text = TextBuffer()
        for i, op in enumerate(operations):
            if op.get("mode") == "reduce":
                self._acc[i] = reduce_init(op)

    def accumulate(
        self, idx: int, op: dict, img: np.ndarray, rid: str, filename: str = ""
    ):
        """Reduce 操作在当前位置采集图像数据。"""
        if idx in self._acc:
            self._acc[idx] = reduce_accumulate(op, self._acc[idx], img, rid, filename)

    def finalize(self) -> dict[str, dict]:
        """完成所有 reduce 聚合，填充 TextBuffer，返回机器可读的分析结果字典。

        Returns:
            形如 {"analyze-0": {...}, "analyze-1": {...}}。
        """
        results: dict[str, dict] = {}
        for i, op in enumerate(self._ops):
            if i in self._acc:
                key = f"{op['kind']}-{i}"
                results[key] = reduce_finalize(op, self._acc[i])
                op_type = op["params"].get("type", "?")
                text = reduce_format(op, results[key])
                if text:
                    self._text.append(f"# {op['kind']}-{i} ({op_type})\n{text}\n")
        return results

    @property
    def text(self) -> str:
        """获取人类可读的分析报告（TAB 分隔文本表格）。"""
        return self._text.content()


def run_pipeline(
    resource_paths: list[tuple[str, str, Path]],
    operations: list[dict],
    state: ChainState,
    per_resource: Callable[[int, str, str, np.ndarray], None],
    on_progress: Callable[[int], None] | None = None,
):
    """统一管道执行函数。

    遍历每张资源，按用户定义的 operation 顺序执行：
    - map op → 变换图像
    - reduce op → 采集图像状态到 ChainState（图像不变）

    Args:
        resource_paths: (rid, filename, path) 元组列表。
        operations: 操作列表（按顺序执行）。
        state: ChainState 实例。
        per_resource: 每张图像处理完毕后的回调 (idx, rid, filename, img)。
        on_progress: 进度回调 (0-100)。
    """
    total = len(resource_paths)
    for idx, (rid, filename, rpath) in enumerate(resource_paths):
        img = load_image(rpath)
        for i, op in enumerate(operations):
            if op.get("mode") == "reduce":
                state.accumulate(i, op, img, rid, filename)
            else:
                img = apply_map_op(img, op)
        per_resource(idx, rid, filename, img)
        del img
        if on_progress:
            on_progress(int((idx + 1) / total * 100))


def render_preview(
    image_path: Path,
    operations: list[dict],
    cache_path: Path,
    on_progress: Callable[[int], None] | None = None,
):
    """为单张资源渲染预览缩略图（200px 宽/高自适应）。

    reduce 操作不改变图像，预览仅关注 map 变换结果。

    Args:
        image_path: 原图路径。
        operations: 操作列表（按顺序执行，reduce 跳过）。
        cache_path: 缩略图缓存路径。
        on_progress: 进度回调。
    """
    img = load_image(image_path)
    total = len(operations)
    for i, op in enumerate(operations):
        if op.get("mode") != "reduce":
            img = apply_map_op(img, op)
        if on_progress:
            on_progress(int((i + 1) / total * 100) if total else 100)
    h, w = img.shape[:2]
    scale = 200 / max(h, w) if max(h, w) > 200 else 1.0
    if scale < 1:
        img = cv2.resize(img, (int(w * scale), int(h * scale)))
    save_image(img, cache_path)
    del img


def execute_chain(
    resource_paths: list[tuple[str, str, Path]],
    operations: list[dict],
    export_dir: Path,
    on_progress: Callable[[int], None] | None = None,
) -> BytesIO:
    """全量执行链，打包为 ZIP（处理后的图像 + analysis.json + analysis.txt）。

    Args:
        resource_paths: 资源路径列表。
        operations: 操作列表。
        export_dir: 临时输出目录。
        on_progress: 进度回调。

    Returns:
        包含导出文件的 ZIP 字节流 BytesIO。
    """
    fmt_op = next((op for op in operations if op["kind"] == "format"), None)
    output_fmt = fmt_op["params"]["type"] if fmt_op else "png"
    quality = fmt_op["params"].get("quality", 85) if fmt_op else 85

    state = ChainState(operations)
    output_paths: list[Path] = []

    def save_output(idx: int, rid: str, filename: str, img: np.ndarray):
        stem = Path(filename).stem
        out_path = export_dir / f"{stem}.{output_fmt}"
        save_image(img, out_path, quality=quality)
        output_paths.append(out_path)

    run_pipeline(resource_paths, operations, state, save_output, on_progress)
    results = state.finalize()

    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in output_paths:
            zf.write(p, p.name)
        if results:
            zf.writestr("analysis.json", json.dumps(results, indent=2))
        if state.text:
            zf.writestr("analysis.txt", state.text)
    buf.seek(0)
    return buf


def execute_and_preview(
    resource_paths: list[tuple[str, str, Path]],
    operations: list[dict],
    thumb_dir: Path,
    prefix: str,
) -> dict:
    """全量执行链，为每张资源保存缩略图 + 全尺寸预览图，返回分析结果。

    Args:
        resource_paths: 资源路径列表。
        operations: 操作列表。
        thumb_dir: 缩略图缓存目录。
        prefix: 文件名前缀（通常为 "execute-{pid}-{cid}"）。

    Returns:
        {"images": [{filename, index}], "analysis": {...}, "text": "..."}
    """
    state = ChainState(operations)
    images: list[dict] = []

    def save_output(idx: int, rid: str, filename: str, img: np.ndarray):
        full_path = thumb_dir / f"execfull-{prefix}-{idx}.jpg"
        save_image(img, full_path, quality=90)

        h, w = img.shape[:2]
        scale = 200 / max(h, w) if max(h, w) > 200 else 1.0
        if scale < 1:
            thumb = cv2.resize(img, (int(w * scale), int(h * scale)))
        else:
            thumb = img
        thumb_path = thumb_dir / f"{prefix}-{idx}.jpg"
        save_image(thumb, thumb_path)

        images.append({"filename": filename, "index": idx})

    run_pipeline(resource_paths, operations, state, save_output)
    results = state.finalize()

    return {"images": images, "analysis": results, "text": state.text}
