import json
import zipfile
from io import BytesIO

import cv2
import numpy as np
from pathlib import Path
from typing import Callable
from PIL import Image

from studio.operations import apply_map_op, reduce_init, reduce_accumulate, reduce_finalize, reduce_format


def load_image(path: Path) -> np.ndarray:
    pil = Image.open(path).convert("RGB")
    img = np.array(pil)
    return cv2.cvtColor(img, cv2.COLOR_RGB2BGR)


def save_image(img: np.ndarray, path: Path, quality: int = 85):
    path.parent.mkdir(parents=True, exist_ok=True)
    if img.ndim == 2:
        Image.fromarray(img).save(path, quality=quality)
    else:
        Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB)).save(path, quality=quality)


class TextBuffer:
    def __init__(self):
        self._lines: list[str] = []

    def append(self, text: str):
        self._lines.append(text)

    def content(self) -> str:
        return "\n".join(self._lines)


class ChainState:
    def __init__(self, operations: list[dict]):
        self._ops = operations
        self._acc: dict[int, dict] = {}
        self._text = TextBuffer()
        for i, op in enumerate(operations):
            if op.get("mode") == "reduce":
                self._acc[i] = reduce_init(op)

    def accumulate(self, idx: int, op: dict, img: np.ndarray, rid: str):
        if idx in self._acc:
            self._acc[idx] = reduce_accumulate(op, self._acc[idx], img, rid)

    def finalize(self) -> dict[str, dict]:
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
        return self._text.content()


def run_pipeline(
    resource_paths: list[tuple[str, str, Path]],
    operations: list[dict],
    state: ChainState,
    per_resource: Callable[[int, str, str, np.ndarray], None],
    on_progress: Callable[[int], None] | None = None,
):
    total = len(resource_paths)
    for idx, (rid, filename, rpath) in enumerate(resource_paths):
        img = load_image(rpath)
        for i, op in enumerate(operations):
            if op.get("mode") == "reduce":
                state.accumulate(i, op, img, rid)
            else:
                img = apply_map_op(img, op)
        per_resource(idx, rid, filename, img)
        del img
        if on_progress:
            on_progress(int((idx + 1) / total * 100))


def render_preview(image_path: Path, operations: list[dict], cache_path: Path,
                   on_progress: Callable[[int], None] | None = None):
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


def execute_chain(resource_paths: list[tuple[str, str, Path]], operations: list[dict],
                  export_dir: Path, on_progress: Callable[[int], None] | None = None) -> BytesIO:
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


def execute_and_preview(resource_paths: list[tuple[str, str, Path]], operations: list[dict],
                        thumb_dir: Path, prefix: str) -> dict:
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
