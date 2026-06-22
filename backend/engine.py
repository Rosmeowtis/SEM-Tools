import cv2
import numpy as np
from pathlib import Path
from typing import Callable
from PIL import Image


def load_image(path: Path) -> np.ndarray:
    pil = Image.open(path).convert("RGB")
    img = np.array(pil)
    return cv2.cvtColor(img, cv2.COLOR_RGB2BGR)


def save_image(img: np.ndarray, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    if img.ndim == 2:
        Image.fromarray(img).save(path)
    else:
        Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB)).save(path)


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
    return img


def render_preview(image_path: Path, operations: list[dict], cache_path: Path,
                   on_progress: Callable[[int], None] | None = None):
    img = load_image(image_path)
    map_ops = [op for op in operations if op.get("mode") == "map"]
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
