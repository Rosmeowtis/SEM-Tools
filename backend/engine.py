import json
import zipfile
from io import BytesIO

import cv2
import numpy as np
from pathlib import Path
from typing import Callable
from PIL import Image

from studio.operations import apply_map_op, reduce_init, reduce_accumulate, reduce_finalize


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


def render_preview(image_path: Path, operations: list[dict], cache_path: Path,
                   on_progress: Callable[[int], None] | None = None):
    img = load_image(image_path)
    map_ops = [op for op in operations if op.get("mode") != "reduce"]
    for i, op in enumerate(map_ops):
        img = apply_map_op(img, op)
        if on_progress:
            on_progress(int((i + 1) / len(map_ops) * 100))
    h, w = img.shape[:2]
    scale = 200 / max(h, w) if max(h, w) > 200 else 1.0
    if scale < 1:
        img = cv2.resize(img, (int(w * scale), int(h * scale)))
    save_image(img, cache_path)
    del img


def execute_chain(resource_paths: list[tuple[str, Path]], operations: list[dict],
                  export_dir: Path, on_progress: Callable[[int], None] | None = None) -> BytesIO:
    map_ops = [op for op in operations if op.get("mode") != "reduce"]
    reduce_ops = [op for op in operations if op.get("mode") == "reduce"]
    total = len(resource_paths)

    fmt_op = next((op for op in operations if op["kind"] == "format"), None)
    output_fmt = fmt_op["params"]["type"] if fmt_op else "png"
    quality = fmt_op["params"].get("quality", 85) if fmt_op else 85

    reduce_states = {}
    for i, op in enumerate(reduce_ops):
        reduce_states[i] = reduce_init(op)

    output_paths: list[Path] = []
    for idx, (rid, rpath) in enumerate(resource_paths):
        img = load_image(rpath)
        for op in map_ops:
            img = apply_map_op(img, op)

        out_path = export_dir / f"{rid}.{output_fmt}"
        save_image(img, out_path, quality=quality)
        output_paths.append(out_path)

        for i, op in enumerate(reduce_ops):
            reduce_states[i] = reduce_accumulate(op, reduce_states[i], img, rid)

        del img
        if on_progress:
            on_progress(int((idx + 1) / total * 100))

    results = {}
    for i, op in enumerate(reduce_ops):
        key = f"{op['kind']}-{i}"
        results[key] = reduce_finalize(op, reduce_states[i])

    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in output_paths:
            zf.write(p, p.name)
        if results:
            zf.writestr("analysis.json", json.dumps(results, indent=2))
    buf.seek(0)
    return buf


def execute_and_preview(resource_paths: list[tuple[str, str, Path]], operations: list[dict],
                        thumb_dir: Path, prefix: str) -> dict:
    """Execute chain: render all images + save thumbnails + full images + return analysis.
    resource_paths: list of (rid, filename, path)"""
    map_ops = [op for op in operations if op.get("mode") != "reduce"]
    reduce_ops = [op for op in operations if op.get("mode") == "reduce"]

    reduce_states = {}
    for i, op in enumerate(reduce_ops):
        reduce_states[i] = reduce_init(op)

    images = []
    for i, (rid, filename, rpath) in enumerate(resource_paths):
        img = load_image(rpath)
        for op in map_ops:
            img = apply_map_op(img, op)

        full_path = thumb_dir / f"execfull-{prefix}-{i}.jpg"
        save_image(img, full_path, quality=90)

        h, w = img.shape[:2]
        scale = 200 / max(h, w) if max(h, w) > 200 else 1.0
        if scale < 1:
            thumb = cv2.resize(img, (int(w * scale), int(h * scale)))
        else:
            thumb = img
        thumb_path = thumb_dir / f"{prefix}-{i}.jpg"
        save_image(thumb, thumb_path)

        for j, op in enumerate(reduce_ops):
            reduce_states[j] = reduce_accumulate(op, reduce_states[j], img, rid)

        del img
        images.append({"filename": filename, "index": i})

    results = {}
    for i, op in enumerate(reduce_ops):
        key = f"{op['kind']}-{i}"
        results[key] = reduce_finalize(op, reduce_states[i])

    return {"images": images, "analysis": results}
