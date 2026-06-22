import json
import zipfile
from io import BytesIO

import cv2
import numpy as np
from pathlib import Path
from typing import Callable
from PIL import Image


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


def apply_map_op(img: np.ndarray, op: dict) -> np.ndarray:
    kind, params = op["kind"], op["params"]
    if kind == "crop":
        return img[params["y"]:params["y"]+params["h"], params["x"]:params["x"]+params["w"]]
    elif kind == "resize":
        interp = cv2.INTER_NEAREST if params.get("algorithm") == "nearest" else cv2.INTER_LINEAR
        return cv2.resize(img, (params["w"], params["h"]), interpolation=interp)
    elif kind == "grayscale":
        if img.ndim == 3:
            return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        return img
    elif kind == "blur":
        k = params.get("ksize", 3)
        if k % 2 == 0: k += 1
        return cv2.GaussianBlur(img, (k, k), 0)
    elif kind == "threshold":
        t = params.get("threshold", 127)
        gray = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        _, binary = cv2.threshold(gray, t, 255, cv2.THRESH_BINARY)
        return binary
    elif kind == "morphology_ellipse":
        t = cv2.MORPH_OPEN if params.get("type") == "open" else cv2.MORPH_CLOSE
        k = params.get("ksize", 3)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
        return cv2.morphologyEx(img, t, kernel)
    elif kind == "invert":
        return cv2.bitwise_not(img)
    elif kind == "format":
        return img
    return img


def _reduce_init(op: dict) -> dict:
    params = op["params"]
    t = params.get("type", "porosity")
    if t == "porosity":
        return {"total_white": 0.0, "total_pixels": 0, "per_image": []}
    elif t == "statistics":
        return {"values": []}
    elif t == "distribution":
        return {"particle_areas": [], "equiv_diameters": []}
    return {}


def _reduce_accumulate(op: dict, state: dict, img: np.ndarray, rid: str) -> dict:
    params = op["params"]
    t = params.get("type", "porosity")
    gray = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    if t == "porosity":
        _, binary = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY)
        white = np.sum(binary == 255)
        total = binary.size
        state["total_white"] += float(white)
        state["total_pixels"] += int(total)
        state["per_image"].append({"rid": rid, "porosity": float(white / total)})
    elif t == "statistics":
        state["values"].extend(gray.ravel().tolist())
    elif t == "distribution":
        _, binary = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY)
        num_labels, _, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
        areas = stats[1:, cv2.CC_STAT_AREA].tolist()
        state["particle_areas"].extend(areas)
        state["equiv_diameters"].extend([2 * np.sqrt(a / np.pi) for a in areas])
    return state


def _reduce_finalize(op: dict, state: dict) -> dict:
    t = op["params"].get("type", "porosity")
    if t == "porosity":
        overall = state["total_white"] / state["total_pixels"] if state["total_pixels"] else 0
        return {"overall": overall, "per_image": state["per_image"]}
    elif t == "statistics":
        arr = np.array(state["values"]) if state["values"] else np.array([0])
        return {"count": int(len(arr)), "mean": float(arr.mean()),
                "std": float(arr.std()), "min": float(arr.min()), "max": float(arr.max()),
                "p50": float(np.percentile(arr, 50)), "p95": float(np.percentile(arr, 95)),
                "p99": float(np.percentile(arr, 99))}
    elif t == "distribution":
        return {"particle_areas": state["particle_areas"],
                "equiv_diameters": state["equiv_diameters"]}
    return {}


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
        reduce_states[i] = _reduce_init(op)

    output_paths: list[Path] = []
    for idx, (rid, rpath) in enumerate(resource_paths):
        img = load_image(rpath)
        for op in map_ops:
            img = apply_map_op(img, op)

        out_path = export_dir / f"{rid}.{output_fmt}"
        save_image(img, out_path, quality=quality)
        output_paths.append(out_path)

        for i, op in enumerate(reduce_ops):
            reduce_states[i] = _reduce_accumulate(op, reduce_states[i], img, rid)

        del img
        if on_progress:
            on_progress(int((idx + 1) / total * 100))

    results = {}
    for i, op in enumerate(reduce_ops):
        key = f"{op['kind']}-{i}"
        results[key] = _reduce_finalize(op, reduce_states[i])

    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in output_paths:
            zf.write(p, p.name)
        if results:
            zf.writestr("analysis.json", json.dumps(results, indent=2))
    buf.seek(0)
    return buf
