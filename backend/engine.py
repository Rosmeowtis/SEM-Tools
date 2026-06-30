"""链式图像处理执行引擎。

核心概念：
- **管道式执行**：operations 严格按用户定义顺序执行。
- **map**：变换图像，输出传给下一个操作。
- **reduce**：在当前位置"采集"图像状态，写入 ChainState 副作用容器，
  图像本身继续向后流动（不阻塞管道）。
- **ChainState**：管理所有 reduce 累加器 + TextBuffer（人类可读的分析报告）。
- **run_pipeline**：统一管道函数，execute_chain 和 execute_and_preview
  共享此核心，仅通过 per_resource 回调区分保存逻辑。

operations 参数现在接受 Pydantic 模型实例（list[OpBase]），使用属性访问
（op.kind / op.mode / op.params）替代原来的 dict API（op["kind"] 等），
以支持类型安全并消除 execute 入口的 AttributeError。
"""

import json
import zipfile
from io import BytesIO
from pathlib import Path
from typing import Callable, cast

import cv2
import numpy as np
from loguru import logger
from PIL import Image
from studio.models import FormatOp, OpBase, Operation, ReduceOpBase
from studio.operations import (
    apply_map_op,
    reduce_accumulate,
    reduce_finalize,
    reduce_format,
    reduce_init,
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


class ChainState:
    """链执行副作用状态容器。

    - 预初始化所有 reduce 操作的累加器。
    - accumulate(idx, op, img, rid, filename)：reduce 操作采集当前图像状态。
    - finalize()：全部资源处理完毕后，完成聚合，写入 TextBuffer。
    - text：获取人类可读的分析报告文本。
    """

    def __init__(self, operations: "list[OpBase]"):
        self._ops = operations
        self._acc: dict[int, dict] = {}
        self._text_lines: list[str] = []
        self._provenance: list[dict] = []
        self._cur_prov: list[dict] | None = None
        self._cur_rid: str = ""
        self._cur_fn: str = ""
        self._cur_step: int = 0
        self._cur_kind: str = ""
        for i, op in enumerate(operations):
            if op.mode == "reduce":
                op: ReduceOpBase = cast(ReduceOpBase, op)
                self._acc[i] = reduce_init(op)

    def accumulate(
        self,
        idx: int,
        op: "ReduceOpBase",
        img: np.ndarray,
        rid: str,
        filename: str = "",
    ):
        """Reduce 操作在当前位置采集图像数据。"""
        if idx in self._acc:
            self._acc[idx] = reduce_accumulate(op, self._acc[idx], img, rid, filename)

    def begin_resource(self, rid: str, filename: str):
        """标记开始处理一张新资源，重置溯源缓冲。"""
        self._cur_prov = []
        self._cur_rid, self._cur_fn = rid, filename

    def set_map_context(self, step: int, kind: str):
        """run_pipeline 在每个 map op 前调用，告知当前步号与 kind。"""
        self._cur_step, self._cur_kind = step, kind

    def add_provenance(self, auto: dict):
        """op 函数调用，记录自动推算的参数。step/kind 由 state 内部提供。"""
        if self._cur_prov is not None:
            self._cur_prov.append(
                {**auto, "step": self._cur_step, "kind": self._cur_kind}
            )

    def end_resource(self):
        """结束当前资源，若有溯源条目则归档。"""
        if self._cur_prov:
            self._provenance.append(
                {
                    "resource_id": self._cur_rid,
                    "filename": self._cur_fn,
                    "entries": self._cur_prov,
                }
            )
        self._cur_prov = None

    @property
    def provenance(self) -> list[dict]:
        """每资源一条的自动参数溯源记录。"""
        return self._provenance

    def finalize(self) -> dict[str, dict]:
        """完成所有 reduce 聚合，填充 TextBuffer，返回机器可读的分析结果字典。

        Returns:
            形如 {"analyze-0": {...}, "analyze-1": {...}}。
        """
        results: dict[str, dict] = {}
        for i, op in enumerate(self._ops):
            if i in self._acc:  # 只有 reduce op 会进入 self._acc
                op: ReduceOpBase = cast(ReduceOpBase, op)
                key = f"{op.kind}-{i}"
                results[key] = reduce_finalize(op, self._acc[i])
                op_type = getattr(op.params, "type", "?")
                text = reduce_format(op, results[key])
                if text:
                    self._text_lines.append(f"# {op.kind}-{i} ({op_type})\n{text}\n")
        return results

    @property
    def text(self) -> str:
        """获取人类可读的分析报告（TAB 分隔文本表格）。"""
        return "\n".join(self._text_lines)


def run_pipeline(
    resource_paths: list[tuple[str, str, Path]],
    operations: "list[OpBase]",
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
        operations: Operation 实例列表（按顺序执行）。
        state: ChainState 实例。
        per_resource: 每张图像处理完毕后的回调 (idx, rid, filename, img)。
        on_progress: 进度回调 (0-100)。
    """
    total = len(resource_paths)
    for idx, (rid, filename, rpath) in enumerate(resource_paths):
        try:
            img = load_image(rpath)
            state.begin_resource(rid, filename)
            for i, op in enumerate(operations):
                if op.mode == "reduce":
                    op: ReduceOpBase = cast(ReduceOpBase, op)
                    state.accumulate(i, op, img, rid, filename)
                else:
                    state.set_map_context(i, op.kind)
                    img = apply_map_op(img, op, state)
            state.end_resource()
            per_resource(idx, rid, filename, img)
            del img
            if on_progress:
                on_progress(int((idx + 1) / total * 100))
        except Exception as e:
            logger.exception("pipeline failed resource={} ({}): {}", rid, filename, e)
            raise e


def _format_provenance_text(provenance: list[dict]) -> str:
    """将 provenance 列表格式化为 TAB 分隔的人可读表格。"""
    if not provenance:
        return ""
    lines = ["# provenance"]
    all_keys: list[str] = []
    for item in provenance:
        for entry in item.get("entries", []):
            for key in entry.get("params", {}):
                if key not in all_keys:
                    all_keys.append(key)
    header = "filename\tstep\tkind\t" + "\t".join(all_keys)
    lines.append(header)
    for item in provenance:
        fn = item.get("filename", "")
        for entry in item.get("entries", []):
            params = entry.get("params", {})
            vals = "\t".join(str(params.get(k, "")) for k in all_keys)
            lines.append(f"{fn}\t{entry.get('step', 0) + 1}\t{entry.get('kind', '?')}\t{vals}")
    return "\n".join(lines)


def execute_chain(
    resource_paths: list[tuple[str, str, Path]],
    operations: "list[Operation]",
    export_dir: Path,
    on_progress: Callable[[int], None] | None = None,
) -> BytesIO:
    """全量执行链，打包为 ZIP（处理后的图像 + analysis.json + analysis.txt）。

    Args:
        resource_paths: 资源路径列表。
        operations: Operation 实例列表。
        export_dir: 临时输出目录。
        on_progress: 进度回调。

    Returns:
        包含导出文件的 ZIP 字节流 BytesIO。
    """
    fmt_op: FormatOp = cast(
        FormatOp, next((op for op in operations if op.kind == "format"), None)
    )
    output_fmt = fmt_op.params.type if fmt_op else "png"
    quality = getattr(fmt_op.params, "quality", 85) if fmt_op else 85

    logger.info("execute_chain start resources={} ops={}", len(resource_paths), len(operations))
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
        text_parts = []
        if state.text:
            text_parts.append(state.text)
        if state.provenance:
            zf.writestr("provenance.json", json.dumps(state.provenance, indent=2))
            text_parts.append(_format_provenance_text(state.provenance))
        if text_parts:
            zf.writestr("analysis.txt", "\n\n".join(text_parts))
    buf.seek(0)
    logger.info("execute_chain done output_files={}", len(output_paths))
    return buf


def execute_and_preview(
    resource_paths: list[tuple[str, str, Path]],
    operations: "list[Operation]",
    thumb_dir: Path,
    prefix: str,
) -> dict:
    """全量执行链，为每张资源保存缩略图 + 全尺寸预览图，返回分析结果。

    Args:
        resource_paths: 资源路径列表。
        operations: Operation 实例列表。
        thumb_dir: 缩略图缓存目录。
        prefix: 文件名前缀（通常为 "execute-{pid}-{cid}"）。

    Returns:
        {"images": [{filename, index}], "analysis": {...}, "text": "..."}
    """
    logger.info("execute_and_preview start resources={} ops={}", len(resource_paths), len(operations))
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

    logger.info("execute_and_preview done images={}", len(images))
    return {"images": images, "analysis": results, "text": state.text,
            "provenance": state.provenance}


if __name__ == "__main__":
    """自检：验证 ChainState provenance 在 run_pipeline 中正确收集。"""
    from studio.models import AutoThresholdOp, AutoThresholdParams

    np.random.seed(42)
    img = (np.random.rand(64, 64) * 255).astype(np.uint8)
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        tdir = Path(td)
        img_path = tdir / "test.png"
        cv2.imwrite(str(img_path), img)

        ops = [AutoThresholdOp(params=AutoThresholdParams(algorithm="left_peak", offset=0))]
        state = ChainState(ops)
        thumb = tdir / "thumbs"
        thumb.mkdir()

        run_pipeline([("r1", "test.png", img_path)], ops, state,
                     lambda i, r, f, img2: None)

        prov = state.provenance
        assert len(prov) == 1, f"expected 1 provenance item, got {len(prov)}"
        item = prov[0]
        assert item["resource_id"] == "r1"
        assert len(item["entries"]) == 1
        entry = item["entries"][0]
        assert entry["step"] == 0
        assert entry["kind"] == "auto_threshold"
        assert "params" in entry
        assert "threshold" in entry["params"]
        assert 0 <= entry["params"]["threshold"] <= 255
        print(f"SELF-CHECK PASSED: threshold={entry['params']['threshold']}, algorithm={entry['params']['algorithm']}")
